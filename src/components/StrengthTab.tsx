import { useMemo, useState } from "react";
import { getAcwrZone } from "../domain/loadCalculator";
import {
  buildStrengthHistory,
  calculateSetLoads,
  isBodyweightByDefault,
  summarizeStrengthGroups,
  type StrengthGroupRow,
} from "../domain/strengthLoad";
import type { AppSettings, StrengthLoadMetric, StrengthSet } from "../types";
import { AcwrHistoryChart } from "./AcwrHistoryChart";
import { NumberInput } from "./NumberInput";

type RangeDays = 28 | 56 | 90 | 180 | 365 | null;

interface StrengthTabProps {
  settings: AppSettings;
  strengthSets: StrengthSet[];
  patchSettings: (update: (draft: AppSettings) => void) => void;
  onImportFile: (file: File) => void;
  onSyncFromDrive: () => void;
  driveConnected: boolean;
  syncing: boolean;
}

const METRIC_LABELS: Record<StrengthLoadMetric, string> = {
  relative: "Relative intensity (reps × % of best e1RM)",
  volume: "Volume (kg × reps)",
  sets: "Hard sets (1 per set)",
};

function zoneClass(acwr: number, settings: AppSettings): string {
  return getAcwrZone(acwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold).toLowerCase().replace(" ", "-");
}

function GroupTable({ rows, settings, label }: { rows: StrengthGroupRow[]; settings: AppSettings; label: string }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{label}</th>
          <th>Last trained</th>
          <th>Sets</th>
          <th>Acute</th>
          <th>Chronic</th>
          <th>ACWR</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td>{row.lastDate}</td>
            <td>{row.setCount}</td>
            <td>{row.acute.toFixed(2)}</td>
            <td>{row.chronic.toFixed(2)}</td>
            <td>{row.acwr.toFixed(2)}</td>
            <td>{getAcwrZone(row.acwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StrengthTab({
  settings,
  strengthSets,
  patchSettings,
  onImportFile,
  onSyncFromDrive,
  driveConnected,
  syncing,
}: StrengthTabProps) {
  const [range, setRange] = useState<RangeDays>(90);
  const config = settings.strength;

  const setLoads = useMemo(() => calculateSetLoads(strengthSets, config), [strengthSets, config]);
  const history = useMemo(() => buildStrengthHistory(setLoads, config), [setLoads, config]);
  const categoryRows = useMemo(() => summarizeStrengthGroups(setLoads, config, "category"), [setLoads, config]);
  const exerciseRows = useMemo(() => summarizeStrengthGroups(setLoads, config, "exercise"), [setLoads, config]);

  const visibleHistory = useMemo(() => {
    if (range === null || history.length === 0) return history;
    // History always runs through today, so the last `range` points are the last `range` days.
    return history.slice(-range);
  }, [history, range]);

  const current = history[history.length - 1];
  const lastImport = settings.fitnotes.lastImport;

  return (
    <section className="panel-grid">
      <article className="panel">
        <h2>Strength ACWR</h2>
        {!current ? (
          <p>Import a FitNotes export to see your strength ACWR.</p>
        ) : (
          <div className="overall-acwr-stat">
            <span className={`acwr-big ${zoneClass(current.acwr, settings)}`}>{current.acwr.toFixed(2)}</span>
            <span className="acwr-zone-label">
              {getAcwrZone(current.acwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold)}
            </span>
            <p className="acwr-range-hint">
              Acute ({config.acuteWindow}d) {current.acute.toFixed(1)} / Chronic ({config.chronicWindow}d) {current.chronic.toFixed(1)}
              {" "}| Goldilocks: {settings.model.acwr.lowThreshold.toFixed(2)} – {settings.model.acwr.highThreshold.toFixed(2)}
            </p>
          </div>
        )}
      </article>

      <article className="panel">
        <h2>FitNotes Import</h2>
        <p className="muted-hint">
          Export your workouts from FitNotes as CSV (a <code>FitNotes_Export_….csv</code> file). Upload it here, or save it
          to Google Drive and sync. Each import replaces all strength data, since the export holds your full history.
        </p>
        <div className="metric-row">
          <label className="file-import-label">
            ⬆ Upload FitNotes CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <button type="button" onClick={onSyncFromDrive} disabled={!driveConnected || syncing}>
            {syncing ? "Syncing…" : "Sync latest export from Google Drive"}
          </button>
        </div>
        {!driveConnected && <p className="muted-hint">Sign in with Google (top right) to sync from Drive.</p>}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.fitnotes.autoSyncFromDrive}
            onChange={(event) =>
              patchSettings((next) => {
                next.fitnotes.autoSyncFromDrive = event.target.checked;
              })
            }
          />
          Auto-sync from Google Drive when the app opens
        </label>
        {lastImport && (
          <p className="muted-hint">
            Last import: <strong>{lastImport.fileName}</strong> — {lastImport.setCount} sets, {new Date(lastImport.importedAt).toLocaleString()}
          </p>
        )}
      </article>

      <article className="panel">
        <h2>Strength Load Model</h2>
        <div className="field-grid">
          <label>
            Load metric
            <select
              value={config.metric}
              onChange={(event) =>
                patchSettings((next) => {
                  next.strength.metric = event.target.value as StrengthLoadMetric;
                })
              }
            >
              {(Object.keys(METRIC_LABELS) as StrengthLoadMetric[]).map((metric) => (
                <option key={metric} value={metric}>{METRIC_LABELS[metric]}</option>
              ))}
            </select>
          </label>
          <label>
            Bodyweight (kg)
            <NumberInput
              value={config.bodyweightKg}
              min={0}
              max={250}
              step={0.5}
              onCommit={(value) =>
                patchSettings((next) => {
                  next.strength.bodyweightKg = value;
                })
              }
            />
          </label>
          <label>
            Acute window (days)
            <NumberInput
              value={config.acuteWindow}
              min={3}
              max={60}
              step={1}
              onCommit={(value) =>
                patchSettings((next) => {
                  next.strength.acuteWindow = Math.round(value);
                })
              }
            />
          </label>
          <label>
            Chronic window (days)
            <NumberInput
              value={config.chronicWindow}
              min={3}
              max={90}
              step={1}
              onCommit={(value) =>
                patchSettings((next) => {
                  next.strength.chronicWindow = Math.round(value);
                })
              }
            />
          </label>
        </div>
        <p className="muted-hint">
          Relative intensity compares each set with your best estimated 1RM on that exercise so far, so a deadlift set and a
          dip set count comparably. Volume favours heavy lower-body lifts. Timed sets count one rep per 4 seconds.
        </p>
      </article>

      <article className="panel full-width">
        <div className="panel-header-row">
          <h2>Strength ACWR History</h2>
          <select
            className="range-select"
            value={range ?? "all"}
            onChange={(event) => setRange(event.target.value === "all" ? null : (Number(event.target.value) as RangeDays))}
          >
            <option value={28}>Last 28 days</option>
            <option value={56}>Last 8 weeks</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
            <option value="all">All time</option>
          </select>
        </div>
        {visibleHistory.length < 2 ? (
          <p>Not enough strength history in this range.</p>
        ) : (
          <AcwrHistoryChart
            points={visibleHistory}
            lowThreshold={settings.model.acwr.lowThreshold}
            highThreshold={settings.model.acwr.highThreshold}
            targetAcwr={settings.model.acwr.targetAcwr}
          />
        )}
      </article>

      {categoryRows.length > 0 && (
        <article className="panel full-width">
          <h2>ACWR by Category</h2>
          <GroupTable rows={categoryRows} settings={settings} label="Category" />
        </article>
      )}

      {exerciseRows.length > 0 && (
        <article className="panel full-width">
          <h2>ACWR by Exercise</h2>
          <p className="muted-hint">
            Tick "+BW" for exercises where FitNotes logs only the added weight (pull-ups, dips…), so your bodyweight counts too.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Category</th>
                <th>Last trained</th>
                <th>Sets</th>
                <th>ACWR</th>
                <th>Status</th>
                <th>+BW</th>
              </tr>
            </thead>
            <tbody>
              {exerciseRows.map((row) => {
                const bodyweight = config.bodyweightExercises[row.key] ?? isBodyweightByDefault(row.key, strengthSets);
                return (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td>{row.category}</td>
                    <td>{row.lastDate}</td>
                    <td>{row.setCount}</td>
                    <td>{row.acwr.toFixed(2)}</td>
                    <td>{getAcwrZone(row.acwr, settings.model.acwr.lowThreshold, settings.model.acwr.highThreshold)}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Add bodyweight to ${row.key}`}
                        checked={bodyweight}
                        onChange={(event) =>
                          patchSettings((next) => {
                            next.strength.bodyweightExercises[row.key] = event.target.checked;
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      )}
    </section>
  );
}

/** Per-day summary of imported strength sets for the History tab. */
export function StrengthHistoryTable({ settings, strengthSets }: { settings: AppSettings; strengthSets: StrengthSet[] }) {
  const days = useMemo(() => {
    const byDate = new Map<string, { exercises: Set<string>; sets: number; load: number }>();
    for (const item of calculateSetLoads(strengthSets, settings.strength)) {
      const day = byDate.get(item.set.date) ?? { exercises: new Set<string>(), sets: 0, load: 0 };
      day.exercises.add(item.set.exercise);
      day.sets += 1;
      day.load += item.load;
      byDate.set(item.set.date, day);
    }
    return Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [strengthSets, settings.strength]);

  if (days.length === 0) {
    return <p>No strength data imported yet. Import a FitNotes export on the Strength tab.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Exercises</th>
          <th>Sets</th>
          <th>Load</th>
        </tr>
      </thead>
      <tbody>
        {days.map(([date, day]) => (
          <tr key={date}>
            <td>{date}</td>
            <td>{Array.from(day.exercises).join(", ")}</td>
            <td>{day.sets}</td>
            <td>{day.load.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
