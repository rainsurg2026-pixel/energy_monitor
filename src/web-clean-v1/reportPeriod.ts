import type { MonthlyLog } from "../types";

/** Matches Desktop v2.3.1's Reporting Period control on the Reports &
 *  Export screen (confirmed via direct inspection, not assumed): Current
 *  Month, Single Month, Month Range, Full History. */
export type ReportingPeriodMode = "current" | "single" | "range" | "full";

export interface ReportingPeriodSelection {
  mode: ReportingPeriodMode;
  singleMonth: string;
  rangeStart: string;
  rangeEnd: string;
}

export function defaultReportingPeriod(currentMonth: string): ReportingPeriodSelection {
  return { mode: "current", singleMonth: currentMonth, rangeStart: currentMonth, rangeEnd: currentMonth };
}

/** Filters already-fetched logs down to the months implied by the selected
 *  Reporting Period. Never recomputes or invents log data - purely
 *  selects which months are included before handing off to the existing,
 *  unmodified CSV/Excel/PDF builders. */
export function filterLogsByPeriod(logs: readonly MonthlyLog[], selection: ReportingPeriodSelection, currentMonth: string): MonthlyLog[] {
  switch (selection.mode) {
    case "current": return logs.filter(log => log.month === currentMonth);
    case "single": return logs.filter(log => log.month === selection.singleMonth);
    case "range": {
      const [start, end] = selection.rangeStart <= selection.rangeEnd ? [selection.rangeStart, selection.rangeEnd] : [selection.rangeEnd, selection.rangeStart];
      return logs.filter(log => log.month >= start && log.month <= end);
    }
    case "full": return [...logs];
  }
}

export function reportingPeriodLabel(selection: ReportingPeriodSelection, lang: "th" | "en"): string {
  switch (selection.mode) {
    case "current": return lang === "th" ? "เดือนปัจจุบัน" : "Current Month";
    case "single": return lang === "th" ? `เดือนเดียว: ${selection.singleMonth}` : `Single Month: ${selection.singleMonth}`;
    case "range": return lang === "th" ? `ช่วง ${selection.rangeStart} ถึง ${selection.rangeEnd}` : `Range: ${selection.rangeStart} to ${selection.rangeEnd}`;
    case "full": return lang === "th" ? "ประวัติทั้งหมด" : "Full History";
  }
}

/** The single reporting month a period selection resolves to for display
 *  purposes (PDF header, filename). Range mode has no single month - callers
 *  fall back to their own label for that case. */
export function effectiveMonth(selection: ReportingPeriodSelection, currentMonth: string): string {
  switch (selection.mode) {
    case "current": return currentMonth;
    case "single": return selection.singleMonth;
    case "range": return selection.rangeEnd;
    case "full": return currentMonth;
  }
}
