import { useState } from "react";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import {
  CHART_PAD_LEFT,
  CHART_PAD_RIGHT,
  columnPath,
  formatCompact,
  handleChartKey,
  niceTicks,
  pickTickIndices,
  useMeasuredWidth,
} from "./chartUtils";

interface ColumnChartProps {
  ariaLabel: string;
  labels: string[];
  titles?: string[];
  values: number[];
  color: string;
  seriesLabel: string;
  height?: number;
  formatValue?: (value: number) => string;
  /** Print the value on each column cap. Defaults to on for ≤ 12 columns. */
  valueLabels?: boolean;
  tooltipExtras?: (index: number) => TooltipRow[];
  /** Off when a chart above already shows the readout for the shared active index. */
  showTooltip?: boolean;
  /** Match a LineChart drawn above with end labels so x positions line up. */
  padRight?: number;
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
}

export function ColumnChart({
  ariaLabel,
  labels,
  titles,
  values,
  color,
  seriesLabel,
  height = 200,
  formatValue = (value) => formatCompact(value),
  valueLabels,
  tooltipExtras,
  showTooltip = true,
  padRight = CHART_PAD_RIGHT,
  activeIndex: controlledIndex,
  onActiveIndexChange,
}: ColumnChartProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const activeIndex = controlledIndex !== undefined ? controlledIndex : localIndex;
  const setActive = (index: number | null) => {
    if (onActiveIndexChange) onActiveIndexChange(index);
    else setLocalIndex(index);
  };

  const count = values.length;
  const showValues = valueLabels ?? count <= 12;
  const padTop = showValues ? 22 : 10;
  const padBottom = 26;
  const padLeft = CHART_PAD_LEFT;
  const innerW = Math.max(10, width - padLeft - padRight);
  const innerH = height - padTop - padBottom;

  const ticks = niceTicks(0, Math.max(...values, 1), 3);
  const domainMax = ticks[ticks.length - 1];
  const baseline = padTop + innerH;
  const slot = innerW / Math.max(1, count);
  // Columns cap at 24px and keep a 2px surface gap to their neighbours.
  const barWidth = Math.max(1, Math.min(24, slot - 2));
  const toY = (value: number) => baseline - (value / domainMax) * innerH;
  const tickIndices = pickTickIndices(count, Math.max(2, Math.floor(innerW / 84)));

  if (count === 0) {
    return <p className="chart-empty">No data to plot yet.</p>;
  }

  return (
    <div className="chart">
      <div className="chart-canvas" ref={containerRef}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={(event) => handleChartKey(event, activeIndex, count, setActive)}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={padLeft} x2={padLeft + innerW} y1={toY(tick)} y2={toY(tick)} />
              <text className="chart-tick" x={padLeft - 8} y={toY(tick) + 4} textAnchor="end">
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          {values.map((value, index) => {
            const x = padLeft + index * slot + (slot - barWidth) / 2;
            const isActive = activeIndex === index;
            return (
              <g key={index}>
                <path
                  d={columnPath(x, barWidth, toY(value), baseline)}
                  style={{ fill: color }}
                  opacity={activeIndex === null || isActive ? 1 : 0.55}
                />
                {showValues && value > 0 && (
                  <text className="chart-value-label" x={x + barWidth / 2} y={toY(value) - 6} textAnchor="middle">
                    {formatValue(value)}
                  </text>
                )}
                {/* Hit target spans the whole slot, not just the painted column. */}
                <rect
                  x={padLeft + index * slot}
                  y={padTop}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={() => setActive(index)}
                />
              </g>
            );
          })}

          <line className="chart-axis" x1={padLeft} x2={padLeft + innerW} y1={baseline} y2={baseline} />
          {tickIndices.map((index) => (
            <text key={index} className="chart-tick" x={padLeft + (index + 0.5) * slot} y={baseline + 18} textAnchor="middle">
              {labels[index]}
            </text>
          ))}
        </svg>

        {showTooltip && activeIndex !== null && (
          <ChartTooltip
            x={padLeft + (activeIndex + 0.5) * slot}
            y={padTop}
            containerWidth={width}
            title={titles?.[activeIndex] ?? labels[activeIndex]}
            rows={[{ label: seriesLabel, value: formatValue(values[activeIndex]), color }, ...(tooltipExtras ? tooltipExtras(activeIndex) : [])]}
          />
        )}
      </div>
    </div>
  );
}
