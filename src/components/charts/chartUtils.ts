import { useEffect, useRef, useState } from "react";

/** Shared horizontal padding so stacked charts (line + columns) line up on the same x positions. */
export const CHART_PAD_LEFT = 46;
export const CHART_PAD_RIGHT = 16;

/** Track an element's rendered width so charts draw at real pixel size (crisp text, no viewBox scaling). */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Round, evenly spaced axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, targetCount = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) max = min + 1;

  const rawStep = (max - min) / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rawStep) ?? rawStep;

  // Start at or below min and end at or above max, so no data is clipped by the axis.
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let index = first; index <= last; index++) {
    ticks.push(Number((index * step).toFixed(10)));
  }
  return ticks;
}

/** Compact number formatting for axes: 950, 1.2K, 3.4M. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e15) return value.toExponential(0).replace("e+", "e");
  if (abs >= 1e12) return `${(value / 1e12).toFixed(abs >= 1e13 ? 0 : 1).replace(/\.0$/, "")}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  if (abs > 0 && abs < 10) return value.toFixed(abs < 1 ? 2 : 1).replace(/\.0+$/, "");
  return value.toFixed(0);
}

/** Indices for ~`maxLabels` evenly spaced x labels, always including the last one. */
export function pickTickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);

  const step = Math.ceil((count - 1) / Math.max(1, maxLabels - 1));
  const indices: number[] = [];
  for (let index = 0; index < count; index += step) indices.push(index);
  const last = count - 1;
  // Drop a label crowding the final one, then always show the final one.
  if (indices.length > 1 && last - indices[indices.length - 1] < step * 0.6) indices.pop();
  indices.push(last);
  return indices;
}

/** Column path with a 4px rounded data end and a square baseline. */
export function columnPath(x: number, width: number, top: number, baseline: number): string {
  const height = baseline - top;
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return [
    `M${x},${baseline}`,
    `V${top + radius}`,
    `Q${x},${top} ${x + radius},${top}`,
    `H${x + width - radius}`,
    `Q${x + width},${top} ${x + width},${top + radius}`,
    `V${baseline}`,
    "Z",
  ].join(" ");
}

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function formatShortDate(isoDate: string): string {
  return SHORT_DATE.format(new Date(`${isoDate}T12:00:00`));
}

export function formatLongDate(isoDate: string): string {
  return LONG_DATE.format(new Date(`${isoDate}T12:00:00`));
}

/** Keyboard stepping shared by charts: arrows move the active index, Escape clears it. */
export function handleChartKey(
  event: React.KeyboardEvent,
  activeIndex: number | null,
  count: number,
  setActive: (index: number | null) => void,
): void {
  if (count === 0) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const start = activeIndex ?? (delta > 0 ? -1 : count);
    setActive(Math.min(count - 1, Math.max(0, start + delta)));
  } else if (event.key === "Home") {
    setActive(0);
  } else if (event.key === "End") {
    setActive(count - 1);
  } else if (event.key === "Escape") {
    setActive(null);
  }
}
