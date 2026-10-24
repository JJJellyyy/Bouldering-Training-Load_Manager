import { useState } from "react";
import { ChartLegend, ChartTooltip, type TooltipRow } from "./ChartTooltip";
import {
  CHART_PAD_LEFT,
  CHART_PAD_RIGHT,
  formatCompact,
  handleChartKey,
  niceTicks,
  pickTickIndices,
  useMeasuredWidth,
} from "./chartUtils";

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

/** A horizontal value band, e.g. an ACWR zone. Drawn as a ~10% wash. */
export interface ChartBand {
  from: number;
  to: number;
  color: string;
}

/** A labelled threshold line such as a target. */
export interface ChartRefLine {
  value: number;
  label: string;
  color: string;
}

interface LineChartProps {
  ariaLabel: string;
  xLabels: string[];
  /** Tooltip heading per index (defaults to the x label). */
  xTitles?: string[];
  series: LineSeries[];
  height?: number;
  yMin?: number;
  yMax?: number;
  yLog?: boolean;
  bands?: ChartBand[];
  refLines?: ChartRefLine[];
  formatY?: (value: number) => string;
  formatValue?: (value: number) => string;
  /** Extra context rows for the tooltip at an index (e.g. that day's load). */
  tooltipExtras?: (index: number) => TooltipRow[];
  /** Label the last value of each series at the line end (use for 1–2 series). */
  endLabels?: boolean;
  /** Draw a soft wash under a single series. */
  area?: boolean;
  showLegend?: boolean;
  xAxisLabel?: string;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
}

export function LineChart({
  ariaLabel,
  xLabels,
  xTitles,
  series,
  height = 240,
  yMin,
  yMax,
  yLog = false,
  bands = [],
  refLines = [],
  formatY = formatCompact,
  formatValue = (value) => value.toFixed(2),
  tooltipExtras,
  endLabels = false,
  area = false,
  showLegend = series.length > 1,
  xAxisLabel,
  activeIndex: controlledIndex,
  onActiveIndexChange,
}: LineChartProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const activeIndex = controlledIndex !== undefined ? controlledIndex : localIndex;
  const setActive = (index: number | null) => {
    if (onActiveIndexChange) onActiveIndexChange(index);
    else setLocalIndex(index);
  };

  const count = xLabels.length;
  const padTop = 14;
  const padBottom = xAxisLabel ? 44 : 28;
  const padLeft = CHART_PAD_LEFT;
  const padRight = endLabels ? 52 : CHART_PAD_RIGHT;
  const innerW = Math.max(10, width - padLeft - padRight);
  const innerH = height - padTop - padBottom;

  const allValues = series.flatMap((serie) => serie.values.filter((value): value is number => value !== null));
  const transform = (value: number) => (yLog ? Math.log10(Math.max(value, 1e-6)) : value);

  let domainMin: number;
  let domainMax: number;
  let ticks: number[];
  if (yLog) {
    const positives = allValues.filter((value) => value > 0);
    const lo = Math.floor(Math.log10(Math.min(...positives, 1)));
    const hi = Math.ceil(Math.log10(Math.max(...positives, 10)));
    const stride = Math.max(1, Math.ceil((hi - lo) / 5));
    ticks = [];
    for (let exponent = lo; exponent <= hi; exponent += stride) ticks.push(10 ** exponent);
    domainMin = lo;
    domainMax = Math.max(hi, lo + 1);
  } else {
    const dataMin = Math.min(...allValues, ...refLines.map((line) => line.value));
    const dataMax = Math.max(...allValues, ...refLines.map((line) => line.value));
    ticks = niceTicks(yMin ?? Math.min(0, dataMin), yMax ?? dataMax, 4);
    domainMin = yMin ?? ticks[0];
    domainMax = yMax ?? ticks[ticks.length - 1];
    ticks = ticks.filter((tick) => tick >= domainMin && tick <= domainMax);
  }

  const span = Math.max(1e-9, domainMax - domainMin);
  const toX = (index: number) => padLeft + ((index + 0.5) / Math.max(1, count)) * innerW;
  const toY = (value: number) => {
    const t = (transform(value) - domainMin) / span;
    return padTop + innerH - Math.min(1, Math.max(0, t)) * innerH;
  };
  const toYRaw = (value: number) => padTop + innerH - ((value - domainMin) / span) * innerH;

  const tickIndices = pickTickIndices(count, Math.max(2, Math.floor(innerW / 84)));

  function linePath(values: Array<number | null>): string {
    let path = "";
    let drawing = false;
    values.forEach((value, index) => {
      if (value === null) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${toX(index).toFixed(1)},${toY(value).toFixed(1)}`;
      drawing = true;
    });
    return path;
  }

  function handlePointer(event: React.PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - rect.left) / Math.max(1, rect.width);
    setActive(Math.min(count - 1, Math.max(0, Math.floor(relative * count))));
  }

  if (count === 0 || allValues.length === 0) {
    return <p className="chart-empty">No data to plot yet.</p>;
  }

  const tooltipRows: TooltipRow[] =
    activeIndex === null
      ? []
      : [
          ...series
            .filter((serie) => serie.values[activeIndex] !== null && serie.values[activeIndex] !== undefined)
            .map((serie) => ({ label: serie.label, value: formatValue(serie.values[activeIndex] as number), color: serie.color })),
          ...(tooltipExtras ? tooltipExtras(activeIndex) : []),
        ];

  return (
    <div className="chart">
      {showLegend && <ChartLegend items={series.map((serie) => ({ label: serie.label, color: serie.color }))} />}
      <div className="chart-canvas" ref={containerRef}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={(event) => handleChartKey(event, activeIndex, count, setActive)}
          onBlur={() => setActive(null)}
        >
          {bands.map((band) => {
            const top = toYRaw(Math.min(domainMax, band.to));
            const bottom = toYRaw(Math.max(domainMin, band.from));
            return bottom > top ? (
              <rect key={`${band.from}-${band.to}`} x={padLeft} y={top} width={innerW} height={bottom - top} style={{ fill: band.color }} opacity={0.12} />
            ) : null;
          })}

          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={padLeft} x2={padLeft + innerW} y1={toY(tick)} y2={toY(tick)} />
              <text className="chart-tick" x={padLeft - 8} y={toY(tick) + 4} textAnchor="end">
                {formatY(tick)}
              </text>
            </g>
          ))}

          {refLines.map((line) => (
            <g key={line.label}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={toY(line.value)}
                y2={toY(line.value)}
                style={{ stroke: line.color }}
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            </g>
          ))}

          <line className="chart-axis" x1={padLeft} x2={padLeft + innerW} y1={padTop + innerH} y2={padTop + innerH} />

          {tickIndices.map((index) => (
            <text key={index} className="chart-tick" x={toX(index)} y={padTop + innerH + 18} textAnchor="middle">
              {xLabels[index]}
            </text>
          ))}
          {xAxisLabel && (
            <text className="chart-axis-label" x={padLeft + innerW / 2} y={height - 6} textAnchor="middle">
              {xAxisLabel}
            </text>
          )}

          {area && series.length === 1 && (
            <path
              d={`${linePath(series[0].values)}L${toX(count - 1)},${padTop + innerH}L${toX(series[0].values.findIndex((value) => value !== null))},${padTop + innerH}Z`}
              style={{ fill: series[0].color }}
              opacity={0.1}
            />
          )}

          {series.map((serie) => (
            <path key={serie.id} d={linePath(serie.values)} fill="none" style={{ stroke: serie.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {endLabels &&
            series.map((serie) => {
              const lastIndex = serie.values.findLastIndex((value) => value !== null);
              if (lastIndex < 0) return null;
              const value = serie.values[lastIndex] as number;
              return (
                <g key={`end-${serie.id}`}>
                  <circle cx={toX(lastIndex)} cy={toY(value)} r={4.5} className="chart-dot" style={{ fill: serie.color }} />
                  <text className="chart-end-label" x={toX(lastIndex) + 9} y={toY(value) + 4}>
                    {formatValue(value)}
                  </text>
                </g>
              );
            })}

          {activeIndex !== null && (
            <g pointerEvents="none">
              <line className="chart-crosshair" x1={toX(activeIndex)} x2={toX(activeIndex)} y1={padTop} y2={padTop + innerH} />
              {series.map((serie) => {
                const value = serie.values[activeIndex];
                return value === null || value === undefined ? null : (
                  <circle key={serie.id} cx={toX(activeIndex)} cy={toY(value)} r={4.5} className="chart-dot" style={{ fill: serie.color }} />
                );
              })}
            </g>
          )}

          <rect
            x={padLeft}
            y={padTop}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {activeIndex !== null && tooltipRows.length > 0 && (
          <ChartTooltip
            x={toX(activeIndex)}
            y={padTop}
            containerWidth={width}
            title={xTitles?.[activeIndex] ?? xLabels[activeIndex]}
            rows={tooltipRows}
          />
        )}
      </div>
    </div>
  );
}
