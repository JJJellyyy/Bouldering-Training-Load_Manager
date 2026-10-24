import type { SessionInput } from "../types";
import { addDays, todayIsoDate } from "./acwr";
import { getSessionDayKey } from "./loadCalculator";

export interface WeeklyWellness {
  /** Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  sessions: number;
  sleepHours: number | null;
  sleepQuality: number | null;
  /** Average stress, rescaled to 1–10 so it shares an axis with sleep quality. */
  stress: number | null;
}

/** Synced TopLogger sessions only carry default sleep/stress until you edit them, so they don't count. */
export function hasWellnessData(session: SessionInput): boolean {
  return session.source !== "toplogger" || session.locallyEdited === true;
}

export function weekStartOf(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return addDays(isoDate, -((day + 6) % 7));
}

/** Average sleep and stress per week for the last `weeks` weeks (oldest first); empty weeks have nulls. */
export function buildWeeklyWellness(
  sessions: SessionInput[],
  stressScaleMax: number,
  weeks: number,
  today: string = todayIsoDate(),
): WeeklyWellness[] {
  const currentWeek = weekStartOf(today);
  const firstWeek = addDays(currentWeek, -7 * (weeks - 1));
  const buckets = new Map<string, { sleep: number[]; quality: number[]; stress: number[] }>();

  for (const session of sessions) {
    if (!hasWellnessData(session)) continue;
    const week = weekStartOf(getSessionDayKey(session));
    if (week < firstWeek || week > currentWeek) continue;

    const bucket = buckets.get(week) ?? { sleep: [], quality: [], stress: [] };
    bucket.sleep.push(session.sleepHours);
    if (session.sleepQuality !== undefined) bucket.quality.push(session.sleepQuality);
    bucket.stress.push((session.stress / Math.max(1, stressScaleMax)) * 10);
    buckets.set(week, bucket);
  }

  const average = (values: number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = addDays(firstWeek, index * 7);
    const bucket = buckets.get(weekStart);
    return {
      weekStart,
      sessions: bucket?.sleep.length ?? 0,
      sleepHours: bucket ? average(bucket.sleep) : null,
      sleepQuality: bucket ? average(bucket.quality) : null,
      stress: bucket ? average(bucket.stress) : null,
    };
  });
}
