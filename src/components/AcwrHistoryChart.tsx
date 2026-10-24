import type { HistoryPoint } from "../domain/loadCalculator";

export function AcwrHistoryChart({
  points,
  lowThreshold,
  highThreshold,
  targetAcwr,
}: {
  points: HistoryPoint[];
  lowThreshold: number;
  highThreshold: number;
  targetAcwr: number;
}) {
  const width = 600;
  const height = 220;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 48;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const maxAcwr = Math.max(2, ...points.map((p) => p.acwr)) * 1.05;
  const toX = (i: number) => padL + (i / (points.length - 1)) * chartW;
  const toY = (v: number) => padT + chartH - (v / maxAcwr) * chartH;

  const acwrLine = points.map((p, i) => `${toX(i)},${toY(p.acwr)}`).join(" ");

  // X-axis date ticks: show ~5 labels
  const tickIndices: number[] = [];
  const step = Math.max(1, Math.floor(points.length / 5));
  for (let i = 0; i < points.length; i += step) tickIndices.push(i);
  if (tickIndices[tickIndices.length - 1] !== points.length - 1) tickIndices.push(points.length - 1);

  // Y-axis ticks: 0, 0.5, 1.0, 1.5, 2.0 (up to maxAcwr)
  const yTicks = [0, 0.5, 1.0, 1.5, 2.0].filter((v) => v <= maxAcwr);

  return (
    <svg className="acwr-history-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ACWR history">
      {/* Zone bands - draw from bottom to top */}
      {/* Low zone (below low threshold) */}
      <rect x={padL} y={toY(lowThreshold)} width={chartW} height={Math.max(0, padT + chartH - toY(lowThreshold))} fill="#f59e0b" opacity="0.10" />
      {/* Green zone (between thresholds) */}
      <rect x={padL} y={toY(highThreshold)} width={chartW} height={Math.max(0, toY(lowThreshold) - toY(highThreshold))} fill="#22c55e" opacity="0.12" />
      {/* High zone (above high threshold) */}
      <rect x={padL} y={padT} width={chartW} height={Math.max(0, toY(highThreshold) - padT)} fill="#ef4444" opacity="0.10" />
      {/* Grid + threshold lines */}
      {yTicks.map((v) => (
        <line key={v} x1={padL} y1={toY(v)} x2={padL + chartW} y2={toY(v)} stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      ))}
      <line x1={padL} y1={toY(lowThreshold)} x2={padL + chartW} y2={toY(lowThreshold)} stroke="#f59e0b" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="4,3" />
      <line x1={padL} y1={toY(highThreshold)} x2={padL + chartW} y2={toY(highThreshold)} stroke="#ef4444" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="4,3" />
      <line x1={padL} y1={toY(targetAcwr)} x2={padL + chartW} y2={toY(targetAcwr)} stroke="#3b82f6" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="6,3" />
      {/* Axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      <line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      {/* Y ticks */}
      {yTicks.map((v) => (
        <text key={v} x={padL - 6} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">{v.toFixed(1)}</text>
      ))}
      {/* X ticks */}
      {tickIndices.map((i) => (
        <text key={i} x={toX(i)} y={padT + chartH + 14} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">
          {points[i].date.slice(5)}
        </text>
      ))}
      {/* ACWR line */}
      <polyline points={acwrLine} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots for each session */}
      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.acwr)} r="3" fill="#6366f1" opacity="0.75" />
      ))}
      {/* Axis labels */}
      <text x={padL + chartW / 2} y={height - 4} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7">Date</text>
      <text x={10} y={padT + chartH / 2} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7"
        transform={`rotate(-90, 10, ${padT + chartH / 2})`}>ACWR</text>
      {/* Legend */}
      <line x1={padL + chartW - 110} y1={12} x2={padL + chartW - 95} y2={12} stroke="#6366f1" strokeWidth="2" />
      <text x={padL + chartW - 92} y={16} fontSize="9" fill="currentColor" opacity="0.7">ACWR</text>
      <line x1={padL + chartW - 60} y1={12} x2={padL + chartW - 45} y2={12} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,2" />
      <text x={padL + chartW - 42} y={16} fontSize="9" fill="currentColor" opacity="0.7">Target</text>
    </svg>
  );
}
