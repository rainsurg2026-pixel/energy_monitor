/**
 * StickyHeader - the always-visible top bar of the Rack Capacity page.
 * Purely presentational: facility, the single shared Reporting Month (from
 * RackCapacityContext), and a month-over-month usage trend chip whose math
 * comes from trendCalculator. Never owns month state itself.
 */
import React from "react";
import { useRackCapacity } from "./RackCapacityContext";
import { monthLabelLong } from "../../utils/monthUtils";
import { calculatePercentageDelta, getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";

export const StickyHeader: React.FC = () => {
  const { lang, facilityName, reportingMonth, usageHistory } = useRackCapacity();

  const trend = React.useMemo(() => {
    if (usageHistory.length < 2) return null;
    const current = usageHistory[usageHistory.length - 1].value;
    const previous = usageHistory[usageHistory.length - 2].value;
    const pct = calculatePercentageDelta(current, previous);
    return { pct, direction: getTrendDirection(pct) };
  }, [usageHistory]);

  const trendColor =
    trend === null ? "text-slate-500" : trend.direction === "Up" ? "text-emerald-400" : trend.direction === "Down" ? "text-rose-400" : "text-slate-400";

  return (
    <header className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur border border-slate-800 rounded-2xl px-5 py-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">{lang === "th" ? "ความจุแร็คและการใช้งาน" : "Rack Capacity and Utilization"}</h1>
          <p className="text-xs text-slate-500">{facilityName ?? (lang === "th" ? "ไม่มีข้อมูลสถานที่" : "No facility selected")}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-slate-300">
          {lang === "th" ? "เดือนรายงาน" : "Reporting Month"}: <span className="font-semibold text-slate-100">{monthLabelLong(reportingMonth, lang)}</span>
        </span>
        {trend !== null && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 border border-slate-800 ${trendColor}`}>
            {trend.direction === "Up" ? "▲" : trend.direction === "Down" ? "▼" : "◆"} {Math.abs(trend.pct).toFixed(1)}% {getTrendLabel(trend.direction, lang)}
          </span>
        )}
      </div>
    </header>
  );
};
