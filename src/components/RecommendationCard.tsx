import type { Recommendation, SessionOption } from "../domain/recommendations";
import type { AppSettings, Grade } from "../types";
import { formatLongDate } from "./charts/chartUtils";
import { ZoneBadge } from "./ZoneBadge";

function describeDay(planDate: string, restDays: number): string {
  if (restDays === 0) return "today";
  if (restDays === 1) return "tomorrow";
  return formatLongDate(planDate);
}

function headline(recommendation: Recommendation, settings: AppSettings): { tone: string; title: string; body: string } {
  const { low, high } = { low: settings.model.acwr.lowThreshold, high: settings.model.acwr.highThreshold };
  const current = recommendation.currentAcwr.toFixed(2);
  const when = describeDay(recommendation.planDate, recommendation.restDays);
  const room = `Load ${recommendation.loadMin.toFixed(0)}–${recommendation.loadMax.toFixed(0)} keeps you in the sweet spot.`;

  if (recommendation.restDays > 0) {
    return {
      tone: recommendation.status === "over" ? "over" : "close",
      title: `Rest first: ${recommendation.restDays} day${recommendation.restDays === 1 ? "" : "s"}`,
      body: `Your ACWR is ${current} (limit ${high.toFixed(2)}). By ${when} it settles around ${recommendation.restAcwr.toFixed(2)} and there is room for a session. ${room}`,
    };
  }
  if (recommendation.status === "over") {
    return { tone: "over", title: "Over your limit", body: `Your ACWR is ${current}, above ${high.toFixed(2)}. ${room}` };
  }
  if (recommendation.status === "close") {
    return { tone: "close", title: "Close to your limit: keep it light", body: `Your ACWR is ${current} against a limit of ${high.toFixed(2)}. ${room}` };
  }
  if (recommendation.status === "low") {
    return { tone: "low", title: "Below your sweet spot", body: `Your ACWR is ${current}, under ${low.toFixed(2)}. A session in this range brings you back. ${room}` };
  }
  return { tone: "green", title: "Room to train today", body: `Your ACWR is ${current}. ${room}` };
}

function OptionCard({ option, displayGrade, settings }: { option: SessionOption; displayGrade: (grade: Grade) => string; settings: AppSettings }) {
  return (
    <article className={`rec-card ${option.available ? "" : "disabled"}`}>
      <div className="rec-card-head">
        <h3>{option.title}</h3>
        {option.available && (
          <ZoneBadge acwr={option.predictedAcwr} low={settings.model.acwr.lowThreshold} high={settings.model.acwr.highThreshold} />
        )}
      </div>
      <p className="muted-hint">{option.blurb}</p>

      {option.available ? (
        <>
          <ul className="attempt-list" aria-label={`${option.title} session`}>
            {option.attempts.map((item) => (
              <li key={item.grade} className="attempt-chip">
                <strong>{displayGrade(item.grade)}</strong>
                <span>× {item.count}</span>
              </li>
            ))}
          </ul>
          <p className="rec-meta">
            {option.totalAttempts} attempts · about {option.minutes} min · load {option.load.toFixed(0)} → ACWR{" "}
            <strong>{option.predictedAcwr.toFixed(2)}</strong>
          </p>
        </>
      ) : (
        <p className="rec-reason">
          <span aria-hidden="true">⊘ </span>
          {option.reason}
        </p>
      )}
    </article>
  );
}

/** Three ways to spend the load that keeps (or puts) you in the green zone: volume, medium and high intensity. */
export function RecommendationCard({
  recommendation,
  settings,
  displayGrade,
  referenceGrade,
}: {
  recommendation: Recommendation | null;
  settings: AppSettings;
  displayGrade: (grade: Grade) => string;
  referenceGrade: Grade;
}) {
  if (!recommendation) {
    return <p className="empty-note">Log or sync a session to get a recommendation.</p>;
  }

  const message = headline(recommendation, settings);

  return (
    <div className="recommendation">
      <div className={`rec-banner ${message.tone}`}>
        <strong>{message.title}</strong>
        <span>{message.body}</span>
      </div>

      <div className="rec-grid">
        {recommendation.options.map((option) => (
          <OptionCard key={option.key} option={option} displayGrade={displayGrade} settings={settings} />
        ))}
      </div>

      <p className="muted-hint">
        For a session {describeDay(recommendation.planDate, recommendation.restDays)}, measured against your current max of{" "}
        <strong>{displayGrade(referenceGrade)}</strong>. Each option stays below an ACWR of{" "}
        {(settings.model.acwr.highThreshold - 0.05).toFixed(2)}; hard sessions are never suggested while you are over or within 0.10 of{" "}
        {settings.model.acwr.highThreshold.toFixed(2)}. Attempts are problems you climb, not individual tries.
      </p>
    </div>
  );
}
