import { useMemo } from "react";
import { addDays, todayIsoDate } from "../domain/acwr";
import { calculateGradeIntensity, getSessionDayKey, gradeToDisplay, gradeToNumber } from "../domain/loadCalculator";
import type { AppSettings, Grade, SessionInput } from "../types";
import { formatShortDate } from "./charts/chartUtils";

/** What you climbed over the last 4 weeks, by grade. Points use your current max grade as the reference. */
export function GradeBreakdownTable({
  sessions,
  settings,
  referenceGrade,
  windowDays = 28,
}: {
  sessions: SessionInput[];
  settings: AppSettings;
  referenceGrade: Grade;
  windowDays?: number;
}) {
  const rows = useMemo(() => {
    const since = addDays(todayIsoDate(), -(windowDays - 1));
    const byGrade = new Map<Grade, { attempts: number; days: Set<string>; last: string }>();

    for (const session of sessions) {
      const day = getSessionDayKey(session);
      if (day < since) continue;
      for (const problem of session.problems) {
        if (problem.count <= 0) continue;
        const row = byGrade.get(problem.grade) ?? { attempts: 0, days: new Set<string>(), last: day };
        row.attempts += problem.count;
        row.days.add(day);
        if (day > row.last) row.last = day;
        byGrade.set(problem.grade, row);
      }
    }

    const rows = [...byGrade.entries()].map(([grade, row]) => ({
      grade,
      attempts: row.attempts,
      days: row.days.size,
      last: row.last,
      points: row.attempts * calculateGradeIntensity(grade, referenceGrade, settings),
    }));
    const totalPoints = rows.reduce((sum, row) => sum + row.points, 0);
    return rows
      .map((row) => ({ ...row, share: totalPoints > 0 ? row.points / totalPoints : 0 }))
      .sort((a, b) => gradeToNumber(b.grade) - gradeToNumber(a.grade));
  }, [sessions, settings, referenceGrade, windowDays]);

  if (rows.length === 0) {
    return <p className="empty-note">No climbing in the last {windowDays} days.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Grade</th>
            <th>Last climbed</th>
            <th>Days</th>
            <th>Attempts</th>
            <th>Points</th>
            <th>Share of load</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.grade}>
              <td>{gradeToDisplay(row.grade, settings.gradeDisplayUnit)}</td>
              <td>{formatShortDate(row.last)}</td>
              <td className="num">{row.days}</td>
              <td className="num">{row.attempts}</td>
              <td className="num">{row.points.toFixed(0)}</td>
              <td className="num">{(row.share * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
