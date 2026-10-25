import type { AppSettings, Grade } from "../types";
import { addDays, predictAcwr, solveLoadForAcwr, todayIsoDate, type HistoryPoint } from "./acwr";
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
const MAX_REST_DAYS = 30;

function mergedGrades(profile: Profile, reference: Grade): Array<{ grade: Grade; share: number }> {
  const merged = new Map<Grade, number>();
  for (const [offset, share] of profile.weights) {
    const grade = gradeFromNumber(gradeToNumber(reference) + offset);
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

function buildOption(
  key: IntensityKey,
  targetLoad: number,
  ceilingAcwr: number,
  highAllowed: boolean,
  context: { history: HistoryPoint[]; planDate: string; reference: Grade; settings: AppSettings },
): SessionOption {
  const { history, planDate, reference, settings } = context;
  const profile = PROFILES[key];
  const grades = mergedGrades(profile, reference);
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
  };

  if (key === "high" && !highAllowed) {
    return { ...base, available: false, reason: "Hard sessions are off the table while your ACWR is over or close to the high threshold." };
  }
  if (total < profile.minAttempts) {
    return { ...base, available: false, reason: "Not enough room in your load for a proper session like this yet." };
  }
  return { ...base, available: true };
}

/**
 * Suggest what to climb next so ACWR stays (or goes back) in the green zone.
 *
 * Every option stays inside the green window (floor: back in the sweet spot, ceiling: just under the high threshold) but
 * sits at a different point in it: volume near the top, high intensity lower. If ACWR is over the high threshold we first find how many rest days it takes to open up room, and a high-intensity
 * session is never suggested while ACWR is over or close to the high threshold.
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

  const referenceProfile = (key: IntensityKey) => {
    const profile = PROFILES[key];
    const grades = mergedGrades(profile, reference);
    const points = grades.reduce((sum, item) => sum + item.share * calculateGradeIntensity(item.grade, reference, settings), 0);
    return points * calculateSpeedMultiplier(100, 100 * profile.minutesPerAttempt, settings);
  };
  const minLoad = PROFILES.volume.minAttempts * referenceProfile("volume");

  // First day with enough room under the ceiling for a real session.
  let restDays = 0;
  let planDate = today;
  let loadMax = 0;
  for (; restDays <= MAX_REST_DAYS; restDays++) {
    planDate = addDays(today, restDays);
    const room = solveLoadForAcwr(history, planDate, ceilingAcwr, acuteWindow, chronicWindow);
    if (room === null) return null;
    loadMax = room;
    if (room >= minLoad) break;
  }

  const restAcwr = predictAcwr(history, planDate, 0, acuteWindow, chronicWindow)?.acwr ?? currentAcwr;
  const toGreen = solveLoadForAcwr(history, planDate, lowThreshold + 0.02, acuteWindow, chronicWindow) ?? 0;
  const loadMin = Math.min(loadMax, Math.max(toGreen, minLoad));

  const zone = getAcwrZoneKey(currentAcwr, lowThreshold, highThreshold);
  const status: RecommendationStatus =
    zone === "high-risk" ? "over" : currentAcwr >= highThreshold - CLOSE_MARGIN ? "close" : zone === "detraining" ? "low" : "green";
  const highAllowed = currentAcwr < highThreshold - CLOSE_MARGIN && restAcwr < highThreshold - CLOSE_MARGIN;

  const context = { history, planDate, reference, settings };
  return {
    status,
    currentAcwr,
    planDate,
    restDays,
    restAcwr,
    loadMin,
    loadMax,
    highAllowed,
    options: OPTION_ORDER.map((key) =>
      buildOption(key, loadMin + PROFILES[key].windowShare * (loadMax - loadMin), ceilingAcwr, highAllowed, context),
    ),
  };
}
