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

export type ReportingPeriodPreset = 3 | 6 | 12;
export interface MonthRange { startMonth: string; endMonth: string }

/** Resolve an inclusive calendar range ending at endMonth. */
export function resolveTrailingMonthRange(endMonth: string, count: ReportingPeriodPreset): MonthRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(endMonth);
  if (!match) throw new Error("Invalid reporting month: " + endMonth);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - count, 1));
  const startMonth = date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
  return { startMonth, endMonth };
}

/** Use the latest available months while preserving the requested trailing count. */
export function resolveAvailableTrailingMonthRange(endMonth: string, count: ReportingPeriodPreset, availableMonths: readonly string[] = []): MonthRange {
  const theoretical = resolveTrailingMonthRange(endMonth, count);
  const available = [...new Set(availableMonths)]
    .filter(month => /^(\d{4})-(0[1-9]|1[0-2])$/.test(month) && month <= endMonth)
    .sort();
  if (available.length === 0) return theoretical;
  const selected = available.slice(-count);
  return { startMonth: selected[0] ?? theoretical.startMonth, endMonth: selected.at(-1) ?? endMonth };
}

export function reportingPeriodForPreset(endMonth: string, count: ReportingPeriodPreset, availableMonths: readonly string[] = []): ReportingPeriodSelection {
  const range = resolveAvailableTrailingMonthRange(endMonth, count, availableMonths);
  return { mode: "range", singleMonth: range.endMonth, rangeStart: range.startMonth, rangeEnd: range.endMonth };
}

export function monthsForReportingPeriod(availableMonths: readonly string[], selection: ReportingPeriodSelection, currentMonth: string): string[] {
  const validMonths = [...new Set(availableMonths)].filter(month => /^(\d{4})-(0[1-9]|1[0-2])$/.test(month)).sort();
  if (selection.mode === "full") return validMonths;
  if (selection.mode === "current") return validMonths.filter(month => month === currentMonth);
  if (selection.mode === "single") return validMonths.filter(month => month === selection.singleMonth);
  const start = selection.rangeStart <= selection.rangeEnd ? selection.rangeStart : selection.rangeEnd;
  const end = selection.rangeStart <= selection.rangeEnd ? selection.rangeEnd : selection.rangeStart;
  return validMonths.filter(month => month >= start && month <= end);
}

export function matchingReportingPeriodPreset(selection: ReportingPeriodSelection, endMonth: string, availableMonths: readonly string[] = []): ReportingPeriodPreset | null {
  if (selection.mode !== "range") return null;
  const start = selection.rangeStart <= selection.rangeEnd ? selection.rangeStart : selection.rangeEnd;
  const end = selection.rangeStart <= selection.rangeEnd ? selection.rangeEnd : selection.rangeStart;
  for (const count of [3, 6, 12] as const) {
    const expected = reportingPeriodForPreset(endMonth, count, availableMonths);
    if (start === expected.rangeStart && end === expected.rangeEnd) return count;
  }
  return null;
}

export function defaultReportingPeriod(currentMonth: string, availableMonths: readonly string[] = []): ReportingPeriodSelection {
  return reportingPeriodForPreset(currentMonth, 3, availableMonths);
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
