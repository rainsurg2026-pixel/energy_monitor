import React from "react";
import { formatNumber2 } from "../utils/numberFormatBridge";

export interface TrendLineSeries { name: string; color: string; values: Array<number | null>; }
interface TrendLineChartProps { labels: string[]; series: TrendLineSeries[]; unit: string; height?: number; }

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

export default function TrendLineChart({ labels, series, unit, height = 360 }: TrendLineChartProps) {
  const width = Math.max(1200, labels.length * 80);
  const left = 78, right = 24, top = 32, bottom = 68;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  if (values.length === 0) return <div className="h-48 flex items-center justify-center text-base text-slate-400">No valid {unit} values are available.</div>;
  const min = Math.min(...values, 0), max = Math.max(...values, 0), range = max - min || 1;
  // Keep one category slot of breathing room on both sides so the first
  // month does not sit directly on the Y axis and the last label is not
  // clipped by the chart edge.
  const x = (index: number) => left + (labels.length <= 1 ? plotWidth / 2 : (index + 1) / (labels.length + 1) * plotWidth);
  const y = (value: number) => top + (max - value) / range * plotHeight;
  return <div className="trend-line-chart w-full overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className={`${labels.length > 6 ? "min-w-[720px] sm:min-w-[1080px]" : "min-w-0 sm:min-w-[1080px]"} w-full text-xs`} role="img" aria-label={`${unit} trend`}>
    <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="currentColor" className="text-slate-400" strokeWidth="1" />
    <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="currentColor" className="text-slate-400" strokeWidth="1" />
    {[0, 1, 2, 3, 4].map(step => { const value = max - range * step / 4; const yy = y(value); return <text key={step} x={left - 8} y={yy + 4} textAnchor="end" className="fill-slate-300">{formatNumber2(value)}</text>; })}
    {series.map((item, seriesIndex) => <g key={item.name}><path d={pathFor(item.values, x, y)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{item.values.map((value, index) => value === null || !Number.isFinite(value) ? null : <g key={index}><circle cx={x(index)} cy={y(value)} r="3.5" fill="currentColor" className="text-slate-50" stroke={item.color} strokeWidth="1.5"/><text x={x(index)} y={y(value) - 10 - (seriesIndex % 2) * 13} textAnchor="middle" className="fill-slate-200">{formatNumber2(value)}</text></g>)}</g>)}
    {labels.map((label, index) => <text key={label + index} x={x(index)} y={height - 38} textAnchor="middle" className="fill-slate-300">{label}</text>)}
  </svg><div className="flex flex-wrap gap-5 mt-3 text-sm text-slate-300">{series.map(item => <span key={item.name} className="inline-flex items-center gap-2"><i className="w-4 h-1.5 rounded" style={{ backgroundColor: item.color }} />{item.name}</span>)}<span className="ml-auto font-medium">{unit}</span></div></div>;
}
