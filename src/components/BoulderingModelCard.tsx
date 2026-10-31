import { calculateGradeIntensity, gradeToDisplay } from "../domain/loadCalculator";
import { GRADES, type AppSettings, type Grade } from "../types";
import { NumberInput } from "./NumberInput";

/** Bouldering counterpart of the Strength tab's load-model card. */
export function BoulderingModelCard({
  settings,
  patchSettings,
  referenceGrade,
}: {
  settings: AppSettings;
  patchSettings: (update: (draft: AppSettings) => void) => void;
  referenceGrade: Grade;
}) {
  const { gradeIntensity, speed, acwr } = settings.model;

  return (
    <article className="panel full-width">
      <h2>Bouldering load model</h2>
      <div className="field-grid field-grid-3">
        <label>
          Points per problem at your max
          <NumberInput
            value={gradeIntensity.basePoints}
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
          Multiplier per grade
          <NumberInput
            value={gradeIntensity.multiplierPerGrade}
            min={1.1}
            max={3}
            step={0.05}
            onCommit={(value) =>
              patchSettings((next) => {
                next.model.gradeIntensity.multiplierPerGrade = value;
              })
            }
          />
        </label>
        <label>
          Pace bonus (% at 1 min/boulder)
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={speed.impactPercent}
            onChange={(event) =>
              patchSettings((next) => {
                next.model.speed.impactPercent = Number(event.target.value);
              })
            }
          />
          <span className="range-value">{speed.impactPercent}%</span>
        </label>
        <label>
          Board multiplier
          <NumberInput
            value={settings.model.boardMultiplier}
            min={1}
            max={2}
            step={0.05}
            onCommit={(value) =>
              patchSettings((next) => {
                next.model.boardMultiplier = value;
              })
            }
          />
        </label>
        <label>
          Acute window (days)
          <NumberInput
            value={acwr.acuteWindow}
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
          Chronic window (days)
          <NumberInput
            value={acwr.chronicWindow}
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
          Current max grade
          <input readOnly value={gradeToDisplay(referenceGrade, settings.gradeDisplayUnit)} aria-label="Current max grade" />
        </label>
      </div>
      <p className="muted-hint">
        Loads are measured against your current max: the hardest grade you've logged on at least two different days in the past year.
        Each grade above it multiplies the points by {gradeIntensity.multiplierPerGrade.toFixed(2)}; each grade below divides them.
        Board problems (Kilter, Tension, MoonBoard, spray walls, or any wall logged as "board") count{" "}
        {settings.model.boardMultiplier.toFixed(2)}× at the same grade. Sleep and stress don't change load; they show up as readiness.
      </p>

      <details>
        <summary>Points per grade</summary>
        <div className="table-scroll">
          <table className="grade-conversion-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Points</th>
                <th>vs. your max</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((grade) => {
                const points = calculateGradeIntensity(grade, referenceGrade, settings);
                return (
                  <tr key={grade} className={grade === referenceGrade ? "highlight-row" : undefined}>
                    <td>{gradeToDisplay(grade, settings.gradeDisplayUnit)}</td>
                    <td className="num">{points < 10 ? points.toFixed(2) : points.toFixed(1)}</td>
                    <td className="num">{(points / gradeIntensity.basePoints).toFixed(2)}×</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
