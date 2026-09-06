import { useMemo } from "react";
import { useReport } from "../ReportContext";
import type { MonthlyLog } from "../types";
import { formatMonthYear } from "../utils";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { shiftMonth } from "../utils/monthUtils";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import { availableMonthsForTrendRange } from "../utils/trendRange";
import TrendLineChart from "./TrendLineChart";

interface EngineeringTrendChartsProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
  selectedMonth?: string;
  layout?: "desktop" | "mobile";
}

interface EngineeringTrendPoint {
  month: string;
  label: string;
  totalEnergy: number | null;
  upsEnergy: number | null;
  airEnergy: number | null;
  dcEnergy: number | null;
  floorCost: number | null;
  averageRate: number | null;
}

const CHARTS = [
  { id: "floor-cost", title: "4th Floor Estimated Cost", unit: "THB", color: "#10b981", key: "floorCost" as const, subtitle: "Estimated cost" },
  { id: "total-energy", title: "4th Floor Total Energy", unit: "kWh", color: "#6366f1", key: "totalEnergy" as const, subtitle: "Total monthly load" },
  { id: "average-rate", title: "Average Electricity Rate", unit: "THB/kWh", color: "#3b82f6", key: "averageRate" as const, subtitle: "Building average rate" },
  { id: "ups-energy", title: "UPS Energy", unit: "kWh", color: "#4f46e5", key: "upsEnergy" as const, subtitle: "UPS contribution" },
  { id: "air-energy", title: "Air Conditioning Energy", unit: "kWh", color: "#14b8a6", key: "airEnergy" as const, subtitle: "Cooling contribution" },
  { id: "dc-energy", title: "DC Power Energy", unit: "kWh", color: "#64748b", key: "dcEnergy" as const, subtitle: "DC panel contribution" },
] as const;

function deltaPercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0 || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

export default function EngineeringTrendCharts({ logs, lang, selectedMonth: selectedMonthProp, layout = "desktop" }: EngineeringTrendChartsProps) {
  const { selectedYear, selectedPeriod, selectedTrend } = useReport();

  const processed = useMemo<EngineeringTrendPoint[]>(() => [...logs].sort((a, b) => a.month.localeCompare(b.month)).map(log => {
    const energy = calculateEnergyCostForMonth(logs, log.month);
    return {
      month: log.month,
      label: formatMonthYear(log.month),
      totalEnergy: energy.floorEnergyKwh,
      upsEnergy: energy.upsEnergyKwh,
      airEnergy: energy.airEnergyKwh,
      dcEnergy: energy.dcEnergyKwh,
      floorCost: energy.floorElectricityCostThb,
      averageRate: energy.averageElectricityRateThbPerKwh,
    };
  }), [logs]);

  const anchorMonth = selectedMonthProp ?? (processed.length ? selectedDashboardMonth(processed, selectedYear, selectedPeriod, processed.at(-1)!.month) : "");
  const trendData = useMemo(() => {
    if (!anchorMonth || processed.length === 0) return [];
    const months = new Set(availableMonthsForTrendRange(processed.map(row => row.month), anchorMonth, selectedTrend));
    return processed.filter(row => months.has(row.month));
  }, [anchorMonth, processed, selectedTrend]);
  const current = processed.find(row => row.month === anchorMonth) ?? null;
  const previous = processed.find(row => row.month === shiftMonth(anchorMonth, -1)) ?? null;

  if (trendData.length === 0) {
    return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400" data-testid="executive-engineering-trend-charts">{lang === "th" ? "ไม่มีข้อมูลสำหรับสร้างกราฟแนวโน้ม" : "No logs available to generate trend charts."}</div>;
  }

  const rangeLabel = lang === "th" ? selectedTrend.replace("Last", "ย้อนหลัง") : selectedTrend;
  const containerClass = layout === "desktop" ? "grid grid-cols-2 gap-4" : "space-y-3";
  const cardClass = layout === "desktop" ? "p-5" : "p-4";
  const chartHeight = layout === "desktop" ? 280 : 240;

  return <section className="space-y-3" data-testid="executive-engineering-trend-charts">
    <div className="flex items-end justify-between gap-3">
      <div><h2 className="font-display text-base font-bold text-slate-100">{lang === "th" ? "แนวโน้มพลังงานและค่าใช้จ่าย" : "Energy & Cost Trends"}</h2><p className="mt-1 text-xs text-slate-500">{rangeLabel} · {trendData[0]?.label} → {trendData.at(-1)?.label}</p></div>
    </div>
    <div className={containerClass}>
      {CHARTS.map(chart => {
        const currentValue = current?.[chart.key] ?? null;
        const previousValue = previous?.[chart.key] ?? null;
        const delta = deltaPercent(currentValue, previousValue);
        return <article key={chart.id} className={`trend-chart-card min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 shadow-sm ${cardClass}`} data-testid={`executive-trend-${chart.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h3 className="truncate text-sm font-bold text-slate-100">{chart.title}</h3><p className="mt-1 text-[10px] text-slate-500">{chart.subtitle} · {rangeLabel}</p></div>
            <div className="shrink-0 text-right"><p className="font-mono text-sm font-black text-slate-100">{currentValue === null ? "—" : formatNumber2(currentValue)}</p><p className="mt-0.5 text-[9px] text-slate-500">{chart.unit}</p>{delta !== null && <p className={`mt-1 text-[9px] font-bold ${delta > 0 ? "text-amber-300" : delta < 0 ? "text-emerald-300" : "text-slate-400"}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {formatNumber2(Math.abs(delta))}%</p>}</div>
          </div>
          <div className="mt-3"><TrendLineChart labels={trendData.map(point => point.label)} unit={chart.unit} height={chartHeight} compact={layout === "mobile"} series={[{ name: chart.title, color: chart.color, values: trendData.map(point => point[chart.key]) }]} /></div>
        </article>;
      })}
    </div>
  </section>;
}
