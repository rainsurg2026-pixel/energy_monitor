/**
 * Timeline - a horizontal month-strip navigation at the top of the
 * Rack Capacity view. Clicking a month changes the shared Reporting
 * Month in RackCapacityContext. All month math comes from
 * monthUtils / timelineUtils — no per-component arrays.
 */
import React from "react";
import { useRackCapacity } from "./RackCapacityContext";
import { generateMonthRange } from "../../utils/timelineUtils";
import { monthLabelShort, shiftMonth } from "../../utils/monthUtils";

/** Months of padding shown before/after the persisted-history range (or
 *  around the Reporting Month, when there's no history yet) - keeps this
 *  the ONE always-available Reporting Month control, so no other panel
 *  needs its own month/year picker. */
const PAST_PADDING_MONTHS = 6;
const FUTURE_PADDING_MONTHS = 3;

export const Timeline: React.FC<{
  /** Web supplies this after checking its API-backed monthly records. */
  canSelectMonth?: (month: string) => boolean;
  /** Desktop owns snapshots locally; Web asks its parent to load first. */
  onMonthSelect?: (month: string) => void;
}> = ({ canSelectMonth, onMonthSelect }) => {
  const { lang, reportingMonth, setReportingMonth, availableMonths } = useRackCapacity();

  const strip = React.useMemo(() => {
    const earliest = availableMonths.length > 0 ? availableMonths[0] : reportingMonth;
    const latest = availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : reportingMonth;
    const start = shiftMonth([earliest, reportingMonth].sort()[0], -PAST_PADDING_MONTHS);
    const end = shiftMonth([latest, reportingMonth].sort()[1], FUTURE_PADDING_MONTHS);
    return generateMonthRange(start, end, 0);
  }, [availableMonths, reportingMonth]);

  return (
    <nav className="flex items-center gap-1 overflow-x-auto py-2 px-1" aria-label={lang === "th" ? "ตัวเลือกเดือนรายงาน" : "Reporting month selector"}>
      <span className="text-[10px] uppercase tracking-wide text-slate-600 mr-2 shrink-0">
        {lang === "th" ? "เดือน" : "Month"}
      </span>
      {strip.map(month => {
        const active = month === reportingMonth;
        const hasData = availableMonths.includes(month);
        const selectable = onMonthSelect === undefined || canSelectMonth?.(month) !== false;
        return (
          <button
            type="button"
            key={month}
            onClick={() => {
              // Desktop owns snapshots in the local provider. Web must ask
              // its parent to load the selected API snapshot before switching.
              if (onMonthSelect) onMonthSelect(month);
              else setReportingMonth(month);
            }}
            disabled={!selectable}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${
              active
                ? "bg-indigo-600 text-white border-indigo-600"
                : hasData
                  ? "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                  : "bg-slate-900 text-slate-600 border-slate-800 cursor-default"
            }`}
            aria-pressed={active}
          >
            {monthLabelShort(month, lang)}
            {!hasData && (
              <span className="ml-0.5 text-[9px] text-slate-500" title={lang === "th" ? "ยังไม่มีข้อมูล" : "No data yet"}>○</span>
            )}
          </button>
        );
      })}
      <span className="ml-2 text-[11px] text-slate-600 shrink-0">
        {lang === "th" ? `รายงาน: ${monthLabelShort(reportingMonth, lang)}` : `Reporting: ${monthLabelShort(reportingMonth, lang)}`}
      </span>
    </nav>
  );
};
