import { useState } from "react";
import type { Readiness } from "../domain/loadCalculator";
import {
  GRADES,
  HOLD_TYPES,
  WALL_ANGLES,
  type AppSettings,
  type CalculationResult,
  type Grade,
  type HoldType,
  type ProblemEntry,
  type WallAngle,
} from "../types";
import { NumberInput } from "./NumberInput";

export interface SessionDraft {
  sessionDate: string;
  durationMinutes: number;
  sleepHours: number;
  sleepQuality: number;
  stress: number;
  motivation: number;
  problems: ProblemEntry[];
}

interface SessionFormProps {
  draft: SessionDraft;
  onChange: (update: (previous: SessionDraft) => SessionDraft) => void;
  settings: AppSettings;
  displayGrade: (grade: Grade) => string;
  estimatedLoad?: CalculationResult;
  readiness: Readiness;
  readinessLabel: string;
  onSave: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  saveLabel: string;
  /** Defaults for the quick-add row (e.g. a grade near your max). */
  defaultGrade: Grade;
}

function newProblemId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 100_000)}`;
}

function Scale({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {Array.from({ length: max }, (_, index) => index + 1).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One form for a whole session: when and how it felt, then the problems. Used for new sessions and for edits. */
export function SessionForm({
  draft,
  onChange,
  settings,
  displayGrade,
  estimatedLoad,
  readiness,
  readinessLabel,
  onSave,
  onCancel,
  onDelete,
  saveLabel,
  defaultGrade,
}: SessionFormProps) {
  const [grade, setGrade] = useState<Grade>(defaultGrade);
  const [count, setCount] = useState(1);
  const [holdType, setHoldType] = useState<HoldType>("mixed");
  const [wallAngle, setWallAngle] = useState<WallAngle>("mixed");
  const totalProblems = draft.problems.reduce((sum, problem) => sum + problem.count, 0);

  const set = <K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) => onChange((previous) => ({ ...previous, [key]: value }));

  function addProblems(): void {
    onChange((previous) => {
      // Same grade, hold and angle as an existing row: add to that row instead of a duplicate.
      const existing = previous.problems.find(
        (problem) => problem.grade === grade && problem.holdType === holdType && problem.wallAngle === wallAngle,
      );
      const problems = existing
        ? previous.problems.map((problem) => (problem === existing ? { ...problem, count: problem.count + count } : problem))
        : [...previous.problems, { id: newProblemId(), count, grade, holdType, wallAngle }];
      return { ...previous, problems };
    });
    setCount(1);
  }

  function changeCount(problemId: string, delta: number): void {
    onChange((previous) => ({
      ...previous,
      problems: previous.problems
        .map((problem) => (problem.id === problemId ? { ...problem, count: problem.count + delta } : problem))
        .filter((problem) => problem.count > 0),
    }));
  }

  return (
    <div className="session-form">
      <fieldset className="form-section">
        <legend>When &amp; how it felt</legend>
        <div className="field-grid field-grid-3">
          <label>
            Date
            <input type="date" value={draft.sessionDate} onChange={(event) => set("sessionDate", event.target.value)} />
          </label>
          <label>
            Duration (minutes)
            <NumberInput value={draft.durationMinutes} min={10} max={600} step={5} onCommit={(value) => set("durationMinutes", Math.round(value))} />
          </label>
          <label>
            Sleep the night before (h)
            <NumberInput value={draft.sleepHours} min={0} max={14} step={0.25} onCommit={(value) => set("sleepHours", value)} />
          </label>
          <Scale label="Sleep quality (10 = great)" value={draft.sleepQuality} max={10} onChange={(value) => set("sleepQuality", value)} />
          <Scale label={`Stress (1–${settings.stressScaleMax})`} value={draft.stress} max={settings.stressScaleMax} onChange={(value) => set("stress", value)} />
          <Scale
            label={`Motivation (1–${settings.motivationScaleMax})`}
            value={draft.motivation}
            max={settings.motivationScaleMax}
            onChange={(value) => set("motivation", value)}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>
          Problems <span className="count-chip">{totalProblems}</span>
        </legend>
        <div className="quick-add">
          <label>
            Grade
            <select value={grade} onChange={(event) => setGrade(event.target.value as Grade)}>
              {GRADES.map((option) => (
                <option key={option} value={option}>
                  {displayGrade(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            How many
            <div className="stepper">
              <button type="button" aria-label="One fewer" onClick={() => setCount((value) => Math.max(1, value - 1))}>
                −
              </button>
              <span aria-live="polite">{count}</span>
              <button type="button" aria-label="One more" onClick={() => setCount((value) => Math.min(100, value + 1))}>
                +
              </button>
            </div>
          </label>
          <label>
            Holds
            <select value={holdType} onChange={(event) => setHoldType(event.target.value as HoldType)}>
              {HOLD_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Wall
            <select value={wallAngle} onChange={(event) => setWallAngle(event.target.value as WallAngle)}>
              {WALL_ANGLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={addProblems}>
            Add
          </button>
        </div>

        {draft.problems.length === 0 ? (
          <p className="empty-note">No problems yet. Pick a grade and how many, then Add.</p>
        ) : (
          <ul className="problem-list">
            {draft.problems.map((problem) => (
              <li key={problem.id}>
                <strong className="problem-grade">{displayGrade(problem.grade)}</strong>
                <span className="problem-meta">
                  {problem.holdType} · {problem.wallAngle}
                </span>
                <div className="stepper small">
                  <button type="button" aria-label={`One fewer ${displayGrade(problem.grade)}`} onClick={() => changeCount(problem.id, -1)}>
                    −
                  </button>
                  <span>{problem.count}</span>
                  <button type="button" aria-label={`One more ${displayGrade(problem.grade)}`} onClick={() => changeCount(problem.id, 1)}>
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="icon-only danger"
                  aria-label={`Remove ${displayGrade(problem.grade)}`}
                  onClick={() => changeCount(problem.id, -problem.count)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="form-footer">
        <div className="form-summary">
          {estimatedLoad ? (
            <p>
              Estimated load <strong>{estimatedLoad.totalLoad.toFixed(0)}</strong>
              <span className="muted-inline">
                {" "}· pace ×{estimatedLoad.speedMultiplier.toFixed(2)} · measured against {displayGrade(estimatedLoad.referenceGrade)}
              </span>
            </p>
          ) : (
            <p className="muted-inline">Add problems to see the session's load.</p>
          )}
          <p className={`readiness-note ${readiness.level}`}>
            <span className="readiness-label">{readinessLabel}</span>
            {readiness.reasons.length === 0 ? "Well rested and low stress." : `${readiness.reasons.join(", ")}.`}
          </p>
        </div>
        <div className="form-actions">
          {onDelete && (
            <button type="button" className="danger ghost" onClick={onDelete}>
              Delete session
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="primary" onClick={onSave} disabled={draft.problems.length === 0}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
