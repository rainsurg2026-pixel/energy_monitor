import { useMemo } from "react";
import { useReport } from "../ReportContext";
import type { MonthlyLog } from "../types";
import { formatMonthYear } from "../utils";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import TrendLineChart from "./TrendLineChart";

interface EngineeringTrendChartsProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
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

const TREND_WINDOW_SIZE: Record<string, number> = {
  "Last 3 Months": 3,
  "Last 6 Months": 6,
  "Last 12 Months": 12,
};

const CHARTS = [
  { id: "floor-cost", title: "4th Floor Estimated Cost Trend (THB)", unit: "THB", color: "#10b981", key: "floorCost" as const, description: "Estimated 4th Floor cost at the shared building electricity rate." },
  { id: "total-energy", title: "4th Floor Total Energy Trend (kWh)", unit: "kWh", color: "#6366f1", key: "totalEnergy" as const, description: "Monthly total 4th Floor energy consumption." },
  { id: "average-rate", title: "4th Floor Average Electricity Rate Trend (THB/kWh)", unit: "THB/kWh", color: "#f97316", key: "averageRate" as const, description: "Building electricity cost divided by building energy." },
  { id: "ups-energy", title: "4th Floor UPS Energy Trend (kWh)", unit: "kWh", color: "#3b82f6", key: "upsEnergy" as const, description: "Monthly UPS system energy utilization." },
  { id: "air-energy", title: "4th Floor Air Conditioning Energy Trend (kWh)", unit: "kWh", color: "#14b8a6", key: "airEnergy" as const, description: "Monthly air-conditioning meter-difference energy." },
  { id: "dc-energy", title: "4th Floor DC Power Energy Trend (kWh)", unit: "kWh", color: "#f59e0b", key: "dcEnergy" as const, description: "Monthly DC power panel energy estimate." },
] as const;

export default function EngineeringTrendCharts({ logs, lang }: EngineeringTrendChartsProps) {
  const { selectedYear, selectedPeriod, selectedTrend } = useReport();

  const trendData = useMemo<EngineeringTrendPoint[]>(() => {
    const sortedLogs = [...logs].sort((a, b) => a.month.localeCompare(b.month));
    const processed = sortedLogs.map(log => {
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
    });
    if (processed.length === 0) return [];

    // "Last N Months" is a trailing window that ENDS at the selected reporting
    // month and slides with it - it is not clipped to a single calendar year,
    // so a 12-month window ending in Feb correctly reaches back into the prior
    // year. selectedYear/selectedPeriod only resolve which month the window
    // ends at; the window itself spans the full (already display-period-clipped)
    // month sequence so every metric keeps its own independent completeness.
    const anchorMonth = selectedDashboardMonth(processed, selectedYear, selectedPeriod, processed[processed.length - 1]!.month);
    const anchorIndex = processed.findIndex(row => row.month === anchorMonth);
    const effectiveAnchor = anchorIndex >= 0 ? anchorIndex : processed.length - 1;
    const windowSize = TREND_WINDOW_SIZE[selectedTrend] ?? 3;
    return processed.slice(Math.max(0, effectiveAnchor - windowSize + 1), effectiveAnchor + 1);
  }, [logs, selectedPeriod, selectedTrend, selectedYear]);

  if (trendData.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-400" data-testid="executive-engineering-trend-charts">
        {lang === "th" ? "ไม่มีข้อมูลสำหรับสร้างกราฟแนวโน้ม" : "No logs available to generate trend charts."}
      </div>
    );
  }

  return (
    <section className="space-y-6" data-testid="executive-engineering-trend-charts">
      {CHARTS.map(chart => (
        <section key={chart.id} className="trend-chart-card w-full bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4 min-w-0 shadow-sm" data-testid={`executive-trend-${chart.id}`}>
          <div className="flex justify-between items-center gap-3">
            <div>
              <h3 className="text-sm tracking-wide text-slate-100">{chart.title}</h3>
              <p className="text-xs mt-1 text-slate-400">{chart.description}</p>
            </div>
            <span className="text-sm text-slate-400 whitespace-nowrap">{trendData.length} months</span>
          </div>
          <TrendLineChart
            labels={trendData.map(point => point.label)}
            unit={chart.unit}
            height={320}
            series={[{ name: chart.title, color: chart.color, values: trendData.map(point => point[chart.key]) }]}
          />
        </section>
      ))}
    </section>
  );
}
