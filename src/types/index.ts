export const GRADES = [
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

export const FONT_BY_GRADE: Record<(typeof GRADES)[number], string> = {
  V0: "4",
  V1: "5",
  V2: "5+",
  V3: "6A",
  V4: "6B",
  V5: "6C",
  V6: "7A",
  V7: "7A+",
  V8: "7B",
  V9: "7C",
  V10: "7C+",
  V11: "8A",
  V12: "8A+",
  V13: "8B",
  V14: "8B+",
  V15: "8C",
  V16: "8C+",
  V17: "9A",
};

export const HOLD_TYPES = ["crimps", "sloper", "pockets", "mixed"] as const;

export const WALL_ANGLES = ["slab", "vert", "overhang", "roof", "board", "mixed"] as const;

export type Grade = (typeof GRADES)[number];
export type HoldType = (typeof HOLD_TYPES)[number];
export type WallAngle = (typeof WALL_ANGLES)[number];

export type GradeDisplayUnit = "v" | "font";
export type SessionSource = "manual" | "toplogger";
export type StrengthLoadMetric = "relative" | "volume" | "sets";
export type TopLoggerCountMode = "attempted" | "sent" | "tries";

export interface ProblemEntry {
  id: string;
  count: number;
  grade: Grade;
  holdType: HoldType;
  wallAngle: WallAngle;
  climbedOn?: string;
}

export interface SessionInput {
  id: string;
  createdAt: string;
  durationMinutes: number;
  sleepHours: number;
  /** Sleep quality 1–10; absent on older and synced sessions. */
  sleepQuality?: number;
  stress: number;
  motivation: number;
  problems: ProblemEntry[];
  source?: SessionSource;
  /** TopLogger climb-day id for synced sessions. */
  externalId?: string;
  /** Set when a synced session was edited by hand, so later syncs leave it alone. */
  locallyEdited?: boolean;
  /** What TopLogger recorded for this day, kept so synced sessions can be checked against the app. */
  toplogger?: TopLoggerSessionStats;
}

export interface TopLoggerSessionStats {
  gymName?: string;
  climbsTried: number;
  climbsSent: number;
  /** Tries counted from individual logs. */
  loggedTries: number;
  /** TopLogger's own total for the day (bouldersTotalTries). */
  totalTries?: number;
}

export interface GradeIntensityConfig {
  /** Points for one problem at your current max grade. */
  basePoints: number;
  /** Factor per grade above (or divisor per grade below) your current max. */
  multiplierPerGrade: number;
  /** Marks the relative-to-max model; settings without it predate it and get new defaults. */
  relativeToMax: true;
}

export interface SpeedMultiplierConfig {
  impactPercent: number;
}

export interface RecoveryConfig {
  personalMaxSleepHours: number;
}

export interface LoadModelConfig {
  gradeIntensity: GradeIntensityConfig;
  speed: SpeedMultiplierConfig;
  recovery: RecoveryConfig;
  acwr: {
    acuteWindow: number;
    chronicWindow: number;
    lowThreshold: number;
    highThreshold: number;
    targetAcwr: number;
  };
}

export interface StrengthConfig {
  metric: StrengthLoadMetric;
  bodyweightKg: number;
  acuteWindow: number;
  chronicWindow: number;
  /** Per-exercise override of whether bodyweight is added to the logged weight. */
  bodyweightExercises: Record<string, boolean>;
}

export interface TopLoggerConfig {
  autoSync: boolean;
  importFromDate: string;
  countMode: TopLoggerCountMode;
  defaultDurationMinutes: number;
  lastSyncedAt?: string;
  /** TopLogger climb days you deleted here, so syncing doesn't bring them back. */
  ignoredDayIds?: string[];
}

export interface FitNotesConfig {
  autoSyncFromDrive: boolean;
  lastImport?: {
    fileName: string;
    importedAt: string;
    setCount: number;
    driveFileId?: string;
    driveModifiedTime?: string;
  };
}

export interface AppSettings {
  climberMaxGrade: Grade;
  gradeDisplayUnit: GradeDisplayUnit;
  stressScaleMax: number;
  motivationScaleMax: number;
  model: LoadModelConfig;
  strength: StrengthConfig;
  toplogger: TopLoggerConfig;
  fitnotes: FitNotesConfig;
  /** Your answer per gap in the log (keyed by gap id): climbing but not logging, or a real break. */
  logGaps: Record<string, "climbing" | "break">;
}

export interface CalculationResult {
  totalLoad: number;
  speedMultiplier: number;
  /** The max grade this session was measured against. */
  referenceGrade: Grade;
}

export interface DriveBackupPayload {
  version: number;
  exportedAt: string;
  settings: AppSettings;
  sessions: SessionInput[];
  /** Per hold/angle snapshots from older versions; no longer written or read. */
  ewmaSnapshots?: unknown[];
  strengthSets?: StrengthSet[];
}

/** One logged set, as imported from a FitNotes CSV export. */
export interface StrengthSet {
  id: string;
  date: string;
  exercise: string;
  category: string;
  weightKg: number;
  reps: number;
  distance?: number;
  distanceUnit?: string;
  timeSeconds?: number;
  comment?: string;
}
