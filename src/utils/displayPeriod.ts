/** Presentation-only data-period helpers. The workbook remains the source of
 * truth; these functions only select what a user sees in historical views and
 * exports. */

export const ALL_AVAILABLE_DATA = "all";

export function isAllAvailableDisplayPeriod(period: string | null | undefined): boolean {
  const normalized = String(period ?? "").trim().toLowerCase();
  return normalized === ALL_AVAILABLE_DATA || normalized === "all available data";
}

export function isMonthInDisplayPeriod(month: string, period: string | null | undefined): boolean {
  if (isAllAvailableDisplayPeriod(period)) return true;
  const year = String(period ?? "").trim();
  const range = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/u.exec(year);
  if (range) return month >= range[1] && month <= range[2];
  return /^\d{4}$/.test(year) && month.startsWith(`${year}-`);
}

export function filterLogsForDisplay<T extends { month: string }>(
  logs: readonly T[],
  period: string | null | undefined
): T[] {
  return logs.filter(log => isMonthInDisplayPeriod(log.month, period));
}
