import { Boxes, ChevronRight, Server } from "lucide-react";
import { useMemo } from "react";
import { useReport } from "../ReportContext";
import { RACK_CAPACITY_HISTORY_TOTAL_ZONE, type RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { formatMonthYear } from "../utils";
import { recentMonthsThroughSelected } from "../utils/historyWindow";
import { formatNumber2 } from "../utils/numberFormatBridge";
import TrendLineChart from "./TrendLineChart";

interface Props {
  selectedMonth: string;
  rackCapacityHistory: RackCapacityHistoryRow[];
  rackUnitCapacity: RackUnitCapacityRow[];
  lang: "th" | "en";
  layout: "desktop" | "mobile";
  onViewRackCapacity?: () => void;
  onViewRackUnitCapacity?: () => void;
}

const TREND_WINDOW_SIZE: Record<string, number> = { "Last 3 Months": 3, "Last 6 Months": 6, "Last 12 Months": 12 };

type Health = { label: string; className: string };
function health(usage: number | null): Health {
  if (usage === null || !Number.isFinite(usage)) return { label: "No data", className: "border-slate-700 bg-slate-800/60 text-slate-400" };
  if (usage >= 0.85) return { label: "High", className: "border-rose-500/30 bg-rose-500/10 text-rose-300" };
  if (usage >= 0.8) return { label: "Attention", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  return { label: "Normal", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
}

function pct(value: number | null): string { return value === null || !Number.isFinite(value) ? "—" : `${formatNumber2(value * 100)}%`; }

function CapacityKpi({ label, value, unit, state, compact }: { label: string; value: string; unit?: string; state?: Health; compact: boolean }) {
  return <article className={`min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 shadow-sm ${compact ? "p-3.5" : "p-5"}`}>
    <div className="flex items-start justify-between gap-2"><p className={`${compact ? "text-[9px]" : "text-[10px]"} font-bold uppercase tracking-[0.1em] text-slate-400`}>{label}</p>{state && <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${state.className}`}>{state.label}</span>}</div>
    <div className={`${compact ? "mt-3" : "mt-4"} flex flex-wrap items-end gap-1.5`}><span className={`font-mono font-black leading-none text-slate-100 ${compact ? "text-xl" : "text-3xl"}`}>{value}</span>{unit && <span className="pb-0.5 text-[10px] font-semibold text-slate-500">{unit}</span>}</div>
  </article>;
}

export default function ExecutiveCapacityOverview({ selectedMonth, rackCapacityHistory, rackUnitCapacity, lang, layout, onViewRackCapacity, onViewRackUnitCapacity }: Props) {
  const { selectedTrend } = useReport();
  const windowSize = TREND_WINDOW_SIZE[selectedTrend] ?? 12;
  const totalRackRows = useMemo(() => rackCapacityHistory.filter(row => row.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE && row.snapshotMonth <= selectedMonth).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth)), [rackCapacityHistory, selectedMonth]);
  const unitRows = useMemo(() => rackUnitCapacity.filter(row => row.month <= selectedMonth).sort((a, b) => a.month.localeCompare(b.month)), [rackUnitCapacity, selectedMonth]);
  const rackCurrent = totalRackRows.find(row => row.snapshotMonth === selectedMonth) ?? null;
  const unitCurrent = unitRows.find(row => row.month === selectedMonth) ?? null;
  const unitUsage = unitCurrent && unitCurrent.totalU > 0 ? unitCurrent.usedU / unitCurrent.totalU : null;
  const rackMonths = new Set(recentMonthsThroughSelected(totalRackRows.map(row => row.snapshotMonth), selectedMonth, windowSize));
  const unitMonths = new Set(recentMonthsThroughSelected(unitRows.map(row => row.month), selectedMonth, windowSize));
  const rackTrend = totalRackRows.filter(row => rackMonths.has(row.snapshotMonth));
  const unitTrend = unitRows.filter(row => unitMonths.has(row.month));
  const compact = layout === "mobile";
  const copy = lang === "th" ? {
    title: "Capacity & Availability", subtitle: "สถานะ Rack และ Rack Unit ของเดือนรายงาน",
    rackUsage: "Rack Usage", availableRack: "Available Racks", unitUsage: "Rack Unit Usage", availableU: "Available U",
    rackTrend: "Rack Capacity Trend", unitTrend: "Rack Unit Capacity Trend", viewRack: "ดู Rack Capacity", viewUnit: "ดู Rack Unit Capacity",
    noTrend: "ยังไม่มีประวัติเพียงพอสำหรับกราฟ"
  } : {
    title: "Capacity & Availability", subtitle: "Rack and rack-unit status for the reporting month.",
    rackUsage: "Rack Usage", availableRack: "Available Racks", unitUsage: "Rack Unit Usage", availableU: "Available U",
    rackTrend: "Rack Capacity Trend", unitTrend: "Rack Unit Capacity Trend", viewRack: "View Rack Capacity", viewUnit: "View Rack Unit Capacity",
    noTrend: "Not enough saved history for this trend."
  };

  return <section className="space-y-3" data-testid={`executive-capacity-${layout}`}>
    <div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-base font-bold text-slate-100">{copy.title}</h2><p className="mt-1 text-xs text-slate-500">{copy.subtitle}</p></div></div>
    <div className={compact ? "grid grid-cols-2 gap-2.5" : "grid grid-cols-4 gap-4"}>
      <CapacityKpi compact={compact} label={copy.rackUsage} value={pct(rackCurrent?.usagePct ?? null)} state={health(rackCurrent?.usagePct ?? null)} />
      <CapacityKpi compact={compact} label={copy.availableRack} value={rackCurrent ? String(rackCurrent.available) : "—"} unit="racks" />
      <CapacityKpi compact={compact} label={copy.unitUsage} value={pct(unitUsage)} state={health(unitUsage)} />
      <CapacityKpi compact={compact} label={copy.availableU} value={unitCurrent ? formatNumber2(unitCurrent.availableU) : "—"} unit="U" />
    </div>
    <div className={compact ? "space-y-3" : "grid grid-cols-2 gap-4"}>
      <article className={`min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 shadow-sm ${compact ? "p-4" : "p-5"}`}>
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Server className="h-4 w-4 text-teal-400"/><h3 className="text-sm font-bold text-slate-100">{copy.rackTrend}</h3></div>{onViewRackCapacity && <button type="button" onClick={onViewRackCapacity} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-300 hover:text-indigo-200">{copy.viewRack}<ChevronRight className="h-3 w-3"/></button>}</div>
        {rackTrend.length ? <div className="mt-3"><TrendLineChart labels={rackTrend.map(row => formatMonthYear(row.snapshotMonth))} unit="%" height={compact ? 230 : 270} compact={compact} series={[{ name: "Usage %", color: "#6366f1", values: rackTrend.map(row => row.usagePct === null ? null : row.usagePct * 100) }, { name: "Availability %", color: "#14b8a6", values: rackTrend.map(row => row.availabilityPct === null ? null : row.availabilityPct * 100) }]} /></div> : <p className="mt-5 text-sm text-slate-500">{copy.noTrend}</p>}
      </article>
      <article className={`min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 shadow-sm ${compact ? "p-4" : "p-5"}`}>
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Boxes className="h-4 w-4 text-teal-400"/><h3 className="text-sm font-bold text-slate-100">{copy.unitTrend}</h3></div>{onViewRackUnitCapacity && <button type="button" onClick={onViewRackUnitCapacity} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-300 hover:text-indigo-200">{copy.viewUnit}<ChevronRight className="h-3 w-3"/></button>}</div>
        {unitTrend.length ? <div className="mt-3"><TrendLineChart labels={unitTrend.map(row => formatMonthYear(row.month))} unit="U" height={compact ? 230 : 270} compact={compact} series={[{ name: "Total U", color: "#64748b", values: unitTrend.map(row => row.totalU) }, { name: "Used U", color: "#6366f1", values: unitTrend.map(row => row.usedU) }, { name: "Available U", color: "#14b8a6", values: unitTrend.map(row => row.availableU) }]} /></div> : <p className="mt-5 text-sm text-slate-500">{copy.noTrend}</p>}
      </article>
    </div>
  </section>;
}
