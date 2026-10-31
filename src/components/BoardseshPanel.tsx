import { useState } from "react";
import { findBoardseshUsers, type BoardseshUser } from "../integrations/boardsesh";
import type { AppSettings, TopLoggerCountMode } from "../types";
import { NumberInput } from "./NumberInput";

interface BoardseshPanelProps {
  settings: AppSettings;
  patchSettings: (update: (draft: AppSettings) => void) => void;
  status: string | undefined;
  syncing: boolean;
  onConnect: (user: BoardseshUser) => void;
  onDisconnect: () => void;
  onSync: () => void;
}

/** Connect a public Boardsesh logbook (Kilter, Tension, MoonBoard, spray walls…). No password or token needed. */
export function BoardseshPanel({ settings, patchSettings, status, syncing, onConnect, onDisconnect, onSync }: BoardseshPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BoardseshUser[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const config = settings.boardsesh;

  async function search(): Promise<void> {
    setSearching(true);
    setError(undefined);
    try {
      const found = await findBoardseshUsers(query);
      setResults(found);
      if (found.length === 0) setError("No public Boardsesh profile found. Check the name, or paste your profile link.");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setSearching(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-header-row">
        <h2>Boardsesh sync</h2>
        {config.userId && (
          <div className="metric-row">
            <button type="button" className="primary" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="danger" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {config.userId ? (
        <p>
          Connected as <strong>{config.displayName ?? "Boardsesh climber"}</strong>.
          {config.lastSyncedAt ? ` Last synced ${new Date(config.lastSyncedAt).toLocaleString()}.` : " Not synced yet."}
        </p>
      ) : (
        <>
          <p className="muted-hint">
            Pull in what you climbed on Kilter, Tension, MoonBoard and other boards via{" "}
            <a href="https://www.boardsesh.com" target="_blank" rel="noreferrer">
              Boardsesh
            </a>
            . Search your name or paste your profile link; no password needed. Your Boardsesh profile has to be public.
          </p>
          <form
            className="metric-row"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              className="token-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Your Boardsesh name or profile link"
              aria-label="Boardsesh name or profile link"
            />
            <button type="submit" disabled={query.trim().length < 2 || searching}>
              {searching ? "Searching…" : "Find"}
            </button>
          </form>
          {error && <p className="muted-hint">{error}</p>}
          {results && results.length > 0 && (
            <ul className="user-results">
              {results.map((user) => (
                <li key={user.id}>
                  <span>
                    <strong>{user.displayName}</strong>
                    {user.recentAscentCount !== undefined && (
                      <span className="muted-inline"> · {user.recentAscentCount} ascents in the last 30 days</span>
                    )}
                  </span>
                  <button type="button" className="primary small" onClick={() => onConnect(user)} disabled={syncing}>
                    This is me
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {status && <p className="muted-hint">{status}</p>}

      <details>
        <summary>Sync options</summary>
        <div className="field-grid">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.autoSync}
              onChange={(event) =>
                patchSettings((next) => {
                  next.boardsesh.autoSync = event.target.checked;
                })
              }
            />
            Auto-sync when the app opens
          </label>
          <label>
            Import sessions from
            <input
              type="date"
              value={config.importFromDate}
              onChange={(event) =>
                patchSettings((next) => {
                  next.boardsesh.importFromDate = event.target.value;
                  // Forget the incremental cursor so the next sync goes back to the new start date.
                  next.boardsesh.lastSyncedAt = undefined;
                })
              }
            />
          </label>
          <label>
            Count
            <select
              value={config.countMode}
              onChange={(event) =>
                patchSettings((next) => {
                  next.boardsesh.countMode = event.target.value as TopLoggerCountMode;
                })
              }
            >
              <option value="attempted">Every climb tried</option>
              <option value="sent">Only climbs sent</option>
              <option value="tries">Every try (5 goes on a project = 5)</option>
            </select>
          </label>
          <label>
            Default session duration (min)
            <NumberInput
              value={config.defaultDurationMinutes}
              min={10}
              max={600}
              step={5}
              onCommit={(value) =>
                patchSettings((next) => {
                  next.boardsesh.defaultDurationMinutes = Math.round(value);
                })
              }
            />
          </label>
        </div>
        <p className="muted-hint">
          Each day on a board becomes one session. Sends use your own grade, attempts the community grade. Board problems count{" "}
          {settings.model.boardMultiplier.toFixed(2)}× the load of the same grade on a gym wall (change it in the load model).
        </p>
      </details>
    </article>
  );
}
