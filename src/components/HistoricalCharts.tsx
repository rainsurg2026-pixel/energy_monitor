import { useState, useMemo } from "react";
import { MonthlyLog } from "../types";
import { formatMonthYear } from "../utils";
import { TrendingUp, Award, DollarSign, Activity, Zap } from "lucide-react";

interface HistoricalChartsProps {
  logs: MonthlyLog[];
  isGoogleConnected?: boolean;
  googleUserEmail?: string | null;
  lang?: "th" | "en";
}

type ChartMetric = "energy" | "cost" | "ups" | "air";

export default function HistoricalCharts({ logs, isGoogleConnected = false, googleUserEmail = null, lang = "th" }: HistoricalChartsProps) {
  const [activeMetric, setActiveMetric] = useState<ChartMetric>("energy");

  // Filter logs that have data for the active metric
  const chartData = useMemo(() => {
    // Sort chronological: e.g. "2026-01", "2026-02", etc.
    const sorted = [...logs].sort((a, b) => a.month.localeCompare(b.month));
    
    return sorted.map(log => {
      let value = 0;
      
      if (activeMetric === "energy") {
        value = log.energyCost.buildingEnergyKwh || 0;
      } else if (activeMetric === "cost") {
        value = log.energyCost.buildingElectricityCostThb || 0;
      } else if (activeMetric === "ups") {
        value = log.ups.reduce((acc, curr) => acc + (curr.loadKw || 0), 0);
      } else if (activeMetric === "air") {
        value = (log.air.eb41a || 0) + (log.air.eb41b || 0) + (log.air.eb42a || 0) + (log.air.eb42b || 0);
      }
      
      return {
        label: formatMonthYear(log.month),
        value,
        rawMonth: log.month
      };
    });
  }, [logs, activeMetric]);

  const maxVal = useMemo(() => {
    const values = chartData.map(d => d.value);
    const max = Math.max(...values, 0);
    return max === 0 ? 100 : max * 1.15; // Give 15% breathing room at the top
  }, [chartData]);

  const totalSum = useMemo(() => {
    return chartData.reduce((acc, d) => acc + d.value, 0);
  }, [chartData]);

  const averageVal = useMemo(() => {
    return chartData.length > 0 ? totalSum / chartData.length : 0;
  }, [chartData, totalSum]);

  // Generate SVG coordinates
  const height = 180;
  const width = 500;
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 15;
  const paddingBottom = 25;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = useMemo(() => {
    if (chartData.length < 2) return "";
    return chartData
      .map((d, idx) => {
        const x = paddingLeft + (idx / (chartData.length - 1)) * chartWidth;
        const y = paddingTop + chartHeight - (d.value / maxVal) * chartHeight;
        return `${x},${y}`;
      })
      .join(" ");
  }, [chartData, chartWidth, chartHeight, maxVal]);

  const gridLines = useMemo(() => {
    const lines = [];
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const y = paddingTop + chartHeight - ratio * chartHeight;
      const value = ratio * maxVal;
      lines.push({ y, value });
    }
    return lines;
  }, [chartHeight, maxVal]);

  if (logs.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-2">
        <Activity className="w-10 h-10 text-slate-600 mx-auto animate-pulse" />
        <h4 className="font-display font-medium text-slate-300 text-sm">No historical records available</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          Add and save data for one or more months to populate interactive trend visualizations.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-6">
      {/* Metrics Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>{lang === "th" ? "สถิติและเทรนด์ประวัติการใช้พลังงาน" : "Facility Trend Analytics"}</span>
            </h3>
            {isGoogleConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-400 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {lang === "th" ? `ข้อมูลหลัก: Google Sheets (${googleUserEmail})` : `Primary Source: Google Sheets (${googleUserEmail})`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold text-amber-400 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                {lang === "th" ? "ใช้ข้อมูลออฟไลน์ชั่วคราว" : "Offline Mode"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {lang === "th" 
              ? "วิเคราะห์และเปรียบเทียบกำลังไฟฟ้า ปริมาณการใช้พลังงาน และอัตราค่าไฟฟ้าเฉลี่ยจากข้อมูลที่ซิงค์" 
              : "Compare facility power, consumption, and utility rates over logged periods."}
          </p>
        </div>

        {/* Tab Selectors */}
        <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850/60">
          {(
            [
              { id: "energy", label: "Building Energy (kWh)" },
              { id: "cost", label: "Building Cost (THB)" },
              { id: "ups", label: "UPS Load (kW)" },
              { id: "air", label: "AC Consumption (GWh)" }
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveMetric(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                activeMetric === tab.id
                  ? "bg-indigo-650 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
              }`}
            >
              {tab.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Stats Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-slate-850/80 pb-5">
        <div className="bg-slate-950/40 border border-slate-850/50 p-4 rounded-xl space-y-1">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">Selected Metric</span>
          <p className="text-xs text-slate-300 font-semibold uppercase">
            {activeMetric === "energy" && "Building Electricity KWh"}
            {activeMetric === "cost" && "Electricity Cost (THB)"}
            {activeMetric === "ups" && "UPS Total Load (kW)"}
            {activeMetric === "air" && "AC Combined Energy (GWh)"}
          </p>
        </div>

        <div className="bg-slate-950/40 border border-slate-850/50 p-4 rounded-xl space-y-1">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">Total Accumulation</span>
          <p className="text-base font-semibold text-indigo-400 font-mono">
            {activeMetric === "energy" && `${totalSum.toLocaleString()} kWh`}
            {activeMetric === "cost" && `฿${totalSum.toLocaleString()}`}
            {activeMetric === "ups" && `${totalSum.toFixed(1)} kW-months`}
            {activeMetric === "air" && `${totalSum.toFixed(3)} GWh`}
          </p>
        </div>

        <div className="bg-slate-950/40 border border-slate-850/50 p-4 rounded-xl space-y-1">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">Monthly Average</span>
          <p className="text-base font-semibold text-emerald-400 font-mono">
            {activeMetric === "energy" && `${averageVal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} kWh`}
            {activeMetric === "cost" && `฿${averageVal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
            {activeMetric === "ups" && `${averageVal.toFixed(1)} kW`}
            {activeMetric === "air" && `${averageVal.toFixed(4)} GWh`}
          </p>
        </div>
      </div>

      {/* Beautiful Custom SVG Line Graph */}
      <div className="relative w-full overflow-hidden">
        {chartData.length < 2 ? (
          <div className="h-[180px] flex items-center justify-center text-xs text-slate-500 italic">
            At least 2 saved months are needed to plot historical curves.
          </div>
        ) : (
          <div className="w-full overflow-x-auto select-none">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full min-w-[450px] h-auto overflow-visible font-mono text-[9px] text-slate-500 fill-slate-500"
            >
              {/* Grid Lines & Y Axis Labels */}
              {gridLines.map((line, idx) => (
                <g key={idx}>
                  <line
                    x1={paddingLeft}
                    y1={line.y}
                    x2={width - paddingRight}
                    y2={line.y}
                    className="stroke-slate-800/80 stroke-1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={line.y + 3}
                    textAnchor="end"
                    className="fill-slate-500 font-medium"
                  >
                    {activeMetric === "cost" 
                      ? `฿${Math.round(line.value).toLocaleString()}` 
                      : line.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </text>
                </g>
              ))}

              {/* Area path for aesthetic glow */}
              <path
                d={`M ${paddingLeft},${paddingTop + chartHeight} 
                    L ${points} 
                    L ${paddingLeft + chartWidth},${paddingTop + chartHeight} Z`}
                className="fill-gradient opacity-10"
                style={{ fill: activeMetric === "cost" ? "#10b981" : "#6366f1" }}
              />

              {/* Trend Line */}
              <polyline
                fill="none"
                stroke={activeMetric === "cost" ? "#10b981" : "#6366f1"}
                strokeWidth="2.5"
                points={points}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="drop-shadow-[0_2px_4px_rgba(99,102,241,0.2)]"
              />

              {/* Interactive Data Nodes */}
              {chartData.map((d, idx) => {
                const x = paddingLeft + (idx / (chartData.length - 1)) * chartWidth;
                const y = paddingTop + chartHeight - (d.value / maxVal) * chartHeight;
                return (
                  <g key={idx} className="group cursor-pointer">
                    <circle
                      cx={x}
                      cy={y}
                      r="4"
                      className="fill-slate-900 stroke-2 transition-all duration-150"
                      style={{ stroke: activeMetric === "cost" ? "#10b981" : "#6366f1" }}
                    />
                    
                    {/* Tooltip Hover Overlay */}
                    <circle
                      cx={x}
                      cy={y}
                      r="9"
                      className="fill-transparent stroke-none group-hover:fill-indigo-500/10"
                    />

                    {/* Node Tooltip Label (Small value overlay) */}
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      className="opacity-0 group-hover:opacity-100 fill-slate-200 font-semibold bg-slate-950 px-1 transition-opacity duration-150 text-[8px]"
                    >
                      {activeMetric === "cost" ? `฿${Math.round(d.value)}` : d.value.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* X Axis Labels */}
              {chartData.map((d, idx) => {
                const x = paddingLeft + (idx / (chartData.length - 1)) * chartWidth;
                return (
                  <text
                    key={idx}
                    x={x}
                    y={height - 5}
                    textAnchor="middle"
                    className="fill-slate-400 font-semibold"
                  >
                    {d.label}
                  </text>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
