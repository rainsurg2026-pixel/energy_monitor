import React from "react";

export interface TrendLineSeries { name: string; color: string; values: Array<number | null>; }
interface TrendLineChartProps { labels: string[]; series: TrendLineSeries[]; unit: string; height?: number; compact?: boolean; }

function pathFor(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { open = false; return; }
    path += `${open ? " L" : "M"} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    open = true;
  });
  return path;
}

/** Compact chart labels keep the exact KPI/header values untouched while
 * making dense plot labels readable on mobile and printable exports. */
export function formatCompactChartValue(value: number): string {
  const absolute = Math.abs(value);
  const scaled = (divisor: number, suffix: string) => `${(value / divisor).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${suffix}`;
  if (absolute >= 1_000_000_000) return scaled(1_000_000_000, "B");
  if (absolute >= 1_000_000) return scaled(1_000_000, "M");
  if (absolute >= 1_000) return scaled(1_000, "K");
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function finiteValue(series: TrendLineSeries, index: number): number | null {
  const value = series.values[index];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** If multiple series land close together at the same month, stagger their
 * labels above/below the lines instead of stacking text in one position. */
function pointLabelYs(
  series: TrendLineSeries[],
  pointIndex: number,
  y: (value: number) => number,
  top: number,
  bottomY: number,
): Array<number | null> {
  const collisionThreshold = 36;
  const minimumLabelGap = 20;
  const upperLimit = Math.max(14, top - 22);
  const lowerLimit = bottomY - 8;
  const entries = series
    .map((item, seriesIndex) => {
      const value = finiteValue(item, pointIndex);
      return value === null ? null : { seriesIndex, pointY: y(value) };
    })
    .filter((item): item is { seriesIndex: number; pointY: number } => item !== null);

  const desired = entries.map(entry => {
    const nearby = entries
      .filter(candidate => Math.abs(candidate.pointY - entry.pointY) < collisionThreshold)
      .sort((left, right) => left.seriesIndex - right.seriesIndex);
    const rank = Math.max(0, nearby.findIndex(candidate => candidate.seriesIndex === entry.seriesIndex));
    const tier = Math.floor(rank / 2);
    const offset = nearby.length > 1 ? (rank % 2 === 0 ? -(24 + tier * 20) : 30 + tier * 20) : -20;
    return { ...entry, labelY: Math.max(upperLimit, Math.min(lowerLimit, entry.pointY + offset)) };
  });

  // Resolve collisions after above/below placement. This catches cases where a
  // label moved below one line meets a label moved above a distant line.
  const ordered = [...desired].sort((left, right) => left.labelY - right.labelY);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].labelY < ordered[index - 1].labelY + minimumLabelGap) {
      ordered[index].labelY = ordered[index - 1].labelY + minimumLabelGap;
    }
  }
  if (ordered.length && ordered.at(-1)!.labelY > lowerLimit) {
    const overflow = ordered.at(-1)!.labelY - lowerLimit;
    ordered.forEach(item => { item.labelY -= overflow; });
  }
  if (ordered.length && ordered[0].labelY < upperLimit) {
    const underflow = upperLimit - ordered[0].labelY;
    ordered.forEach(item => { item.labelY += underflow; });
  }

  const result: Array<number | null> = Array(series.length).fill(null);
  ordered.forEach(item => { result[item.seriesIndex] = item.labelY; });
  return result;
}

export default function TrendLineChart({ labels, series, unit, height = 360, compact = false }: TrendLineChartProps) {
  const width = compact ? Math.max(640, labels.length * 90) : Math.max(1200, labels.length * 80);
  const left = compact ? 64 : 78, right = 24, top = compact ? 46 : 36, bottom = 68;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  if (values.length === 0) return <div className="h-48 flex items-center justify-center text-base text-slate-400">No valid {unit} values are available.</div>;
  const min = Math.min(...values, 0), max = Math.max(...values, 0), range = max - min || 1;
  const x = (index: number) => left + (labels.length <= 1 ? plotWidth / 2 : (index + 1) / (labels.length + 1) * plotWidth);
  const y = (value: number) => top + (max - value) / range * plotHeight;
  const bottomY = height - bottom;
  const labelYsByPoint = labels.map((_, pointIndex) => pointLabelYs(series, pointIndex, y, top, bottomY));

  const svgMinWidth = labels.length > 6 ? (compact ? Math.max(720, labels.length * 88) : Math.max(1080, labels.length * 80)) : undefined;
  return <div className="trend-line-chart w-full overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full text-xs" style={svgMinWidth ? { minWidth: `${svgMinWidth}px` } : undefined} role="img" aria-label={`${unit} trend`}>
    <line x1={left} y1={top} x2={left} y2={bottomY} stroke="currentColor" className="text-slate-400" strokeWidth="1" />
    <line x1={left} y1={bottomY} x2={width - right} y2={bottomY} stroke="currentColor" className="text-slate-400" strokeWidth="1" />
    {[0, 1, 2, 3, 4].map(step => { const value = max - range * step / 4; const yy = y(value); return <text key={step} x={left - 8} y={yy + 4} textAnchor="end" className="fill-slate-300">{formatCompactChartValue(value)}</text>; })}
    {series.map((item, seriesIndex) => <g key={item.name}>
      <path d={pathFor(item.values, x, y)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {item.values.map((value, index) => {
        if (value === null || !Number.isFinite(value)) return null;
        const pointY = y(value);
        const labelY = labelYsByPoint[index]?.[seriesIndex] ?? Math.max(14, pointY - 20);
        return <g key={index}>
          <circle cx={x(index)} cy={pointY} r="3.5" fill="currentColor" className="text-slate-50" stroke={item.color} strokeWidth="1.5"/>
          <text x={x(index)} y={labelY} textAnchor="middle" className="fill-slate-200" data-chart-point-label="true">{formatCompactChartValue(value)}</text>
        </g>;
      })}
    </g>)}
    {labels.map((label, index) => <text key={label + index} x={x(index)} y={height - 38} textAnchor="middle" className="fill-slate-300">{label}</text>)}
  </svg><div className="flex flex-wrap gap-5 mt-3 text-sm text-slate-300">{series.map(item => <span key={item.name} className="inline-flex items-center gap-2"><i className="w-4 h-1.5 rounded" style={{ backgroundColor: item.color }} />{item.name}</span>)}<span className="ml-auto font-medium">{unit}</span></div></div>;
}
