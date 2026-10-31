import { displayToGrade } from "../domain/loadCalculator";
import type { AppSettings, Grade, ProblemEntry, SessionInput } from "../types";

// Boardsesh's GraphQL backend only allows CORS from its own sites, so requests go through our read-only proxy
// (api/boardsesh.ts on Vercel, the Vite dev-server proxy locally). Only public logbook data is read; no sign-in.
const ENDPOINT = "/api/boardsesh";
/** Boardsesh caps a feed page at 50 items. */
const PAGE_SIZE = 50;
/** Hard stop so a huge logbook can't turn one sync into hundreds of requests (2,000 ticks per sync). */
const MAX_PAGES = 40;

export interface BoardseshUser {
  id: string;
  displayName: string;
  recentAscentCount?: number;
}

interface FeedItem {
  uuid: string;
  climbUuid: string;
  climbName: string;
  boardType: string;
  angle: number;
  status: "flash" | "send" | "attempt";
  attemptCount: number;
  difficultyName: string | null;
  consensusDifficultyName: string | null;
  climbedAt: string;
}

export interface BoardseshClimb {
  climbUuid: string;
  board: string;
  grade?: Grade;
  sent: boolean;
  tries: number;
}

export interface BoardseshDay {
  date: string;
  climbs: BoardseshClimb[];
}

export class BoardseshError extends Error {}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  let payload: { data?: T | null; errors?: { message: string }[] };
  try {
    payload = await response.json();
  } catch {
    throw new BoardseshError(`Boardsesh request failed (HTTP ${response.status}).`);
  }
  if (payload.errors?.length) throw new BoardseshError(payload.errors[0].message);
  if (!payload.data) throw new BoardseshError(`Boardsesh returned no data (HTTP ${response.status}).`);
  return payload.data;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Find climbers by name, or resolve a pasted profile link / id (boardsesh.com/profile/<id>) to that one climber. */
export async function findBoardseshUsers(nameOrLink: string): Promise<BoardseshUser[]> {
  const text = nameOrLink.trim();
  const id = text.match(UUID_PATTERN)?.[0];

  if (id) {
    const data = await gql<{ publicProfile: { id: string; displayName: string | null } | null }>(
      `query publicProfile($userId: ID!) { publicProfile(userId: $userId) { id displayName } }`,
      { userId: id },
    );
    return data.publicProfile ? [{ id: data.publicProfile.id, displayName: data.publicProfile.displayName ?? "Boardsesh climber" }] : [];
  }

  if (text.length < 2) return [];
  const data = await gql<{
    searchUsers: { results: Array<{ recentAscentCount: number; user: { id: string; displayName: string | null } }> };
  }>(
    `query searchUsers($input: SearchUsersInput!) {
      searchUsers(input: $input) { results { recentAscentCount user { id displayName } } }
    }`,
    { input: { query: text, limit: 8 } },
  );
  return data.searchUsers.results.map((result) => ({
    id: result.user.id,
    displayName: result.user.displayName ?? "Boardsesh climber",
    recentAscentCount: result.recentAscentCount,
  }));
}

/** "6c+/V5" → V5; also handles "V5" alone and Font-only names. */
export function boardseshGradeToV(name: string | null): Grade | undefined {
  if (!name) return undefined;
  const v = name.match(/V(\d{1,2})/i);
  if (v) {
    const grade = `V${Math.min(17, Number(v[1]))}`;
    return grade as Grade;
  }
  const font = name.split("/")[0].trim();
  return (displayToGrade(font, "font") as Grade | undefined) ?? undefined;
}

function toLocalIsoDate(climbedAt: string): string {
  // Boardsesh returns "YYYY-MM-DD HH:MM:SS.mmm" in UTC.
  const date = new Date(`${climbedAt.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(climbedAt) ? "" : "Z"}`);
  if (Number.isNaN(date.getTime())) return climbedAt.slice(0, 10);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function boardLabel(item: FeedItem): string {
  const board = item.boardType.charAt(0).toUpperCase() + item.boardType.slice(1);
  return item.angle ? `${board} ${item.angle}°` : board;
}

/** Every public tick since `sinceDate` (YYYY-MM-DD), grouped into climbing days with one entry per climb. */
export async function fetchBoardseshDays(userId: string, sinceDate: string): Promise<BoardseshDay[]> {
  const items: FeedItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql<{ userAscentsFeed: { items: FeedItem[]; hasMore: boolean } }>(
      `query boardseshFeed($userId: ID!, $input: AscentFeedInput) {
        userAscentsFeed(userId: $userId, input: $input) {
          hasMore
          items { uuid climbUuid climbName boardType angle status attemptCount difficultyName consensusDifficultyName climbedAt }
        }
      }`,
      { userId, input: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, statusMode: "both", fromDate: sinceDate } },
    );
    items.push(...data.userAscentsFeed.items);
    if (!data.userAscentsFeed.hasMore) break;
  }

  const days = new Map<string, Map<string, BoardseshClimb>>();
  for (const item of items) {
    const date = toLocalIsoDate(item.climbedAt);
    if (date < sinceDate) continue;
    const climbs = days.get(date) ?? new Map<string, BoardseshClimb>();
    // A climb at another angle is a different problem.
    const key = `${item.climbUuid}@${item.angle}`;
    const sent = item.status !== "attempt";
    // Your own grade on a send wins; attempts carry only the community grade.
    const grade = boardseshGradeToV(sent ? (item.difficultyName ?? item.consensusDifficultyName) : item.consensusDifficultyName);
    const existing = climbs.get(key);
    if (existing) {
      existing.sent ||= sent;
      existing.tries += Math.max(1, item.attemptCount);
      if (sent && grade) existing.grade = grade;
      existing.grade ??= grade;
    } else {
      climbs.set(key, { climbUuid: item.climbUuid, board: boardLabel(item), grade, sent, tries: Math.max(1, item.attemptCount) });
    }
    days.set(date, climbs);
  }

  return [...days.entries()].map(([date, climbs]) => ({ date, climbs: [...climbs.values()] }));
}

/** One session per board day. Every problem counts as a board problem, so it gets the board multiplier. */
export function boardseshDayToSession(day: BoardseshDay, userId: string, settings: AppSettings): SessionInput | undefined {
  const mode = settings.boardsesh.countMode;
  const counts = new Map<Grade, number>();
  for (const climb of day.climbs) {
    if (!climb.grade || (mode === "sent" && !climb.sent)) continue;
    counts.set(climb.grade, (counts.get(climb.grade) ?? 0) + (mode === "tries" ? climb.tries : 1));
  }
  if (counts.size === 0) return undefined;

  const problems: ProblemEntry[] = [...counts.entries()].map(([grade, count]) => ({
    id: `boardsesh-${day.date}-${grade}`,
    count,
    grade,
    holdType: "mixed",
    wallAngle: "board",
    climbedOn: day.date,
  }));

  return {
    id: `boardsesh-${userId}-${day.date}`,
    createdAt: `${day.date}T12:00:00Z`,
    durationMinutes: settings.boardsesh.defaultDurationMinutes,
    sleepHours: settings.model.recovery.personalMaxSleepHours,
    stress: 5,
    motivation: 5,
    problems,
    source: "boardsesh",
    boardsesh: {
      boards: [...new Set(day.climbs.map((climb) => climb.board))],
      climbsTried: day.climbs.length,
      climbsSent: day.climbs.filter((climb) => climb.sent).length,
      tries: day.climbs.reduce((sum, climb) => sum + climb.tries, 0),
    },
  };
}
