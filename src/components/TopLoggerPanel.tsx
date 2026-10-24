import { useState } from "react";
import { TOPLOGGER_TOKEN_SNIPPET, type TopLoggerAuth } from "../integrations/toplogger";
import type { AppSettings, TopLoggerCountMode } from "../types";
import { NumberInput } from "./NumberInput";

interface TopLoggerPanelProps {
  settings: AppSettings;
  patchSettings: (update: (draft: AppSettings) => void) => void;
  auth: TopLoggerAuth | undefined;
  status: string | undefined;
  syncing: boolean;
  onConnect: (refreshToken: string) => void;
  onDisconnect: () => void;
  onSync: () => void;
}

export function TopLoggerPanel({
  settings,
  patchSettings,
  auth,
  status,
  syncing,
  onConnect,
  onDisconnect,
  onSync,
}: TopLoggerPanelProps) {
  const [tokenDraft, setTokenDraft] = useState("");
  const config = settings.toplogger;

  return (
    <article className="panel full-width">
      <div className="panel-header-row">
        <h2>TopLogger Sync</h2>
        {auth && (
          <div className="metric-row">
            <button type="button" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="danger" onClick={onDisconnect}>Disconnect</button>
          </div>
        )}
      </div>

      {auth ? (
        <p>
          Connected as <strong>{auth.userName ?? "TopLogger user"}</strong>.
          {config.lastSyncedAt ? ` Last synced ${new Date(config.lastSyncedAt).toLocaleString()}.` : " Not synced yet."}
        </p>
      ) : (
        <>
          <p className="muted-hint">
            TopLogger has no public login API, so connect with your session's refresh token: sign in at{" "}
            <a href="https://app.toplogger.nu" target="_blank" rel="noreferrer">app.toplogger.nu</a>, open the browser
            console (F12), paste the snippet below and press Enter. The token is copied to your clipboard. Paste it here.
            It is stored only in this browser.
          </p>
          <div className="snippet-row">
            <code className="snippet">{TOPLOGGER_TOKEN_SNIPPET}</code>
            <button type="button" onClick={() => void navigator.clipboard.writeText(TOPLOGGER_TOKEN_SNIPPET)}>Copy snippet</button>
          </div>
          <div className="metric-row">
            <input
              className="token-input"
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              placeholder="Paste TopLogger refresh token"
            />
            <button
              type="button"
              disabled={!tokenDraft.trim() || syncing}
              onClick={() => {
                onConnect(tokenDraft);
                setTokenDraft("");
              }}
            >
              Connect
            </button>
          </div>
          <p className="muted-hint">
            Tip: use a private window and just close it afterwards. Signing out on TopLogger revokes the token.
          </p>
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
                  next.toplogger.autoSync = event.target.checked;
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
                  next.toplogger.importFromDate = event.target.value;
                  // Forget the incremental cursor so the next sync goes back to the new start date.
                  next.toplogger.lastSyncedAt = undefined;
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
                  next.toplogger.countMode = event.target.value as TopLoggerCountMode;
                })
              }
            >
              <option value="attempted">Every boulder tried</option>
              <option value="sent">Only boulders sent</option>
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
                  next.toplogger.defaultDurationMinutes = Math.round(value);
                })
              }
            />
          </label>
        </div>
        <p className="muted-hint">
          Each TopLogger day becomes one session. Grades come from TopLogger and wall angle from the wall name when it
          says slab, overhang, roof or board; hold type is set to mixed. TopLogger doesn't record duration, sleep or
          stress, so these use the defaults above. Edit a synced session in History to fill them in; later syncs won't
          overwrite your edits.
        </p>
      </details>
    </article>
  );
}
