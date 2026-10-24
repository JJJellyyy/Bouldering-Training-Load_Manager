import type { AppSettings, Grade, ProblemEntry, SessionInput, WallAngle } from "../types";

// TopLogger's GraphQL API only allows CORS from app.toplogger.nu, so requests go through our proxy
// (api/toplogger.ts on Vercel, the Vite dev-server proxy locally).
const ENDPOINT = "/api/toplogger";
const AUTH_STORAGE_KEY = "blm_toplogger_auth";
const ACCESS_TOKEN_MARGIN_MS = 60_000;

export interface TopLoggerAuth {
  refreshToken: string;
  refreshExpiresAt?: string;
  accessToken?: string;
  accessExpiresAt?: string;
  userId?: string;
  userName?: string;
}

export interface TopLoggerClimb {
  climbId: string;
  grade: number;
  ticked: boolean;
  wallName?: string;
}

export interface TopLoggerClimbDay {
  id: string;
  date: string;
  gymName?: string;
  climbs: TopLoggerClimb[];
}

interface TokenPair {
  access: { token: string; expiresAt: string };
  refresh: { token: string; expiresAt: string };
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export class TopLoggerError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Paste this into the browser console on app.toplogger.nu (while signed in) to copy the refresh token. */
export const TOPLOGGER_TOKEN_SNIPPET =
  "copy(Object.values(localStorage).map(v=>{try{const j=JSON.parse(v);return j?.refresh?.token??j?.tokens?.refresh?.token}catch{}}).find(Boolean)??'not found')";

export function readTopLoggerAuth(): TopLoggerAuth | undefined {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as TopLoggerAuth;
    return parsed.refreshToken ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function storeTopLoggerAuth(auth: TopLoggerAuth | undefined): void {
  if (!auth) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

async function gql<T>(query: string, variables: Record<string, unknown>, accessToken?: string): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  let payload: GraphQLResponse<T>;
  try {
    payload = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new TopLoggerError(`TopLogger request failed (HTTP ${response.status}).`);
  }

  if (payload.errors?.length) {
    const first = payload.errors[0];
    throw new TopLoggerError(first.message, first.extensions?.code);
  }

  if (!payload.data) {
    throw new TopLoggerError(`TopLogger returned no data (HTTP ${response.status}).`);
  }

  return payload.data;
}

async function refreshTokens(auth: TopLoggerAuth): Promise<TopLoggerAuth> {
  const data = await gql<{ tokens: TokenPair }>(
    `mutation authSigninRefreshToken($refreshToken: JWT!) {
      tokens: authSigninRefreshToken(refreshToken: $refreshToken) {
        access { token expiresAt }
        refresh { token expiresAt }
      }
    }`,
    { refreshToken: auth.refreshToken },
  );

  const next: TopLoggerAuth = {
    ...auth,
    refreshToken: data.tokens.refresh.token,
    refreshExpiresAt: data.tokens.refresh.expiresAt,
    accessToken: data.tokens.access.token,
    accessExpiresAt: data.tokens.access.expiresAt,
  };
  // The refresh token rotates, so persist the new one immediately.
  storeTopLoggerAuth(next);
  return next;
}

async function ensureAccessToken(auth: TopLoggerAuth): Promise<TopLoggerAuth> {
  const expiresAt = auth.accessExpiresAt ? new Date(auth.accessExpiresAt).getTime() : 0;
  if (auth.accessToken && Date.now() < expiresAt - ACCESS_TOKEN_MARGIN_MS) {
    return auth;
  }

  return refreshTokens(auth);
}

/** Validate a pasted refresh token and look up the TopLogger user it belongs to. */
export async function connectTopLogger(refreshToken: string): Promise<TopLoggerAuth> {
  const trimmed = refreshToken.trim().replace(/^"|"$/g, "");
  const auth = await refreshTokens({ refreshToken: trimmed });
  const data = await gql<{ userMe: { id: string; fullName: string } }>(
    `query userMe { userMe { id fullName } }`,
    {},
    auth.accessToken,
  );

  const connected: TopLoggerAuth = { ...auth, userId: data.userMe.id, userName: data.userMe.fullName };
  storeTopLoggerAuth(connected);
  return connected;
}

function toLocalIsoDate(dateTime: string): string {
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return dateTime.slice(0, 10);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface ClimbDayRow {
  id: string;
  statsAtDate: string;
  gymId: string | null;
  gym: { name: string } | null;
}

interface ClimbLogRow {
  id: string;
  climbId: string;
  ticked: boolean;
  climb: { id: string; grade: number | null; wall: { nameLoc: string | null } | null } | null;
}

interface Paginated<T> {
  pagination: { total: number };
  data: T[];
}

const PAGE_SIZE_DAYS = 50;
const PAGE_SIZE_LOGS = 100;

/** All boulder climb days since `sinceDate` (YYYY-MM-DD), with the climbs logged on each. */
export async function fetchTopLoggerBoulderDays(
  initialAuth: TopLoggerAuth,
  sinceDate: string,
): Promise<{ auth: TopLoggerAuth; days: TopLoggerClimbDay[] }> {
  let auth = await ensureAccessToken(initialAuth);
  if (!auth.userId) {
    auth = await connectTopLogger(auth.refreshToken);
  }
  const userId = auth.userId as string;

  const dayRows: ClimbDayRow[] = [];
  for (let page = 1; ; page++) {
    const data = await gql<{ climbDaysPaginated: Paginated<ClimbDayRow> }>(
      `query climbDaysSessionsList($userId: ID!, $statsAtDateMin: DateTime, $pagination: PaginationInputClimbDays) {
        climbDaysPaginated(
          userId: $userId
          totalTriesMin: 1
          bouldersTotalTriesMin: 1
          statsAtDateMin: $statsAtDateMin
          pagination: $pagination
          updateDayStatsIfOld: true
        ) {
          pagination { total }
          data { id statsAtDate gymId gym { name } }
        }
      }`,
      {
        userId,
        statsAtDateMin: `${sinceDate}T00:00:00.000Z`,
        pagination: { page, perPage: PAGE_SIZE_DAYS, orderBy: [{ key: "statsAtDate", order: "desc" }] },
      },
      auth.accessToken,
    );

    dayRows.push(...data.climbDaysPaginated.data);
    if (data.climbDaysPaginated.data.length < PAGE_SIZE_DAYS || dayRows.length >= data.climbDaysPaginated.pagination.total) {
      break;
    }
  }

  const days: TopLoggerClimbDay[] = [];
  for (const day of dayRows) {
    auth = await ensureAccessToken(auth);
    const logs: ClimbLogRow[] = [];

    for (let page = 1; ; page++) {
      const data = await gql<{ climbLogs: Paginated<ClimbLogRow> }>(
        `query climbLogsSession($gymId: ID, $userId: ID!, $climbedAtDate: DateTime, $pagination: PaginationInputClimbLogs) {
          climbLogs(gymId: $gymId, userId: $userId, climbedAtDate: $climbedAtDate, climbType: boulder, pagination: $pagination) {
            pagination { total }
            data { id climbId ticked climb { id grade wall { nameLoc } } }
          }
        }`,
        {
          gymId: day.gymId,
          userId,
          climbedAtDate: day.statsAtDate,
          pagination: { page, perPage: PAGE_SIZE_LOGS },
        },
        auth.accessToken,
      );

      logs.push(...data.climbLogs.data);
      if (data.climbLogs.data.length < PAGE_SIZE_LOGS || logs.length >= data.climbLogs.pagination.total) {
        break;
      }
    }

    // A climb can have several logs (one per try); collapse to one entry per climb.
    const climbs = new Map<string, TopLoggerClimb>();
    for (const log of logs) {
      const climbId = log.climb?.id ?? log.climbId;
      const existing = climbs.get(climbId);
      if (existing) {
        existing.ticked ||= log.ticked;
      } else {
        climbs.set(climbId, {
          climbId,
          grade: log.climb?.grade ?? 0,
          ticked: log.ticked,
          wallName: log.climb?.wall?.nameLoc ?? undefined,
        });
      }
    }

    days.push({
      id: day.id,
      date: toLocalIsoDate(day.statsAtDate),
      gymName: day.gym?.name,
      climbs: Array.from(climbs.values()),
    });
  }

  return { auth, days };
}

// TopLogger's internal grade scale (600 = 6a, 700 = 7a) mapped to V grades, from TopLogger's own V-scale table.
const TOPLOGGER_V_SCALE: Array<[number, Grade]> = [
  [400, "V0"], [500, "V1"], [550, "V2"], [600, "V3"], [633, "V4"], [667, "V5"],
  [700, "V6"], [720, "V7"], [740, "V8"], [760, "V9"], [780, "V10"], [800, "V11"],
  [817, "V12"], [833, "V13"], [850, "V14"], [867, "V15"], [883, "V16"], [900, "V17"],
];

export function topLoggerGradeToV(value: number): Grade | undefined {
  if (!value || value <= 0) return undefined;
  if (value <= TOPLOGGER_V_SCALE[0][0]) return "V0";

  let best = TOPLOGGER_V_SCALE[0];
  for (const entry of TOPLOGGER_V_SCALE) {
    if (Math.abs(entry[0] - value) < Math.abs(best[0] - value)) best = entry;
  }
  return best[1];
}

export function wallNameToAngle(wallName: string | undefined): WallAngle {
  const name = (wallName ?? "").toLowerCase();
  if (/slab|plaat/.test(name)) return "slab";
  if (/roof|\bdak\b|cave/.test(name)) return "roof";
  if (/board|moon|kilter|tension|spray/.test(name)) return "board";
  if (/overhang|steep|overhel/.test(name)) return "overhang";
  if (/vert|recht|straight/.test(name)) return "vert";
  return "mixed";
}

/** Convert a TopLogger climb day to a session; returns undefined when no climb counts (e.g. only failed tries in "sent" mode). */
export function topLoggerDayToSession(day: TopLoggerClimbDay, settings: AppSettings): SessionInput | undefined {
  const grouped = new Map<string, ProblemEntry>();

  for (const climb of day.climbs) {
    if (settings.toplogger.countMode === "sent" && !climb.ticked) continue;
    const grade = topLoggerGradeToV(climb.grade);
    if (!grade) continue;

    const wallAngle = wallNameToAngle(climb.wallName);
    const key = `${grade}|${wallAngle}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        id: `toplogger-${day.id}-${key}`,
        count: 1,
        grade,
        holdType: "mixed",
        wallAngle,
        climbedOn: day.date,
      });
    }
  }

  if (grouped.size === 0) return undefined;

  return {
    id: `toplogger-${day.id}`,
    createdAt: `${day.date}T12:00:00Z`,
    durationMinutes: settings.toplogger.defaultDurationMinutes,
    sleepHours: settings.model.recovery.personalMaxSleepHours,
    stress: 5,
    motivation: 5,
    problems: Array.from(grouped.values()),
    source: "toplogger",
    externalId: day.id,
  };
}
