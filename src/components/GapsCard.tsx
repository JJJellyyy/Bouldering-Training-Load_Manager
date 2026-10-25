import type { GapDecision, LogGap } from "../domain/gaps";
import { formatLongDate } from "./charts/chartUtils";

type GapWithDecision = LogGap & { decision?: GapDecision };

function GapPeriod({ gap }: { gap: LogGap }) {
  return (
    <>
      <strong>
        {formatLongDate(gap.start)} – {formatLongDate(gap.end)}
      </strong>{" "}
      <span className="muted-inline">({gap.days} days)</span>
    </>
  );
}

/**
 * Asks once per gap in the log whether you were climbing without logging. Unlogged climbing would otherwise
 * count as rest, deflate your chronic load and make the next sessions look like a spike.
 */
export function GapsCard({
  gaps,
  onDecide,
}: {
  gaps: GapWithDecision[];
  onDecide: (gapId: string, decision: GapDecision | undefined) => void;
}) {
  const open = gaps.filter((gap) => !gap.decision);
  const answered = gaps.filter((gap) => gap.decision);
  if (gaps.length === 0) return null;

  return (
    <article className={`panel full-width gaps-card ${open.length > 0 ? "attention" : ""}`}>
      <div className="panel-heading">
        <h2>{open.length > 0 ? "Were you climbing?" : "Gaps in your log"}</h2>
        <p className="muted-hint">
          Nothing was logged in {open.length > 0 ? "these periods" : "the periods below"}. If you were climbing but not logging, the app
          fills them with your usual load (marked as estimated), so your return doesn't look like a huge spike. If you really took a
          break, the warning after it is real.
        </p>
      </div>

      {open.length > 0 && (
        <ul className="gap-list">
          {open.map((gap) => (
            <li key={gap.id}>
              <span>
                <GapPeriod gap={gap} />
              </span>
              <div className="gap-actions">
                <button type="button" className="primary small" onClick={() => onDecide(gap.id, "climbing")}>
                  I was climbing, just not logging
                </button>
                <button type="button" className="small" onClick={() => onDecide(gap.id, "break")}>
                  I took a break
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {answered.length > 0 && (
        <details>
          <summary>Answered ({answered.length})</summary>
          <ul className="gap-list">
            {answered.map((gap) => (
              <li key={gap.id}>
                <span>
                  <GapPeriod gap={gap} /> · {gap.decision === "climbing" ? "filled with your usual load" : "counted as a break"}
                </span>
                <button type="button" className="small" onClick={() => onDecide(gap.id, undefined)}>
                  Change
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
