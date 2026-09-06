import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import { MonthlyLog } from "../types";
import { computeAllMetrics, ComputedMonthMetrics } from "../utils/analytics";
import { formatMonthYear } from "../utils";
import { formatNumber2, formatCompactNumber } from "../utils/numberFormatBridge";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import { 
  Building, 
  ChevronRight, 
  Compass, 
  Goal, 
  HelpCircle, 
  Info, 
  Lightbulb, 
  Scale, 
  TrendingDown, 
  TrendingUp 
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";

interface BenchmarkDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

export default function BenchmarkDashboard({ logs, lang }: BenchmarkDashboardProps) {
  const { selectedYear, selectedPeriod, selectedBenchmarkReference } = useReport();

  // Compute all history metrics
  const allMetrics = useMemo(() => {
    return computeAllMetrics(logs).sort((a, b) => a.month.localeCompare(b.month));
  }, [logs]);

  // Keep the visible benchmark series inside the global reporting year. The
  // raw log set is still used to calculate each metric, including any
  // month-over-month dependency required by the calculation chain.
  const displayMetrics = useMemo(
    () => allMetrics.filter(metric => metric.month.startsWith(`${selectedYear}-`)),
    [allMetrics, selectedYear]
  );

  // Current selected month metric
  const currentMonthMetric = useMemo(() => {
    const selectedMonth = selectedDashboardMonth(displayMetrics, selectedYear, selectedPeriod, "");
    return displayMetrics.find(metric => metric.month === selectedMonth) ?? displayMetrics[displayMetrics.length - 1] ?? null;
  }, [displayMetrics, selectedYear, selectedPeriod]);

  // Keep the selected reporting month as the right edge and show at most the
  // preceding 11 valid months. Values come from the same computeAllMetrics
  // result used by the benchmark matrix, so the line cannot drift from it.
  const pueTrendData = useMemo(() => {
    if (!currentMonthMetric) return [];
    const currentIndex = displayMetrics.findIndex(metric => metric.month === currentMonthMetric.month);
    if (currentIndex < 0) return [];
    return displayMetrics
      .slice(Math.max(0, currentIndex - 11), currentIndex + 1)
      .filter(metric => metric.pue !== null)
      .map(metric => ({ month: formatMonthYear(metric.month), pue: metric.pue, sourceMonth: metric.month }));
  }, [displayMetrics, currentMonthMetric]);

  // Data-backed benchmark references only. No industry/company target is shown
  // unless the product later receives a persisted reference configuration.
  const benchmarks = useMemo(() => {
    if (!currentMonthMetric || allMetrics.length === 0) return null;
    const usableMetrics = displayMetrics.filter(m => m.pue !== null && m.totalEnergyKwh !== null);
    if (usableMetrics.length === 0 || currentMonthMetric.pue === null || currentMonthMetric.totalEnergyKwh === null) return null;

    const bestMonth = [...usableMetrics].reduce((best, metric) => metric.pue! < best.pue! ? metric : best, usableMetrics[0]);
    const worstMonth = [...usableMetrics].reduce((worst, metric) => metric.pue! > worst.pue! ? metric : worst, usableMetrics[0]);
    const previousRows = usableMetrics.filter(metric => metric.month < currentMonthMetric.month).slice(-3);
    const rolling = previousRows.length > 0 ? {
      pue: previousRows.reduce((sum, metric) => sum + metric.pue!, 0) / previousRows.length,
      energy: previousRows.reduce((sum, metric) => sum + metric.totalEnergyKwh!, 0) / previousRows.length,
      count: previousRows.length,
    } : null;

    return {
      best: { month: bestMonth.month, pue: bestMonth.pue!, energy: bestMonth.totalEnergyKwh! },
      worst: { month: worstMonth.month, pue: worstMonth.pue!, energy: worstMonth.totalEnergyKwh! },
      rolling,
    };
  }, [allMetrics.length, currentMonthMetric, displayMetrics]);

  const dict = {
    th: {
      title: "เปรียบเทียบเกณฑ์มาตรฐาน (Benchmark)",
      desc: "วิเคราะห์ PUE และพลังงานของเดือนปัจจุบันเทียบกับข้อมูลประวัติที่บันทึกจริง",
      parameter: "พารามิเตอร์",
      current: "ปัจจุบัน",
      target: "เปรียบเทียบเกณฑ์",
      difference: "ผลต่าง",
      status: "สถานะ",
      bestMonth: "เดือนที่ดีที่สุด (Best Month)",
      worstMonth: "เดือนที่แย่ที่สุด (Worst Month)",
      rollingAvg: "ค่าเฉลี่ยเคลื่อนที่ย้อนหลัง 3 เดือน",
      better: "ดีกว่าเกณฑ์",
      worse: "ต่ำกว่าเกณฑ์",
      matchesWorst: "Matches Worst Month",
      suggestionTitle: "ข้อแนะนำทางวิศวกรรมเพื่อความยั่งยืน",
      pueTitle: "กราฟเปรียบเทียบ PUE กับประวัติข้อมูล",
      pueLegend: "ประสิทธิภาพ PUE"
    },
    en: {
      title: "Energy Benchmarking Dashboard",
      desc: "Analyze current PUE and energy against persisted historical extremes and rolling averages.",
      parameter: "Benchmark Indicator",
      current: "Current",
      target: "Reference Value",
      difference: "Variance",
      status: "Status",
      bestMonth: "Best Month (Lowest PUE)",
      worstMonth: "Worst Month (Highest PUE)",
      rollingAvg: "Rolling 3-Month Average",
      better: "Better / Within Target",
      worse: "Exceeds Threshold / Worse",
      matchesWorst: "Matches Worst Month",
      suggestionTitle: "Engineering Actionable Insights",
      pueTitle: "Historical PUE Comparison",
      pueLegend: "PUE Rating"
    }
  };

  const t = dict[lang];

  // Actionable insights are derived from persisted history only. Do not attach
  // unsourced industry/company PUE thresholds to the current value.
  const smartInsights = useMemo(() => {
    if (!currentMonthMetric || currentMonthMetric.pue === null || !benchmarks) return [];
    const list: string[] = [];
    if (benchmarks.rolling) {
      const delta = currentMonthMetric.pue - benchmarks.rolling.pue;
      const direction = delta > 0 ? "higher" : delta < 0 ? "lower" : "unchanged";
      list.push(lang === "th"
        ? `PUE เดือนปัจจุบัน ${direction === "higher" ? "สูงกว่า" : direction === "lower" ? "ต่ำกว่า" : "เท่ากับ"} ค่าเฉลี่ยย้อนหลัง ${benchmarks.rolling.count} เดือนอยู่ ${formatNumber2(Math.abs(delta))} จุด`
        : `Current PUE is ${direction} than the prior ${benchmarks.rolling.count}-month average by ${formatNumber2(Math.abs(delta))} points.`);
    }
    if (currentMonthMetric.month === benchmarks.best.month) {
      list.push(lang === "th" ? "เดือนที่เลือกมี PUE ต่ำสุดในประวัติที่มองเห็นอยู่ขณะนี้" : "The selected month has the lowest PUE in the visible persisted history.");
    } else if (currentMonthMetric.month === benchmarks.worst.month) {
      list.push(lang === "th" ? "เดือนที่เลือกมี PUE สูงสุดในประวัติที่มองเห็นอยู่ขณะนี้ ควรตรวจสอบสาเหตุเทียบกับเดือนก่อนหน้า" : "The selected month has the highest PUE in the visible persisted history; review the month-over-month drivers.");
    }
    const upsAlerts = currentMonthMetric.alerts.filter(alert => alert.includes("UPS"));
    if (upsAlerts.length > 0) {
      list.push(lang === "th" ? `พบการแจ้งเตือน UPS จากข้อมูลเดือนนี้ ${upsAlerts.length} รายการ ควรตรวจสอบรายละเอียดใน Engineering View` : `${upsAlerts.length} UPS alert(s) are present in this month's data; review the Engineering View for details.`);
    }
    return list;
  }, [benchmarks, currentMonthMetric, lang]);

  if (!currentMonthMetric || !benchmarks) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-12 rounded-3xl text-center space-y-4">
        <Scale className="w-12 h-12 text-slate-500 mx-auto animate-bounce" />
        <p className="text-slate-300 font-medium">Insufficient monthly logs to run comparative benchmarks.</p>
      </div>
    );
  }

  const cur = currentMonthMetric;
  const b = benchmarks;

  // Comparison rows are persisted-history references only.
  const benchmarkRows = [
    {
      id: "best",
      name: t.bestMonth,
      refLabel: `(${formatMonthYear(b.best.month)})`,
      currentPue: cur.pue,
      targetPue: b.best.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.best.energy,
      type: "lower-better"
    },
    ...(b.rolling ? [{
      id: "rolling",
      name: t.rollingAvg,
      refLabel: `(Prev ${b.rolling.count} Month${b.rolling.count === 1 ? "" : "s"})`,
      currentPue: cur.pue,
      targetPue: b.rolling.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.rolling.energy,
      type: "lower-better"
    }] : []),
    {
      id: "worst",
      name: t.worstMonth,
      refLabel: `(${formatMonthYear(b.worst.month)})`,
      currentPue: cur.pue,
      targetPue: b.worst.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.worst.energy,
      type: "lower-better"
    }
  ];

  const visibleBenchmarkRows = selectedBenchmarkReference === "all" ? benchmarkRows : benchmarkRows.filter(row => row.id === selectedBenchmarkReference);

  const chartData = [
    { name: "Current Month", PUE: cur.pue },
    { name: "Best Month", PUE: b.best.pue },
    ...(b.rolling ? [{ name: `${b.rolling.count}-Mo Rolling Avg`, PUE: b.rolling.pue }] : []),
    { name: "Worst Month", PUE: b.worst.pue },
  ].filter(item => {
    if (selectedBenchmarkReference === "all" || item.name === "Current Month") return true;
    if (selectedBenchmarkReference === "best") return item.name === "Best Month";
    if (selectedBenchmarkReference === "rolling") return item.name.includes("Rolling Avg");
    return item.name === "Worst Month";
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      
      {/* HEADER BANNER */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Scale className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-slate-100 uppercase tracking-wider">{t.title}</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">{t.desc}</p>
          </div>
        </div>
        <div className="hidden sm:block text-right">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Current Month PUE</span>
          <div className="text-2xl font-mono font-black text-indigo-400 leading-none">{formatNumber2(cur.pue)}</div>
        </div>
      </div>

      {/* BENCHMARKING GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Benchmarking Table List */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl lg:col-span-7 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>Comparative Analytics Matrix</span>
            </h3>
            
            <div className="space-y-3.5">
              {visibleBenchmarkRows.map((row) => {
                const diffPue = row.currentPue - row.targetPue;
                const isPueBetter = diffPue <= 0; // lower PUE is better
                const matchesWorstMonth = row.id === "worst" && Math.abs(diffPue) < 0.0001;
                const diffPct = (diffPue / row.targetPue) * 100;

                return (
                  <div 
                    key={row.id} 
                    className="p-4 bg-slate-950/60 border border-slate-850 hover:border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-200">{row.name}</span>
                        <span className="text-[10px] text-slate-500 font-semibold font-mono">{row.refLabel}</span>
                      </div>
                      <div className="mt-1 text-slate-400 text-[10px] font-medium leading-none">
                        Ref Target PUE: <strong className="font-mono text-slate-300">{formatNumber2(row.targetPue)}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 self-end sm:self-auto">
                      <div className="text-right">
                        <div className="text-xs font-mono font-bold text-slate-300">
                          {formatNumber2(row.currentPue)} vs {formatNumber2(row.targetPue)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">PUE Ratio</div>
                      </div>

                      {/* Variance Status Badge */}
                      <div className={`px-2.5 py-1.5 rounded-lg text-right text-[10px] font-bold border ${
                        isPueBetter 
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/15" 
                          : "bg-rose-500/10 text-rose-400 border-rose-500/15"
                      } flex items-center gap-1 min-w-[110px] justify-center`}>
                        {matchesWorstMonth ? <Scale className="w-3.5 h-3.5" /> : isPueBetter ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                        <span>
                          {matchesWorstMonth ? t.matchesWorst : isPueBetter ? t.better : t.worse} ({formatNumber2(Math.abs(diffPct))} %)
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Benchmarking Recharts Bar Chart */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl lg:col-span-5 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider mb-1">{t.pueTitle}</h3>
            <p className="text-[11px] text-slate-400">Comparing the selected month with persisted historical references.</p>
          </div>

          <div className="h-64 my-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#475569" style={{ fontSize: 9, fontFamily: "sans-serif" }} />
                <YAxis stroke="#475569" domain={[1.0, 2.2]} tickFormatter={formatCompactNumber} style={{ fontSize: 10, fontFamily: "monospace" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: 12 }}
                  labelStyle={{ color: "#94a3b8", fontWeight: "bold" }}
                  itemStyle={{ color: "#818cf8" }}
                  formatter={(value: number) => [formatNumber2(value), "PUE"]}
                />
                <Bar dataKey="PUE" fill="#6366f1" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => {
                    let fill = "#6366f1"; // base default
                    if (entry.name === "Current Month") fill = "#818cf8";
                    else if (entry.name === "Best Month") fill = "#10b981";
                    else if (entry.name === "Worst Month") fill = "#ef4444";
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-[10px] text-slate-400">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>PUE values shown here are calculated from persisted energy data; no external target is assumed.</span>
          </div>
        </div>

      </div>

      {/* PUE HISTORY TREND */}
      <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl" data-testid="benchmark-pue-trend">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">PUE Trend Line (Previous 12 Months)</h3>
            <p className="text-[11px] text-slate-400 mt-1">Selected reporting period at the right edge; up to 12 valid months shown.</p>
          </div>
          <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">{pueTrendData.length} months</span>
        </div>
        {pueTrendData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-slate-500">No valid PUE history is available.</div>
        ) : (
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pueTrendData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis domain={[1, "auto"]} tickFormatter={value => formatNumber2(value)} stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", borderRadius: 12 }}
                  labelStyle={{ color: "#cbd5e1", fontWeight: "bold" }}
                  formatter={(value: number) => [formatNumber2(value), "PUE"]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="pue" name="PUE" stroke="#b91c1c" strokeWidth={3} dot={{ r: 3, fill: "#b91c1c" }} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ACTIONABLE ADVICE BAR */}
      <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-2xl p-5 shadow-sm">
        <h4 className="text-xs font-display font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-indigo-400 animate-pulse" />
          <span>{t.suggestionTitle}</span>
        </h4>
        <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
          {smartInsights.map((insight, idx) => (
            <li key={idx} className="flex gap-2.5 items-start">
              <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}
