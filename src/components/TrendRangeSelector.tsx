import { TREND_RANGE_OPTIONS, type TrendRange } from "../utils/trendRange";

interface Props {
  value: TrendRange;
  onChange: (value: TrendRange) => void;
  compact?: boolean;
}

const SHORT_LABELS: Record<TrendRange, string> = {
  "Last 3 Months": "3M",
  "Last 6 Months": "6M",
  "Last 12 Months": "12M",
  All: "All",
};

export default function TrendRangeSelector({ value, onChange, compact = false }: Props) {
  return <div className={`inline-flex items-center rounded-xl border border-slate-700/80 bg-slate-950/60 p-1 ${compact ? "gap-0.5" : "gap-1"}`} aria-label="Trend range">
    {TREND_RANGE_OPTIONS.map(option => <button
      key={option}
      type="button"
      onClick={() => onChange(option)}
      aria-pressed={value === option}
      className={`rounded-lg font-bold transition ${compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"} ${value === option ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/30" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}
    >{SHORT_LABELS[option]}</button>)}
  </div>;
}
