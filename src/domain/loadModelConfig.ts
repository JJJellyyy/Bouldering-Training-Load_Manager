import type { AppSettings } from "../types";

export const DEFAULT_SETTINGS: AppSettings = {
  climberMaxGrade: "V7",
  gradeDisplayUnit: "v",
  stressScaleMax: 10,
  motivationScaleMax: 10,
  model: {
    gradeIntensity: {
      basePoints: 10,
      multiplierPerGrade: 1.5,
      relativeToMax: true,
    },
    speed: {
      impactPercent: 40,
    },
    recovery: {
      personalMaxSleepHours: 8.5,
    },
    acwr: {
      acuteWindow: 10,
      chronicWindow: 25,
      lowThreshold: 0.8,
      highThreshold: 1.2,
      targetAcwr: 1.0,
    },
  },
  strength: {
    metric: "relative",
    bodyweightKg: 70,
    acuteWindow: 7,
    chronicWindow: 28,
    bodyweightExercises: {},
  },
  toplogger: {
    autoSync: true,
    importFromDate: daysAgoIsoDate(90),
    countMode: "attempted",
    defaultDurationMinutes: 120,
  },
  fitnotes: {
    autoSyncFromDrive: false,
  },
  logGaps: {},
};

function daysAgoIsoDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function clampSettings(input: AppSettings): AppSettings {
  const incoming = (input ?? DEFAULT_SETTINGS) as Partial<AppSettings>;

  // Before the relative-to-max model, intensity was absolute (×5 per grade from V0); those values don't carry over.
  const incomingGrade = incoming.model?.gradeIntensity;
  const gradeIntensity = incomingGrade?.relativeToMax ? incomingGrade : DEFAULT_SETTINGS.model.gradeIntensity;

  const next: AppSettings = {
    climberMaxGrade: incoming.climberMaxGrade ?? DEFAULT_SETTINGS.climberMaxGrade,
    gradeDisplayUnit: incoming.gradeDisplayUnit ?? DEFAULT_SETTINGS.gradeDisplayUnit,
    stressScaleMax: incoming.stressScaleMax ?? DEFAULT_SETTINGS.stressScaleMax,
    motivationScaleMax: incoming.motivationScaleMax ?? DEFAULT_SETTINGS.motivationScaleMax,
    model: {
      gradeIntensity: { ...DEFAULT_SETTINGS.model.gradeIntensity, ...gradeIntensity, relativeToMax: true },
      speed: {
        ...DEFAULT_SETTINGS.model.speed,
        impactPercent: clamp(incoming.model?.speed?.impactPercent ?? DEFAULT_SETTINGS.model.speed.impactPercent, 0, 100),
      },
      recovery: {
        personalMaxSleepHours:
          incoming.model?.recovery?.personalMaxSleepHours ??
          DEFAULT_SETTINGS.model.recovery.personalMaxSleepHours,
      },
      acwr: {
        ...DEFAULT_SETTINGS.model.acwr,
        ...(incoming.model?.acwr ?? {}),
        targetAcwr: incoming.model?.acwr?.targetAcwr ?? DEFAULT_SETTINGS.model.acwr.targetAcwr,
      },
    },
    strength: {
      ...DEFAULT_SETTINGS.strength,
      ...(incoming.strength ?? {}),
      bodyweightExercises: { ...(incoming.strength?.bodyweightExercises ?? {}) },
    },
    toplogger: {
      ...DEFAULT_SETTINGS.toplogger,
      ...(incoming.toplogger ?? {}),
    },
    fitnotes: {
      ...DEFAULT_SETTINGS.fitnotes,
      ...(incoming.fitnotes ?? {}),
    },
    logGaps: Object.fromEntries(
      Object.entries(incoming.logGaps ?? {}).filter(([, decision]) => decision === "climbing" || decision === "break"),
    ),
  };

  next.stressScaleMax = clamp(next.stressScaleMax, 3, 20);
  next.motivationScaleMax = clamp(next.motivationScaleMax, 3, 20);
  next.gradeDisplayUnit = next.gradeDisplayUnit === "font" ? "font" : "v";

  next.model.gradeIntensity.basePoints = clamp(next.model.gradeIntensity.basePoints, 1, 1000);
  next.model.gradeIntensity.multiplierPerGrade = clamp(next.model.gradeIntensity.multiplierPerGrade, 1.1, 3);

  next.model.speed.impactPercent = clamp(next.model.speed.impactPercent, 0, 100);

  next.model.recovery.personalMaxSleepHours = clamp(next.model.recovery.personalMaxSleepHours, 4, 12);
  next.model.acwr.lowThreshold = clamp(next.model.acwr.lowThreshold, 0.3, 1.5);
  next.model.acwr.highThreshold = clamp(next.model.acwr.highThreshold, next.model.acwr.lowThreshold + 0.05, 2.5);
  next.model.acwr.acuteWindow = clamp(next.model.acwr.acuteWindow, 3, 60);
  next.model.acwr.chronicWindow = clamp(next.model.acwr.chronicWindow, 3, 60);
  next.model.acwr.targetAcwr = clamp(next.model.acwr.targetAcwr, 0.5, 1.5);

  if (!["relative", "volume", "sets"].includes(next.strength.metric)) {
    next.strength.metric = DEFAULT_SETTINGS.strength.metric;
  }
  next.strength.bodyweightKg = clamp(next.strength.bodyweightKg, 0, 250);
  next.strength.acuteWindow = clamp(Math.round(next.strength.acuteWindow), 3, 60);
  next.strength.chronicWindow = clamp(Math.round(next.strength.chronicWindow), 3, 90);

  if (!["attempted", "sent", "tries"].includes(next.toplogger.countMode)) {
    next.toplogger.countMode = DEFAULT_SETTINGS.toplogger.countMode;
  }
  next.toplogger.defaultDurationMinutes = clamp(Math.round(next.toplogger.defaultDurationMinutes), 10, 600);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.toplogger.importFromDate)) {
    next.toplogger.importFromDate = DEFAULT_SETTINGS.toplogger.importFromDate;
  }

  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
