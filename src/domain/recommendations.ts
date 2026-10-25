import type { AppSettings, Grade } from "../types";
import { addDays, predictAcwr, projectAcwr, solveLoadForAcwr, todayIsoDate, type HistoryPoint } from "./acwr";
import { calculateGradeIntensity, calculateSpeedMultiplier, getAcwrZoneKey, gradeFromNumber, gradeToNumber } from "./loadCalculator";

export type IntensityKey = "volume" | "medium" | "high";
export type RecommendationStatus = "over" | "close" | "green" | "low";

export interface AttemptCount {
  grade: Grade;
  count: number;
}

export interface SessionOption {
  key: IntensityKey;
  title: string;
  blurb: string;
  available: boolean;
  /** Why the option isn't offered (only when unavailable). */
  reason?: string;
  attempts: AttemptCount[];
  totalAttempts: number;
  minutes: number;
  load: number;
  predictedAcwr: number;
  /** Deload mode: ACWR after a week of sessions like this at your usual frequency. */
  weekAcwr?: number;
}

export interface Recommendation {
  status: RecommendationStatus;
  currentAcwr: number;
  /** First day that has room for a session (today unless you need rest first). */
  planDate: string;
  restDays: number;
  /** ACWR on the plan day if you don't climb. */
  restAcwr: number;
  /** Load range that keeps (or puts) you in the green zone on the plan day. */
  loadMin: number;
  loadMax: number;
  highAllowed: boolean;
  /** "deload": you're over the limit (or there's no room soon), so sessions are half your usual size, a grade easier. */
  mode: "normal" | "deload";
  /** Median load of your recent logged sessions. */
  typicalSessionLoad: number;
  sessionsPerWeek: number;
  /** Deload mode: ACWR after a week of the volume option. */
  deloadWeekAcwr: number | null;
  options: SessionOption[];
}

interface Profile {
  title: string;
  blurb: string;
  /** Grades relative to your current max grade, and the share of attempts at each. */
  weights: Array<[offset: number, share: number]>;
  /** Average time per attempt, including rest; sets the session length and pace multiplier. */
  minutesPerAttempt: number;
  /** Fewer attempts than this isn't a real session of this type. */
  minAttempts: number;
  /**
   * Where in the green window this session type sits (0 = floor, 1 = ceiling).
   * Volume days carry the most load; high-intensity days are short and hard, so they carry less.
   */
  windowShare: number;
}

const PROFILES: Record<IntensityKey, Profile> = {
  volume: {
    title: "Volume",
    blurb: "Lots of easier problems: mileage, movement and flow.",
    weights: [[-3, 0.3], [-2, 0.4], [-1, 0.3]],
    minutesPerAttempt: 5,
    minAttempts: 6,
    windowShare: 0.9,
  },
  medium: {
    title: "Medium",
    blurb: "A mix around your solid grades, a few at your limit.",
    weights: [[-2, 0.25], [-1, 0.45], [0, 0.3]],
    minutesPerAttempt: 6,
    minAttempts: 4,
    windowShare: 0.65,
  },
  high: {
    title: "High intensity",
    blurb: "Few attempts, long rests, at and just above your max.",
    weights: [[-1, 0.2], [0, 0.5], [1, 0.3]],
    minutesPerAttempt: 8,
    minAttempts: 3,
    windowShare: 0.4,
  },
};

const OPTION_ORDER: IntensityKey[] = ["volume", "medium", "high"];
/** End this far below the high threshold, so the session finishes comfortably inside the zone. */
const CEILING_MARGIN = 0.05;
/** Within this distance of the high threshold counts as "close". */
const CLOSE_MARGIN = 0.1;
const MAX_ATTEMPTS = 80;
/** Never suggest more than this many days of full rest; past that, a deload week works better than stopping. */
const MAX_REST_DAYS = 2;
const DELOAD_SHARE = 0.5;
const DELOAD_GRADE_SHIFT = -1;

function mergedGrades(profile: Profile, reference: Grade, gradeShift = 0): Array<{ grade: Grade; share: number }> {
  const merged = new Map<Grade, number>();
  for (const [offset, share] of profile.weights) {
    const grade = gradeFromNumber(gradeToNumber(reference) + offset + gradeShift);
    merged.set(grade, (merged.get(grade) ?? 0) + share);
  }
  return [...merged.entries()].map(([grade, share]) => ({ grade, share }));
}

/** Split `total` attempts across grades by share, using largest remainders so the counts add up exactly. */
function allocate(total: number, grades: Array<{ grade: Grade; share: number }>): AttemptCount[] {
  const raw = grades.map((item) => ({ grade: item.grade, exact: total * item.share }));
  const counts = raw.map((item) => ({ grade: item.grade, count: Math.floor(item.exact), rest: item.exact - Math.floor(item.exact) }));
  let missing = total - counts.reduce((sum, item) => sum + item.count, 0);

  for (const item of [...counts].sort((a, b) => b.rest - a.rest)) {
    if (missing <= 0) break;
    item.count += 1;
    missing -= 1;
  }

  return counts
    .filter((item) => item.count > 0)
    .map(({ grade, count }) => ({ grade, count }))
    .sort((a, b) => gradeToNumber(b.grade) - gradeToNumber(a.grade));
}

function sessionLoad(attempts: AttemptCount[], total: number, profile: Profile, reference: Grade, settings: AppSettings): number {
  const speed = calculateSpeedMultiplier(Math.max(1, total), Math.max(1, total * profile.minutesPerAttempt), settings);
  const raw = attempts.reduce((sum, item) => sum + item.count * calculateGradeIntensity(item.grade, reference, settings), 0);
  return raw * speed;
}

interface OptionContext {
  history: HistoryPoint[];
  planDate: string;
  reference: Grade;
  settings: AppSettings;
  highAllowed: boolean;
  highBlockedReason: string;
  /** Deload mode: grades shift down and ACWR is projected over a week of these sessions. */
  deload?: { weekPattern: (load: number) => number[] };
}

function buildOption(key: IntensityKey, targetLoad: number, ceilingAcwr: number, context: OptionContext): SessionOption {
  const { history, planDate, reference, settings, highAllowed, deload } = context;
  const profile = PROFILES[key];
  const grades = mergedGrades(profile, reference, deload ? DELOAD_GRADE_SHIFT : 0);
  const { acuteWindow, chronicWindow } = settings.model.acwr;

  const evaluate = (total: number) => {
    const attempts = allocate(total, grades);
    const load = sessionLoad(attempts, total, profile, reference, settings);
    const predicted = predictAcwr(history, planDate, load, acuteWindow, chronicWindow)?.acwr ?? 0;
    return { attempts, load, predicted };
  };

  const averagePoints = grades.reduce((sum, item) => sum + item.share * calculateGradeIntensity(item.grade, reference, settings), 0);
  const speed = calculateSpeedMultiplier(100, 100 * profile.minutesPerAttempt, settings);
  let total = Math.min(MAX_ATTEMPTS, Math.max(0, Math.round(targetLoad / Math.max(1e-9, averagePoints * speed))));
  let result = evaluate(total);

  // Rounding to whole attempts can overshoot the ceiling; step down until it fits.
  while (total > 0 && result.predicted > ceilingAcwr) {
    total -= 1;
    result = evaluate(total);
  }

  const base = {
    key,
    title: profile.title,
    blurb: profile.blurb,
    attempts: result.attempts,
    totalAttempts: total,
    minutes: Math.round((total * profile.minutesPerAttempt) / 5) * 5,
    load: result.load,
    predictedAcwr: result.predicted,
    weekAcwr: deload
      ? (projectAcwr(history, planDate, deload.weekPattern(result.load), settings.model.acwr.acuteWindow, settings.model.acwr.chronicWindow) ??
        undefined)
      : undefined,
  };

  if (key === "high" && !highAllowed) {
    return { ...base, available: false, reason: context.highBlockedReason };
  }
  if (total < profile.minAttempts) {
    return { ...base, available: false, reason: "Not enough room in your load for a proper session like this yet." };
  }
  return { ...base, available: true };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Your usual session size and how often you climb, from logged (not estimated) days. */
function usualTraining(history: HistoryPoint[], fallbackLoad: number) {
  const logged = (days: number) => history.slice(-days).filter((point) => point.load > 0 && !point.estimated);
  const recent = logged(56);
  const typicalSessionLoad =
    median(recent.map((point) => point.load)) ?? median(logged(history.length).map((point) => point.load)) ?? fallbackLoad;
  // Sessions per week over the last 4 weeks, counted from your first logged session in that window,
  // so restarting your logging after a gap doesn't read as climbing once a week.
  const lastMonth = logged(28);
  const windowStart = history.length - Math.min(28, history.length);
  const firstLogged = history.findIndex((point, index) => index >= windowStart && point.load > 0 && !point.estimated);
  const weeksLogged = firstLogged < 0 ? 4 : Math.max(1, (history.length - firstLogged) / 7);
  const perWeek = lastMonth.length / weeksLogged || recent.length / 8 || 2;
  return { typicalSessionLoad, sessionsPerWeek: Math.min(6, Math.max(1, Math.round(perWeek))) };
}

/** A week of `sessions` evenly spread sessions of `load`, the first one on day 0. */
function weekPattern(sessions: number, load: number): number[] {
  const days = new Set(Array.from({ length: sessions }, (_, index) => Math.round((index * 7) / sessions)));
  return Array.from({ length: 7 }, (_, day) => (days.has(day) ? load : 0));
}

/**
 * Suggest what to climb next so ACWR stays (or goes back) in the green zone.
 *
 * Normally every option stays inside the green window (floor: back in the sweet spot, ceiling: just under the high
 * threshold), volume near the top and high intensity lower. At most two rest days are ever suggested: when you're over
 * the limit, or there's still no room after that, it switches to a deload week of sessions about half your usual size
 * and a grade easier, and shows where that takes your ACWR. High intensity is never suggested while ACWR is over or
 * close to the high threshold.
 */
export function buildRecommendation(
  history: HistoryPoint[],
  reference: Grade,
  settings: AppSettings,
  today: string = todayIsoDate(),
): Recommendation | null {
  if (history.length === 0) return null;

  const { acuteWindow, chronicWindow, lowThreshold, highThreshold } = settings.model.acwr;
  const currentAcwr = history[history.length - 1].acwr;
  const ceilingAcwr = highThreshold - CEILING_MARGIN;

  const loadPerAttempt = (key: IntensityKey) => {
    const profile = PROFILES[key];
    const grades = mergedGrades(profile, reference);
    const points = grades.reduce((sum, item) => sum + item.share * calculateGradeIntensity(item.grade, reference, settings), 0);
    return points * calculateSpeedMultiplier(100, 100 * profile.minutesPerAttempt, settings);
  };
  const minLoad = PROFILES.volume.minAttempts * loadPerAttempt("volume");
  const { typicalSessionLoad, sessionsPerWeek } = usualTraining(history, minLoad * 2);

  const zone = getAcwrZoneKey(currentAcwr, lowThreshold, highThreshold);
  const status: RecommendationStatus =
    zone === "high-risk" ? "over" : currentAcwr >= highThreshold - CLOSE_MARGIN ? "close" : zone === "detraining" ? "low" : "green";
  const highBlockedReason = `Hard sessions wait until your ACWR is back under ${(highThreshold - CLOSE_MARGIN).toFixed(2)}.`;

  // Normal path: the first day (within MAX_REST_DAYS) with room under the ceiling for a real session.
  let restDays = 0;
  let planDate = today;
  let loadMax = 0;
  let foundRoom = false;
  if (status !== "over") {
    for (; restDays <= MAX_REST_DAYS; restDays++) {
      planDate = addDays(today, restDays);
      const room = solveLoadForAcwr(history, planDate, ceilingAcwr, acuteWindow, chronicWindow);
      if (room === null) return null;
      loadMax = room;
      if (room >= minLoad) {
        foundRoom = true;
        break;
      }
    }
  }

  if (!foundRoom) {
    // Deload: a rest day only if you already climbed today, then sessions at half your usual size, a grade easier.
    const last = history[history.length - 1];
    restDays = last.date === today && last.load > 0 ? 1 : 0;
    planDate = addDays(today, restDays);
    const deloadLoad = typicalSessionLoad * DELOAD_SHARE;
    const context: OptionContext = {
      history,
      planDate,
      reference,
      settings,
      highAllowed: false,
      highBlockedReason,
      deload: { weekPattern: (load) => weekPattern(sessionsPerWeek, load) },
    };
    const options = OPTION_ORDER.map((key) => buildOption(key, deloadLoad, Number.POSITIVE_INFINITY, context));
    return {
      status,
      currentAcwr,
      planDate,
      restDays,
      restAcwr: predictAcwr(history, planDate, 0, acuteWindow, chronicWindow)?.acwr ?? currentAcwr,
      loadMin: deloadLoad,
      loadMax: deloadLoad,
      highAllowed: false,
      mode: "deload",
      typicalSessionLoad,
      sessionsPerWeek,
      deloadWeekAcwr: options[0].weekAcwr ?? null,
      options,
    };
  }

  const restAcwr = predictAcwr(history, planDate, 0, acuteWindow, chronicWindow)?.acwr ?? currentAcwr;
  const toGreen = solveLoadForAcwr(history, planDate, lowThreshold + 0.02, acuteWindow, chronicWindow) ?? 0;
  const loadMin = Math.min(loadMax, Math.max(toGreen, minLoad));
  const highAllowed = currentAcwr < highThreshold - CLOSE_MARGIN && restAcwr < highThreshold - CLOSE_MARGIN;

  const context: OptionContext = { history, planDate, reference, settings, highAllowed, highBlockedReason };
  return {
    status,
    currentAcwr,
    planDate,
    restDays,
    restAcwr,
    loadMin,
    loadMax,
    highAllowed,
    mode: "normal",
    typicalSessionLoad,
    sessionsPerWeek,
    deloadWeekAcwr: null,
    options: OPTION_ORDER.map((key) => buildOption(key, loadMin + PROFILES[key].windowShare * (loadMax - loadMin), ceilingAcwr, context)),
  };
}
