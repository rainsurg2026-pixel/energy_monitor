/**
 * Forecast - usage % trend line across real history plus a 12-month
 * regression forecast, plus the Executive summary line (forecast
 * exhaustion month, remaining capacity, trend, confidence). All curve/
 * regression math comes from capacityForecast - this module never
 * re-derives slope/R²/crossing math. Confidence is regression.rSquared;
 * "not enough history" is shown rather than ever fabricating a projection.
 */
import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useRackCapacity } from "./RackCapacityContext";
import { monthLabelLong, monthLabelShort } from "../../utils/monthUtils";
import { getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";
import { MIN_FORECAST_HISTORY_MONTHS } from "../../utils/capacityForecast";
import { formatFixedPercentage } from "../../utils/numberFormatBridge";

export const Forecast: React.FC = () => {
  const { lang, usageForecast, usageHistory, regression } = useRackCapacity();

  const historyMonthSet = React.useMemo(() => new Set(usageHistory.map(p => p.month)), [usageHistory]);

  const chartData = React.useMemo(() => {
    return usageForecast.map(p => ({
      month: monthLabelShort(p.month, lang),
      history: historyMonthSet.has(p.month) ? p.value : null,
      forecast: historyMonthSet.has(p.month) ? null : p.value,
      isForecast: !historyMonthSet.has(p.month)
    }));
  }, [usageForecast, historyMonthSet, lang]);

  const allNull = chartData.every(d => d.history === null && d.forecast === null);

  if (usageHistory.length < MIN_FORECAST_HISTORY_MONTHS) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <h3 className="text-base text-slate-100 mb-2">{lang === "th" ? "แนวโน้มและพยากรณ์ความจุ" : "Capacity Trend and Forecast"}</h3>
        <p className="text-sm text-slate-500">{lang === "th" ? "ประวัติไม่เพียงพอ" : "Insufficient History"}</p>
        <p className="text-xs text-slate-600 mt-1">
          {lang === "th"
            ? `ต้องมีประวัติอย่างน้อย ${MIN_FORECAST_HISTORY_MONTHS} เดือนจึงจะพยากรณ์ได้ (ขณะนี้มี ${usageHistory.length})`
            : `Requires at least ${MIN_FORECAST_HISTORY_MONTHS} months of history to forecast (currently ${usageHistory.length}).`}
        </p>
      </section>
    );
  }

  const exhaustionMonth = regression ? regression.crosses(100) : null;
  const latestUsage = usageHistory[usageHistory.length - 1].value;
  const remainingCapacityPct = Math.max(0, Math.min(100, 100 - latestUsage));
  const trendDirection = regression ? getTrendDirection(regression.slope, 0.05) : "Unknown";
  const confidencePct = regression ? regression.rSquared * 100 : null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
      <h3 className="text-base text-slate-100 mb-2">{lang === "th" ? "แนวโน้มและพยากรณ์ความจุ" : "Capacity Trend and Forecast"}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: -4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" stroke="#64748b" fontSize={11} padding={{ left: 4, right: 4 }} />
            <YAxis stroke="#64748b" fontSize={11} unit="%" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
              formatter={(value: number | null) => (value === null ? "-" : formatFixedPercentage(value, 1))}
            />
            {!allNull && <Line type="monotone" dataKey="history" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} name={lang === "th" ? "ประวัติ" : "History"} />}
            {!allNull && <Line type="monotone" dataKey="forecast" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls={false} name={lang === "th" ? "พยากรณ์" : "Forecast"} />}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{lang === "th" ? "เดือนที่คาดว่าเต็มความจุ" : "Forecast Exhaustion Month"}</p>
          <p className="text-sm font-mono text-slate-100 mt-1">
            {exhaustionMonth ? monthLabelLong(exhaustionMonth, lang) : (lang === "th" ? "ไม่คาดว่าจะเต็ม" : "Not projected")}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{lang === "th" ? "ความจุคงเหลือ" : "Remaining Capacity"}</p>
          <p className="text-sm font-mono text-slate-100 mt-1">{formatFixedPercentage(remainingCapacityPct, 1)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{lang === "th" ? "แนวโน้ม" : "Trend"}</p>
          <p className="text-sm font-mono text-slate-100 mt-1">{getTrendLabel(trendDirection, lang)}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{lang === "th" ? "ความเชื่อมั่น" : "Confidence"}</p>
          <p className="text-sm font-mono text-slate-100 mt-1">{confidencePct === null ? "—" : formatFixedPercentage(confidencePct, 0)}</p>
        </div>
      </div>
    </section>
  );
};
