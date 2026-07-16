import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import { MonthlyLog } from "../types";
import { 
  computeAllMetrics, 
  ComputedMonthMetrics, 
  getDaysInMonth, 
  getPreviousMonthStr 
} from "../utils/analytics";
import { formatMonthYear } from "../utils";
import { 
  Zap, 
  Coins, 
  Percent, 
  ShieldCheck, 
  Activity, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  Flame,
  Gauge
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie } from "recharts";

interface ExecutiveDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

export default function ExecutiveDashboard({ logs, lang }: ExecutiveDashboardProps) {
  const {
    selectedYear,
    selectedPeriod,
    compareMode,
    selectedCategory,
    selectedUPSGroup,
    triggerRefresh
  } = useReport();

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

  // Aggregate active period stats
  const aggregateStats = useMemo(() => {
    if (activePeriodMetrics.length === 0) return null;

    const totalEnergy = activePeriodMetrics.reduce((acc, m) => acc + m.totalEnergyKwh, 0);
    const totalItEnergy = activePeriodMetrics.reduce((acc, m) => acc + m.itEquipmentEnergyKwh, 0);
    const totalCost = activePeriodMetrics.reduce((acc, m) => acc + m.actualCostThb, 0);
    const totalCarbon = activePeriodMetrics.reduce((acc, m) => acc + m.carbonEmissionKg, 0);
    const totalBuildingEnergy = activePeriodMetrics.reduce((acc, m) => acc + m.buildingEnergyKwh, 0);
    const totalBuildingCost = activePeriodMetrics.reduce((acc, m) => acc + m.buildingCostThb, 0);
    
    const avgPue = totalItEnergy > 0 ? totalEnergy / totalItEnergy : 1.5;
    const avgHealth = activePeriodMetrics.reduce((acc, m) => acc + m.facilityHealthScore, 0) / activePeriodMetrics.length;
    const avgDq = activePeriodMetrics.reduce((acc, m) => acc + m.dataQualityScore, 0) / activePeriodMetrics.length;
    
    // Sum component energies for breakdown
    const upsSum = activePeriodMetrics.reduce((acc, m) => acc + m.upsEnergyKwh, 0);
    const airSum = activePeriodMetrics.reduce((acc, m) => acc + m.airEnergyKwh, 0);
    const dcSum = activePeriodMetrics.reduce((acc, m) => acc + m.dcEnergyKwh, 0);

    // Dynamic warning alerts
    const activeAlerts: string[] = [];
    activePeriodMetrics.forEach(m => {
      m.alerts.forEach(a => {
        if (!activeAlerts.includes(a)) activeAlerts.push(a);
      });
    });

    return {
      totalEnergy,
      totalItEnergy,
      totalCost,
      totalCarbon,
      avgPue,
      avgHealth,
      avgDq,
      upsSum,
      airSum,
      dcSum,
      totalBuildingEnergy,
      totalBuildingCost,
      alerts: activeAlerts,
      countMonths: activePeriodMetrics.length
    };
  }, [activePeriodMetrics]);

  // Comparison metrics calculations
  const comparisonStats = useMemo(() => {
    if (!aggregateStats || activePeriodMetrics.length === 0 || compareMode === "none") return null;

    let compareTargetMetrics: ComputedMonthMetrics[] = [];

    if (compareMode === "prev_month") {
      // Find previous month or months
      if (selectedPeriod !== "Entire Year" && selectedPeriod !== "YTD") {
        const activeMonthStr = `${selectedYear}-${selectedPeriod}`;
        const prevMonthStr = getPreviousMonthStr(activeMonthStr);
        compareTargetMetrics = allMonthlyMetrics.filter(m => m.month === prevMonthStr);
      } else {
        // For Entire Year compare with previous year
        const prevYearInt = parseInt(selectedYear, 10) - 1;
        compareTargetMetrics = allMonthlyMetrics.filter(m => m.month.startsWith(String(prevYearInt)));
      }
    } else if (compareMode === "prev_year") {
      const prevYearInt = parseInt(selectedYear, 10) - 1;
      if (selectedPeriod !== "Entire Year" && selectedPeriod !== "YTD") {
        const targetMonthStr = `${prevYearInt}-${selectedPeriod}`;
        compareTargetMetrics = allMonthlyMetrics.filter(m => m.month === targetMonthStr);
      } else {
        compareTargetMetrics = allMonthlyMetrics.filter(m => m.month.startsWith(String(prevYearInt)));
      }
    } else if (compareMode === "rolling_avg") {
      // Calculate rolling average of previous 3 months
      if (selectedPeriod !== "Entire Year" && selectedPeriod !== "YTD") {
        const activeMonthStr = `${selectedYear}-${selectedPeriod}`;
        const sorted = [...allMonthlyMetrics].sort((a, b) => a.month.localeCompare(b.month));
        const activeIdx = sorted.findIndex(m => m.month === activeMonthStr);
        if (activeIdx >= 3) {
          compareTargetMetrics = sorted.slice(activeIdx - 3, activeIdx);
        }
      }
    }

    if (compareTargetMetrics.length === 0) return null;

    // Aggregate comparison stats
    const compTotalEnergy = compareTargetMetrics.reduce((acc, m) => acc + m.totalEnergyKwh, 0);
    const compTotalCost = compareTargetMetrics.reduce((acc, m) => acc + m.actualCostThb, 0);
    const compTotalItEnergy = compareTargetMetrics.reduce((acc, m) => acc + m.itEquipmentEnergyKwh, 0);
    const compAvgPue = compTotalItEnergy > 0 ? compTotalEnergy / compTotalItEnergy : 1.5;
    const compAvgHealth = compareTargetMetrics.reduce((acc, m) => acc + m.facilityHealthScore, 0) / compareTargetMetrics.length;

    // If rolling average or previous month has different length, we scale values for proper comparison
    const scaleFactor = activePeriodMetrics.length / compareTargetMetrics.length;
    const adjustedCompEnergy = compTotalEnergy * scaleFactor;
    const adjustedCompCost = compTotalCost * scaleFactor;

    return {
      totalEnergy: adjustedCompEnergy,
      totalCost: adjustedCompCost,
      avgPue: compAvgPue,
      avgHealth: compAvgHealth
    };
  }, [aggregateStats, activePeriodMetrics, compareMode, selectedYear, selectedPeriod, allMonthlyMetrics]);

  // Translate helpers
  const dict = {
    th: {
      energy: "พลังงานชั้น 4 ทั้งหมด",
      cost: "ประมาณการค่าไฟชั้น 4",
      pue: "ค่าเฉลี่ยประสิทธิภาพ (PUE)",
      carbon: "การปล่อยก๊าซคาร์บอนสะสม",
      health: "คะแนนสุขภาพระบบกายภาพ",
      quality: "คะแนนความถูกต้องของข้อมูล",
      subTitle: "สรุปแดชบอร์ดผู้บริหาร",
      empty: "ไม่มีข้อมูลสำหรับช่วงเวลานี้",
      better: "ดีขึ้น",
      worse: "แย่ลง",
      vsPrevious: "เทียบช่วงก่อนหน้า",
      breakdown: "สัดส่วนพลังงานรายหมวดหมู่",
      monthlyTrend: "แนวโน้มการใช้พลังงานรายเดือน (kWh)",
      activeAlerts: "การแจ้งเตือนทางวิศวกรรมที่สำคัญ",
      noAlerts: "ไม่พบค่าสภาวะผิดปกติในรอบระยะเวลานี้"
    },
    en: {
      energy: "Total 4th Floor Energy",
      cost: "Estimated 4th Floor Cost",
      pue: "Avg Power Efficiency (PUE)",
      carbon: "Carbon Footprint (CO2)",
      health: "Facility Health Score",
      quality: "Data Integrity Index",
      subTitle: "Executive Insights & Operations Summary",
      empty: "No logs found for selected period",
      better: "Better",
      worse: "Worse",
      vsPrevious: "vs Previous",
      breakdown: "Energy Subsystem Breakdown",
      monthlyTrend: "Monthly Energy Consumption Trend (kWh)",
      activeAlerts: "Critical Technical Alerts",
      noAlerts: "No critical engineering alerts detected in this period."
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

  // Delta helpers
  const renderDelta = (current: number, target: number, type: "lower-better" | "higher-better", format: "percent" | "pue" | "health") => {
    const diff = current - target;
    const pct = target > 0 ? (diff / target) * 100 : 0;
    const isPositiveChange = diff > 0;
    const isGood = type === "lower-better" ? !isPositiveChange : isPositiveChange;
    
    if (Math.abs(diff) < 0.001) return null;

    let text = "";
    if (format === "percent") {
      text = `${isPositiveChange ? "+" : ""}${pct.toFixed(1)}%`;
    } else if (format === "pue") {
      text = `${isPositiveChange ? "+" : ""}${diff.toFixed(2)}`;
    } else {
      text = `${isPositiveChange ? "+" : ""}${diff.toFixed(1)} pts`;
    }

    return (
      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-bold ${
        isGood ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
      }`}>
        {isGood ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
        <span>{text}</span>
      </span>
    );
  };

  // Subsystem Breakdown data
  const breakdownData = [
    { name: "UPS Load", value: aggregateStats.upsSum, color: "#6366f1" },
    { name: "Air Conditioning", value: aggregateStats.airSum, color: "#14b8a6" },
    { name: "DC Power", value: aggregateStats.dcSum, color: "#f59e0b" },
  ].filter(d => d.value > 0);

  const totalBreakdownVal = breakdownData.reduce((acc, d) => acc + d.value, 0);

  // Score colors
  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-emerald-400 border-emerald-500/20 bg-emerald-500/5";
    if (score >= 75) return "text-amber-400 border-amber-500/20 bg-amber-500/5";
    return "text-rose-400 border-rose-500/20 bg-rose-500/5";
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      
      {/* 1. ROW OF EXECUTIVE KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Energy */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between shadow-xl min-h-[140px] relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all"></div>
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.energy}</span>
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-2xl font-mono font-black text-slate-100 tracking-tight">
              {aggregateStats.totalEnergy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="text-xs font-sans font-semibold text-slate-400 ml-1.5">kWh</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-medium">
                {aggregateStats.countMonths} {aggregateStats.countMonths > 1 ? "Months" : "Month"}
              </span>
              {comparisonStats && renderDelta(aggregateStats.totalEnergy, comparisonStats.totalEnergy, "lower-better", "percent")}
            </div>
          </div>
        </div>

        {/* Estimated Cost */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between shadow-xl min-h-[140px] relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="absolute right-0 top-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all"></div>
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.cost}</span>
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-2xl font-mono font-black text-slate-100 tracking-tight">
              ฿{aggregateStats.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-medium">
                Avg: ฿{(aggregateStats.totalCost / aggregateStats.countMonths).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
              </span>
              {comparisonStats && renderDelta(aggregateStats.totalCost, comparisonStats.totalCost, "lower-better", "percent")}
            </div>
          </div>
        </div>

        {/* Power Usage Effectiveness (PUE) */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between shadow-xl min-h-[140px] relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="absolute right-0 top-0 w-24 h-24 bg-teal-500/5 rounded-full blur-2xl group-hover:bg-teal-500/10 transition-all"></div>
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.pue}</span>
            <div className="p-2 bg-teal-500/10 text-teal-400 rounded-xl">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-2xl font-mono font-black text-slate-100 tracking-tight">
              {aggregateStats.avgPue.toFixed(2)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-medium">
                IT Load: {Math.round(aggregateStats.totalItEnergy / aggregateStats.totalEnergy * 100)}%
              </span>
              {comparisonStats && renderDelta(aggregateStats.avgPue, comparisonStats.avgPue, "lower-better", "pue")}
            </div>
          </div>
        </div>

        {/* Carbon Emission */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between shadow-xl min-h-[140px] relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="absolute right-0 top-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all"></div>
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.carbon}</span>
            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <div className="text-2xl font-mono font-black text-slate-100 tracking-tight">
              {(aggregateStats.totalCarbon / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              <span className="text-xs font-sans font-semibold text-slate-400 ml-1.5">tCO₂e</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-medium">
                 thailand grid factor 0.4991
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* 2. ROW OF HEALTH & DATA QUALITY SCORES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Facility Health Score */}
        <div className={`border rounded-2xl p-5 shadow-lg flex items-center justify-between ${getScoreColor(aggregateStats.avgHealth)} transition-all`}>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 opacity-80">
              <Activity className="w-3.5 h-3.5" />
              <span>{t.health}</span>
            </p>
            <h4 className="text-4xl font-display font-black leading-tight">
              {Math.round(aggregateStats.avgHealth)}
              <span className="text-lg font-sans font-medium opacity-60"> / 100</span>
            </h4>
            <p className="text-xs opacity-75">
              {aggregateStats.avgHealth >= 90 ? "Excellent operating efficiency & balance" : 
               aggregateStats.avgHealth >= 75 ? "Standard operations. Minor optimization recommended." : 
               "System alerts or extreme PUE detected. Urgent review required."}
            </p>
          </div>
          <div className="w-16 h-16 rounded-full border-4 border-current border-r-transparent animate-spin-slow shrink-0 hidden sm:block"></div>
        </div>

        {/* Data Quality Score */}
        <div className={`border rounded-2xl p-5 shadow-lg flex items-center justify-between ${getScoreColor(aggregateStats.avgDq)} transition-all`}>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 opacity-80">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t.quality}</span>
            </p>
            <h4 className="text-4xl font-display font-black leading-tight">
              ★★★★★
              <span className="text-xl font-mono ml-2">{Math.round(aggregateStats.avgDq)}%</span>
            </h4>
            <p className="text-xs opacity-75">
              {aggregateStats.avgDq >= 95 ? "High-precision log integrity, no gaps." : 
               aggregateStats.avgDq >= 85 ? "Good integrity. Minor empty variables detected." : 
               "Significant gaps or critical parameter omissions detected."}
            </p>
          </div>
          <div className="w-16 h-16 rounded-full border-4 border-current border-t-transparent animate-pulse shrink-0 hidden sm:block"></div>
        </div>
      </div>

      {/* 3. BREAKDOWN & CHART ZONE */}
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
                {Math.round(totalBreakdownVal / 1000)} MWh
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
                    {Math.round(d.value).toLocaleString()}
                  </strong> kWh ({totalBreakdownVal > 0 ? Math.round(d.value / totalBreakdownVal * 100) : 0}%)
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Trend Analytics */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl lg:col-span-8 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">{t.monthlyTrend}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Monthly energy utilization pattern.</p>
          </div>

          <div className="h-64 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activePeriodMetrics}>
                <XAxis 
                  dataKey="month" 
                  tickFormatter={formatMonthYear} 
                  stroke="#475569" 
                  style={{ fontSize: 10, fontFamily: "monospace" }} 
                />
                <YAxis stroke="#475569" style={{ fontSize: 10, fontFamily: "monospace" }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: 12 }}
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold" }}
                  itemStyle={{ color: "#38bdf8" }}
                  formatter={(value: any) => [`${Math.round(value).toLocaleString()} kWh`, "Floor Energy"]}
                />
                <Bar dataKey="totalEnergyKwh" fill="url(#energyGrad)" radius={[4, 4, 0, 0]}>
                  {activePeriodMetrics.map((entry, index) => {
                    // highlight maximum
                    const isMax = entry.totalEnergyKwh === Math.max(...activePeriodMetrics.map(e => e.totalEnergyKwh));
                    return <Cell key={`cell-${index}`} fill={isMax ? "#818cf8" : "#6366f1"} opacity={isMax ? 1 : 0.8} />;
                  })}
                </Bar>
                <defs>
                  <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.9}/>
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.3}/>
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* 4. ALERTS BOX */}
      {aggregateStats.alerts.length > 0 ? (
        <div className="bg-rose-950/20 border border-rose-900/30 rounded-2xl p-5 shadow-md">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm uppercase tracking-wider">
            <AlertTriangle className="w-5 h-5 animate-bounce" />
            <span>{t.activeAlerts} ({aggregateStats.alerts.length})</span>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-rose-300/80">
            {aggregateStats.alerts.map((alert, idx) => (
              <div key={idx} className="flex items-center gap-2 border-b border-rose-950/35 pb-1">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full shrink-0" />
                <span>{alert}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/45 border border-slate-800 p-4 rounded-xl text-center text-xs text-slate-500">
          {t.noAlerts}
        </div>
      )}
    </div>
  );
}
