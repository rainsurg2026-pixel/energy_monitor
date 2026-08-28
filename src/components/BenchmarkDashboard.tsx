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
  const { selectedYear, selectedPeriod } = useReport();

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

  // Benchmark metrics
  const benchmarks = useMemo(() => {
    if (!currentMonthMetric || allMetrics.length === 0) return null;

    const usableMetrics = displayMetrics.filter(m => m.pue !== null && m.totalEnergyKwh !== null);
    if (usableMetrics.length === 0 || currentMonthMetric.pue === null || currentMonthMetric.totalEnergyKwh === null) return null;

    const curVal = currentMonthMetric;

    // 1. Find Best Month (lowest PUE or lowest total energy in all history)
    const bestMonth = [...usableMetrics].reduce((best, m) => {
      if (m.pue > 1.0 && m.pue < best.pue) return m;
      return best;
    }, usableMetrics[0]);

    // 2. Find Worst Month (highest PUE in all history)
    const worstMonth = [...usableMetrics].reduce((worst, m) => {
      if (m.pue > worst.pue) return m;
      return worst;
    }, usableMetrics[0]);

    // 3. Find Rolling Average of previous 3 months
    const curIdx = usableMetrics.findIndex(m => m.month === curVal.month);
    let rollingAvgPue = 1.5;
    let rollingAvgEnergy = 120000;
    if (curIdx >= 3) {
      const last3 = usableMetrics.slice(Math.max(0, curIdx - 3), curIdx);
      rollingAvgPue = last3.reduce((acc, m) => acc + m.pue, 0) / 3;
      rollingAvgEnergy = last3.reduce((acc, m) => acc + m.totalEnergyKwh, 0) / 3;
    } else {
      // fallback to global average
      rollingAvgPue = usableMetrics.reduce((acc, m) => acc + (m.pue as number), 0) / usableMetrics.length;
      rollingAvgEnergy = usableMetrics.reduce((acc, m) => acc + (m.totalEnergyKwh as number), 0) / usableMetrics.length;
    }

    // 4. Industry Standard PUE Target
    const industryPueTarget = 1.50;
    // 5. Company PUE Target
    const companyPueTarget = 1.40;

    return {
      best: {
        month: bestMonth.month,
        pue: bestMonth.pue,
        energy: bestMonth.totalEnergyKwh
      },
      worst: {
        month: worstMonth.month,
        pue: worstMonth.pue,
        energy: worstMonth.totalEnergyKwh
      },
      rolling: {
        pue: rollingAvgPue,
        energy: rollingAvgEnergy
      },
      industry: {
        pue: industryPueTarget,
        energy: rollingAvgEnergy * 0.95 // assume 5% saving target
      },
      company: {
        pue: companyPueTarget,
        energy: rollingAvgEnergy * 0.90 // assume 10% saving target
      }
    };
  }, [displayMetrics, currentMonthMetric]);

  const dict = {
    th: {
      title: "เปรียบเทียบเกณฑ์มาตรฐาน (Benchmark)",
      desc: "วิเคราะห์และเปรียบเทียบประสิทธิภาพพลังงาน (PUE) ของรอบระยะเวลาปัจจุบันกับเกณฑ์อ้างอิงและกลุ่มประวัติข้อมูล",
      parameter: "พารามิเตอร์",
      current: "ปัจจุบัน",
      target: "เปรียบเทียบเกณฑ์",
      difference: "ผลต่าง",
      status: "สถานะ",
      bestMonth: "เดือนที่ดีที่สุด (Best Month)",
      worstMonth: "เดือนที่แย่ที่สุด (Worst Month)",
      rollingAvg: "ค่าเฉลี่ยเคลื่อนที่ย้อนหลัง 3 เดือน",
      industryStd: "มาตรฐานอุตสาหกรรม (Industry Target)",
      companyGoal: "เป้าหมายองค์กร (Company Goal)",
      better: "ดีกว่าเกณฑ์",
      worse: "ต่ำกว่าเกณฑ์",
      matchesWorst: "Matches Worst Month",
      suggestionTitle: "ข้อแนะนำทางวิศวกรรมเพื่อความยั่งยืน",
      pueTitle: "กราฟเปรียบเทียบ PUE เทียบกับเป้าหมาย",
      pueLegend: "ประสิทธิภาพ PUE"
    },
    en: {
      title: "Energy Benchmarking Dashboard",
      desc: "Analyze and benchmark current operations (PUE & Energy) against historical extremes, rolling averages, and carbon-reduction targets.",
      parameter: "Benchmark Indicator",
      current: "Current",
      target: "Reference Value",
      difference: "Variance",
      status: "Status",
      bestMonth: "Best Month (Lowest PUE)",
      worstMonth: "Worst Month (Highest PUE)",
      rollingAvg: "Rolling 3-Month Average",
      industryStd: "Industry Standard Target",
      companyGoal: "Company Efficiency Goal",
      better: "Better / Within Target",
      worse: "Exceeds Threshold / Worse",
      matchesWorst: "Matches Worst Month",
      suggestionTitle: "Engineering Actionable Insights",
      pueTitle: "PUE Performance Benchmarking",
      pueLegend: "PUE Rating"
    }
  };

  const t = dict[lang];

  // Declared before the early return below so the hook count stays stable when
  // a facility switch removes the data (React "rendered fewer hooks" crash).
  const smartInsights = useMemo(() => {
    if (!currentMonthMetric || currentMonthMetric.pue === null) return [];
    const list: string[] = [];
    if (currentMonthMetric.pue > 1.6) {
      list.push(
        lang === "th"
          ? "ค่า PUE สูงเกินเกณฑ์มาตรฐาน 1.5: ควรตรวจสอบประสิทธิภาพระบายความร้อนของระบบปรับอากาศ ชั้น 4 (EB41A-B, EB42A-B) ว่ามีปริมาณความต้องการลมเย็นเกินสภาวะปกติหรือไม่"
          : "PUE exceeds standard threshold (>1.5): Audit 4th floor cooling subsystems (EB41A-B, EB42A-B) to verify if air-flow velocity or ambient setpoints are misaligned with IT heat loads."
      );
      list.push(
        lang === "th"
          ? "แนะนำระบบปิดกั้นช่องทางลมร้อน/ลมเย็น (Hot/Cold Aisle Containment) เพื่อป้องกันการผสมกันของอากาศและเพิ่มประสิทธิภาพพัดลมคอยล์เย็น"
          : "Implement Hot/Cold Aisle Containment protocols to prevent bypass cold air mixing and optimize chillers coil return temperature."
      );
    } else {
      list.push(
        lang === "th"
          ? "ค่าประสิทธิภาพ PUE อยู่ในเกณฑ์ดีเยี่ยม: แนะนำให้รักษาระดับอุณหภูมิห้องเครื่องไว้ที่ 22-24°C และรักษามาตรฐานพฤติกรรมการบันทึกข้อมูลอย่างสมบูรณ์แบบ"
          : "PUE meets high-efficiency targets: Maintain current temperature setpoints (22-24°C) and secure consistent historical log data accuracy."
      );
    }

    const ups11 = currentMonthMetric.alerts.some(a => a.includes("UPS 11"));
    const ups15 = currentMonthMetric.alerts.some(a => a.includes("UPS 15"));
    if (ups11 || ups15) {
      list.push(
        lang === "th"
          ? "ตรวจพบโหลดไม่สมมาตรในกลุ่ม UPS: ตรวจสอบการกระจายโหลดแผงจ่ายไฟฟ้ากระแสสลับ (A/B lines) เพื่อยืดอายุการทำงานของแบตเตอรี่และคาปาซิเตอร์"
          : "Unbalanced UPS load distribution detected: Verify branch circuits across dual-corded servers (A/B feeds) to protect long-term battery lifespan."
      );
    }
    return list;
  }, [currentMonthMetric, lang]);

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

  // Comparison Rows
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
    {
      id: "rolling",
      name: t.rollingAvg,
      refLabel: "(Prev 3 Months)",
      currentPue: cur.pue,
      targetPue: b.rolling.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.rolling.energy,
      type: "lower-better"
    },
    {
      id: "industry",
      name: t.industryStd,
      refLabel: "(Green DC Standard)",
      currentPue: cur.pue,
      targetPue: b.industry.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.industry.energy,
      type: "lower-better"
    },
    {
      id: "company",
      name: t.companyGoal,
      refLabel: "(ESG Target)",
      currentPue: cur.pue,
      targetPue: b.company.pue,
      currentEnergy: cur.totalEnergyKwh,
      targetEnergy: b.company.energy,
      type: "lower-better"
    },
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

  // Chart data
  const chartData = [
    { name: "Current Month", PUE: cur.pue },
    { name: "Best Month", PUE: b.best.pue },
    { name: "3-Mo Rolling Avg", PUE: b.rolling.pue },
    { name: "Industry Standard", PUE: b.industry.pue },
    { name: "Company ESG Target", PUE: b.company.pue },
    { name: "Worst Month", PUE: b.worst.pue },
  ];

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
              {benchmarkRows.map((row) => {
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
            <p className="text-[11px] text-slate-400">Comparing PUE against industry guidelines and targets.</p>
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
                    else if (entry.name === "Best Month" || entry.name === "Company ESG Target") fill = "#10b981";
                    else if (entry.name === "Worst Month") fill = "#ef4444";
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-[10px] text-slate-400">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>PUE = 1.0 represents perfect efficiency (zero auxiliary power overhead). Green standard threshold is &lt; 1.5.</span>
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
