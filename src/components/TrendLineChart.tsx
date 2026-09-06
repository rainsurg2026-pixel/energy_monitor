import React from "react";

export interface TrendLineSeries { name: string; color: string; values: Array<number | null>; }
interface TrendLineChartProps { labels: string[]; series: TrendLineSeries[]; unit: string; height?: number; compact?: boolean; minPointSlots?: number; }

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

/** Compact chart labels keep exact KPI/header values untouched while making
 * dense plot labels readable on mobile and printable exports. */
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

/** If multiple series land close together at the same month, stagger labels
 * above/below the lines instead of stacking text in one position. */
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

  const ordered = [...desired].sort((left, right) => left.labelY - right.labelY);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].labelY < ordered[index - 1].labelY + minimumLabelGap) ordered[index].labelY = ordered[index - 1].labelY + minimumLabelGap;
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

export default function TrendLineChart({ labels, series, unit, height = 360, compact = false, minPointSlots = 0 }: TrendLineChartProps) {
  const displayPointCount = Math.max(labels.length, minPointSlots);
  const width = compact ? Math.max(640, displayPointCount * 90) : Math.max(1320, displayPointCount * 90);
  const left = compact ? 64 : 88, right = compact ? 24 : 36, top = compact ? 46 : 48, bottom = compact ? 68 : 72;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  if (values.length === 0) return <div className="h-48 flex items-center justify-center text-base text-slate-400">No valid {unit} values are available.</div>;
  const min = Math.min(...values, 0), max = Math.max(...values, 0), range = max - min || 1;
  const x = (index: number) => left + (labels.length <= 1 ? plotWidth / 2 : (index + 1) / (labels.length + 1) * plotWidth);
  const y = (value: number) => top + (max - value) / range * plotHeight;
  const bottomY = height - bottom;
  const labelYsByPoint = labels.map((_, pointIndex) => pointLabelYs(series, pointIndex, y, top, bottomY));
  const svgMinWidth = displayPointCount > 6 ? (compact ? Math.max(720, displayPointCount * 88) : Math.max(1180, displayPointCount * 92)) : undefined;
  const svgTextClass = compact ? "w-full text-xs" : "w-full text-[13px]";
  const pointLabelClass = compact ? "fill-slate-200 font-medium" : "fill-slate-100 font-semibold";

  return <div className="trend-line-chart w-full overflow-x-auto">
    <svg viewBox={`0 0 ${width} ${height}`} className={svgTextClass} style={svgMinWidth ? { minWidth: `${svgMinWidth}px` } : undefined} role="img" aria-label={`${unit} trend`}>
      {[0, 1, 2, 3, 4].map(step => {
        const value = max - range * step / 4;
        const yy = y(value);
        return <g key={step}>
          <line x1={left} y1={yy} x2={width - right} y2={yy} stroke="currentColor" className="text-slate-700/80" strokeWidth="1" strokeDasharray="5 7" />
          <text x={left - 10} y={yy + 4} textAnchor="end" className="fill-slate-300 font-medium">{formatCompactChartValue(value)}</text>
        </g>;
      })}
      <line x1={left} y1={top} x2={left} y2={bottomY} stroke="currentColor" className="text-slate-400" strokeWidth="1.2" />
      <line x1={left} y1={bottomY} x2={width - right} y2={bottomY} stroke="currentColor" className="text-slate-400" strokeWidth="1.2" />
      {series.map((item, seriesIndex) => <g key={item.name}>
        <path d={pathFor(item.values, x, y)} fill="none" stroke={item.color} strokeWidth={compact ? 2.5 : 3.25} strokeLinecap="round" strokeLinejoin="round"/>
        {item.values.map((value, index) => {
          if (value === null || !Number.isFinite(value)) return null;
          const pointY = y(value);
          const labelY = labelYsByPoint[index]?.[seriesIndex] ?? Math.max(14, pointY - 20);
          return <g key={index}>
            <circle cx={x(index)} cy={pointY} r={compact ? 3.5 : 4.5} fill="#f8fafc" stroke={item.color} strokeWidth={compact ? 1.5 : 2}/>
            <text x={x(index)} y={labelY} textAnchor="middle" className={pointLabelClass} data-chart-point-label="true">{formatCompactChartValue(value)}</text>
          </g>;
        })}
      </g>)}
      {labels.map((label, index) => <text key={label + index} x={x(index)} y={height - 38} textAnchor="middle" className="fill-slate-200 font-medium">{label}</text>)}
    </svg>
    <div className={`mt-3 flex flex-wrap items-center gap-5 text-slate-300 ${compact ? "text-sm" : "text-[15px]"}`}>{series.map(item => <span key={item.name} className="inline-flex items-center gap-2"><i className="h-2 w-5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>)}<span className="ml-auto font-semibold text-slate-400">{unit}</span></div>
  </div>;
}
