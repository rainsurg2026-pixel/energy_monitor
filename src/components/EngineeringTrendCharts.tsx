import { useMemo } from "react";
import { Banknote, BatteryCharging, CircuitBoard, Gauge, Snowflake, Zap, type LucideIcon } from "lucide-react";
import { useReport } from "../ReportContext";
import type { MonthlyLog } from "../types";
import { formatMonthYear } from "../utils";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { shiftMonth } from "../utils/monthUtils";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import { availableMonthsForTrendRange } from "../utils/trendRange";
import TrendLineChart from "./TrendLineChart";
import TrendRangeSelector from "./TrendRangeSelector";

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

type TrendMetricKey = "floorCost" | "totalEnergy" | "averageRate" | "upsEnergy" | "airEnergy" | "dcEnergy";

const CHARTS: ReadonlyArray<{
  id: string;
  title: string;
  unit: string;
  color: string;
  key: TrendMetricKey;
  subtitle: string;
  icon: LucideIcon;
}> = [
  { id: "floor-cost", title: "4th Floor Estimated Cost", unit: "THB", color: "#10b981", key: "floorCost", subtitle: "Estimated monthly electricity cost", icon: Banknote },
  { id: "total-energy", title: "4th Floor Total Energy", unit: "kWh", color: "#3b82f6", key: "totalEnergy", subtitle: "Total monthly energy load", icon: Zap },
  { id: "average-rate", title: "Average Electricity Rate", unit: "THB/kWh", color: "#f59e0b", key: "averageRate", subtitle: "Building average electricity rate", icon: Gauge },
  { id: "ups-energy", title: "UPS Energy", unit: "kWh", color: "#6366f1", key: "upsEnergy", subtitle: "UPS energy contribution", icon: BatteryCharging },
  { id: "air-energy", title: "Air Conditioning Energy", unit: "kWh", color: "#06b6d4", key: "airEnergy", subtitle: "Cooling energy contribution", icon: Snowflake },
  { id: "dc-energy", title: "DC Power Energy", unit: "kWh", color: "#8b5cf6", key: "dcEnergy", subtitle: "DC distribution energy contribution", icon: CircuitBoard },
];

function deltaPercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0 || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

export default function EngineeringTrendCharts({ logs, lang, selectedMonth: selectedMonthProp, layout = "desktop" }: EngineeringTrendChartsProps) {
  const { selectedYear, selectedPeriod, selectedTrend, setSelectedTrend } = useReport();

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
  const containerClass = layout === "desktop" ? "space-y-4" : "space-y-3";
  const cardClass = layout === "desktop" ? "p-6" : "p-4";
  const chartHeight = layout === "desktop" ? 330 : 240;

  return <section className="space-y-3" data-testid="executive-engineering-trend-charts">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-base font-bold text-slate-100">{lang === "th" ? "แนวโน้มพลังงานและค่าใช้จ่าย" : "Energy & Cost Trends"}</h2><p className="mt-1 text-xs text-slate-500">{rangeLabel} · {trendData[0]?.label} → {trendData.at(-1)?.label}</p></div>
      <TrendRangeSelector value={selectedTrend} onChange={setSelectedTrend} compact={layout === "mobile"} />
    </div>
    <div className={containerClass}>
      {CHARTS.map(chart => {
        const currentValue = current?.[chart.key] ?? null;
        const previousValue = previous?.[chart.key] ?? null;
        const delta = deltaPercent(currentValue, previousValue);
        const Icon = chart.icon;
        return <article key={chart.id} className={`trend-chart-card min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 shadow-sm ${cardClass}`} data-testid={`executive-trend-${chart.id}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 inline-flex shrink-0 items-center justify-center rounded-xl border ${layout === "desktop" ? "h-10 w-10" : "h-8 w-8"}`} style={{ color: chart.color, borderColor: `${chart.color}55`, backgroundColor: `${chart.color}16` }}><Icon className={layout === "desktop" ? "h-5 w-5" : "h-4 w-4"} /></span>
              <div className="min-w-0"><h3 className={`truncate font-bold text-slate-100 ${layout === "desktop" ? "text-lg" : "text-sm"}`}>{chart.title}</h3><p className={`mt-1 text-slate-400 ${layout === "desktop" ? "text-xs" : "text-[10px]"}`}>{chart.subtitle} · {rangeLabel}</p></div>
            </div>
            <div className="shrink-0 text-right"><p className={`font-mono font-black text-slate-100 ${layout === "desktop" ? "text-xl" : "text-sm"}`}>{currentValue === null ? "—" : formatNumber2(currentValue)}</p><p className={`mt-0.5 text-slate-500 ${layout === "desktop" ? "text-xs" : "text-[9px]"}`}>{chart.unit}</p>{delta !== null && <p className={`mt-1 font-bold ${layout === "desktop" ? "text-xs" : "text-[9px]"} ${delta > 0 ? "text-amber-300" : delta < 0 ? "text-emerald-300" : "text-slate-400"}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {formatNumber2(Math.abs(delta))}%</p>}</div>
          </div>
          <div className={layout === "desktop" ? "mt-4" : "mt-3"}><TrendLineChart labels={trendData.map(point => point.label)} unit={chart.unit} height={chartHeight} compact={layout === "mobile"} series={[{ name: chart.title, color: chart.color, values: trendData.map(point => point[chart.key]) }]} /></div>
        </article>;
      })}
    </div>
  </section>;
}
