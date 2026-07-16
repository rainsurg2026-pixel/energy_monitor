import React, { useState, useMemo } from "react";
import { MonthlyLog } from "../types";
import { computeAllMetrics, generateForecast } from "../utils/analytics";
import { formatMonthYear } from "../utils";
import { 
  TrendingUp, 
  Sparkles, 
  Calendar, 
  HelpCircle, 
  LineChart, 
  ArrowUpRight, 
  Zap, 
  Coins, 
  Flame, 
  Percent 
} from "lucide-react";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface ForecastDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

type ForecastMetric = "totalEnergyKwh" | "actualCostThb" | "carbonEmissionKg" | "pue";
type ForecastHorizon = 3 | 6 | 12;

export default function ForecastDashboard({ logs, lang }: ForecastDashboardProps) {
  const [metric, setMetric] = useState<ForecastMetric>("totalEnergyKwh");
  const [horizon, setHorizon] = useState<ForecastHorizon>(3);

  // Compute all metrics chronologically
  const historyMetrics = useMemo(() => {
    return computeAllMetrics(logs).sort((a, b) => a.month.localeCompare(b.month));
  }, [logs]);

  // Format dataset for forecast algorithm
  const forecastResult = useMemo(() => {
    if (historyMetrics.length < 2) return null;
    
    const formattedHistory = historyMetrics.map(m => ({
      monthStr: m.month,
      value: m[metric]
    }));

    return generateForecast(formattedHistory, horizon);
  }, [historyMetrics, metric, horizon]);

  const dict = {
    th: {
      title: "การทำนายและคาดการณ์อนาคต (Predictive Forecasting)",
      desc: "ใช้อัลกอริทึมการวิเคราะห์ถดถอยเชิงเส้น (Linear Regression) ในการวิเคราะห์สถิติประวัติข้อมูลเพื่อประมาณการแนวโน้มความต้องการและประสิทธิภาพในอนาคต",
      metricLabel: "ตัวชี้วัดที่ต้องการพยากรณ์",
      horizonLabel: "กรอบระยะเวลาทำนาย",
      accuracyLabel: "ความน่าเชื่อถือของตัวแบบ (Model R²)",
      accuracyDesc: "คำนวณจากสัมประสิทธิ์การตัดสินใจประวัติข้อมูล",
      chartTitle: "กราฟสถิติย้อนหลังร่วมกับช่วงทำนายอนาคต (95% Confidence Band)",
      insufficientData: "ข้อมูลประวัติไม่เพียงพอสำหรับการพยากรณ์",
      insufficientDesc: "กรุณากรอกข้อมูลรายเดือนในประวัติอย่างน้อย 3 เดือนขึ้นไปเพื่อเริ่มต้นระบบแบบจำลองพยากรณ์อนาคต",
      
      totalEnergyKwh: "ความต้องการพลังงานไฟฟ้า (kWh)",
      actualCostThb: "ประมาณการค่าใช้จ่ายพลังงาน (THB)",
      carbonEmissionKg: "ปริมาณการปล่อยก๊าซคาร์บอน (kg CO2)",
      pue: "ดัชนีประสิทธิภาพ PUE"
    },
    en: {
      title: "Predictive Energy Forecasting",
      desc: "Utilize advanced Linear Regression algorithms mapped against historical facility logs to estimate future load growth, capacity ceilings, and power efficiency.",
      metricLabel: "Forecast Parameter",
      horizonLabel: "Prediction Horizon",
      accuracyLabel: "Model Confidence (R² Value)",
      accuracyDesc: "Calculated dynamically based on historical variance.",
      chartTitle: "Historical Operations with 95% Confidence Forecast Band",
      insufficientData: "Insufficient Data for Modeling",
      insufficientDesc: "Please log at least 3 months of facility historical entries to run forecasting models.",
      
      totalEnergyKwh: "Total Energy Demand (kWh)",
      actualCostThb: "Energy Operations Cost (THB)",
      carbonEmissionKg: "Estimated Carbon Footprint (kgCO2)",
      pue: "Power Usage Effectiveness (PUE)"
    }
  };

  const t = dict[lang];

  if (!forecastResult || historyMetrics.length < 2) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-12 rounded-3xl text-center space-y-4">
        <LineChart className="w-12 h-12 text-slate-500 mx-auto animate-pulse" />
        <h3 className="font-display font-semibold text-slate-200 text-lg">{t.insufficientData}</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">{t.insufficientDesc}</p>
      </div>
    );
  }

  // Rounding variables for cleaner charts
  const chartData = forecastResult.forecast.map(p => ({
    ...p,
    "Historical Actual": p.actual !== null ? parseFloat(p.actual.toFixed(2)) : null,
    "Trend Forecast": parseFloat(p.forecast.toFixed(2)),
    "Confidence Range": [parseFloat(p.confidenceLower.toFixed(2)), parseFloat(p.confidenceUpper.toFixed(2))]
  }));

  const metricsOptions = [
    { value: "totalEnergyKwh", label: t.totalEnergyKwh, icon: Zap, color: "text-indigo-400" },
    { value: "actualCostThb", label: t.actualCostThb, icon: Coins, color: "text-emerald-400" },
    { value: "carbonEmissionKg", label: t.carbonEmissionKg, icon: Flame, color: "text-amber-400" },
    { value: "pue", label: t.pue, icon: Percent, color: "text-teal-400" }
  ];

  const horizonOptions = [
    { value: 3, label: lang === "th" ? "3 เดือนข้างหน้า" : "Next 3 Months" },
    { value: 6, label: lang === "th" ? "6 เดือนข้างหน้า" : "Next 6 Months" },
    { value: 12, label: lang === "th" ? "12 เดือนข้างหน้า" : "Next 12 Months" }
  ];

  // Pick color based on metric
  const getThemeColors = () => {
    switch(metric) {
      case "totalEnergyKwh": return { stroke: "#6366f1", fill: "#818cf8" };
      case "actualCostThb": return { stroke: "#10b981", fill: "#34d399" };
      case "carbonEmissionKg": return { stroke: "#f59e0b", fill: "#fbbf24" };
      case "pue": return { stroke: "#0d9488", fill: "#2dd4bf" };
    }
  };

  const colors = getThemeColors();

  // Custom tool tip rendering
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const actual = payload[0]?.payload["Historical Actual"];
      const forecast = payload[0]?.payload["Trend Forecast"];
      const range = payload[0]?.payload["Confidence Range"];

      return (
        <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl shadow-2xl text-xs space-y-1.5 font-mono">
          <p className="font-bold text-slate-300 font-sans border-b border-slate-850 pb-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span>{formatMonthYear(label)}</span>
          </p>
          {actual !== undefined && actual !== null && (
            <p className="text-slate-100 font-semibold">
              Actual: <span className="text-sky-400">{actual.toLocaleString()}</span>
            </p>
          )}
          <p className="text-slate-300 font-semibold">
            Forecasted: <span className="text-indigo-400">{forecast.toLocaleString()}</span>
          </p>
          {range && (
            <p className="text-[10px] text-slate-500 font-medium">
              Confidence Range: <span>{range[0].toLocaleString()} - {range[1].toLocaleString()}</span>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      
      {/* HEADER HERO */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-slate-100 uppercase tracking-wider">{t.title}</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">{t.desc}</p>
          </div>
        </div>

        {/* Dynamic Model Confidence Gauge */}
        <div className="bg-slate-950 px-4 py-3 rounded-xl border border-slate-850 text-left shrink-0">
          <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">{t.accuracyLabel}</span>
          <div className="flex items-center gap-2 mt-1">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <strong className="text-xl font-mono text-emerald-400">{forecastResult.accuracyPct}%</strong>
          </div>
          <p className="text-[9px] text-slate-500/80 mt-0.5 max-w-[150px] leading-tight">{t.accuracyDesc}</p>
        </div>
      </div>

      {/* FILTERS ZONE */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Metric Selector Rail */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl md:col-span-4 flex flex-col gap-2.5">
          <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">{t.metricLabel}</h4>
          {metricsOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = metric === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMetric(opt.value as any)}
                className={`p-3.5 rounded-xl border text-left cursor-pointer flex items-center justify-between transition-all ${
                  isSelected 
                    ? "bg-indigo-600/15 border-indigo-500 text-indigo-300 font-bold" 
                    : "bg-slate-950/40 border-slate-850 hover:border-slate-800 text-slate-400 hover:text-slate-300"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isSelected ? "text-indigo-400" : "text-slate-500"}`} />
                  <span className="text-xs">{opt.label}</span>
                </div>
                {isSelected && <ArrowUpRight className="w-4 h-4 text-indigo-400" />}
              </button>
            );
          })}

          <div className="mt-4 border-t border-slate-850 pt-4">
            <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">{t.horizonLabel}</h4>
            <div className="grid grid-cols-3 gap-2">
              {horizonOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setHorizon(opt.value as any)}
                  className={`py-2 px-1 text-[10px] font-bold rounded-lg border text-center transition-all cursor-pointer ${
                    horizon === opt.value
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : "bg-slate-950/40 border-slate-850 hover:border-slate-800 text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Forecast Visualization Chart */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl md:col-span-8 flex flex-col justify-between">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider">{t.chartTitle}</h3>
          </div>

          <div className="h-72 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ left: -15, right: 10, top: 10, bottom: 5 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis 
                  dataKey="monthStr" 
                  tickFormatter={formatMonthYear} 
                  stroke="#475569" 
                  style={{ fontSize: 9, fontFamily: "monospace" }} 
                />
                <YAxis stroke="#475569" style={{ fontSize: 9, fontFamily: "monospace" }} />
                <Tooltip content={<CustomTooltip />} />
                
                {/* Confidence Interval band */}
                <Area 
                  dataKey="Confidence Range" 
                  fill={colors.fill} 
                  stroke="none" 
                  opacity={0.08} 
                  name="Confidence Range (95%)"
                />

                {/* Historical Actual line */}
                <Line 
                  type="monotone" 
                  dataKey="Historical Actual" 
                  stroke="#ffffff" 
                  strokeWidth={2.5} 
                  dot={{ r: 3, fill: "#ffffff" }} 
                  name="Historical Actual"
                />

                {/* Forecast trend line */}
                <Line 
                  type="monotone" 
                  dataKey="Trend Forecast" 
                  stroke={colors.stroke} 
                  strokeWidth={2} 
                  strokeDasharray="5 5" 
                  dot={{ r: 2, fill: colors.stroke }} 
                  name="Statistical Forecast"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 p-2.5 rounded-xl border border-slate-850 text-[10px] text-slate-500 font-medium">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>The confidence band represents statistical variance levels; prediction accuracy increases with larger dataset history logs.</span>
          </div>
        </div>

      </div>

    </div>
  );
}
