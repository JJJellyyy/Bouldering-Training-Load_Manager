import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  clearEwmaSnapshots,
  clearSessions,
  loadEwmaSnapshots,
  loadSessions,
  loadSettings,
  loadStrengthSets,
  replaceStrengthSets,
  saveEwmaSnapshot,
  saveSession,
  saveSettings,
} from "./db/indexedDb";
import { updateSnapshot } from "./domain/ewma";
import { DEFAULT_SETTINGS, clampSettings } from "./domain/loadModelConfig";
import {
  calculateGradeIntensity,
  calculateSleepRecoveryMultiplier,
  calculateStressMultiplier,
  calculateSpeedMultiplier,
  calculateSessionLoad,
  calculateGradeDistribution,
  gradeToDisplay,
  gradeToNumber,
  suggestedCapacityRange,
  buildSessionHistory,
  getAcwrZone,
  getAcwrZoneKey,
  getSessionDayKey,
} from "./domain/loadCalculator";
import { AcwrHistoryChart } from "./components/AcwrHistoryChart";
import { BrandMark, RangePills, TabIcon, ThemeToggle } from "./components/Chrome";
import { ColumnChart } from "./components/charts/ColumnChart";
import { formatCompact, formatLongDate } from "./components/charts/chartUtils";
import { CurveChart, EwmaWeightsChart, LoadTotalsChart } from "./components/ModelCharts";
import { ZoneBadge } from "./components/ZoneBadge";
import { buildStrengthHistory, calculateSetLoads } from "./domain/strengthLoad";
import { NumberInput } from "./components/NumberInput";
import { StrengthHistoryTable, StrengthTab } from "./components/StrengthTab";
import { TopLoggerPanel } from "./components/TopLoggerPanel";
import { parseFitNotesCsv } from "./integrations/fitnotes";
import {
  connectTopLogger,
  fetchTopLoggerBoulderDays,
  readTopLoggerAuth,
  storeTopLoggerAuth,
  topLoggerDayToSession,
  TopLoggerError,
  type TopLoggerAuth,
} from "./integrations/toplogger";
import {
  initiateGoogleOAuthRedirect,
  extractOAuthTokenFromUrl,
  downloadBackupFromGoogleDrive,
  downloadDriveFileText,
  fetchGoogleProfile,
  findLatestFitNotesExport,
  type GoogleAuthSession,
  type GoogleProfile,
  uploadBackupToGoogleDrive,
} from "./integrations/googleDrive";
import {
  GRADES,
  HOLD_TYPES,
  WALL_ANGLES,
  type AppSettings,
  type DriveBackupPayload,
  type EWMASnapshot,
  type Grade,
  type GradeDisplayUnit,
  type HoldType,
  type ProblemEntry,
  type SessionInput,
  type StrengthSet,
  type WallAngle,
} from "./types";

type TabName = "session" | "dashboard" | "strength" | "settings" | "history";

interface SessionDraft {
  sessionDate: string;
  durationMinutes: number;
  sleepHours: number;
  stress: number;
  motivation: number;
  problems: ProblemEntry[];
}

function createSessionDraft(settings: AppSettings): SessionDraft {
  return {
    sessionDate: todayIsoDate(),
    durationMinutes: 120,
    sleepHours: settings.model.recovery.personalMaxSleepHours,
    stress: 5,
    motivation: 5,
    problems: [],
  };
}

function getId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.round(Math.random() * 100_000)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const GOOGLE_SESSION_STORAGE_KEY = "blm_google_session";

function getEwmaValue(snapshot: EWMASnapshot, windowDays: number): number {
  // For preset windows, return exact values
  if (windowDays === 10) {
    return snapshot.ewma10;
  }
  if (windowDays === 15) {
    return snapshot.ewma15;
  }
  if (windowDays === 20) {
    return snapshot.ewma20;
  }
  if (windowDays === 25) {
    return snapshot.ewma25;
  }

  // For custom windows, interpolate between nearest two preset windows
  const presets = [10, 15, 20, 25];
  const presetValues = [snapshot.ewma10, snapshot.ewma15, snapshot.ewma20, snapshot.ewma25];
  
  if (windowDays < 10) {
    // Extrapolate below 10
    const ratio = windowDays / 10;
    return snapshot.ewma10 * ratio;
  }
  if (windowDays > 25) {
    // Extrapolate above 25
    const ratio = windowDays / 25;
    return snapshot.ewma25 * ratio;
  }

  // Find bracketing windows
  let below = presets[0];
  let above = presets[presets.length - 1];
  let belowIdx = 0;
  let aboveIdx = presets.length - 1;

  for (let i = 0; i < presets.length - 1; i++) {
    if (presets[i] <= windowDays && windowDays <= presets[i + 1]) {
      below = presets[i];
      above = presets[i + 1];
      belowIdx = i;
      aboveIdx = i + 1;
      break;
    }
  }

  // Linear interpolation
  const belowValue = presetValues[belowIdx];
  const aboveValue = presetValues[aboveIdx];
  const t = (windowDays - below) / (above - below);
  return belowValue + t * (aboveValue - belowValue);
}

function App() {
  const [tab, setTab] = useState<TabName>(() => {
    const saved = localStorage.getItem("blm_tab");
    return (saved as TabName | null) ?? "session";
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<SessionInput[]>([]);
  const [strengthSets, setStrengthSets] = useState<StrengthSet[]>([]);
  const [fitnotesSyncing, setFitnotesSyncing] = useState(false);
  const [toploggerAuth, setToploggerAuth] = useState<TopLoggerAuth | undefined>(() => readTopLoggerAuth());
  const [toploggerStatus, setToploggerStatus] = useState<string | undefined>();
  const [toploggerSyncing, setToploggerSyncing] = useState(false);
  const [ewmaSnapshots, setEwmaSnapshots] = useState<Record<string, EWMASnapshot>>({});
  const [draft, setDraft] = useState<SessionDraft>(createSessionDraft(DEFAULT_SETTINGS));
  const [editingSessionId, setEditingSessionId] = useState<string | undefined>();
  const [editingSessionCreatedAt, setEditingSessionCreatedAt] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [driveSession, setDriveSession] = useState<GoogleAuthSession | undefined>();
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | undefined>();
  const [driveStatus, setDriveStatus] = useState<string>("Google Drive not connected.");
  const [driveConnectError, setDriveConnectError] = useState<string | undefined>(undefined);
  const [driveLog, setDriveLog] = useState<string[]>([]);
  const [notification, setNotification] = useState<string | undefined>(undefined);
  // Dashboard history graph
  const [historyRange, setHistoryRange] = useState<number | null>(28);
  // Next-session planner
  const [plannerGrade, setPlannerGrade] = useState<Grade>("V5");
  const [plannerCount, setPlannerCount] = useState<number>(20);
  const [plannerDuration, setPlannerDuration] = useState<number>(120);
  const [plannerDate, setPlannerDate] = useState<string>(todayIsoDate());
  const [plannerSleep, setPlannerSleep] = useState<number>(8);
  const [plannerStress, setPlannerStress] = useState<number>(5);

  function setTabAndPersist(t: TabName): void {
    localStorage.setItem("blm_tab", t);
    setTab(t);
  }

  function addDriveLog(msg: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log("[Drive]", msg);
    setDriveLog((prev) => [...prev.slice(-19), entry]);
  }

  function showNotification(msg: string, ms = 4000): void {
    setNotification(msg);
    window.setTimeout(() => setNotification(undefined), ms);
  }

  const [entryCount, setEntryCount] = useState(1);
  const [entryGrade, setEntryGrade] = useState<Grade>("V4");
  const [entryHold, setEntryHold] = useState<HoldType>("mixed");
  const [entryAngle, setEntryAngle] = useState<WallAngle>("vert");
  const [entryDate, setEntryDate] = useState<string>(todayIsoDate());
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  function storeDriveSession(session: GoogleAuthSession | undefined): void {
    if (!session) {
      localStorage.removeItem(GOOGLE_SESSION_STORAGE_KEY);
      return;
    }

    localStorage.setItem(GOOGLE_SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  function readStoredDriveSession(): GoogleAuthSession | undefined {
    const raw = localStorage.getItem(GOOGLE_SESSION_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as GoogleAuthSession;
      if (!parsed.accessToken || !parsed.expiresAt) {
        return undefined;
      }

      if (Date.now() > parsed.expiresAt - 15_000) {
        return undefined;
      }

      return parsed;
    } catch {
      return undefined;
    }
  }

  const totalProblems = useMemo(
    () => draft.problems.reduce((sum, problem) => sum + problem.count, 0),
    [draft.problems],
  );

  const estimatedLoad = useMemo(() => {
    if (draft.problems.length === 0) {
      return undefined;
    }

    return calculateSessionLoad(
      {
        id: "draft",
        createdAt: new Date().toISOString(),
        durationMinutes: draft.durationMinutes,
        sleepHours: draft.sleepHours,
        stress: draft.stress,
        motivation: draft.motivation,
        problems: draft.problems,
      },
      settings,
    );
  }, [draft, settings]);

  const capacityRange = useMemo(
    () => suggestedCapacityRange(settings.climberMaxGrade),
    [settings.climberMaxGrade],
  );

  const acwrRows = useMemo(() => {
    const acuteWindow = settings.model.acwr.acuteWindow;
    const chronicWindow = settings.model.acwr.chronicWindow;

    return Object.values(ewmaSnapshots)
      .map((snapshot) => {
        const acute = getEwmaValue(snapshot, acuteWindow);
        const chronic = getEwmaValue(snapshot, chronicWindow);
        const acwr = chronic <= 0 ? 0 : acute / chronic;

        return {
          key: snapshot.key,
          acute,
          chronic,
          acwr,
          zone: getAcwrZone(acwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold),
        };
      })
      .sort((a, b) => b.acwr - a.acwr);
  }, [ewmaSnapshots, settings.model.acwr]);

  // Overall ACWR: sum all acute / sum all chronic across every boulder type snapshot
  const overallAcwr = useMemo(() => {
    const snapshots = Object.values(ewmaSnapshots);
    if (snapshots.length === 0) return null;
    const sumAcute = snapshots.reduce((s, snap) => s + getEwmaValue(snap, settings.model.acwr.acuteWindow), 0);
    const sumChronic = snapshots.reduce((s, snap) => s + getEwmaValue(snap, settings.model.acwr.chronicWindow), 0);
    return sumChronic > 0 ? sumAcute / sumChronic : null;
  }, [ewmaSnapshots, settings.model.acwr]);

  // Session history for ACWR+Load graph (combined across all types)
  const fullSessionHistory = useMemo(() => buildSessionHistory(sessions, settings, null), [sessions, settings]);

  const strengthNow = useMemo(() => {
    const history = buildStrengthHistory(calculateSetLoads(strengthSets, settings.strength), settings.strength);
    return history.length > 0 ? history[history.length - 1] : null;
  }, [strengthSets, settings.strength]);

  const recentLoad = useMemo(() => {
    const lastWeek = fullSessionHistory.slice(-7);
    return {
      load: lastWeek.reduce((sum, point) => sum + point.load, 0),
      climbingDays: lastWeek.filter((point) => point.load > 0).length,
    };
  }, [fullSessionHistory]);

  const sessionHistory = useMemo(
    () => buildSessionHistory(sessions, settings, historyRange),
    [sessions, settings, historyRange],
  );

  // Planner: calculate predicted ACWR from manual inputs
  const plannerPrediction = useMemo(() => {
    const snapshots = Object.values(ewmaSnapshots);
    if (snapshots.length === 0) return null;

    const acuteWindow = settings.model.acwr.acuteWindow;
    const chronicWindow = settings.model.acwr.chronicWindow;
    const acuteAlpha = 2 / (acuteWindow + 1);
    const chronicAlpha = 2 / (chronicWindow + 1);

    let prevAcute = snapshots.reduce((s, snap) => s + getEwmaValue(snap, acuteWindow), 0);
    let prevChronic = snapshots.reduce((s, snap) => s + getEwmaValue(snap, chronicWindow), 0);
    if (prevChronic === 0) return null;

    if (sessions.length > 0) {
      const lastSession = sessions[sessions.length - 1];
      const lastSessionDate = new Date(lastSession.createdAt);
      const lastDate = new Date(lastSessionDate.getUTCFullYear(), lastSessionDate.getUTCMonth(), lastSessionDate.getUTCDate());
      const plannedDate = new Date(`${plannerDate}T00:00:00Z`);
      const daysBetween = Math.max(0, Math.floor((plannedDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)));

      for (let i = 0; i < daysBetween; i++) {
        prevAcute = (1 - acuteAlpha) * prevAcute;
        prevChronic = (1 - chronicAlpha) * prevChronic;
      }
    }

    const plannedSession = {
      id: "planner",
      createdAt: new Date(`${plannerDate}T12:00:00Z`).toISOString(),
      durationMinutes: plannerDuration,
      sleepHours: plannerSleep,
      stress: plannerStress,
      motivation: 5,
      problems: [
        {
          id: "planner-problem",
          count: plannerCount,
          grade: plannerGrade,
          holdType: "mixed" as HoldType,
          wallAngle: "mixed" as WallAngle,
        },
      ],
    };

    const actualLoad = calculateSessionLoad(plannedSession, settings).totalLoad;
    const newAcute = acuteAlpha * actualLoad + (1 - acuteAlpha) * prevAcute;
    const predAcwr = prevChronic > 0 ? newAcute / prevChronic : 0;
    return { predAcwr, actualLoad };
  }, [ewmaSnapshots, settings, plannerSleep, plannerStress, plannerGrade, plannerCount, plannerDuration, plannerDate, sessions]);

  const gradeDistribution = useMemo(() => {
    if (!plannerPrediction || plannerPrediction.actualLoad <= 0) return {};
    return calculateGradeDistribution(plannerPrediction.actualLoad, plannerDuration, plannerSleep, plannerStress, settings);
  }, [plannerPrediction, plannerDuration, plannerSleep, plannerStress, settings]);

  // Boulder distribution: show count of each grade centered around planner grade (normal distribution ±2)
  const boulderDistribution = useMemo(() => {
    if (!plannerPrediction || plannerPrediction.actualLoad <= 0) return [];
    
    const targetLoad = plannerPrediction.actualLoad;
    const gradeNum = gradeToNumber(plannerGrade);
    
    // Get grades from -2 to +1 relative to center
    const gradesInRange: Array<{ grade: Grade; offset: number }> = [];
    for (let offset = -2; offset <= 1; offset++) {
      const targetNum = gradeNum + offset;
      const grade = GRADES.find((g) => gradeToNumber(g) === targetNum);
      if (grade) {
        gradesInRange.push({ grade, offset });
      }
    }
    
    if (gradesInRange.length === 0) return [];
    
    // Calculate normal distribution weights (bell curve centered at offset=0)
    // Using Gaussian: weight = exp(-(offset^2 / 2)) for std dev = 1
    const weights = gradesInRange.map(({ offset }) => Math.exp(-0.5 * offset * offset));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    // Calculate intensities for each grade
    const distribution: Array<{ grade: Grade; count: number; intensity: number; offset: number }> = [];
    let totalIntensity = 0;
    
    for (let i = 0; i < gradesInRange.length; i++) {
      const { grade, offset } = gradesInRange[i];
      const normalizedWeight = weights[i] / totalWeight;
      const count = Math.round(plannerCount * normalizedWeight);
      const intensity = calculateGradeIntensity(grade, settings);
      distribution.push({ grade, count, intensity, offset });
      totalIntensity += count * intensity;
    }
    
    // Scale all counts to match target load
    if (totalIntensity > 0) {
      const scale = targetLoad / totalIntensity;
      let totalCount = 0;
      for (let i = 0; i < distribution.length; i++) {
        distribution[i].count = Math.round(distribution[i].count * scale);
        // Cap +1 grade at 15% of total
        if (distribution[i].offset === 1) {
          distribution[i].count = Math.min(distribution[i].count, Math.round(plannerCount * 0.15));
        }
        totalCount += distribution[i].count;
      }
      // Redistribute remaining count to center grade
      const surplus = plannerCount - totalCount;
      const centerIdx = distribution.findIndex((d) => d.offset === 0);
      if (centerIdx >= 0) {
        distribution[centerIdx].count += surplus;
      }
    }
    
    return distribution.map(({ grade, count }) => ({ grade, count })).filter((d) => d.count > 0);
  }, [plannerPrediction, plannerGrade, plannerCount, settings]);

  const acwrExample = useMemo(() => {
    const dummyProblems = 24;
    const dummyDuration = 120;
    const dummySleep = 7.5;
    const dummyStress = 5;
    const prevAcuteEwma = 95;
    const prevChronicEwma = 110;

    const acuteWindow = settings.model.acwr.acuteWindow;
    const chronicWindow = settings.model.acwr.chronicWindow;
    const acuteAlpha = 2 / (acuteWindow + 1);
    const chronicAlpha = 2 / (chronicWindow + 1);

    const baselineGrade = calculateGradeIntensity("V6", settings);
    const baselineSpeed = calculateSpeedMultiplier(dummyProblems, dummyDuration, settings);
    const baselineRecovery = calculateSleepRecoveryMultiplier(dummySleep, settings);
    const baselineStress = calculateStressMultiplier(dummyStress, settings);
    const baselineLoad = dummyProblems * baselineGrade * baselineSpeed * baselineRecovery * baselineStress;
    const nextAcuteEwma = acuteAlpha * baselineLoad + (1 - acuteAlpha) * prevAcuteEwma;
    const nextChronicEwma = chronicAlpha * baselineLoad + (1 - chronicAlpha) * prevChronicEwma;
    const nextAcwr = nextChronicEwma <= 0 ? 0 : nextAcuteEwma / nextChronicEwma;

    function projectAcwr(newLoad: number): number {
      const acute = acuteAlpha * newLoad + (1 - acuteAlpha) * prevAcuteEwma;
      const chronic = chronicAlpha * newLoad + (1 - chronicAlpha) * prevChronicEwma;
      return chronic <= 0 ? 0 : acute / chronic;
    }

    const hardGradeLoad =
      dummyProblems *
      calculateGradeIntensity("V9", settings) *
      baselineSpeed *
      baselineRecovery *
      baselineStress;

    const fasterPaceLoad =
      dummyProblems *
      baselineGrade *
      calculateSpeedMultiplier(dummyProblems, 75, settings) *
      baselineRecovery *
      baselineStress;

    const poorSleepLoad =
      dummyProblems *
      baselineGrade *
      baselineSpeed *
      calculateSleepRecoveryMultiplier(6.0, settings) *
      baselineStress;

    return {
      dummyProblems,
      dummyDuration,
      dummySleep,
      prevAcuteEwma,
      prevChronicEwma,
      acuteWindow,
      chronicWindow,
      acuteAlpha,
      chronicAlpha,
      baselineGrade,
      baselineSpeed,
      baselineRecovery,
      baselineLoad,
      nextAcuteEwma,
      nextChronicEwma,
      nextAcwr,
      hardGradeLoad,
      fasterPaceLoad,
      poorSleepLoad,
      hardGradeAcwr: projectAcwr(hardGradeLoad),
      fasterPaceAcwr: projectAcwr(fasterPaceLoad),
      poorSleepAcwr: projectAcwr(poorSleepLoad),
    };
  }, [settings]);

  const gradeCurvePoints = useMemo(
    () =>
      GRADES.map((grade) => ({
        x: gradeToNumber(grade),
        y: calculateGradeIntensity(grade, settings),
      })),
    [settings],
  );

  const speedCurvePoints = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => {
        const problemsPerHour = 8 + index * 4;
        return {
          x: problemsPerHour,
          y: calculateSpeedMultiplier(problemsPerHour, 60, settings),
        };
      }),
    [settings],
  );

  const sleepPenaltyCurvePoints = useMemo(() => {
    const maxSleep = settings.model.recovery.personalMaxSleepHours;

    return Array.from({ length: 16 }, (_, index) => {
      const deficit = index * 0.03;
      const actualSleep = maxSleep * (1 - deficit);
      const recovery = calculateSleepRecoveryMultiplier(actualSleep, settings);
      return {
        x: deficit * 100,
        y: (recovery - 1) * 100,
      };
    });
  }, [settings]);

  const stressPenaltyCurvePoints = useMemo(() => {
    return Array.from({ length: 11 }, (_, index) => {
      const stress = index;
      const multiplier = calculateStressMultiplier(stress, settings);
      return {
        x: stress * 10,
        y: (multiplier - 1) * 100,
      };
    });
  }, [settings]);

  const displayGradeLabel = (grade: Grade): string => gradeToDisplay(grade, settings.gradeDisplayUnit);
  const gradeFromNumber = (value: number): Grade => {
    const bounded = Math.min(17, Math.max(0, Math.round(value)));
    return `V${bounded}` as Grade;
  };

  useEffect(() => {
    async function bootstrap() {
      const [savedSettings, savedSessions, savedSnapshots, savedStrengthSets] = await Promise.all([
        loadSettings(),
        loadSessions(),
        loadEwmaSnapshots(),
        loadStrengthSets(),
      ]);

      const nextSettings = clampSettings(savedSettings ?? DEFAULT_SETTINGS);
      setSettings(nextSettings);
      setDraft(createSessionDraft(nextSettings));
      setSessions(savedSessions);

      const mapped = savedSnapshots.reduce<Record<string, EWMASnapshot>>((acc, snapshot) => {
        acc[snapshot.key] = snapshot;
        return acc;
      }, {});
      setEwmaSnapshots(mapped);

      setStrengthSets(savedStrengthSets);

      // Check if Google redirected back with a code (or error) in the URL query.
      let redirectSession: GoogleAuthSession | null = null;
      let activeDriveToken: string | undefined;
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (clientId) {
          redirectSession = await extractOAuthTokenFromUrl(clientId);
        }
      } catch (oauthErr) {
        const msg = oauthErr instanceof Error ? oauthErr.message : String(oauthErr);
        addDriveLog(`OAuth error on return: ${msg}`);
        setDriveConnectError(msg);
      }
      if (redirectSession) {
        try {
          addDriveLog("OAuth redirect detected. Fetching profile…");
          const profile = await fetchGoogleProfile(redirectSession.accessToken);
          addDriveLog(`Profile OK: ${profile.email}`);
          setDriveSession(redirectSession);
          setGoogleProfile(profile);
          storeDriveSession(redirectSession);
          activeDriveToken = redirectSession.accessToken;
              if (savedSessions.length === 0) {
                setDriveStatus(`Signed in as ${profile.email}. Restoring backup…`);
                addDriveLog("No local data — restoring from Drive…");
                await applyDriveBackup(redirectSession.accessToken);
                addDriveLog("Restore complete.");
                setDriveStatus(`Backup restored. Signed in as ${profile.email}.`);
              } else {
                setDriveStatus(`Google Drive connected as ${profile.email}. Attempting to merge data...`);
                addDriveLog("Local data exists — merging missing sessions from Drive.");
                await mergeDriveBackup(redirectSession.accessToken);
                setDriveStatus(`Google Drive connected as ${profile.email}. Merge complete.`);
              }
        } catch (err) {
          addDriveLog(`Redirect sign-in error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        const existingDriveSession = readStoredDriveSession();
        if (existingDriveSession) {
          try {
            const profile = await fetchGoogleProfile(existingDriveSession.accessToken);
            setDriveSession(existingDriveSession);
            setGoogleProfile(profile);
            activeDriveToken = existingDriveSession.accessToken;
            if (savedSessions.length === 0) {
              setDriveStatus(`Signed in as ${profile.email}. Restoring backup…`);
              await applyDriveBackup(existingDriveSession.accessToken);
              setDriveStatus(`Backup restored. Signed in as ${profile.email}.`);
            } else {
              setDriveStatus(`Google Drive connected as ${profile.email}. Attempting to merge data...`);
              addDriveLog("Local data exists — merging missing sessions from Drive.");
              await mergeDriveBackup(existingDriveSession.accessToken);
              setDriveStatus(`Google Drive connected as ${profile.email}. Merge complete.`);
            }
          } catch {
            storeDriveSession(undefined);
          }
        }
      }

      setLoading(false);

      // Background syncs run after first render so the app is usable while they load.
      const storedTopLoggerAuth = readTopLoggerAuth();
      if (storedTopLoggerAuth && nextSettings.toplogger.autoSync) {
        void syncTopLogger(storedTopLoggerAuth, nextSettings);
      }
      if (activeDriveToken && nextSettings.fitnotes.autoSyncFromDrive) {
        void syncFitNotesFromDrive(activeDriveToken, nextSettings, true);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    void saveSettings(settings);
  }, [settings, loading]);

  function addProblem(): void {
    setDraft((previous) => ({
      ...previous,
      problems: [
        ...previous.problems,
        {
          id: getId(),
          count: Math.max(1, Math.min(100, entryCount)),
          grade: entryGrade,
          holdType: entryHold,
          wallAngle: entryAngle,
          climbedOn: entryDate,
        },
      ],
    }));
  }

  function removeProblem(problemId: string): void {
    setDraft((previous) => ({
      ...previous,
      problems: previous.problems.filter((problem) => problem.id !== problemId),
    }));
  }

  function patchSettings(update: (draftValue: AppSettings) => void): void {
    setSettings((previous) => {
      const next = structuredClone(previous);
      update(next);
      return clampSettings(next);
    });
  }

  function beginEditSession(session: SessionInput): void {
    setEditingSessionId(session.id);
    setEditingSessionCreatedAt(session.createdAt);
    const sessionDateIso = session.createdAt.slice(0, 10); // Extract YYYY-MM-DD from ISO timestamp
    setDraft({
      sessionDate: sessionDateIso,
      durationMinutes: session.durationMinutes,
      sleepHours: session.sleepHours,
      stress: session.stress,
      motivation: session.motivation,
      problems: session.problems.map((problem) => ({ ...problem })),
    });
    setEntryDate(session.problems[0]?.climbedOn ?? todayIsoDate());
    setTabAndPersist("session");
  }

  function cancelEditSession(): void {
    setEditingSessionId(undefined);
    setEditingSessionCreatedAt(undefined);
    setDraft(createSessionDraft(settings));
  }

  async function recomputeAndPersistSnapshots(
    sessionsToReplay: SessionInput[],
    settingsForCalc: AppSettings,
  ): Promise<Record<string, EWMASnapshot>> {
    await clearEwmaSnapshots();
    const ordered = [...sessionsToReplay].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const windows = [...new Set(settingsForCalc.model.ewmaWindows)];
    const sessionsByDate = new Map<string, SessionInput[]>();
    const allKeys = new Set<string>();

    for (const sessionItem of ordered) {
      const dayKey = getSessionDayKey(sessionItem);
      const existing = sessionsByDate.get(dayKey) ?? [];
      existing.push(sessionItem);
      sessionsByDate.set(dayKey, existing);

      const sessionCalc = calculateSessionLoad(sessionItem, settingsForCalc);
      for (const entry of sessionCalc.byBoulderType) {
        allKeys.add(entry.key);
      }
    }

    const nextSnapshots: Record<string, EWMASnapshot> = {};
    for (const key of allKeys) {
      nextSnapshots[key] = {
        key,
        ewma10: 0,
        ewma15: 0,
        ewma20: 0,
        ewma25: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    if (ordered.length === 0) {
      await Promise.all(Object.values(nextSnapshots).map((snapshot) => saveEwmaSnapshot(snapshot)));
      return nextSnapshots;
    }

    const startDate = new Date(ordered[0].createdAt);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(ordered[ordered.length - 1].createdAt);
    endDate.setUTCHours(0, 0, 0, 0);

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayKey = currentDate.toISOString().slice(0, 10);
      const daySessions = sessionsByDate.get(dayKey) ?? [];
      const loadsByKey: Record<string, number> = {};

      for (const sessionItem of daySessions) {
        const sessionCalc = calculateSessionLoad(sessionItem, settingsForCalc);
        for (const entry of sessionCalc.byBoulderType) {
          loadsByKey[entry.key] = (loadsByKey[entry.key] ?? 0) + entry.adjustedLoad;
        }
      }

      for (const key of allKeys) {
        const updated = updateSnapshot(
          nextSnapshots[key],
          key,
          loadsByKey[key] ?? 0,
          windows,
        );
        nextSnapshots[key] = updated;
      }

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    await Promise.all(Object.values(nextSnapshots).map((snapshot) => saveEwmaSnapshot(snapshot)));
    return nextSnapshots;
  }

  function getBackupPayload(): DriveBackupPayload {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      sessions,
      ewmaSnapshots: Object.values(ewmaSnapshots),
      strengthSets,
    };
  }

  function downloadBlob(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportBackupAsJSON(): void {
    const payload = getBackupPayload();
    const json = JSON.stringify(payload, null, 2);
    downloadBlob(json, `boulder-load-manager-backup-${new Date().toISOString().slice(0,10)}.json`, "application/json");
  }

  function exportBouldersToCSV(): void {
    const header = "sessionId,createdAt,durationMinutes,sleepHours,stress,motivation,problemId,count,grade,holdType,wallAngle,climbedOn";
    const rows: string[] = [header];
    for (const s of sessions) {
      if (s.problems.length === 0) {
        rows.push([s.id, s.createdAt, s.durationMinutes, s.sleepHours, s.stress, s.motivation, "", "", "", "", "", ""].join(","));
      } else {
        for (const p of s.problems) {
          rows.push([s.id, s.createdAt, s.durationMinutes, s.sleepHours, s.stress, s.motivation, p.id, p.count, p.grade, p.holdType, p.wallAngle, p.climbedOn ?? ""].join(","));
        }
      }
    }
    downloadBlob(rows.join("\n"), `bouldering-sessions-${new Date().toISOString().slice(0,10)}.csv`, "text/csv");
  }

  async function importBackupFromJSON(file: File): Promise<void> {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as DriveBackupPayload;
      
      await clearSessions();
      await clearEwmaSnapshots();

      const restoredSettings = clampSettings(payload.settings ?? DEFAULT_SETTINGS);
      await saveSettings(restoredSettings);
      for (const s of payload.sessions) { await saveSession(s); }
      for (const snap of payload.ewmaSnapshots ?? []) { await saveEwmaSnapshot(snap); }
      if (payload.strengthSets) { await replaceStrengthSets(payload.strengthSets); }

      const [sessionsFromDb, snapshotsFromDb, strengthSetsFromDb] = await Promise.all([
        loadSessions(), loadEwmaSnapshots(), loadStrengthSets(),
      ]);
      const mappedSnapshots = snapshotsFromDb.reduce<Record<string, EWMASnapshot>>((acc, snap) => {
        acc[snap.key] = snap;
        return acc;
      }, {});

      setSettings(restoredSettings);
      setSessions(sessionsFromDb);
      setEwmaSnapshots(mappedSnapshots);
      setStrengthSets(strengthSetsFromDb);
      setDraft(createSessionDraft(restoredSettings));
      addDriveLog("Backup imported successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addDriveLog(`Error importing backup: ${msg}`);
    }
  }

  async function importBouldersFromCSV(file: File): Promise<void> {
    const text = await file.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return;
    // Group by sessionId
    const sessionMap = new Map<string, SessionInput>();
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const [sid, createdAt, durationMinutes, sleepHours, stress, motivation, problemId, count, grade, holdType, wallAngle, climbedOn] = cols;
      if (!sid) continue;
      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, { id: sid, createdAt, durationMinutes: Number(durationMinutes), sleepHours: Number(sleepHours), stress: Number(stress), motivation: Number(motivation), problems: [] });
      }
      if (problemId && grade) {
        sessionMap.get(sid)!.problems.push({ id: problemId, count: Number(count), grade: grade as Grade, holdType: holdType as HoldType, wallAngle: wallAngle as WallAngle, climbedOn: climbedOn || undefined });
      }
    }
    for (const session of sessionMap.values()) {
      await saveSession(session);
    }
    const updated = await loadSessions();
    setSessions(updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  }

  async function applyDriveBackup(token: string): Promise<void> {
    try {
      const payload = await downloadBackupFromGoogleDrive(token);
      await clearSessions();
      await clearEwmaSnapshots();

      const restoredSettings = clampSettings(payload.settings ?? DEFAULT_SETTINGS);
      await saveSettings(restoredSettings);
      for (const s of payload.sessions) { await saveSession(s); }
      for (const snap of payload.ewmaSnapshots ?? []) { await saveEwmaSnapshot(snap); }
      if (payload.strengthSets) { await replaceStrengthSets(payload.strengthSets); }

      const [sessionsFromDb, snapshotsFromDb, strengthSetsFromDb] = await Promise.all([
        loadSessions(), loadEwmaSnapshots(), loadStrengthSets(),
      ]);
      const mappedSnapshots = snapshotsFromDb.reduce<Record<string, EWMASnapshot>>((acc, snap) => {
        acc[snap.key] = snap;
        return acc;
      }, {});

      setSettings(restoredSettings);
      setSessions(sessionsFromDb);
      setEwmaSnapshots(mappedSnapshots);
      setStrengthSets(strengthSetsFromDb);
      setDraft(createSessionDraft(restoredSettings));
    } catch {
      // No backup file yet — that's fine, just continue with local data.
    }
  }

  async function mergeDriveBackup(token: string): Promise<void> {
    try {
      const payload = await downloadBackupFromGoogleDrive(token);
      const remoteSessions = payload.sessions ?? [];
      const local = await loadSessions();
      const localIds = new Set(local.map((s) => s.id));
      const sessionsToAdd = remoteSessions.filter((s) => !localIds.has(s.id));

      for (const s of sessionsToAdd) {
        await saveSession(s);
      }

      if (sessionsToAdd.length === 0) {
        addDriveLog("No new sessions to merge from Drive.");
        showNotification("No new sessions to merge from Drive.");
        return;
      }

      const updated = await loadSessions();
      const recalculatedSnapshots = await recomputeAndPersistSnapshots(updated, settings);

      setEwmaSnapshots(recalculatedSnapshots);
      setSessions(updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      addDriveLog(`Merged ${sessionsToAdd.length} sessions from Drive.`);
      showNotification(`Merged ${sessionsToAdd.length} sessions from Drive.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addDriveLog(`Error merging backup: ${msg}`);
      showNotification(`Error merging backup: ${msg}`);
    }
  }

  async function connectGoogleDrive(): Promise<void> {
    if (!googleClientId) {
      setDriveConnectError("Missing VITE_GOOGLE_CLIENT_ID. Configure it in Vercel and .env.local.");
      return;
    }
    // Navigate immediately — no state update before redirect to avoid blocking navigation
    await initiateGoogleOAuthRedirect(googleClientId);
  }

  function disconnectGoogleDrive(): void {
    setDriveSession(undefined);
    setGoogleProfile(undefined);
    storeDriveSession(undefined);
    setDriveStatus("Google Drive disconnected.");
  }

  function ensureDriveAccessToken(): string | undefined {
    if (driveSession && Date.now() < driveSession.expiresAt - 15_000) {
      return driveSession.accessToken;
    }
    return undefined;
  }


  async function handleDriveUpload(): Promise<void> {
    const token = ensureDriveAccessToken();
    if (!token) {
      setDriveStatus("Token expired — please sign in again.");
      showNotification("Token expired — please sign in again.");
      return;
    }

    try {
      await uploadBackupToGoogleDrive(token, getBackupPayload());
      setDriveStatus("Backup uploaded to Google Drive.");
      showNotification("Backup uploaded to Google Drive.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setDriveStatus(message);
      showNotification(`Upload failed: ${message}`);
    }
  }

  async function handleDriveRestore(): Promise<void> {
    const token = ensureDriveAccessToken();
    if (!token) {
      setDriveStatus("Token expired — please sign in again.");
      showNotification("Token expired — please sign in again.");
      return;
    }

    try {
      await applyDriveBackup(token);
      setDriveStatus("Backup restored from Google Drive.");
      showNotification("Backup restored from Google Drive.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restore failed.";
      setDriveStatus(message);
      showNotification(`Restore failed: ${message}`);
    }
  }

  function problemsSignature(problems: ProblemEntry[]): string {
    return problems.map((problem) => `${problem.grade}|${problem.wallAngle}|${problem.count}`).sort().join(",");
  }

  async function syncTopLogger(auth: TopLoggerAuth, settingsForSync: AppSettings): Promise<void> {
    setToploggerSyncing(true);
    setToploggerStatus("Syncing TopLogger…");

    try {
      const { importFromDate, lastSyncedAt } = settingsForSync.toplogger;
      // Re-check a few days before the last sync to catch climbs logged late.
      const lastSyncedDay = lastSyncedAt ? shiftIsoDate(lastSyncedAt.slice(0, 10), -3) : undefined;
      // Sessions synced before tries were recorded get backfilled with one full re-sync.
      const needsBackfill = (await loadSessions()).some((item) => item.source === "toplogger" && !item.toplogger);
      const since = !needsBackfill && lastSyncedDay && lastSyncedDay > importFromDate ? lastSyncedDay : importFromDate;

      const { auth: nextAuth, days } = await fetchTopLoggerBoulderDays(auth, since);
      setToploggerAuth(nextAuth);

      const sessionsById = new Map((await loadSessions()).map((item) => [item.id, item]));
      let added = 0;
      let updated = 0;

      for (const day of days) {
        const synced = topLoggerDayToSession(day, settingsForSync);
        if (!synced) continue;

        const existing = sessionsById.get(synced.id);
        if (existing?.locallyEdited) continue;

        if (existing) {
          if (
            problemsSignature(existing.problems) === problemsSignature(synced.problems) &&
            JSON.stringify(existing.toplogger) === JSON.stringify(synced.toplogger)
          ) {
            continue;
          }
          const merged: SessionInput = {
            ...synced,
            durationMinutes: existing.durationMinutes,
            sleepHours: existing.sleepHours,
            stress: existing.stress,
            motivation: existing.motivation,
          };
          await saveSession(merged);
          sessionsById.set(merged.id, merged);
          updated++;
        } else {
          await saveSession(synced);
          sessionsById.set(synced.id, synced);
          added++;
        }
      }

      if (added + updated > 0) {
        const allSessions = Array.from(sessionsById.values());
        const recalculatedSnapshots = await recomputeAndPersistSnapshots(allSessions, settingsForSync);
        setEwmaSnapshots(recalculatedSnapshots);
        setSessions(allSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }

      setSettings((previous) =>
        clampSettings({ ...previous, toplogger: { ...previous.toplogger, lastSyncedAt: new Date().toISOString() } }),
      );
      setToploggerStatus(`TopLogger: checked ${days.length} climbing days since ${since}: ${added} new, ${updated} updated.`);
      if (added + updated > 0) {
        showNotification(`TopLogger sync: ${added} new, ${updated} updated sessions.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TopLoggerError && (error.code === "UNAUTHENTICATED" || /jwt|token/i.test(message))) {
        storeTopLoggerAuth(undefined);
        setToploggerAuth(undefined);
        setToploggerStatus(`TopLogger session expired or revoked (${message}). Paste a new refresh token to reconnect.`);
      } else {
        setToploggerStatus(`TopLogger sync failed: ${message}`);
      }
    } finally {
      setToploggerSyncing(false);
    }
  }

  async function handleTopLoggerConnect(refreshToken: string): Promise<void> {
    setToploggerSyncing(true);
    setToploggerStatus("Connecting to TopLogger…");

    let auth: TopLoggerAuth;
    try {
      auth = await connectTopLogger(refreshToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToploggerStatus(`Could not connect to TopLogger: ${message}`);
      setToploggerSyncing(false);
      return;
    }

    setToploggerAuth(auth);
    await syncTopLogger(auth, settings);
  }

  function handleTopLoggerDisconnect(): void {
    storeTopLoggerAuth(undefined);
    setToploggerAuth(undefined);
    setToploggerStatus("TopLogger disconnected. Synced sessions stay in your history.");
  }

  async function applyFitNotesExport(
    text: string,
    source: { fileName: string; driveFileId?: string; driveModifiedTime?: string },
  ): Promise<void> {
    const { sets, skippedRows } = parseFitNotesCsv(text);
    if (sets.length === 0) {
      throw new Error("No sets found in this export.");
    }

    await replaceStrengthSets(sets);
    setStrengthSets(sets);
    setSettings((previous) =>
      clampSettings({
        ...previous,
        fitnotes: {
          ...previous.fitnotes,
          lastImport: { ...source, importedAt: new Date().toISOString(), setCount: sets.length },
        },
      }),
    );
    showNotification(
      `Imported ${sets.length} sets from ${source.fileName}${skippedRows > 0 ? ` (${skippedRows} rows skipped)` : ""}.`,
    );
  }

  async function importFitNotesFile(file: File): Promise<void> {
    try {
      await applyFitNotesExport(await file.text(), { fileName: file.name });
    } catch (error) {
      showNotification(`FitNotes import failed: ${error instanceof Error ? error.message : String(error)}`, 6000);
    }
  }

  async function syncFitNotesFromDrive(token: string, settingsForSync: AppSettings, onlyIfChanged: boolean): Promise<void> {
    setFitnotesSyncing(true);

    try {
      const file = await findLatestFitNotesExport(token);
      if (!file) {
        if (!onlyIfChanged) showNotification("No FitNotes CSV export found in Google Drive.");
        return;
      }

      const lastImport = settingsForSync.fitnotes.lastImport;
      if (onlyIfChanged && lastImport?.driveFileId === file.id && lastImport.driveModifiedTime === file.modifiedTime) {
        return;
      }

      const text = await downloadDriveFileText(token, file.id);
      await applyFitNotesExport(text, { fileName: file.name, driveFileId: file.id, driveModifiedTime: file.modifiedTime });
    } catch (error) {
      showNotification(`FitNotes Drive sync failed: ${error instanceof Error ? error.message : String(error)}`, 6000);
    } finally {
      setFitnotesSyncing(false);
    }
  }

  function handleFitNotesDriveSync(): void {
    const token = ensureDriveAccessToken();
    if (!token) {
      showNotification("Google sign-in expired — please sign in again.");
      return;
    }

    void syncFitNotesFromDrive(token, settings, false);
  }

  async function saveCurrentSession(): Promise<void> {
    if (draft.problems.length === 0) {
      return;
    }

    const isEditing = Boolean(editingSessionId);

    // Convert session date (YYYY-MM-DD) to ISO timestamp at noon UTC
    const sessionDateIso = `${draft.sessionDate}T12:00:00Z`;

    const original = isEditing ? sessions.find((item) => item.id === editingSessionId) : undefined;
    const session: SessionInput = {
      id: editingSessionId ?? getId(),
      createdAt: editingSessionCreatedAt ?? sessionDateIso,
      durationMinutes: draft.durationMinutes,
      sleepHours: draft.sleepHours,
      stress: draft.stress,
      motivation: draft.motivation,
      problems: draft.problems,
      source: original?.source ?? "manual",
      externalId: original?.externalId,
      locallyEdited: original?.source === "toplogger" ? true : undefined,
    };

    const highestLoggedGrade = session.problems.reduce((max, item) => {
      const score = gradeToNumber(item.grade);
      return Math.max(max, score);
    }, gradeToNumber(settings.climberMaxGrade));

    let nextSettings = settings;
    if (highestLoggedGrade > gradeToNumber(settings.climberMaxGrade)) {
      const upgraded = `V${highestLoggedGrade}` as Grade;
      nextSettings = clampSettings({ ...settings, climberMaxGrade: upgraded });
      setSettings(nextSettings);
      await saveSettings(nextSettings);
    }

    const updatedSessions = isEditing
      ? sessions.map((item) => (item.id === session.id ? session : item))
      : [session, ...sessions];

    await saveSession(session);
    const recalculatedSnapshots = await recomputeAndPersistSnapshots(updatedSessions, nextSettings);

    setEwmaSnapshots(recalculatedSnapshots);
    setSessions(updatedSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setDraft(createSessionDraft(nextSettings));
    setEditingSessionId(undefined);
    setEditingSessionCreatedAt(undefined);
    setTabAndPersist("dashboard");
  }

  if (loading) {
    return (
      <main className="app-shell">
        <p className="loading-note">Chalking up…</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {notification && <div className="notification">{notification}</div>}
      <header className="hero">
        <div className="hero-bar">
          <div className="brand">
            <BrandMark />
            <div>
              <p className="brand-name">Boulder Load Manager</p>
              <p className="brand-tag">Climb hard, recover well, stay on the wall.</p>
            </div>
          </div>
          <div className="hero-actions">
            <ThemeToggle />
            {googleProfile ? (
              <div className="profile-chip">
                {googleProfile.picture ? (
                  <img src={googleProfile.picture} alt="" className="profile-avatar" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                ) : (
                  <div className="profile-avatar-fallback">{googleProfile.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div className="profile-text">
                  <p className="profile-name">{googleProfile.name}</p>
                  <p className="profile-email">{googleProfile.email}</p>
                </div>
                <button type="button" className="ghost small" onClick={disconnectGoogleDrive}>Sign out</button>
              </div>
            ) : (
              <div className="connect-top-col">
                <button type="button" className="primary" onClick={() => { setDriveConnectError(undefined); connectGoogleDrive(); }}>
                  Sign in with Google
                </button>
                {driveConnectError && (
                  <>
                    <p className="drive-connect-error">{driveConnectError}</p>
                    <p className="drive-connect-hint">If Google shows "This app isn't verified", click <strong>Advanced</strong> → <strong>Go to boulder-load-manager.vercel.app</strong> to continue.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="hero-body">
          <div className="hero-copy">
            <p className="eyebrow">{formatLongDate(todayIsoDate())}</p>
            <h1>
              {overallAcwr === null
                ? "Welcome to base camp."
                : {
                    detraining: "Fresh legs. Room to push.",
                    goldilocks: "Right in the sweet spot.",
                    "high-risk": "Easy does it. Load is spiking.",
                  }[getAcwrZoneKey(overallAcwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold)]}
            </h1>
            <p className="hero-sub">
              Capacity range for a max of {displayGradeLabel(settings.climberMaxGrade)}:{" "}
              <strong>
                {displayGradeLabel(gradeFromNumber(capacityRange.min))} – {displayGradeLabel(gradeFromNumber(capacityRange.max))}
              </strong>
            </p>
          </div>
          <div className="stat-tiles">
            <article className="stat-tile">
              <span className="stat-label">Bouldering ACWR</span>
              <strong className="stat-value">{overallAcwr === null ? "–" : overallAcwr.toFixed(2)}</strong>
              {overallAcwr !== null && (
                <ZoneBadge acwr={overallAcwr} low={settings.model.acwr.lowThreshold} high={settings.model.acwr.highThreshold} />
              )}
            </article>
            <article className="stat-tile">
              <span className="stat-label">Strength ACWR</span>
              <strong className="stat-value">{strengthNow ? strengthNow.acwr.toFixed(2) : "–"}</strong>
              {strengthNow && (
                <ZoneBadge acwr={strengthNow.acwr} low={settings.model.acwr.lowThreshold} high={settings.model.acwr.highThreshold} />
              )}
            </article>
            <article className="stat-tile">
              <span className="stat-label">Last 7 days</span>
              <strong className="stat-value">{formatCompact(recentLoad.load)}</strong>
              <span className="stat-meta">
                load · {recentLoad.climbingDays} climbing day{recentLoad.climbingDays === 1 ? "" : "s"}
              </span>
            </article>
            <article className="stat-tile">
              <span className="stat-label">Sessions logged</span>
              <strong className="stat-value">{sessions.length}</strong>
              <span className="stat-meta">
                {sessions[0] ? `last ${formatLongDate(getSessionDayKey(sessions[0]))}` : "none yet"}
              </span>
            </article>
          </div>
        </div>
        <svg className="hero-ridge" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
          <path className="ridge-far" d="M0 120 L0 70 L90 40 L170 66 L260 22 L360 60 L450 34 L560 72 L660 28 L760 58 L860 18 L960 54 L1060 36 L1200 64 L1200 120 Z" />
          <path className="ridge-near" d="M0 120 L0 92 L120 70 L220 94 L330 64 L430 90 L540 76 L650 100 L760 72 L880 96 L990 78 L1100 98 L1200 84 L1200 120 Z" />
        </svg>
      </header>

      <nav className="tab-nav" aria-label="Main tabs">
        {([
          ["session", "Session"],
          ["dashboard", "Dashboard"],
          ["strength", "Strength"],
          ["history", "History"],
          ["settings", "Settings"],
        ] as const).map(([name, label]) => (
          <button
            key={name}
            type="button"
            onClick={() => setTabAndPersist(name)}
            className={tab === name ? "active" : ""}
            aria-current={tab === name ? "page" : undefined}
          >
            <TabIcon name={name} />
            {label}
          </button>
        ))}
      </nav>

      {tab === "session" && (
        <section className="panel-grid">
          <TopLoggerPanel
            settings={settings}
            patchSettings={patchSettings}
            auth={toploggerAuth}
            status={toploggerStatus}
            syncing={toploggerSyncing}
            onConnect={(refreshToken) => void handleTopLoggerConnect(refreshToken)}
            onDisconnect={handleTopLoggerDisconnect}
            onSync={() => {
              if (toploggerAuth) void syncTopLogger(toploggerAuth, settings);
            }}
          />
          <article className="panel">
            <h2>Add problems</h2>
            <div className="field-grid">
              <label>
                Date
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                />
              </label>
              <label>
                Problems (1-100)
                <NumberInput
                  value={entryCount}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) => setEntryCount(Math.round(value))}
                />
              </label>
              <label>
                Grade
                <select value={entryGrade} onChange={(event) => setEntryGrade(event.target.value as Grade)}>
                  {GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {displayGradeLabel(grade)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hold type
                <select value={entryHold} onChange={(event) => setEntryHold(event.target.value as HoldType)}>
                  {HOLD_TYPES.map((holdType) => (
                    <option key={holdType} value={holdType}>
                      {holdType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Wall angle
                <select value={entryAngle} onChange={(event) => setEntryAngle(event.target.value as WallAngle)}>
                  {WALL_ANGLES.map((angle) => (
                    <option key={angle} value={angle}>
                      {angle}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="primary" onClick={addProblem}>Add to session</button>
          </article>

          <article className="panel">
            <h2>How did it feel?</h2>
            {editingSessionId && (
              <p>
                Editing existing session. Save will update the same history entry and recalculate ACWR/EWMA.
              </p>
            )}
            <div className="field-grid">
              <label>
                Session date
                <input
                  type="date"
                  value={draft.sessionDate}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, sessionDate: event.target.value }))
                  }
                />
              </label>
              <label>
                Duration (minutes)
                <NumberInput
                  value={draft.durationMinutes}
                  min={10}
                  step={1}
                  onCommit={(value) =>
                    setDraft((previous) => ({ ...previous, durationMinutes: Math.round(value) }))
                  }
                />
              </label>
              <label>
                Sleep before session (hours)
                <NumberInput
                  value={draft.sleepHours}
                  min={0}
                  max={12}
                  step={0.25}
                  onCommit={(value) => setDraft((previous) => ({ ...previous, sleepHours: value }))}
                />
              </label>
              <label>
                Stress ({settings.stressScaleMax} max)
                <select
                  value={draft.stress}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft((previous) => ({ ...previous, stress: value }));
                  }}
                >
                  {Array.from({ length: settings.stressScaleMax }, (_, index) => index + 1).map((value) => (
                    <option key={`stress-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Motivation ({settings.motivationScaleMax} max)
                <select
                  value={draft.motivation}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft((previous) => ({ ...previous, motivation: value }));
                  }}
                >
                  {Array.from({ length: settings.motivationScaleMax }, (_, index) => index + 1).map((value) => (
                    <option key={`motivation-${value}`} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {estimatedLoad && (
              <div className="metric-row">
                <span>
                  Estimated load: <strong>{estimatedLoad.totalLoad.toFixed(2)}</strong>
                </span>
                <span>Speed x {estimatedLoad.speedMultiplier.toFixed(2)}</span>
                <span>Recovery x {estimatedLoad.recoveryMultiplier.toFixed(2)}</span>
              </div>
            )}

            <div className="metric-row">
              <button type="button" className="primary" onClick={() => void saveCurrentSession()} disabled={draft.problems.length === 0}>
                {editingSessionId ? "Update session" : "Save session"}
              </button>
              {editingSessionId && (
                <button type="button" onClick={cancelEditSession}>
                  Cancel Edit
                </button>
              )}
            </div>
          </article>

          <article className="panel full-width">
            <div className="panel-header-row">
              <h2>This session</h2>
              <span className="count-chip">{totalProblems} problem{totalProblems === 1 ? "" : "s"}</span>
            </div>
            {draft.problems.length === 0 && <p>No problems logged yet.</p>}
            {draft.problems.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Count</th>
                    <th>Grade</th>
                    <th>Hold</th>
                    <th>Angle</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.problems.map((problem) => (
                    <tr key={problem.id}>
                      <td>{problem.climbedOn ?? todayIsoDate()}</td>
                      <td>{problem.count}</td>
                      <td>{displayGradeLabel(problem.grade)}</td>
                      <td>{problem.holdType}</td>
                      <td>{problem.wallAngle}</td>
                      <td>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => removeProblem(problem.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </section>
      )}

      {tab === "dashboard" && (
        <section className="panel-grid">
          <div className="filter-row full-width">
            <span className="filter-label">Range</span>
            <RangePills
              label="Chart date range"
              value={historyRange}
              onChange={setHistoryRange}
              options={[
                { value: 14, label: "2 wk" },
                { value: 28, label: "4 wk" },
                { value: 90, label: "3 mo" },
                { value: 180, label: "6 mo" },
                { value: null, label: "All" },
              ]}
            />
          </div>

          <article className="panel">
            <h2>Bouldering ACWR</h2>
            {overallAcwr === null ? (
              <p className="empty-note">Save a session to see your ACWR.</p>
            ) : (
              <div className="hero-figure">
                <span className="hero-figure-value">{overallAcwr.toFixed(2)}</span>
                <ZoneBadge acwr={overallAcwr} low={settings.model.acwr.lowThreshold} high={settings.model.acwr.highThreshold} />
                <p className="muted-hint">
                  Sweet spot {settings.model.acwr.lowThreshold.toFixed(2)}–{settings.model.acwr.highThreshold.toFixed(2)} · target{" "}
                  {settings.model.acwr.targetAcwr.toFixed(2)} · windows {settings.model.acwr.acuteWindow}/{settings.model.acwr.chronicWindow} days
                </p>
              </div>
            )}
          </article>

          <article className="panel">
            <h2>This week on the wall</h2>
            <dl className="fact-list">
              <div>
                <dt>Load, last 7 days</dt>
                <dd>{formatCompact(recentLoad.load)}</dd>
              </div>
              <div>
                <dt>Climbing days</dt>
                <dd>{recentLoad.climbingDays}</dd>
              </div>
              <div>
                <dt>Last session</dt>
                <dd>{sessions[0] ? formatLongDate(getSessionDayKey(sessions[0])) : "–"}</dd>
              </div>
              <div>
                <dt>Max grade</dt>
                <dd>{displayGradeLabel(settings.climberMaxGrade)}</dd>
              </div>
            </dl>
          </article>

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>ACWR over time</h2>
              <p className="muted-hint">Acute ÷ chronic EWMA of your daily bouldering load. Hover or use the arrow keys for details.</p>
            </div>
            {sessionHistory.length < 2 ? (
              <p className="empty-note">Log at least 2 sessions to see the history graph.</p>
            ) : (
              <AcwrHistoryChart
                points={sessionHistory}
                lowThreshold={settings.model.acwr.lowThreshold}
                highThreshold={settings.model.acwr.highThreshold}
                targetAcwr={settings.model.acwr.targetAcwr}
              />
            )}
          </article>

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>Rolling load totals</h2>
              <p className="muted-hint">Total load over the previous 7, 14 and 28 days, for each day in the range.</p>
            </div>
            <LoadTotalsChart history={fullSessionHistory} rangeDays={historyRange} />
          </article>

          {/* Next-session planner */}
          <article className="panel full-width">
            <h2>Plan your next session</h2>
            <p className="muted-hint">Enter your planned session details to see what ACWR you'll reach. Your ACWR target: <strong>{settings.model.acwr.targetAcwr.toFixed(2)}</strong>.</p>
            {plannerPrediction === null ? (
              <p>Log at least one session to enable the planner.</p>
            ) : (
              <>
                <div className="planner-inputs-row">
                  <label className="planner-input-label">
                    Session Date
                    <input type="date" value={plannerDate} onChange={(e) => setPlannerDate(e.target.value)} />
                  </label>
                  <label className="planner-input-label">
                    Sleep (h)
                    <NumberInput value={plannerSleep} min={0} max={14} step={0.5} onCommit={setPlannerSleep} />
                  </label>
                  <label className="planner-input-label">
                    Stress (1–{settings.stressScaleMax})
                    <NumberInput value={plannerStress} min={1} max={settings.stressScaleMax} step={1} onCommit={setPlannerStress} />
                  </label>
                </div>
                <div className="planner-grid">
                  <div className="planner-field">
                    <label>
                      Duration (min)
                    </label>
                    <NumberInput value={plannerDuration} min={5} max={600} step={5} onCommit={setPlannerDuration} />
                  </div>
                  <div className="planner-field">
                    <label>
                      Boulder count
                    </label>
                    <NumberInput value={plannerCount} min={1} max={150} step={1} onCommit={setPlannerCount} />
                  </div>
                  <div className="planner-field">
                    <label>
                      Avg grade
                    </label>
                    <select value={plannerGrade} onChange={(e) => setPlannerGrade(e.target.value as Grade)}>
                      {GRADES.map((g) => (
                        <option key={g} value={g}>{gradeToDisplay(g, settings.gradeDisplayUnit)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="planner-result">
                    <span className="planner-acwr-label">Predicted ACWR</span>
                    <span className={`planner-acwr-value ${getAcwrZone(plannerPrediction.predAcwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold).toLowerCase().replace(" ", "-")}`}>
                      {plannerPrediction.predAcwr.toFixed(2)}
                    </span>
                  </div>
                  <div className="planner-result">
                    <span className="planner-acwr-label">Estimated Load</span>
                    <span className="planner-acwr-value">
                      {plannerPrediction.actualLoad.toFixed(0)}
                    </span>
                  </div>
                </div>

                {plannerPrediction && Object.keys(gradeDistribution).length > 0 && (
                  <div className="grade-distribution">
                    <h3>Same load, one grade</h3>
                    <p className="muted-hint">How many boulders of a single grade give the same load ({plannerPrediction.actualLoad.toFixed(0)}).</p>
                    {(() => {
                      const grades = GRADES.filter((grade) => gradeDistribution[grade] > 0);
                      return (
                        <ColumnChart
                          ariaLabel="Boulders needed per grade for the same load"
                          labels={grades.map((grade) => gradeToDisplay(grade, settings.gradeDisplayUnit))}
                          titles={grades.map((grade) => `Only ${gradeToDisplay(grade, settings.gradeDisplayUnit)}`)}
                          values={grades.map((grade) => gradeDistribution[grade])}
                          color="var(--series-1)"
                          seriesLabel="boulders"
                          height={210}
                          formatValue={(value) => value.toFixed(0)}
                        />
                      );
                    })()}
                  </div>
                )}

                {boulderDistribution.length > 0 && (
                  <div className="grade-distribution">
                    <h3>Suggested mix</h3>
                    <p className="muted-hint">Distribute your {plannerCount} boulders across grades to hit {plannerPrediction.actualLoad.toFixed(0)} load:</p>
                    <div className="boulder-breakdown">
                      {boulderDistribution.map((item, idx) => (
                        <div key={idx} className="breakdown-item">
                          <strong>{item.count}×</strong> {gradeToDisplay(item.grade, settings.gradeDisplayUnit)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
              </>
            )}
          </article>

          <article className="panel full-width">
            <h2>ACWR by hold type and wall angle</h2>
            {sessions.length > 0 && sessions.length < Math.max(...settings.model.ewmaWindows) && (
              <p className="bootstrap-warning">
                ⚠ EWMA is still stabilising — using session average as seed ({sessions.length}/{Math.max(...settings.model.ewmaWindows)} sessions logged). Values will become more accurate as you log more sessions.
              </p>
            )}
            {acwrRows.length === 0 && <p>Save a session to generate ACWR values.</p>}
            {acwrRows.length > 0 && (
              <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Boulder type</th>
                    <th>Acute EWMA</th>
                    <th>Chronic EWMA</th>
                    <th>ACWR</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {acwrRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key.replace("__", " · ")}</td>
                        <td className="num">{formatCompact(row.acute)}</td>
                        <td className="num">{formatCompact(row.chronic)}</td>
                        <td className="num">{row.acwr.toFixed(2)}</td>
                        <td>
                          <ZoneBadge acwr={row.acwr} low={settings.model.acwr.lowThreshold} high={settings.model.acwr.highThreshold} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            )}
          </article>
        </section>
      )}

      {tab === "strength" && (
        <StrengthTab
          settings={settings}
          strengthSets={strengthSets}
          patchSettings={patchSettings}
          onImportFile={(file) => void importFitNotesFile(file)}
          onSyncFromDrive={handleFitNotesDriveSync}
          driveConnected={Boolean(driveSession)}
          syncing={fitnotesSyncing}
        />
      )}

      {tab === "settings" && (
        <section className="panel-grid">
          <article className="panel">
            <h2>Profile</h2>
            <div className="field-grid">
              <label>
                Max grade
                <select
                  value={settings.climberMaxGrade}
                  onChange={(event) =>
                    patchSettings((next) => {
                      next.climberMaxGrade = event.target.value as Grade;
                    })
                  }
                >
                  {GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {displayGradeLabel(grade)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Grade unit
                <select
                  value={settings.gradeDisplayUnit}
                  onChange={(event) =>
                    patchSettings((next) => {
                      next.gradeDisplayUnit = event.target.value as GradeDisplayUnit;
                    })
                  }
                >
                  <option value="v">V grade</option>
                  <option value="font">Font</option>
                </select>
              </label>
              <label>
                Stress scale max
                <NumberInput
                  value={settings.stressScaleMax}
                  min={3}
                  max={20}
                  step={1}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.stressScaleMax = Math.round(value);
                    })
                  }
                />
              </label>
              <label>
                Motivation scale max
                <NumberInput
                  value={settings.motivationScaleMax}
                  min={3}
                  max={20}
                  step={1}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.motivationScaleMax = Math.round(value);
                    })
                  }
                />
              </label>
            </div>
          </article>

          <article className="panel">
            <h2>Model tuning</h2>
            <div className="field-grid">
              <label>
                Grade base points (V0)
                <NumberInput
                  value={settings.model.gradeIntensity.basePoints}
                  min={1}
                  max={100}
                  step={1}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.gradeIntensity.basePoints = value;
                    })
                  }
                />
              </label>
              <label>
                Grade multiplier per grade
                <NumberInput
                  value={settings.model.gradeIntensity.multiplierPerGrade}
                  min={1.01}
                  max={10}
                  step={0.05}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.gradeIntensity.multiplierPerGrade = value;
                    })
                  }
                />
              </label>
              <label>
                Speed impact (% increase at 1 min/boulder)
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.model.speed.impactPercent}
                  onChange={(e) =>
                    patchSettings((next) => {
                      next.model.speed.impactPercent = Number(e.target.value);
                    })
                  }
                />
                <span className="range-value">{settings.model.speed.impactPercent}%</span>
              </label>
              <label>
                Sleep impact (% increase at 0 hours)
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.model.recovery.sleepImpactPercent}
                  onChange={(e) =>
                    patchSettings((next) => {
                      next.model.recovery.sleepImpactPercent = Number(e.target.value);
                    })
                  }
                />
                <span className="range-value">{settings.model.recovery.sleepImpactPercent}%</span>
              </label>
              <label>
                Stress impact (% increase at 10/10 stress)
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.model.recovery.stressImpactPercent}
                  onChange={(e) =>
                    patchSettings((next) => {
                      next.model.recovery.stressImpactPercent = Number(e.target.value);
                    })
                  }
                />
                <span className="range-value">{settings.model.recovery.stressImpactPercent}%</span>
              </label>
              <label>
                ACWR acute window (days)
                <NumberInput
                  value={settings.model.acwr.acuteWindow}
                  min={3}
                  max={60}
                  step={1}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.acwr.acuteWindow = Math.round(value);
                    })
                  }
                />
              </label>
              <label>
                ACWR chronic window (days)
                <NumberInput
                  value={settings.model.acwr.chronicWindow}
                  min={3}
                  max={60}
                  step={1}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.acwr.chronicWindow = Math.round(value);
                    })
                  }
                />
              </label>
              <label>
                ACWR low threshold
                <NumberInput
                  value={settings.model.acwr.lowThreshold}
                  min={0.1}
                  max={3}
                  step={0.05}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.acwr.lowThreshold = value;
                    })
                  }
                />
              </label>
              <label>
                ACWR high threshold
                <NumberInput
                  value={settings.model.acwr.highThreshold}
                  min={0.1}
                  max={4}
                  step={0.05}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.acwr.highThreshold = value;
                    })
                  }
                />
              </label>
              <label>
                ACWR planner target
                <input
                  type="range"
                  min={0.8}
                  max={1.3}
                  step={0.05}
                  value={settings.model.acwr.targetAcwr}
                  onChange={(e) =>
                    patchSettings((next) => {
                      next.model.acwr.targetAcwr = Number(e.target.value);
                    })
                  }
                />
                <span className="range-value">{settings.model.acwr.targetAcwr.toFixed(2)}</span>
              </label>
              <label>
                Sleep max hours
                <NumberInput
                  value={settings.model.recovery.personalMaxSleepHours}
                  min={1}
                  max={14}
                  step={0.25}
                  onCommit={(value) =>
                    patchSettings((next) => {
                      next.model.recovery.personalMaxSleepHours = value;
                    })
                  }
                />
              </label>
            </div>
            <button type="button" className="danger" onClick={() => setSettings(DEFAULT_SETTINGS)}>
              Reset all settings to default
            </button>

          </article>

          <article className="panel">
            <h2>Grade intensity</h2>
            <p>Shows relative difficulty: 1 V6 = X × V5 (depends on multiplier: {settings.model.gradeIntensity.multiplierPerGrade.toFixed(2)}).</p>
            <table className="grade-conversion-table">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th>Intensity</th>
                  <th>Relative to V0</th>
                  <th>= How many V5s</th>
                </tr>
              </thead>
              <tbody>
                {GRADES.map((g) => {
                  const intensity = calculateGradeIntensity(g, settings);
                  const v5Intensity = calculateGradeIntensity("V5" as Grade, settings);
                  const relativeToV0 = intensity / settings.model.gradeIntensity.basePoints;
                  const equivalentV5s = intensity / v5Intensity;
                  return (
                    <tr key={g}>
                      <td>{gradeToDisplay(g, settings.gradeDisplayUnit)}</td>
                      <td>{intensity.toFixed(1)}</td>
                      <td>{relativeToV0.toFixed(2)}x</td>
                      <td>{equivalentV5s.toFixed(2)}x</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          </article>

          <article className="panel">
            <h2>Data &amp; sync</h2>
            <h3>Export / import</h3>
            <p>Download complete backup as JSON, or re-import to restore all data (same format as Google Drive).</p>
            <div className="metric-row">
              <button type="button" onClick={exportBackupAsJSON}>Export backup (JSON)</button>
              <label className="file-import-label">
                Import backup (JSON)
                <input type="file" accept=".json" className="hidden-file-input" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importBackupFromJSON(file);
                  e.target.value = "";
                }} />
              </label>
            </div>
            <details>
              <summary>Bouldering CSV (legacy)</summary>
              <div className="metric-row">
                <button type="button" onClick={exportBouldersToCSV}>Export bouldering CSV</button>
              </div>
              <div className="import-row">
                <label className="file-import-label">
                  Import bouldering CSV
                  <input type="file" accept=".csv" className="hidden-file-input" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importBouldersFromCSV(file);
                    e.target.value = "";
                  }} />
                </label>
              </div>
            </details>

            <h3>Google Drive Sync</h3>
            <p>{driveStatus}</p>
            <p>
              Current origin: <strong>{window.location.origin}</strong>
            </p>
            <div className="metric-row">
              <button type="button" onClick={() => connectGoogleDrive()}>
                Connect Google Drive
              </button>
              <button type="button" onClick={disconnectGoogleDrive}>
                Disconnect
              </button>
              <button type="button" onClick={() => void handleDriveUpload()}>
                Upload Backup
              </button>
              <button type="button" onClick={() => void handleDriveRestore()}>
                Restore Backup
              </button>
            </div>
            {driveLog.length > 0 && (
              <div className="drive-log">
                <div className="drive-log-header">
                  <span>Auth log</span>
                  <button type="button" className="drive-log-clear" onClick={() => setDriveLog([])}>Clear</button>
                </div>
                {driveLog.map((entry, i) => <p key={i} className="drive-log-entry">{entry}</p>)}
              </div>
            )}

          </article>

          <article className="panel full-width">
            <h2>How the maths works</h2>
            <h3>A worked example</h3>
            <p>
              Dummy session: {acwrExample.dummyProblems} problems, {acwrExample.dummyDuration} min, {" "}
              {acwrExample.dummySleep.toFixed(1)}h sleep.
            </p>
            <p>
              Base load = problems x gradeIntensity x speedMultiplier x recoveryMultiplier
            </p>
            <p>
              Base load = {acwrExample.dummyProblems} x {acwrExample.baselineGrade.toFixed(3)} x {" "}
              {acwrExample.baselineSpeed.toFixed(3)} x {acwrExample.baselineRecovery.toFixed(3)} = {" "}
              {acwrExample.baselineLoad.toFixed(2)}
            </p>
            <p>
              Acute EWMA ({acwrExample.acuteWindow}) = alphaA x load + (1 - alphaA) x prevAcute
            </p>
            <p>
              Chronic EWMA ({acwrExample.chronicWindow}) = alphaC x load + (1 - alphaC) x prevChronic
            </p>
            <p>
              ACWR = Acute EWMA / Chronic EWMA = {acwrExample.nextAcuteEwma.toFixed(2)} / {" "}
              {acwrExample.nextChronicEwma.toFixed(2)} = {acwrExample.nextAcwr.toFixed(2)}
            </p>

            <h3>How much each day counts</h3>
            <p>Shows how much each day's load contributes to the EWMA calculation. Shorter windows (10d) weight recent days more heavily.</p>
            <EwmaWeightsChart />

            <h3>Model curves</h3>
            <div className="curve-grid">
              <CurveChart
                title="Grade intensity"
                xLabel="Grade"
                points={gradeCurvePoints}
                color="var(--series-1)"
                xFormatter={(value) => gradeToDisplay(gradeFromNumber(value), settings.gradeDisplayUnit)}
                yFormatter={formatCompact}
                yLog
              />
              <CurveChart
                title="Speed multiplier"
                xLabel="Problems per hour"
                points={speedCurvePoints}
                color="var(--series-2)"
                xFormatter={(value) => value.toFixed(0)}
                yFormatter={(value) => `${value.toFixed(2)}x`}
              />
              <CurveChart
                title="Sleep penalty"
                xLabel="Sleep deficit %"
                points={sleepPenaltyCurvePoints}
                color="var(--series-3)"
                xFormatter={(value) => `${value.toFixed(0)}%`}
                yFormatter={(value) => `${value.toFixed(1)}%`}
              />
              <CurveChart
                title="Stress penalty"
                xLabel="Stress level (0-10)"
                points={stressPenaltyCurvePoints}
                color="var(--series-4)"
                xFormatter={(value) => (value / 10).toFixed(1)}
                yFormatter={(value) => `${value.toFixed(1)}%`}
              />
            </div>

            <div className="example-grid">
              <article className="math-card">
                <h4>Grade harder (V6 to V9)</h4>
                <p>Load changes to {formatCompact(acwrExample.hardGradeLoad)}</p>
                <p>
                  ACWR: {acwrExample.hardGradeAcwr.toFixed(2)}
                </p>
              </article>
              <article className="math-card">
                <h4>Climb faster (120 to 75 min)</h4>
                <p>Load changes to {formatCompact(acwrExample.fasterPaceLoad)}</p>
                <p>
                  ACWR: {acwrExample.fasterPaceAcwr.toFixed(2)}
                </p>
              </article>
              <article className="math-card">
                <h4>Sleep less (7.5h to 6.0h)</h4>
                <p>Load changes to {formatCompact(acwrExample.poorSleepLoad)}</p>
                <p>
                  ACWR: {acwrExample.poorSleepAcwr.toFixed(2)}
                </p>
              </article>
            </div>
          </article>
        </section>
      )}

      {tab === "history" && (
        <section className="panel-grid">
          <article className="panel full-width">
            <h2>Bouldering sessions</h2>
            {sessions.length === 0 && <p>No sessions saved yet.</p>}
            {sessions.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Problems</th>
                    <th>Grades</th>
                    <th>Duration</th>
                    <th>Sleep</th>
                    <th>Stress</th>
                    <th>Motivation</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const count = session.problems.reduce((sum, problem) => sum + problem.count, 0);
                    const climbingDates = Array.from(
                      new Set(session.problems.map((problem) => problem.climbedOn).filter(Boolean)),
                    ) as string[];
                    const climbingDateLabel =
                      climbingDates.length === 0
                        ? "-"
                        : climbingDates.length === 1
                          ? climbingDates[0]
                          : `${climbingDates[0]} to ${climbingDates[climbingDates.length - 1]}`;
                    
                    const gradesLabel = session.problems.length === 0 
                      ? "-"
                      : Array.from(new Set(session.problems.map((p) => gradeToDisplay(p.grade, settings.gradeDisplayUnit)))).sort().join(", ");

                    return (
                      <tr key={session.id}>
                        <td className="nowrap">{climbingDateLabel === "-" ? formatLongDate(getSessionDayKey(session)) : climbingDateLabel}</td>
                        <td>{count}</td>
                        <td>{gradesLabel}</td>
                        <td>{session.durationMinutes} min</td>
                        <td>{session.sleepHours.toFixed(1)} h</td>
                        <td>{session.stress}</td>
                        <td>{session.motivation}</td>
                        <td>
                          {session.source === "toplogger" ? (
                            <>
                              <span className="source-badge" title={session.locallyEdited ? "Edited after sync" : "Synced from TopLogger"}>
                                TopLogger{session.locallyEdited ? " ✎" : ""}
                              </span>
                              {session.toplogger && (
                                <span className="source-stats">
                                  {session.toplogger.climbsTried} tried · {session.toplogger.climbsSent} sent ·{" "}
                                  {session.toplogger.totalTries ?? session.toplogger.loggedTries} tries
                                  {session.toplogger.gymName ? ` · ${session.toplogger.gymName}` : ""}
                                </span>
                              )}
                            </>
                          ) : (
                            "Manual"
                          )}
                        </td>
                        <td>
                          <button type="button" onClick={() => beginEditSession(session)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </article>

          <article className="panel full-width">
            <h2>Strength days</h2>
            <StrengthHistoryTable settings={settings} strengthSets={strengthSets} />
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
