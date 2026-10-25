/** One day of training load. */
export interface DailyLoad {
  date: string;
  load: number;
}

export interface HistoryPoint {
  date: string;
  load: number;
  acute: number;
  chronic: number;
  acwr: number;
}

export function todayIsoDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

/** Fill gaps so every calendar day from the first entry through `endDate` has a load (rest days = 0). */
export function fillDailyLoads(loadsByDate: Map<string, number>, endDate: string): DailyLoad[] {
  if (loadsByDate.size === 0) return [];

  const start = [...loadsByDate.keys()].sort()[0];
  const end = endDate > start ? endDate : start;
  const days: DailyLoad[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push({ date, load: loadsByDate.get(date) ?? 0 });
  }
  return days;
}

/**
 * EWMA acute:chronic workload ratio (Williams et al. 2017), alpha = 2 / (N + 1).
 *
 * Both averages are seeded with the mean daily load of the first `chronicWindow` days instead of 0,
 * so the ratio doesn't start artificially high while the chronic average is still filling up.
 */
export function buildAcwrHistory(days: DailyLoad[], acuteWindow: number, chronicWindow: number): HistoryPoint[] {
  if (days.length === 0) return [];

  const acuteAlpha = 2 / (acuteWindow + 1);
  const chronicAlpha = 2 / (chronicWindow + 1);
  const seedDays = days.slice(0, Math.max(1, chronicWindow));
  const seed = seedDays.reduce((sum, day) => sum + day.load, 0) / seedDays.length;

  let acute = seed;
  let chronic = seed;
  return days.map((day) => {
    acute = acuteAlpha * day.load + (1 - acuteAlpha) * acute;
    chronic = chronicAlpha * day.load + (1 - chronicAlpha) * chronic;
    return { date: day.date, load: day.load, acute, chronic, acwr: chronic > 0 ? acute / chronic : 0 };
  });
}

/** True while there is less history than one chronic window, so the ratio is still settling. */
export function isCalibrating(history: HistoryPoint[], chronicWindow: number): boolean {
  return history.length < chronicWindow;
}

/** The averages going into `plannedDate`, with rest days between the end of history and that date applied. */
function stateBeforeDay(history: HistoryPoint[], plannedDate: string, acuteAlpha: number, chronicAlpha: number) {
  const dayBefore = addDays(plannedDate, -1);
  const last = history[history.length - 1];

  let prevAcute: number;
  let prevChronic: number;
  if (dayBefore >= last.date) {
    const restDays = daysBetween(last.date, dayBefore);
    prevAcute = last.acute * (1 - acuteAlpha) ** restDays;
    prevChronic = last.chronic * (1 - chronicAlpha) ** restDays;
  } else {
    const point = history.find((item) => item.date === dayBefore) ?? history[0];
    prevAcute = point.acute;
    prevChronic = point.chronic;
  }

  // Load already logged on the planned day still counts alongside the planned session.
  const existing = history.find((item) => item.date === plannedDate)?.load ?? 0;
  return { prevAcute, prevChronic, existing };
}

/**
 * Predict ACWR after adding `plannedLoad` on `plannedDate`, given history that runs through today.
 * Days between the end of history and the planned date count as rest days.
 */
export function predictAcwr(
  history: HistoryPoint[],
  plannedDate: string,
  plannedLoad: number,
  acuteWindow: number,
  chronicWindow: number,
): { acwr: number; acute: number; chronic: number } | null {
  if (history.length === 0) return null;

  const acuteAlpha = 2 / (acuteWindow + 1);
  const chronicAlpha = 2 / (chronicWindow + 1);
  const { prevAcute, prevChronic, existing } = stateBeforeDay(history, plannedDate, acuteAlpha, chronicAlpha);

  const dayLoad = existing + plannedLoad;
  const acute = acuteAlpha * dayLoad + (1 - acuteAlpha) * prevAcute;
  const chronic = chronicAlpha * dayLoad + (1 - chronicAlpha) * prevChronic;
  return { acwr: chronic > 0 ? acute / chronic : 0, acute, chronic };
}

/**
 * The session load that lands ACWR exactly on `targetAcwr` on `plannedDate` (0 if rest already gets there or beyond).
 * Solves target = (αa·X + (1−αa)·A) / (αc·X + (1−αc)·C) for the day's total load X; null when the target is unreachable.
 */
export function solveLoadForAcwr(
  history: HistoryPoint[],
  plannedDate: string,
  targetAcwr: number,
  acuteWindow: number,
  chronicWindow: number,
): number | null {
  if (history.length === 0) return null;

  const acuteAlpha = 2 / (acuteWindow + 1);
  const chronicAlpha = 2 / (chronicWindow + 1);
  const denominator = acuteAlpha - targetAcwr * chronicAlpha;
  if (denominator <= 0) return null;

  const { prevAcute, prevChronic, existing } = stateBeforeDay(history, plannedDate, acuteAlpha, chronicAlpha);
  const dayLoad = (targetAcwr * (1 - chronicAlpha) * prevChronic - (1 - acuteAlpha) * prevAcute) / denominator;
  return Math.max(0, dayLoad - existing);
}

export interface TrendMetrics {
  thisWeekLoad: number;
  lastWeekLoad: number;
  /** Fractional change, e.g. 0.12 = +12%. Null when last week had no load. */
  weekOverWeek: number | null;
  /** Foster's monotony: mean daily load / SD over the last 7 days. Null when every day was identical. */
  monotony: number | null;
  /** Weekly load × monotony. */
  strain: number | null;
  activeDays: number;
}

/** Week-over-week change, monotony and strain over the last 7 days of history. */
export function calculateTrendMetrics(history: HistoryPoint[]): TrendMetrics {
  const thisWeek = history.slice(-7).map((point) => point.load);
  const lastWeek = history.slice(-14, -7).map((point) => point.load);
  const thisWeekLoad = thisWeek.reduce((sum, load) => sum + load, 0);
  const lastWeekLoad = lastWeek.reduce((sum, load) => sum + load, 0);

  // Pad to a full week so missing days count as rest.
  const week = [...Array(Math.max(0, 7 - thisWeek.length)).fill(0), ...thisWeek];
  const mean = week.reduce((sum, load) => sum + load, 0) / 7;
  const sd = Math.sqrt(week.reduce((sum, load) => sum + (load - mean) ** 2, 0) / 7);
  const monotony = sd > 0 ? mean / sd : null;

  return {
    thisWeekLoad,
    lastWeekLoad,
    weekOverWeek: lastWeekLoad > 0 ? thisWeekLoad / lastWeekLoad - 1 : null,
    monotony,
    strain: monotony === null ? null : thisWeekLoad * monotony,
    activeDays: thisWeek.filter((load) => load > 0).length,
  };
}
