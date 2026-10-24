import { buildMovingAverageSeries, type HistoryPoint } from "../domain/loadCalculator";
import { ChartDataTable } from "./charts/ChartTooltip";
import { formatLongDate, formatShortDate } from "./charts/chartUtils";
import { LineChart } from "./charts/LineChart";

const TOTAL_WINDOWS = [
  { days: 7, color: "var(--series-1)" },
  { days: 14, color: "var(--series-2)" },
  { days: 28, color: "var(--series-3)" },
] as const;

/**
 * Rolling 7/14/28-day load totals. Totals are computed on the full history and then cut to the
 * visible range, so the first visible days already include load from before the range.
 */
export function LoadTotalsChart({ history, rangeDays }: { history: HistoryPoint[]; rangeDays: number | null }) {
  const totals = TOTAL_WINDOWS.map((window) => ({
    ...window,
    values: buildMovingAverageSeries(history, window.days).map((point) => point.average),
  }));
  const start = rangeDays === null ? 0 : Math.max(0, history.length - rangeDays);
  const visible = history.slice(start);

  if (visible.length < 2) {
    return <p className="chart-empty">Log a few sessions to see rolling load totals.</p>;
  }

  return (
    <>
      <LineChart
        ariaLabel="Rolling load totals"
        xLabels={visible.map((point) => formatShortDate(point.date))}
        xTitles={visible.map((point) => formatLongDate(point.date))}
        series={totals.map((total) => ({
          id: `total-${total.days}`,
          label: `${total.days}-day total`,
          color: total.color,
          values: total.values.slice(start),
        }))}
        height={260}
        formatValue={(value) => value.toFixed(0)}
      />
      <ChartDataTable
        columns={["Date", "Daily load", ...TOTAL_WINDOWS.map((window) => `${window.days}-day total`)]}
        rows={visible
          .map((point, index) => [
            point.date,
            point.load.toFixed(0),
            ...totals.map((total) => total.values[start + index].toFixed(0)),
          ])
          .reverse()}
      />
    </>
  );
}

const EWMA_WINDOWS = [
  { days: 10, color: "var(--series-1)" },
  { days: 15, color: "var(--series-2)" },
  { days: 20, color: "var(--series-3)" },
  { days: 25, color: "var(--series-4)" },
] as const;

/** How much each past day weighs in an EWMA: alpha · (1 − alpha)^d with alpha = 2 / (N + 1). */
export function EwmaWeightsChart() {
  const days = Array.from({ length: 31 }, (_, day) => day);

  return (
    <LineChart
      ariaLabel="EWMA weight per day for 10, 15, 20 and 25 day windows"
      xLabels={days.map((day) => `${day}d`)}
      xTitles={days.map((day) => (day === 0 ? "Today" : `${day} day${day === 1 ? "" : "s"} ago`))}
      series={EWMA_WINDOWS.map((window) => {
        const alpha = 2 / (window.days + 1);
        return {
          id: `ewma-${window.days}`,
          label: `${window.days}-day window`,
          color: window.color,
          values: days.map((day) => alpha * (1 - alpha) ** day * 100),
        };
      })}
      height={220}
      yMin={0}
      formatY={(value) => `${value.toFixed(0)}%`}
      formatValue={(value) => `${value.toFixed(1)}%`}
      xAxisLabel="Days ago"
    />
  );
}

/** Small single-series curve for the model settings. */
export function CurveChart({
  title,
  xLabel,
  points,
  color,
  xFormatter,
  yFormatter,
  yLog = false,
}: {
  title: string;
  xLabel: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  yLog?: boolean;
}) {
  return (
    <article className="curve-card">
      <h4>
        {title}
        {yLog && <span className="log-badge">log scale</span>}
      </h4>
      <LineChart
        ariaLabel={title}
        xLabels={points.map((point) => xFormatter(point.x))}
        series={[{ id: title, label: title, color, values: points.map((point) => point.y) }]}
        height={190}
        yLog={yLog}
        yMin={yLog ? undefined : Math.min(0, ...points.map((point) => point.y))}
        formatY={yFormatter}
        formatValue={yFormatter}
        xAxisLabel={xLabel}
        area={!yLog}
      />
    </article>
  );
}
