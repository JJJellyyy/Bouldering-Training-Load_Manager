import type { DailyLoad } from "./acwr";

export type GapDecision = "climbing" | "break";

/** A stretch with nothing logged between two logged sessions. */
export interface LogGap {
  /** Stable while the gap's edges don't change: first and last empty day. */
  id: string;
  start: string;
  end: string;
  days: number;
}

/** Gaps shorter than this are normal rest (a holiday week, a busy spell) and are never questioned. */
export const MIN_GAP_DAYS = 14;
const BASELINE_DAYS = 28;

/** Empty stretches of at least `minDays` with logged climbing on both sides. Gaps up to today are left alone. */
export function findLogGaps(days: DailyLoad[], minDays = MIN_GAP_DAYS): LogGap[] {
  const gaps: LogGap[] = [];
  let runStart = -1;

  days.forEach((day, index) => {
    if (day.load > 0) {
      if (runStart > 0 && index - runStart >= minDays) {
        const start = days[runStart].date;
        const end = days[index - 1].date;
        gaps.push({ id: `${start}_${end}`, start, end, days: index - runStart });
      }
      runStart = -1;
    } else if (runStart < 0 && index > 0) {
      runStart = index;
    }
  });

  return gaps;
}

function averageLoad(days: DailyLoad[]): number | null {
  const real = days.filter((day) => !day.estimated);
  if (real.length === 0 || real.every((day) => day.load === 0)) return null;
  return real.reduce((sum, day) => sum + day.load, 0) / real.length;
}

/**
 * Fill gaps you marked as "climbing, just not logging" with your usual daily load: the average over the
 * 4 weeks before the gap (or after it, when there's nothing before). Days are flagged as estimated.
 */
export function fillLogGaps(days: DailyLoad[], decisions: Record<string, GapDecision>, minDays = MIN_GAP_DAYS): DailyLoad[] {
  const climbingGaps = findLogGaps(days, minDays).filter((gap) => decisions[gap.id] === "climbing");
  if (climbingGaps.length === 0) return days;

  const indexOf = new Map(days.map((day, index) => [day.date, index]));
  const filled = [...days];

  for (const gap of climbingGaps) {
    const startIndex = indexOf.get(gap.start) ?? 0;
    const endIndex = indexOf.get(gap.end) ?? startIndex;
    const before = filled.slice(Math.max(0, startIndex - BASELINE_DAYS), startIndex);
    const after = filled.slice(endIndex + 1, endIndex + 1 + BASELINE_DAYS);
    const baseline = averageLoad(before) ?? averageLoad(after) ?? 0;

    for (let index = startIndex; index <= endIndex; index++) {
      filled[index] = { date: filled[index].date, load: baseline, estimated: true };
    }
  }

  return filled;
}
