import { shiftMonth } from "./monthUtils";
import { recentMonthsThroughSelected } from "./historyWindow";

export type TrendRange = "Last 3 Months" | "Last 6 Months" | "Last 12 Months" | "All";

export const TREND_RANGE_OPTIONS: readonly TrendRange[] = ["Last 3 Months", "Last 6 Months", "Last 12 Months", "All"];

export function trendRangeSize(range: string): number | null {
  if (range === "Last 3 Months") return 3;
  if (range === "Last 6 Months") return 6;
  if (range === "Last 12 Months") return 12;
  return null;
}

/** Available-record window. Missing calendar months are not invented. */
export function availableMonthsForTrendRange(availableMonths: readonly string[], selectedMonth: string, range: string): string[] {
  const sorted = [...new Set(availableMonths)].filter(month => month <= selectedMonth).sort();
  const size = trendRangeSize(range);
  return size === null ? sorted : recentMonthsThroughSelected(sorted, selectedMonth, size).sort();
}

/** Calendar window for charts that must show gaps as gaps instead of silently
 * skipping an unsaved month. */
export function calendarMonthsForTrendRange(availableMonths: readonly string[], selectedMonth: string, range: string): string[] {
  const size = trendRangeSize(range);
  if (size !== null) return Array.from({ length: size }, (_, index) => shiftMonth(selectedMonth, index - (size - 1)));
  const first = [...new Set(availableMonths)].filter(month => month <= selectedMonth).sort()[0];
  if (!first) return [selectedMonth];
  const months: string[] = [];
  let cursor = first;
  while (cursor <= selectedMonth) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}
