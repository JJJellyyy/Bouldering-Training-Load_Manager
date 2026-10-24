import type { WeeklyWellness } from "../domain/wellness";
import { ChartDataTable } from "./charts/ChartTooltip";
import { formatCompact, formatShortDate } from "./charts/chartUtils";
import { LineChart } from "./charts/LineChart";

function formatDelta(current: number | null, previous: number | null, unit: string, higherIsBetter: boolean) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) return { text: `steady vs last week`, tone: "neutral" };
  const improving = higherIsBetter ? delta > 0 : delta < 0;
  return {
    text: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}${unit} vs last week`,
    tone: improving ? "good" : "bad",
  };
}

/** Week-by-week sleep (duration on its own axis) and sleep quality + stress (both 1–10) as two charts, never a dual axis. */
export function WellnessCharts({ weeks, personalMaxSleep }: { weeks: WeeklyWellness[]; personalMaxSleep: number }) {
  const withData = weeks.filter((week) => week.sessions > 0);
  if (withData.length === 0) {
    return (
      <p className="empty-note">
        Log sleep and stress with your sessions to see weekly trends. Synced TopLogger sessions count once you edit them.
      </p>
    );
  }

  const latest = withData[withData.length - 1];
  const previous = withData.length > 1 ? withData[withData.length - 2] : null;
  const labels = weeks.map((week) => formatShortDate(week.weekStart));
  const titles = weeks.map((week) => `Week of ${formatShortDate(week.weekStart)} · ${week.sessions} session${week.sessions === 1 ? "" : "s"}`);

  const tiles = [
    { label: "Sleep", value: latest.sleepHours, unit: " h", delta: formatDelta(latest.sleepHours, previous?.sleepHours ?? null, " h", true) },
    { label: "Sleep quality", value: latest.sleepQuality, unit: "/10", delta: formatDelta(latest.sleepQuality, previous?.sleepQuality ?? null, "", true) },
    { label: "Stress", value: latest.stress, unit: "/10", delta: formatDelta(latest.stress, previous?.stress ?? null, "", false) },
  ];

  return (
    <div className="wellness">
      <div className="wellness-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="wellness-tile">
            <span className="wellness-label">{tile.label}</span>
            <strong>{tile.value === null ? "–" : `${tile.value.toFixed(1)}${tile.unit}`}</strong>
            {tile.delta && <span className={`wellness-delta ${tile.delta.tone}`}>{tile.delta.text}</span>}
          </div>
        ))}
      </div>

      <div className="wellness-charts">
        <div>
          <p className="chart-subtitle">Sleep per night (hours)</p>
          <LineChart
            ariaLabel="Average sleep per week"
            xLabels={labels}
            xTitles={titles}
            series={[{ id: "sleep", label: "sleep", color: "var(--series-4)", values: weeks.map((week) => week.sleepHours) }]}
            refLines={[{ value: personalMaxSleep, label: "Your target", color: "var(--ink-secondary)" }]}
            height={190}
            yMin={Math.max(0, Math.floor(Math.min(personalMaxSleep, ...withData.map((week) => week.sleepHours ?? personalMaxSleep)) - 1))}
            formatY={(value) => `${value.toFixed(0)}h`}
            formatValue={(value) => `${value.toFixed(1)} h`}
            showDots
          />
        </div>
        <div>
          <p className="chart-subtitle">Sleep quality and stress (1–10)</p>
          <LineChart
            ariaLabel="Average sleep quality and stress per week"
            xLabels={labels}
            xTitles={titles}
            series={[
              { id: "quality", label: "sleep quality", color: "var(--series-1)", values: weeks.map((week) => week.sleepQuality) },
              { id: "stress", label: "stress", color: "var(--series-3)", values: weeks.map((week) => week.stress) },
            ]}
            height={190}
            yMin={0}
            yMax={10}
            formatY={formatCompact}
            showDots
            formatValue={(value) => value.toFixed(1)}
          />
        </div>
      </div>

      <ChartDataTable
        columns={["Week of", "Sessions", "Sleep (h)", "Sleep quality", "Stress (/10)"]}
        rows={[...weeks].reverse().map((week) => [
          week.weekStart,
          week.sessions,
          week.sleepHours?.toFixed(1) ?? "–",
          week.sleepQuality?.toFixed(1) ?? "–",
          week.stress?.toFixed(1) ?? "–",
        ])}
      />
    </div>
  );
}
