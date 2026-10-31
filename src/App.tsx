import { Fragment, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  clearSessions,
  deleteSession,
  loadSessions,
  loadSettings,
  loadStrengthSets,
  replaceStrengthSets,
  saveSession,
  saveSettings,
} from "./db/indexedDb";
import { addDays, calculateTrendMetrics, isCalibrating, predictAcwr, todayIsoDate } from "./domain/acwr";
import { DEFAULT_SETTINGS, clampSettings } from "./domain/loadModelConfig";
import {
  assessReadiness,
  calculateSessionLoad,
  gradeFromNumber,
  gradeToDisplay,
  gradeToNumber,
  referenceGradeOn,
  buildSessionHistory,
  getAcwrZoneKey,
  getSessionDayKey,
  findBoulderingGaps,
  type Readiness,
} from "./domain/loadCalculator";
import { buildWeeklyWellness } from "./domain/wellness";
import { WellnessCharts } from "./components/WellnessCharts";
import { BoulderingModelCard } from "./components/BoulderingModelCard";
import { GradeBreakdownTable } from "./components/GradeBreakdownTable";
import { RecommendationCard } from "./components/RecommendationCard";
import { GapsCard } from "./components/GapsCard";
import { BoardseshPanel } from "./components/BoardseshPanel";
import { boardseshDayToSession, fetchBoardseshDays, type BoardseshUser } from "./integrations/boardsesh";
import type { GapDecision } from "./domain/gaps";
import { SessionForm, type SessionDraft } from "./components/SessionForm";
import { buildRecommendation } from "./domain/recommendations";
import { AcwrHistoryChart } from "./components/AcwrHistoryChart";
import { BrandMark, RangePills, TabIcon, ThemeToggle } from "./components/Chrome";
import { formatCompact, formatLongDate } from "./components/charts/chartUtils";
import { LoadTotalsChart } from "./components/ModelCharts";
import { GuideTab } from "./components/GuideTab";
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
  type AppSettings,
  type DriveBackupPayload,
  type Grade,
  type GradeDisplayUnit,
  type ProblemEntry,
  type SessionInput,
  type StrengthSet,
} from "./types";

type TabName = "session" | "bouldering" | "strength" | "settings" | "history" | "guide";

function createSessionDraft(settings: AppSettings): SessionDraft {
  return {
    sessionDate: todayIsoDate(),
    durationMinutes: 120,
    sleepHours: settings.model.recovery.personalMaxSleepHours,
    sleepQuality: 7,
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

const GOOGLE_SESSION_STORAGE_KEY = "blm_google_session";

function ReadinessNote({ readiness, label }: { readiness: Readiness; label: string }) {
  return (
    <p className={`readiness-note ${readiness.level}`}>
      <span className="readiness-label">{label}</span>
      {readiness.reasons.length === 0 ? "Well rested and low stress." : `${readiness.reasons.join(", ")}. Consider the lower end of your plan.`}
    </p>
  );
}

function App() {
  const [tab, setTab] = useState<TabName>(() => {
    const saved = localStorage.getItem("blm_tab");
    // "dashboard" was renamed to "bouldering".
    return saved === "dashboard" || saved === null ? "bouldering" : (saved as TabName);
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<SessionInput[]>([]);
  const [strengthSets, setStrengthSets] = useState<StrengthSet[]>([]);
  const [fitnotesSyncing, setFitnotesSyncing] = useState(false);
  const [toploggerAuth, setToploggerAuth] = useState<TopLoggerAuth | undefined>(() => readTopLoggerAuth());
  const [toploggerStatus, setToploggerStatus] = useState<string | undefined>();
  const [toploggerSyncing, setToploggerSyncing] = useState(false);
  const [boardseshStatus, setBoardseshStatus] = useState<string | undefined>();
  const [boardseshSyncing, setBoardseshSyncing] = useState(false);
  const [draft, setDraft] = useState<SessionDraft>(createSessionDraft(DEFAULT_SETTINGS));
  const [editingSessionId, setEditingSessionId] = useState<string | undefined>();
  const [editDraft, setEditDraft] = useState<SessionDraft | undefined>();
  const [loading, setLoading] = useState(true);
  const [driveSession, setDriveSession] = useState<GoogleAuthSession | undefined>();
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | undefined>();
  const [driveStatus, setDriveStatus] = useState<string>("Google Drive not connected.");
  const [driveConnectError, setDriveConnectError] = useState<string | undefined>(undefined);
  const [notification, setNotification] = useState<string | undefined>(undefined);
  // Dashboard history graph
  const [historyRange, setHistoryRange] = useState<number | null>(28);
  // Next-session planner
  const [plannerGrade, setPlannerGrade] = useState<Grade>("V5");
  const [plannerCount, setPlannerCount] = useState<number>(20);
  const [plannerDuration, setPlannerDuration] = useState<number>(120);
  const [plannerDate, setPlannerDate] = useState<string>(todayIsoDate());
  const [plannerSleep, setPlannerSleep] = useState<number>(8);
  const [plannerSleepQuality, setPlannerSleepQuality] = useState<number>(7);
  const [plannerStress, setPlannerStress] = useState<number>(5);

  function setTabAndPersist(t: TabName): void {
    localStorage.setItem("blm_tab", t);
    setTab(t);
  }

  function addDriveLog(msg: string): void {
    console.debug("[Drive]", msg);
  }

  function showNotification(msg: string, ms = 4000): void {
    setNotification(msg);
    window.setTimeout(() => setNotification(undefined), ms);
  }

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


  // The max grade loads are measured against today; earlier days use the max at that time.
  const currentReferenceGrade = useMemo(
    () => referenceGradeOn(todayIsoDate(), sessions, settings),
    [sessions, settings],
  );

  function estimateDraftLoad(draftValue: SessionDraft, excludeId?: string) {
    if (draftValue.problems.length === 0) return undefined;

    const draftSession: SessionInput = {
      id: excludeId ?? "draft",
      createdAt: `${draftValue.sessionDate}T12:00:00Z`,
      durationMinutes: draftValue.durationMinutes,
      sleepHours: draftValue.sleepHours,
      sleepQuality: draftValue.sleepQuality,
      stress: draftValue.stress,
      motivation: draftValue.motivation,
      problems: draftValue.problems,
    };
    const otherSessions = sessions.filter((item) => item.id !== excludeId);
    const reference = referenceGradeOn(draftValue.sessionDate, [...otherSessions, draftSession], settings);
    return calculateSessionLoad(draftSession, reference, settings);
  }



  // One ACWR over all bouldering, running through today so it decays on rest days.
  const fullSessionHistory = useMemo(() => buildSessionHistory(sessions, settings, null), [sessions, settings]);
  const sessionHistory = useMemo(
    () => (historyRange === null ? fullSessionHistory : fullSessionHistory.slice(-historyRange)),
    [fullSessionHistory, historyRange],
  );
  const overallAcwr = sessions.length === 0 || fullSessionHistory.length === 0 ? null : fullSessionHistory[fullSessionHistory.length - 1].acwr;
  const acwrCalibrating = isCalibrating(fullSessionHistory, settings.model.acwr.chronicWindow);
  const trends = useMemo(() => calculateTrendMetrics(fullSessionHistory), [fullSessionHistory]);
  const logGaps = useMemo(() => findBoulderingGaps(sessions, settings), [sessions, settings]);

  function decideGap(gapId: string, decision: GapDecision | undefined): void {
    patchSettings((next) => {
      if (decision) next.logGaps[gapId] = decision;
      else delete next.logGaps[gapId];
    });
  }

  const recommendation = useMemo(
    () => (sessions.length === 0 ? null : buildRecommendation(fullSessionHistory, currentReferenceGrade, settings)),
    [sessions.length, fullSessionHistory, currentReferenceGrade, settings],
  );
  const weeklyWellness = useMemo(() => buildWeeklyWellness(sessions, settings.stressScaleMax, 12), [sessions, settings.stressScaleMax]);

  const strengthNow = useMemo(() => {
    const history = buildStrengthHistory(calculateSetLoads(strengthSets, settings.strength), settings.strength);
    return history.length > 0 ? history[history.length - 1] : null;
  }, [strengthSets, settings.strength]);

  // Planner: predicted ACWR if the planned session happens on the planned date (days until then are rest).
  const plannerPrediction = useMemo(() => {
    if (fullSessionHistory.length === 0) return null;

    const plannedSession: SessionInput = {
      id: "planner",
      createdAt: `${plannerDate}T12:00:00Z`,
      durationMinutes: plannerDuration,
      sleepHours: plannerSleep,
      stress: plannerStress,
      motivation: 5,
      problems: [
        { id: "planner-problem", count: plannerCount, grade: plannerGrade, holdType: "mixed", wallAngle: "mixed" },
      ],
    };

    const load = calculateSessionLoad(plannedSession, currentReferenceGrade, settings);
    const prediction = predictAcwr(
      fullSessionHistory,
      plannerDate,
      load.totalLoad,
      settings.model.acwr.acuteWindow,
      settings.model.acwr.chronicWindow,
    );
    if (!prediction) return null;
    return { predAcwr: prediction.acwr, actualLoad: load.totalLoad, speedMultiplier: load.speedMultiplier };
  }, [fullSessionHistory, settings, plannerSleep, plannerStress, plannerGrade, plannerCount, plannerDuration, plannerDate, currentReferenceGrade]);

  const plannerReadiness = useMemo(
    () => assessReadiness(plannerSleep, plannerSleepQuality, plannerStress, settings),
    [plannerSleep, plannerSleepQuality, plannerStress, settings],
  );

  const displayGradeLabel = (grade: Grade): string => gradeToDisplay(grade, settings.gradeDisplayUnit);
  const readinessLabel: Record<Readiness["level"], string> = { good: "Ready", fair: "Okay", low: "Take it easy" };

  useEffect(() => {
    async function bootstrap() {
      const [savedSettings, savedSessions, savedStrengthSets] = await Promise.all([
        loadSettings(),
        loadSessions(),
        loadStrengthSets(),
      ]);

      const nextSettings = clampSettings(savedSettings ?? DEFAULT_SETTINGS);
      setSettings(nextSettings);
      setDraft(createSessionDraft(nextSettings));
      setSessions(savedSessions);

      setStrengthSets(savedStrengthSets);

      // Check if Google redirected back with a code (or error) in the URL query.
      let redirectSession: GoogleAuthSession | null = null;
      let activeDriveToken: string | undefined;
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (clientId) {
          redirectSession = await extractOAuthTokenFromUrl();
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
      if (nextSettings.boardsesh.userId && nextSettings.boardsesh.autoSync) {
        void syncBoardsesh(nextSettings.boardsesh.userId, nextSettings);
      }
      if (activeDriveToken && nextSettings.fitnotes.autoSyncFromDrive) {
        void syncFitNotesFromDrive(activeDriveToken, nextSettings, true);
      }
    }

    void bootstrap();
    // Load data and start background syncs once on mount; later state changes must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    void saveSettings(settings);
  }, [settings, loading]);

  function patchSettings(update: (draftValue: AppSettings) => void): void {
    setSettings((previous) => {
      const next = structuredClone(previous);
      update(next);
      return clampSettings(next);
    });
  }

  function draftFromSession(session: SessionInput): SessionDraft {
    return {
      sessionDate: getSessionDayKey(session),
      durationMinutes: session.durationMinutes,
      sleepHours: session.sleepHours,
      sleepQuality: session.sleepQuality ?? 7,
      stress: session.stress,
      motivation: session.motivation,
      problems: session.problems.map((problem) => ({ ...problem })),
    };
  }

  function beginEditSession(session: SessionInput): void {
    setEditingSessionId(session.id);
    setEditDraft(draftFromSession(session));
  }

  function cancelEditSession(): void {
    setEditingSessionId(undefined);
    setEditDraft(undefined);
  }

  async function removeSession(session: SessionInput): Promise<void> {
    const label = formatLongDate(getSessionDayKey(session));
    if (!window.confirm(`Delete the session of ${label}? This can't be undone.`)) return;

    await deleteSession(session.id);
    if (session.source === "boardsesh") {
      const day = getSessionDayKey(session);
      setSettings((previous) =>
        clampSettings({
          ...previous,
          boardsesh: { ...previous.boardsesh, ignoredDays: [...new Set([...(previous.boardsesh.ignoredDays ?? []), day])] },
        }),
      );
    }
    if (session.source === "toplogger" && session.externalId) {
      const dayId = session.externalId;
      setSettings((previous) =>
        clampSettings({
          ...previous,
          toplogger: { ...previous.toplogger, ignoredDayIds: [...new Set([...(previous.toplogger.ignoredDayIds ?? []), dayId])] },
        }),
      );
    }
    setSessions((previous) => previous.filter((item) => item.id !== session.id));
    cancelEditSession();
    showNotification(`Deleted the session of ${label}.`);
  }

  function getBackupPayload(): DriveBackupPayload {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      sessions,
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

  async function importBackupFromJSON(file: File): Promise<void> {
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as DriveBackupPayload;
      
      await clearSessions();

      const restoredSettings = clampSettings(payload.settings ?? DEFAULT_SETTINGS);
      await saveSettings(restoredSettings);
      for (const s of payload.sessions) { await saveSession(s); }
      if (payload.strengthSets) { await replaceStrengthSets(payload.strengthSets); }

      const [sessionsFromDb, strengthSetsFromDb] = await Promise.all([loadSessions(), loadStrengthSets()]);

      setSettings(restoredSettings);
      setSessions(sessionsFromDb);
      setStrengthSets(strengthSetsFromDb);
      setDraft(createSessionDraft(restoredSettings));
      addDriveLog("Backup imported successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addDriveLog(`Error importing backup: ${msg}`);
    }
  }

  async function applyDriveBackup(token: string): Promise<void> {
    try {
      const payload = await downloadBackupFromGoogleDrive(token);
      await clearSessions();

      const restoredSettings = clampSettings(payload.settings ?? DEFAULT_SETTINGS);
      await saveSettings(restoredSettings);
      for (const s of payload.sessions) { await saveSession(s); }
      if (payload.strengthSets) { await replaceStrengthSets(payload.strengthSets); }

      const [sessionsFromDb, strengthSetsFromDb] = await Promise.all([loadSessions(), loadStrengthSets()]);

      setSettings(restoredSettings);
      setSessions(sessionsFromDb);
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

  /**
   * Merge synced sessions into storage: new days are added, changed days updated, and days you edited by hand are
   * left alone. Duration, sleep, stress and motivation you filled in survive re-syncs.
   */
  async function mergeSyncedSessions(synced: SessionInput[]): Promise<{ added: number; updated: number }> {
    const sessionsById = new Map((await loadSessions()).map((item) => [item.id, item]));
    let added = 0;
    let updated = 0;

    for (const session of synced) {
      const existing = sessionsById.get(session.id);
      if (existing?.locallyEdited) continue;

      if (existing) {
        if (
          problemsSignature(existing.problems) === problemsSignature(session.problems) &&
          JSON.stringify(existing.toplogger) === JSON.stringify(session.toplogger) &&
          JSON.stringify(existing.boardsesh) === JSON.stringify(session.boardsesh)
        ) {
          continue;
        }
        const merged: SessionInput = {
          ...session,
          durationMinutes: existing.durationMinutes,
          sleepHours: existing.sleepHours,
          stress: existing.stress,
          motivation: existing.motivation,
        };
        await saveSession(merged);
        sessionsById.set(merged.id, merged);
        updated++;
      } else {
        await saveSession(session);
        sessionsById.set(session.id, session);
        added++;
      }
    }

    if (added + updated > 0) {
      const allSessions = Array.from(sessionsById.values());
      setSessions(allSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }
    return { added, updated };
  }

  async function syncBoardsesh(userId: string, settingsForSync: AppSettings): Promise<void> {
    setBoardseshSyncing(true);
    setBoardseshStatus("Syncing Boardsesh…");

    try {
      const { importFromDate, lastSyncedAt, ignoredDays } = settingsForSync.boardsesh;
      // Re-check a few days before the last sync to catch climbs logged late.
      const lastSyncedDay = lastSyncedAt ? addDays(lastSyncedAt.slice(0, 10), -3) : undefined;
      const since = lastSyncedDay && lastSyncedDay > importFromDate ? lastSyncedDay : importFromDate;

      const days = await fetchBoardseshDays(userId, since);
      const synced = days
        .filter((day) => !ignoredDays?.includes(day.date))
        .map((day) => boardseshDayToSession(day, userId, settingsForSync))
        .filter((session): session is SessionInput => session !== undefined);
      const { added, updated } = await mergeSyncedSessions(synced);

      setSettings((previous) =>
        clampSettings({ ...previous, boardsesh: { ...previous.boardsesh, lastSyncedAt: new Date().toISOString() } }),
      );
      setBoardseshStatus(
        days.length === 0 && !lastSyncedAt
          ? "No public board climbs found since " + since + ". If your Boardsesh profile is private, make it public to sync."
          : `Boardsesh: checked ${days.length} board days since ${since}: ${added} new, ${updated} updated.`,
      );
      if (added + updated > 0) {
        showNotification(`Boardsesh sync: ${added} new, ${updated} updated sessions.`);
      }
    } catch (error) {
      setBoardseshStatus(`Boardsesh sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBoardseshSyncing(false);
    }
  }

  function handleBoardseshConnect(user: BoardseshUser): void {
    const nextSettings = clampSettings({
      ...settings,
      boardsesh: { ...settings.boardsesh, userId: user.id, displayName: user.displayName, lastSyncedAt: undefined },
    });
    setSettings(nextSettings);
    void syncBoardsesh(user.id, nextSettings);
  }

  function handleBoardseshDisconnect(): void {
    patchSettings((next) => {
      next.boardsesh.userId = undefined;
      next.boardsesh.displayName = undefined;
      next.boardsesh.lastSyncedAt = undefined;
    });
    setBoardseshStatus("Boardsesh disconnected. Synced sessions stay in your history.");
  }

  async function syncTopLogger(auth: TopLoggerAuth, settingsForSync: AppSettings): Promise<void> {
    setToploggerSyncing(true);
    setToploggerStatus("Syncing TopLogger…");

    try {
      const { importFromDate, lastSyncedAt } = settingsForSync.toplogger;
      // Re-check a few days before the last sync to catch climbs logged late.
      const lastSyncedDay = lastSyncedAt ? addDays(lastSyncedAt.slice(0, 10), -3) : undefined;
      // Sessions synced before tries were recorded get backfilled with one full re-sync.
      const needsBackfill = (await loadSessions()).some((item) => item.source === "toplogger" && !item.toplogger);
      const since = !needsBackfill && lastSyncedDay && lastSyncedDay > importFromDate ? lastSyncedDay : importFromDate;

      const { auth: nextAuth, days } = await fetchTopLoggerBoulderDays(auth, since);
      setToploggerAuth(nextAuth);

      const synced = days
        .filter((day) => !settingsForSync.toplogger.ignoredDayIds?.includes(day.id))
        .map((day) => topLoggerDayToSession(day, settingsForSync))
        .filter((session): session is SessionInput => session !== undefined);
      const { added, updated } = await mergeSyncedSessions(synced);

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

  async function saveDraft(draftValue: SessionDraft, existing?: SessionInput): Promise<void> {
    if (draftValue.problems.length === 0) {
      return;
    }

    const session: SessionInput = {
      id: existing?.id ?? getId(),
      createdAt: `${draftValue.sessionDate}T12:00:00Z`,
      durationMinutes: draftValue.durationMinutes,
      sleepHours: draftValue.sleepHours,
      sleepQuality: draftValue.sleepQuality,
      stress: draftValue.stress,
      motivation: draftValue.motivation,
      problems: draftValue.problems.map((problem) => ({ ...problem, climbedOn: draftValue.sessionDate })),
      source: existing?.source ?? "manual",
      externalId: existing?.externalId,
      toplogger: existing?.toplogger,
      boardsesh: existing?.boardsesh,
      locallyEdited: existing?.source === "toplogger" || existing?.source === "boardsesh" ? true : undefined,
    };

    // The fallback max grade (used before there is history) follows the hardest grade you log.
    const highestLoggedGrade = session.problems.reduce(
      (max, item) => Math.max(max, gradeToNumber(item.grade)),
      gradeToNumber(settings.climberMaxGrade),
    );
    if (highestLoggedGrade > gradeToNumber(settings.climberMaxGrade)) {
      const nextSettings = clampSettings({ ...settings, climberMaxGrade: `V${highestLoggedGrade}` as Grade });
      setSettings(nextSettings);
      await saveSettings(nextSettings);
    }

    await saveSession(session);
    setSessions((previous) =>
      [session, ...previous.filter((item) => item.id !== session.id)].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    );

    if (existing) {
      cancelEditSession();
      showNotification(`Updated the session of ${formatLongDate(draftValue.sessionDate)}.`);
    } else {
      setDraft(createSessionDraft(settings));
      showNotification("Session saved. Here's where it puts you.");
      setTabAndPersist("bouldering");
    }
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
              {recommendation === null
                ? "Log or sync a session to get started."
                : recommendation.restDays > 0
                  ? `Next: rest ${recommendation.restDays} day${recommendation.restDays === 1 ? "" : "s"}, then a light session.`
                  : recommendation.options.find((option) => option.key === "high")?.available
                    ? "Room for any kind of session today."
                    : "Room for a volume or medium session today."}{" "}
              <button type="button" className="link-button hero-link" onClick={() => setTabAndPersist("bouldering")}>
                See what to climb
              </button>
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
              <strong className="stat-value">{formatCompact(trends.thisWeekLoad)}</strong>
              <span className="stat-meta">
                load · {trends.activeDays} climbing day{trends.activeDays === 1 ? "" : "s"}
                {trends.weekOverWeek !== null && ` · ${trends.weekOverWeek >= 0 ? "+" : "−"}${Math.abs(trends.weekOverWeek * 100).toFixed(0)}%`}
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
          ["bouldering", "Bouldering"],
          ["strength", "Strength"],
          ["session", "Sessions"],
          ["history", "History"],
          ["guide", "Guide"],
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
          <article className="panel full-width">
            <div className="panel-heading">
              <h2>Log a session</h2>
              <p className="muted-hint">
                Climbing at a TopLogger gym? Those sessions sync by themselves on the{" "}
                <button type="button" className="link-button" onClick={() => setTabAndPersist("bouldering")}>
                  Bouldering tab
                </button>
                . Use this for anything else.
              </p>
            </div>
            <SessionForm
              draft={draft}
              onChange={setDraft}
              settings={settings}
              displayGrade={displayGradeLabel}
              estimatedLoad={estimateDraftLoad(draft)}
              readiness={assessReadiness(draft.sleepHours, draft.sleepQuality, draft.stress, settings, draft.motivation)}
              readinessLabel={readinessLabel[assessReadiness(draft.sleepHours, draft.sleepQuality, draft.stress, settings, draft.motivation).level]}
              onSave={() => void saveDraft(draft)}
              onCancel={draft.problems.length > 0 ? () => setDraft(createSessionDraft(settings)) : undefined}
              saveLabel="Save session"
              defaultGrade={gradeFromNumber(gradeToNumber(currentReferenceGrade) - 2)}
            />
          </article>
        </section>
      )}

      {tab === "bouldering" && (
        <section className="panel-grid">
          <article className="panel full-width">
            <h2>Bouldering ACWR</h2>
            <div className="acwr-overview">
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
                {acwrCalibrating && (
                  <p className="bootstrap-warning">
                    Still calibrating: {fullSessionHistory.length} of {settings.model.acwr.chronicWindow} days of history. Treat the
                    ratio as rough until then.
                  </p>
                )}
              </div>
            )}
            <div>
            <h3 className="facts-heading">This week on the wall</h3>
            <dl className="fact-list fact-list-3">
              <div>
                <dt>Load, last 7 days</dt>
                <dd>{trends.thisWeekLoad.toFixed(0)}</dd>
                {trends.weekOverWeek !== null && (
                  <span className={`fact-note ${Math.abs(trends.weekOverWeek) > 0.15 ? "warn" : ""}`}>
                    {trends.weekOverWeek >= 0 ? "▴" : "▾"} {Math.abs(trends.weekOverWeek * 100).toFixed(0)}% vs previous week
                  </span>
                )}
              </div>
              <div>
                <dt>Climbing days</dt>
                <dd>{trends.activeDays}</dd>
                <span className="fact-note">in the last 7 days</span>
              </div>
              <div>
                <dt>Monotony</dt>
                <dd>{trends.monotony === null ? "–" : trends.monotony.toFixed(2)}</dd>
                <span className={`fact-note ${trends.monotony !== null && trends.monotony > 2 ? "warn" : ""}`}>
                  {trends.monotony === null ? "needs varied days" : trends.monotony > 2 ? "very samey: vary hard and easy days" : "good mix of hard and easy"}
                </span>
              </div>
              <div>
                <dt>Strain</dt>
                <dd>{trends.strain === null ? "–" : trends.strain.toFixed(0)}</dd>
                <span className="fact-note">weekly load × monotony</span>
              </div>
              <div>
                <dt>Current max grade</dt>
                <dd>{displayGradeLabel(currentReferenceGrade)}</dd>
                <span className="fact-note">loads are measured against this</span>
              </div>
              <div>
                <dt>Last session</dt>
                <dd>{sessions[0] ? formatLongDate(getSessionDayKey(sessions[0])) : "–"}</dd>
              </div>
            </dl>
            </div>
            </div>
          </article>

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

          <BoardseshPanel
            settings={settings}
            patchSettings={patchSettings}
            status={boardseshStatus}
            syncing={boardseshSyncing}
            onConnect={handleBoardseshConnect}
            onDisconnect={handleBoardseshDisconnect}
            onSync={() => {
              if (settings.boardsesh.userId) void syncBoardsesh(settings.boardsesh.userId, settings);
            }}
          />

          <BoulderingModelCard settings={settings} patchSettings={patchSettings} referenceGrade={currentReferenceGrade} />

          <GapsCard gaps={logGaps} onDecide={decideGap} />

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>What to climb next</h2>
              <p className="muted-hint">
                Three ways to spend the load that keeps you in the green zone, as grades and attempts.
              </p>
            </div>
            <RecommendationCard
              recommendation={recommendation}
              settings={settings}
              displayGrade={displayGradeLabel}
              referenceGrade={currentReferenceGrade}
            />
          </article>

          <article className="panel full-width">
            <div className="panel-header-row">
              <div className="panel-heading">
                <h2>Bouldering ACWR over time</h2>
                <p className="muted-hint">Acute ÷ chronic EWMA of your daily bouldering load. Hover or use the arrow keys for details.</p>
              </div>
              <RangePills
                label="Bouldering chart range"
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
            {sessionHistory.length < 2 ? (
              <p className="empty-note">Log at least 2 sessions to see the history graph.</p>
            ) : (
              <AcwrHistoryChart
                points={sessionHistory}
                lowThreshold={settings.model.acwr.lowThreshold}
                highThreshold={settings.model.acwr.highThreshold}
                targetAcwr={settings.model.acwr.targetAcwr}
                loadLabel="Daily bouldering load"
              />
            )}
          </article>

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>Rolling load totals</h2>
              <p className="muted-hint">Total load over the previous 7, 14 and 28 days, for each day in the range above.</p>
            </div>
            <LoadTotalsChart history={fullSessionHistory} rangeDays={historyRange} />
          </article>

          {/* Next-session planner */}
          <article className="panel full-width">
            <h2>Try your own session</h2>
            <p className="muted-hint">
              Enter any session to see what ACWR it would bring you to. Days until the planned date count as rest. Target:{" "}
              <strong>{settings.model.acwr.targetAcwr.toFixed(2)}</strong>.
            </p>
            {plannerPrediction === null ? (
              <p>Log at least one session to enable the planner.</p>
            ) : (
              <>
                <div className="planner-inputs-row">
                  <label className="planner-input-label">
                    Session date
                    <input type="date" min={todayIsoDate()} value={plannerDate} onChange={(e) => setPlannerDate(e.target.value)} />
                  </label>
                  <label className="planner-input-label">
                    Sleep (h)
                    <NumberInput value={plannerSleep} min={0} max={14} step={0.5} onCommit={setPlannerSleep} />
                  </label>
                  <label className="planner-input-label">
                    Sleep quality (1–10)
                    <NumberInput value={plannerSleepQuality} min={1} max={10} step={1} onCommit={setPlannerSleepQuality} />
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
                    <span className={`planner-acwr-value ${getAcwrZoneKey(plannerPrediction.predAcwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold)}`}>
                      {plannerPrediction.predAcwr.toFixed(2)}
                    </span>
                  </div>
                  <div className="planner-result">
                    <span className="planner-acwr-label">Estimated load</span>
                    <span className="planner-acwr-value">
                      {plannerPrediction.actualLoad.toFixed(0)}
                    </span>
                  </div>
                </div>
                <ReadinessNote readiness={plannerReadiness} label={readinessLabel[plannerReadiness.level]} />

              </>
            )}
          </article>

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>Sleep &amp; stress, week by week</h2>
              <p className="muted-hint">
                Weekly averages from your sessions. These shape your readiness, not your load: a bad night doesn't make a
                session bigger, it makes you less ready for one.
              </p>
            </div>
            <WellnessCharts weeks={weeklyWellness} personalMaxSleep={settings.model.recovery.personalMaxSleepHours} />
          </article>

          <article className="panel full-width">
            <div className="panel-heading">
              <h2>By grade, last 4 weeks</h2>
              <p className="muted-hint">
                Attempts are problems you climbed. Points are measured against your current max of {displayGradeLabel(currentReferenceGrade)}.
              </p>
            </div>
            <GradeBreakdownTable sessions={sessions} settings={settings} referenceGrade={currentReferenceGrade} />
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
                Starting max grade
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
            </div>
            <p className="muted-hint">
              The starting max grade is only used until you have history; after that your current max comes from what you climb.
            </p>
          </article>

          <article className="panel">
            <h2>Zones &amp; targets</h2>
            <p className="muted-hint">Shared by bouldering and strength. Load model settings live on their own tabs.</p>
            <div className="field-grid">
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
                ACWR target
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
                Your ideal sleep (hours)
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
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (window.confirm("Reset every setting to its default? Your sessions and strength data are kept.")) {
                  // Keep sync bookkeeping so a reset doesn't re-import deleted TopLogger days or re-download FitNotes.
                  setSettings((previous) =>
                    clampSettings({
                      ...DEFAULT_SETTINGS,
                      toplogger: { ...DEFAULT_SETTINGS.toplogger, lastSyncedAt: previous.toplogger.lastSyncedAt, ignoredDayIds: previous.toplogger.ignoredDayIds },
                      fitnotes: { ...DEFAULT_SETTINGS.fitnotes, lastImport: previous.fitnotes.lastImport },
                    }),
                  );
                }
              }}
            >
              Reset settings to default
            </button>
          </article>

          <article className="panel">
            <h2>Google Drive backup</h2>
            {driveSession ? (
              <>
                <p className="muted-hint">{driveStatus}</p>
                <div className="metric-row">
                  <button type="button" className="primary" onClick={() => void handleDriveUpload()}>
                    Back up to Drive
                  </button>
                  <button type="button" onClick={() => void handleDriveRestore()}>
                    Restore from Drive
                  </button>
                </div>
                <p className="muted-hint">The last 5 backups are kept in your Drive. Restoring replaces what is in this browser.</p>
              </>
            ) : (
              <p className="muted-hint">Sign in with Google (top right) to back up to and restore from your own Drive.</p>
            )}
          </article>

          <article className="panel">
            <h2>Backup file</h2>
            <p className="muted-hint">Everything in one JSON file: sessions, strength sets and settings.</p>
            <div className="metric-row">
              <button type="button" onClick={exportBackupAsJSON}>Export backup</button>
              <label className="file-import-label">
                Import backup
                <input type="file" accept=".json" className="hidden-file-input" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importBackupFromJSON(file);
                  e.target.value = "";
                }} />
              </label>
            </div>
          </article>

        </section>
      )}

      {tab === "guide" && <GuideTab settings={settings} referenceGrade={currentReferenceGrade} />}

      {tab === "history" && (
        <section className="panel-grid">
          <article className="panel full-width">
            <div className="panel-heading">
              <h2>Bouldering sessions</h2>
              <p className="muted-hint">Edit opens the session right here. Synced sessions you edit or delete stay that way on the next sync.</p>
            </div>
            {sessions.length === 0 && <p className="empty-note">No sessions saved yet.</p>}
            {sessions.length > 0 && (
              <div className="table-scroll">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Problems</th>
                      <th>Grades</th>
                      <th>Duration</th>
                      <th>Sleep</th>
                      <th>Stress</th>
                      <th>Source</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => {
                      const count = session.problems.reduce((sum, problem) => sum + problem.count, 0);
                      const grades = [...new Set(session.problems.map((problem) => problem.grade))].sort(
                        (a, b) => gradeToNumber(b) - gradeToNumber(a),
                      );
                      const isEditing = editingSessionId === session.id && editDraft !== undefined;

                      return (
                        <Fragment key={session.id}>
                          <tr className={isEditing ? "editing" : undefined}>
                            <td className="nowrap">{formatLongDate(getSessionDayKey(session))}</td>
                            <td className="num">{count}</td>
                            <td>{grades.length === 0 ? "–" : grades.map(displayGradeLabel).join(", ")}</td>
                            <td className="nowrap">{session.durationMinutes} min</td>
                            <td className="nowrap">
                              {session.sleepHours.toFixed(1)} h{session.sleepQuality !== undefined ? ` · ${session.sleepQuality}/10` : ""}
                            </td>
                            <td className="num">{session.stress}</td>
                            <td>
                              {session.source === "boardsesh" ? (
                                <>
                                  <span className="source-badge" title={session.locallyEdited ? "Edited after sync" : "Synced from Boardsesh"}>
                                    Boardsesh{session.locallyEdited ? " ✎" : ""}
                                  </span>
                                  {session.boardsesh && (
                                    <span className="source-stats">
                                      {session.boardsesh.climbsTried} tried · {session.boardsesh.climbsSent} sent · {session.boardsesh.tries} tries ·{" "}
                                      {session.boardsesh.boards.join(", ")}
                                    </span>
                                  )}
                                </>
                              ) : session.source === "toplogger" ? (
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
                              <button
                                type="button"
                                className="small"
                                aria-expanded={isEditing}
                                onClick={() => (isEditing ? cancelEditSession() : beginEditSession(session))}
                              >
                                {isEditing ? "Close" : "Edit"}
                              </button>
                            </td>
                          </tr>
                          {isEditing && editDraft && (
                            <tr className="edit-row">
                              <td colSpan={8}>
                                <SessionForm
                                  draft={editDraft}
                                  onChange={(update) => setEditDraft((previous) => (previous ? update(previous) : previous))}
                                  settings={settings}
                                  displayGrade={displayGradeLabel}
                                  estimatedLoad={estimateDraftLoad(editDraft, session.id)}
                                  readiness={assessReadiness(editDraft.sleepHours, editDraft.sleepQuality, editDraft.stress, settings, editDraft.motivation)}
                                  readinessLabel={
                                    readinessLabel[assessReadiness(editDraft.sleepHours, editDraft.sleepQuality, editDraft.stress, settings, editDraft.motivation).level]
                                  }
                                  onSave={() => void saveDraft(editDraft, session)}
                                  onCancel={cancelEditSession}
                                  onDelete={() => void removeSession(session)}
                                  saveLabel="Save changes"
                                  defaultGrade={grades[0] ?? currentReferenceGrade}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
