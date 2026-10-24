import type { StrengthConfig, StrengthSet } from "../types";
import { buildAcwrHistory, fillDailyLoads, todayIsoDate, type HistoryPoint } from "./acwr";

/** Timed sets (isometrics, hangs) count one rep-equivalent per this many seconds under load. */
const SECONDS_PER_REP_EQUIVALENT = 4;
/** Intensity used for sets with no measurable external load (e.g. bodyweight with bodyweight set to 0). */
const FALLBACK_INTENSITY = 0.5;

const BODYWEIGHT_NAME_PATTERN = /pull ?-?ups?|chin ?-?ups?|\bdips?\b|push ?-?ups?|pistol|muscle ?-?ups?|leg raise|front lever|\bl-sit/i;

export interface StrengthSetLoad {
  set: StrengthSet;
  effectiveWeightKg: number;
  repEquivalent: number;
  load: number;
}

export interface StrengthGroupRow {
  key: string;
  category: string;
  lastDate: string;
  setCount: number;
  acute: number;
  chronic: number;
  acwr: number;
}

/** Heuristic default: known bodyweight movements, or exercises only ever logged with ≤1 kg. */
export function isBodyweightByDefault(exercise: string, sets: StrengthSet[]): boolean {
  if (BODYWEIGHT_NAME_PATTERN.test(exercise)) return true;
  const exerciseSets = sets.filter((set) => set.exercise === exercise);
  return exerciseSets.length > 0 && exerciseSets.every((set) => set.weightKg <= 1);
}

export function isBodyweightExercise(exercise: string, sets: StrengthSet[], config: StrengthConfig): boolean {
  return config.bodyweightExercises[exercise] ?? isBodyweightByDefault(exercise, sets);
}

/** Per-set load under the configured metric, processed chronologically so "relative" uses the best e1RM so far. */
export function calculateSetLoads(sets: StrengthSet[], config: StrengthConfig): StrengthSetLoad[] {
  const ordered = [...sets].sort((a, b) => a.date.localeCompare(b.date));
  const bodyweightByExercise = new Map<string, boolean>();
  const bestE1rmByExercise = new Map<string, number>();

  return ordered.map((set) => {
    let isBodyweight = bodyweightByExercise.get(set.exercise);
    if (isBodyweight === undefined) {
      isBodyweight = isBodyweightExercise(set.exercise, sets, config);
      bodyweightByExercise.set(set.exercise, isBodyweight);
    }

    const effectiveWeightKg = set.weightKg + (isBodyweight ? config.bodyweightKg : 0);
    const repEquivalent = set.reps > 0 ? set.reps : (set.timeSeconds ?? 0) / SECONDS_PER_REP_EQUIVALENT;

    let load: number;
    if (config.metric === "sets") {
      load = 1;
    } else if (config.metric === "volume") {
      load = effectiveWeightKg * repEquivalent;
    } else if (effectiveWeightKg <= 0) {
      load = repEquivalent * FALLBACK_INTENSITY;
    } else {
      // Epley e1RM; intensity is this set's weight relative to the best e1RM seen so far.
      const e1rm = effectiveWeightKg * (1 + repEquivalent / 30);
      const best = Math.max(bestE1rmByExercise.get(set.exercise) ?? 0, e1rm);
      bestE1rmByExercise.set(set.exercise, best);
      load = repEquivalent * (effectiveWeightKg / best);
    }

    return { set, effectiveWeightKg, repEquivalent, load };
  });
}

/** Daily load + EWMA ACWR from the first logged set through `endDate` (default today), so ACWR decays on rest days. */
export function buildStrengthHistory(
  setLoads: StrengthSetLoad[],
  config: StrengthConfig,
  endDate: string = todayIsoDate(),
): HistoryPoint[] {
  const loadByDate = new Map<string, number>();
  for (const item of setLoads) {
    loadByDate.set(item.set.date, (loadByDate.get(item.set.date) ?? 0) + item.load);
  }

  return buildAcwrHistory(fillDailyLoads(loadByDate, endDate), config.acuteWindow, config.chronicWindow);
}

/** Current acute/chronic/ACWR per exercise or per category. */
export function summarizeStrengthGroups(
  setLoads: StrengthSetLoad[],
  config: StrengthConfig,
  groupBy: "exercise" | "category",
  endDate?: string,
): StrengthGroupRow[] {
  const groups = new Map<string, StrengthSetLoad[]>();
  for (const item of setLoads) {
    const key = groupBy === "exercise" ? item.set.exercise : item.set.category;
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const history = buildStrengthHistory(items, config, endDate);
      const latest = history[history.length - 1];
      return {
        key,
        category: items[0].set.category,
        lastDate: items.reduce((max, item) => (item.set.date > max ? item.set.date : max), items[0].set.date),
        setCount: items.length,
        acute: latest?.acute ?? 0,
        chronic: latest?.chronic ?? 0,
        acwr: latest?.acwr ?? 0,
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.key.localeCompare(b.key));
}
