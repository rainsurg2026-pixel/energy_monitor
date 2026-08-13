import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import { MonthlyLog } from "../types";
import {
  computeAllMetrics,
  ComputedMonthMetrics
} from "../utils/analytics";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { selectedPeriodMonths } from "../utils/reportPeriodSelection";
import {
  Zap,
  Coins,
  Activity
} from "lucide-react";
import EngineeringTrendCharts from "./EngineeringTrendCharts";

interface ExecutiveDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

export default function ExecutiveDashboard({ logs, lang }: ExecutiveDashboardProps) {
  const { selectedYear, selectedPeriod } = useReport();

  // Compute metrics for all months
  const allMonthlyMetrics = useMemo(() => {
    return computeAllMetrics(logs);
  }, [logs]);

  // Filter metrics based on Selected Year and Period
  const activePeriodMetrics = useMemo(() => {
    return selectedPeriodMonths(allMonthlyMetrics, selectedYear, selectedPeriod);
  }, [allMonthlyMetrics, selectedYear, selectedPeriod]);

    // Approximate horizontal plot width available to the point scale: measured
    // wrapper width minus the Y-axis allowance. One category slot is
    // plotWidth / (count + 1), which places points at (index + 1) / (count + 1)
    // — one blank slot before the first month and after the last.

  // Aggregate active period stats
  const aggregateStats = useMemo(() => {
    if (activePeriodMetrics.length === 0) return null;

    const sumMetric = (selector: (metric: ComputedMonthMetrics) => number | null): number =>
      activePeriodMetrics.reduce((acc, metric) => {
        const value = selector(metric);
        return value === null ? acc : acc + value;
      }, 0);

    const totalEnergy = sumMetric(m => m.totalEnergyKwh);
    const totalCost = sumMetric(m => m.actualCostThb);
    const totalBuildingEnergy = sumMetric(m => m.buildingEnergyKwh);
    const totalBuildingCost = sumMetric(m => m.buildingCostThb);

    return {
      totalEnergy,
      totalCost,
      totalBuildingEnergy,
      totalBuildingCost,
      countMonths: activePeriodMetrics.length
    };
  }, [activePeriodMetrics]);

  // Translate helpers
  const dict = {
    th: {
      empty: "ไม่มีข้อมูลสำหรับช่วงเวลานี้",

    },
    en: {
      empty: "No logs found for selected period",

    }
  };

  const t = dict[lang];

  if (!aggregateStats) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-12 rounded-3xl text-center space-y-4">
        <Activity className="w-12 h-12 text-slate-500 mx-auto animate-pulse" />
        <h3 className="font-display font-semibold text-slate-200 text-lg">{t.empty}</h3>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">

      {/* Building versus 4th-floor electricity comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "th" ? "เปรียบเทียบการใช้ไฟฟ้า" : "Electricity Consumption Comparison"}</span>
            <Zap className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-5">
            <div>
              <span className="text-[10px] text-slate-500 uppercase">{lang === "th" ? "ทั้งตึก" : "Whole Building"}</span>
              <div className="text-2xl font-mono font-black text-slate-100 mt-1">{formatNumber2(aggregateStats.totalBuildingEnergy)}<span className="text-xs text-slate-400 ml-1">kWh</span></div>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase">{lang === "th" ? "ชั้น 4" : "4th Floor"}</span>
              <div className="text-2xl font-mono font-black text-indigo-400 mt-1">{formatNumber2(aggregateStats.totalEnergy)}<span className="text-xs text-slate-400 ml-1">kWh</span></div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-4">{lang === "th" ? "สัดส่วนการใช้ไฟชั้น 4 เทียบกับทั้งตึก" : "4th-floor share of whole-building electricity"}: {aggregateStats.totalBuildingEnergy > 0 ? formatNumber2(aggregateStats.totalEnergy / aggregateStats.totalBuildingEnergy * 100) : "—"}%</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "th" ? "เปรียบเทียบค่าไฟฟ้า" : "Electricity Cost Comparison"}</span>
            <Coins className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-5">
            <div>
              <span className="text-[10px] text-slate-500 uppercase">{lang === "th" ? "ทั้งตึก" : "Whole Building"}</span>
              <div className="text-2xl font-mono font-black text-slate-100 mt-1">฿{formatNumber2(aggregateStats.totalBuildingCost)}</div>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase">{lang === "th" ? "ชั้น 4" : "4th Floor"}</span>
              <div className="text-2xl font-mono font-black text-emerald-400 mt-1">฿{formatNumber2(aggregateStats.totalCost)}</div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-4">{lang === "th" ? "ใช้ค่าเฉลี่ยอัตราค่าไฟเต็มความละเอียดจากข้อมูล workbook" : "4th-floor cost uses the shared full-precision workbook rate"}</p>
        </div>
      </div>

      <EngineeringTrendCharts logs={logs} lang={lang} />
    </div>
  );
}
