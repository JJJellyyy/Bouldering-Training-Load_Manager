import type { AppSettings, CalculationResult, Grade, GradeDisplayUnit, SessionInput } from "../types";
import { FONT_BY_GRADE } from "../types";
import { addDays, buildAcwrHistory, fillDailyLoads, todayIsoDate, type HistoryPoint } from "./acwr";

export type { HistoryPoint } from "./acwr";

const GRADES_ORDER = [
  "V0",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "V10",
  "V11",
  "V12",
  "V13",
  "V14",
  "V15",
  "V16",
  "V17",
] as const;

const FONT_TO_V: Record<string, Grade | string> = {
  "4": "V0",
  "5": "V1",
  "5+": "V2",
  "6A": "V3",
  "6A+": "V4",
  "6B": "V4",
  "6B+": "V4",
  "6C": "V5",
  "6C+": "V5",
  "7A": "V6",
  "7A+": "V7",
  "7B": "V8",
  "7B+": "V8",
  "7C": "V9",
  "7C+": "V10",
  "8A": "V11",
  "8A+": "V12",
  "8B": "V13",
  "8B+": "V14",
  "8C": "V15",
  "8C+": "V16",
  "9A": "V17",
};

/** Look-back window for the reference ("current max") grade. */
const REFERENCE_WINDOW_DAYS = 365;

export function gradeToNumber(grade: Grade | string): number {
  const gradeStr = String(grade).replace("V", "");
  return parseFloat(gradeStr);
}

export function gradeFromNumber(value: number): Grade {
  const bounded = Math.min(17, Math.max(0, Math.round(value)));
  return `V${bounded}` as Grade;
}

export function gradeToDisplay(grade: Grade, unit: GradeDisplayUnit): string {
  if (unit === "font") {
    return FONT_BY_GRADE[grade];
  }

  return grade;
}

export function displayToGrade(display: string, unit: GradeDisplayUnit): string | undefined {
  if (unit === "v") {
    return (GRADES_ORDER.find((grade) => grade === display) as Grade | undefined);
  }

  return FONT_TO_V[display.toUpperCase()];
}

/**
 * Points for one problem, relative to the climber's reference (max) grade:
 * basePoints at the reference grade, × multiplierPerGrade for each grade above, ÷ for each grade below.
 * So a V5 is "hard" while V5 is your limit and counts for less once you climb V8.
 */
export function calculateGradeIntensity(problemGrade: Grade, referenceGrade: Grade, settings: AppSettings): number {
  const { basePoints, multiplierPerGrade } = settings.model.gradeIntensity;
  return basePoints * multiplierPerGrade ** (gradeToNumber(problemGrade) - gradeToNumber(referenceGrade));
}

export function calculateSpeedMultiplier(totalProblems: number, durationMinutes: number, settings: AppSettings): number {
  // Linear pace bonus: 10 min/boulder = no extra load, 1 min/boulder = +impactPercent.
  const safeProblems = Math.max(1, totalProblems);
  const safeDuration = Math.max(1, durationMinutes);
  const minutesPerBoulder = safeDuration / safeProblems;

  if (minutesPerBoulder >= 10) return 1;
  if (minutesPerBoulder <= 1) return 1 + settings.model.speed.impactPercent / 100;

  const deficit = (10 - minutesPerBoulder) / 9;
  return 1 + (settings.model.speed.impactPercent / 100) * deficit;
}

export function getSessionDayKey(session: SessionInput): string {
  const createdDay = session.createdAt?.slice(0, 10);
  if (createdDay && /^\d{4}-\d{2}-\d{2}$/.test(createdDay)) {
    return createdDay;
  }

  const climbedOn = session.problems.find((problem) => Boolean(problem.climbedOn))?.climbedOn;
  if (climbedOn) {
    return climbedOn.slice(0, 10);
  }

  const parsed = new Date(session.createdAt);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return todayIsoDate();
}

/**
 * The climber's current max grade on a given day: the hardest grade logged on at least two different days
 * in the preceding year (one-off attempts on a hard project don't count), falling back to the hardest grade
 * logged at all in that year, and finally to the max grade from settings.
 */
export function referenceGradeOn(dayKey: string, sessions: SessionInput[], settings: AppSettings): Grade {
  const windowStart = addDays(dayKey, -REFERENCE_WINDOW_DAYS);
  const daysByGrade = new Map<number, Set<string>>();

  for (const session of sessions) {
    const sessionDay = getSessionDayKey(session);
    if (sessionDay > dayKey || sessionDay <= windowStart) continue;
    for (const problem of session.problems) {
      if (problem.count <= 0) continue;
      const grade = gradeToNumber(problem.grade);
      const days = daysByGrade.get(grade) ?? new Set<string>();
      days.add(sessionDay);
      daysByGrade.set(grade, days);
    }
  }

  if (daysByGrade.size === 0) return settings.climberMaxGrade;

  const grades = [...daysByGrade.keys()].sort((a, b) => b - a);
  const repeated = grades.find((grade) => (daysByGrade.get(grade)?.size ?? 0) >= 2);
  return gradeFromNumber(repeated ?? grades[0]);
}

/** Session load = Σ problems × grade intensity (vs. reference grade) × pace multiplier. Sleep and stress are not load. */
export function calculateSessionLoad(session: SessionInput, referenceGrade: Grade, settings: AppSettings): CalculationResult {
  const totalProblems = session.problems.reduce((sum, item) => sum + item.count, 0);
  const speedMultiplier = calculateSpeedMultiplier(totalProblems, session.durationMinutes, settings);
  const rawLoad = session.problems.reduce(
    (sum, problem) => sum + problem.count * calculateGradeIntensity(problem.grade, referenceGrade, settings),
    0,
  );

  return {
    totalLoad: rawLoad * speedMultiplier,
    speedMultiplier,
    referenceGrade,
  };
}

/** Daily bouldering load from the first session through `endDate` (default: today), rest days included. */
export function buildDailyLoads(sessions: SessionInput[], settings: AppSettings, endDate: string = todayIsoDate()) {
  const loadsByDate = new Map<string, number>();
  const referenceByDay = new Map<string, Grade>();

  for (const session of sessions) {
    const dayKey = getSessionDayKey(session);
    let reference = referenceByDay.get(dayKey);
    if (!reference) {
      reference = referenceGradeOn(dayKey, sessions, settings);
      referenceByDay.set(dayKey, reference);
    }
    const load = calculateSessionLoad(session, reference, settings).totalLoad;
    loadsByDate.set(dayKey, (loadsByDate.get(dayKey) ?? 0) + load);
  }

  return fillDailyLoads(loadsByDate, endDate);
}

/**
 * Daily EWMA/ACWR history for all bouldering, through today so the ratio keeps decaying on rest days.
 * Computed over the full history (needed for accurate EWMA), then cut to the last `daysBack` days.
 */
export function buildSessionHistory(
  sessions: SessionInput[],
  settings: AppSettings,
  daysBack: number | null,
): HistoryPoint[] {
  const history = buildAcwrHistory(
    buildDailyLoads(sessions, settings),
    settings.model.acwr.acuteWindow,
    settings.model.acwr.chronicWindow,
  );

  return daysBack === null ? history : history.slice(-daysBack);
}

export interface MovingAveragePoint {
  date: string;
  average: number;
}

export function buildMovingAverageSeries(history: HistoryPoint[], windowDays: number): MovingAveragePoint[] {
  if (history.length === 0 || windowDays <= 0) return [];

  const points: MovingAveragePoint[] = [];
  const window: number[] = [];

  for (const point of history) {
    window.push(point.load);
    if (window.length > windowDays) {
      window.shift();
    }

    const total = window.reduce((sum, value) => sum + value, 0);
    points.push({ date: point.date, average: total });
  }

  return points;
}

export type AcwrZoneKey = "detraining" | "goldilocks" | "high-risk";

/** Stable key for styling and copy. */
export function getAcwrZoneKey(acwr: number, lowThreshold: number, highThreshold: number): AcwrZoneKey {
  if (acwr < lowThreshold) return "detraining";
  if (acwr > highThreshold) return "high-risk";
  return "goldilocks";
}

export interface Readiness {
  level: "good" | "fair" | "low";
  reasons: string[];
}

/**
 * Readiness from sleep and stress. Kept separate from load: a bad night doesn't make a session bigger,
 * it makes you less ready for one.
 */
export function assessReadiness(
  sleepHours: number,
  sleepQuality: number | undefined,
  stress: number,
  settings: AppSettings,
  motivation?: number,
): Readiness {
  const reasons: string[] = [];
  let penalty = 0;

  const sleepDeficit = settings.model.recovery.personalMaxSleepHours - sleepHours;
  if (sleepDeficit >= 2) {
    penalty += 2;
    reasons.push(`${sleepDeficit.toFixed(1)} h short on sleep`);
  } else if (sleepDeficit >= 1) {
    penalty += 1;
    reasons.push(`${sleepDeficit.toFixed(1)} h short on sleep`);
  }

  if (sleepQuality !== undefined && sleepQuality <= 3) {
    penalty += 2;
    reasons.push("poor sleep quality");
  } else if (sleepQuality !== undefined && sleepQuality <= 5) {
    penalty += 1;
    reasons.push("so-so sleep quality");
  }

  const stressShare = stress / Math.max(1, settings.stressScaleMax);
  if (stressShare >= 0.8) {
    penalty += 2;
    reasons.push("high stress");
  } else if (stressShare >= 0.6) {
    penalty += 1;
    reasons.push("elevated stress");
  }

  if (motivation !== undefined && motivation / Math.max(1, settings.motivationScaleMax) <= 0.3) {
    penalty += 1;
    reasons.push("low motivation");
  }

  return { level: penalty >= 3 ? "low" : penalty >= 1 ? "fair" : "good", reasons };
}
