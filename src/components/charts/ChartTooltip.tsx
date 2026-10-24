export interface TooltipRow {
  label: string;
  value: string;
  /** Series colour for the short line key; omitted for context rows. */
  color?: string;
}

/** Floating readout: value first and strong, series name secondary. Flips to the left near the right edge. */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  title,
  rows,
}: {
  x: number;
  y: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
}) {
  const flip = x > containerWidth * 0.6;

  return (
    <div
      className="chart-tooltip"
      role="status"
      style={{
        left: x,
        top: y,
        transform: flip ? "translate(calc(-100% - 14px), 0)" : "translate(14px, 0)",
      }}
    >
      <p className="chart-tooltip-title">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="chart-tooltip-row">
          {row.color ? <span className="chart-line-key" style={{ background: row.color }} /> : <span className="chart-line-key empty" />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </p>
      ))}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: "line" | "rect" | "dash";
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`chart-legend-key ${item.kind ?? "line"}`} style={{ background: item.kind === "dash" ? undefined : item.color, borderColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Table twin of a chart, so every value is reachable without hovering. */
export function ChartDataTable({
  columns,
  rows,
  summary = "Show data",
}: {
  columns: string[];
  rows: Array<Array<string | number>>;
  summary?: string;
}) {
  return (
    <details className="chart-data">
      <summary>{summary}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
