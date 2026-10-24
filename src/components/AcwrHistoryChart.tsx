import { useState } from "react";
import type { HistoryPoint } from "../domain/loadCalculator";
import { ColumnChart } from "./charts/ColumnChart";
import { ChartDataTable, ChartLegend } from "./charts/ChartTooltip";
import { formatCompact, formatLongDate, formatShortDate } from "./charts/chartUtils";
import { LineChart } from "./charts/LineChart";

/** ACWR line over zone bands, with that period's daily load as a separate column strip on the same timeline. */
export function AcwrHistoryChart({
  points,
  lowThreshold,
  highThreshold,
  targetAcwr,
  loadLabel = "Daily load",
}: {
  points: HistoryPoint[];
  lowThreshold: number;
  highThreshold: number;
  targetAcwr: number;
  loadLabel?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const xLabels = points.map((point) => formatShortDate(point.date));
  const xTitles = points.map((point) => formatLongDate(point.date));
  const yMax = Math.max(2, Math.ceil(Math.max(...points.map((point) => point.acwr)) * 4) / 4);

  return (
    <div className="acwr-chart">
      <ChartLegend
        items={[
          { label: "ACWR", color: "var(--series-1)" },
          { label: `Target ${targetAcwr.toFixed(2)}`, color: "var(--ink-secondary)", kind: "dash" },
          { label: `Sweet spot ${lowThreshold.toFixed(2)}–${highThreshold.toFixed(2)}`, color: "var(--status-good)", kind: "rect" },
          { label: "Detraining", color: "var(--status-warning)", kind: "rect" },
          { label: "High risk", color: "var(--status-critical)", kind: "rect" },
        ]}
      />
      <LineChart
        ariaLabel="ACWR over time"
        xLabels={xLabels}
        xTitles={xTitles}
        series={[{ id: "acwr", label: "ACWR", color: "var(--series-1)", values: points.map((point) => point.acwr) }]}
        height={240}
        yMin={0}
        yMax={yMax}
        bands={[
          { from: 0, to: lowThreshold, color: "var(--status-warning)" },
          { from: lowThreshold, to: highThreshold, color: "var(--status-good)" },
          { from: highThreshold, to: yMax, color: "var(--status-critical)" },
        ]}
        refLines={[{ value: targetAcwr, label: "Target", color: "var(--ink-secondary)" }]}
        formatY={(value) => value.toFixed(1)}
        tooltipExtras={(index) => [
          { label: "acute", value: formatCompact(points[index].acute) },
          { label: "chronic", value: formatCompact(points[index].chronic) },
          { label: "load that day", value: formatCompact(points[index].load) },
        ]}
        endLabels
        showLegend={false}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
      />
      <p className="chart-subtitle">{loadLabel}</p>
      <ColumnChart
        ariaLabel={loadLabel}
        labels={xLabels}
        titles={xTitles}
        values={points.map((point) => point.load)}
        color="var(--series-3)"
        seriesLabel="load"
        height={110}
        valueLabels={false}
        padRight={52}
        showTooltip={false}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
      />
      <ChartDataTable
        columns={["Date", "Load", "Acute", "Chronic", "ACWR"]}
        rows={[...points].reverse().map((point) => [
          point.date,
          formatCompact(point.load),
          formatCompact(point.acute),
          formatCompact(point.chronic),
          point.acwr.toFixed(2),
        ])}
      />
    </div>
  );
}
