import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import { MonthlyLog } from "../types";
import {
  computeAllMetrics,
  ComputedMonthMetrics
} from "../utils/analytics";
import { formatMonthYear } from "../utils";
import { normalizedMonth } from "../utils/energyCost";
import { formatNumber2, formatCompactNumber } from "../utils/numberFormatBridge";
import {
  Zap,
  Coins,
  Activity
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, LabelList, PieChart, Pie, Cell } from "recharts";

interface ExecutiveDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

export default function ExecutiveDashboard({ logs, lang }: ExecutiveDashboardProps) {
  const { selectedYear, selectedPeriod, selectedTrend } = useReport();

  // Compute metrics for all months
  const allMonthlyMetrics = useMemo(() => {
    return computeAllMetrics(logs);
  }, [logs]);

  // Filter metrics based on Selected Year and Period
  const activePeriodMetrics = useMemo(() => {
    let yearFiltered = allMonthlyMetrics.filter(m => m.month.startsWith(selectedYear));
    
    // Sort chronological
    yearFiltered.sort((a, b) => a.month.localeCompare(b.month));

    if (selectedPeriod === "Entire Year") {
      return yearFiltered;
    } else if (selectedPeriod === "YTD") {
      // Find latest month in that year
      return yearFiltered; // all months up to latest for that year
    } else {
      // Specific month (e.g., "05")
      return yearFiltered.filter(m => m.month.endsWith(`-${selectedPeriod}`));
    }
  }, [allMonthlyMetrics, selectedYear, selectedPeriod]);

  // The trend selector controls the chart window independently from the
  // selected KPI period. When a specific reporting month is selected, anchor
  // the window on that month; otherwise use the latest month in the selected
  // year (or the latest available month when no year is selected).
  const trendMetrics = useMemo(() => {
    const windowSize = selectedTrend === "Last 6 Months" ? 6 : selectedTrend === "Last 12 Months" ? 12 : 3;
    if (allMonthlyMetrics.length === 0) return [];

    const normalizedSelectedMonth = /^(0[1-9]|1[0-2])$/.test(selectedPeriod)
      ? `${selectedYear}-${selectedPeriod}`
      : null;
    const selectedMonthIndex = normalizedSelectedMonth
      ? allMonthlyMetrics.findIndex(metric => normalizedMonth(metric.month) === normalizedSelectedMonth)
      : -1;

    const selectedYearMetrics = selectedYear === "All"
      ? allMonthlyMetrics
      : allMonthlyMetrics.filter(metric => normalizedMonth(metric.month)?.startsWith(`${selectedYear}-`));
    const anchorIndex = selectedMonthIndex >= 0
      ? selectedMonthIndex
      : selectedYearMetrics.length > 0
        ? allMonthlyMetrics.indexOf(selectedYearMetrics[selectedYearMetrics.length - 1])
        : allMonthlyMetrics.length - 1;

    return allMonthlyMetrics.slice(Math.max(0, anchorIndex - windowSize + 1), anchorIndex + 1);
  }, [allMonthlyMetrics, selectedTrend, selectedYear, selectedPeriod]);

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

    // Sum component energies for breakdown
    const upsSum = sumMetric(m => m.upsEnergyKwh);
    const airSum = sumMetric(m => m.airEnergyKwh);
    const dcSum = sumMetric(m => m.dcEnergyKwh);

    return {
      totalEnergy,
      totalCost,
      upsSum,
      airSum,
      dcSum,
      totalBuildingEnergy,
      totalBuildingCost,
      countMonths: activePeriodMetrics.length
    };
  }, [activePeriodMetrics]);

  // Translate helpers
  const dict = {
    th: {
      empty: "ไม่มีข้อมูลสำหรับช่วงเวลานี้",
      breakdown: "สัดส่วนพลังงานรายหมวดหมู่",
      monthlyTrend: "แนวโน้มการใช้พลังงานรายเดือน (kWh)"
    },
    en: {
      empty: "No logs found for selected period",
      breakdown: "Energy Subsystem Breakdown",
      monthlyTrend: "Monthly Energy Consumption Trend (kWh)"
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

  // Subsystem Breakdown data
  const breakdownData = [
    { name: "UPS Load", value: aggregateStats.upsSum, color: "#6366f1" },
    { name: "Air Conditioning", value: aggregateStats.airSum, color: "#14b8a6" },
    { name: "DC Power", value: aggregateStats.dcSum, color: "#f59e0b" },
  ].filter(d => d.value > 0);

  const totalBreakdownVal = breakdownData.reduce((acc, d) => acc + d.value, 0);

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

      {/* BREAKDOWN & CHART ZONE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Subsystem Breakdown Chart */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl lg:col-span-4 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">{t.breakdown}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Energy distribution across floor systems.</p>
          </div>

          <div className="h-44 my-4 flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdownData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {breakdownData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Total</span>
              <span className="text-base font-mono font-bold text-slate-100">
                {formatNumber2(totalBreakdownVal / 1000)} MWh
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-850 pt-3">
            {breakdownData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }}></span>
                  <span className="text-slate-300 font-medium">{d.name}</span>
                </div>
                <div className="text-right font-mono text-slate-400">
                  <strong className="text-slate-200">
                    {formatNumber2(d.value)}
                  </strong> kWh ({formatNumber2(totalBreakdownVal > 0 ? d.value / totalBreakdownVal * 100 : 0)}%)
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Trend Analytics */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl lg:col-span-8 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">{t.monthlyTrend}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Monthly energy utilization pattern · {trendMetrics.length} reporting months</p>
          </div>

          <div className="h-64 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendMetrics} margin={{ top: 28, right: 10, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  padding="gap"
                  tickFormatter={formatMonthYear}
                  stroke="#475569"
                  style={{ fontSize: 10, fontFamily: "monospace" }}
                />
                <YAxis
                  stroke="#475569"
                  tickFormatter={formatCompactNumber}
                  style={{ fontSize: 10, fontFamily: "monospace" }}
                  domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.35)]}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: 12 }}
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold" }}
                  itemStyle={{ color: "#38bdf8" }}
                  formatter={(value: any) => [`${formatNumber2(value)} kWh`, "Floor Energy"]}
                />
                <Line type="monotone" dataKey="totalEnergyKwh" stroke="#7c9cc8" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false}>
                  <LabelList dataKey="totalEnergyKwh" position="top" formatter={(value: unknown) => typeof value === "number" ? formatNumber2(value) : "—"} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
