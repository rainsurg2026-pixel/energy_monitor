/** Shared Desktop/CleanWeb semantics for the dashboard's reporting-period
 * selector. In particular, "Last Month" means the second-most-recent
 * available record, never an invalid YYYY-Last Month string. */
export function monthsForReportingYear<T extends { month: string }>(logs: readonly T[], year: string): T[] {
  return [...logs].filter(log => log.month.startsWith(`${year}-`)).sort((left, right) => left.month.localeCompare(right.month));
}

export function selectedPeriodMonths<T extends { month: string }>(logs: readonly T[], year: string, period: string): T[] {
  const yearLogs = monthsForReportingYear(logs, year);
  if (period === "Entire Year" || period === "YTD") return yearLogs;
  if (period === "Last Month") return yearLogs.length > 1 ? [yearLogs.at(-2)!] : yearLogs;
  return /^(0[1-9]|1[0-2])$/.test(period) ? yearLogs.filter(log => log.month === `${year}-${period}`) : yearLogs;
}

export function selectedDashboardMonth<T extends { month: string }>(logs: readonly T[], year: string, period: string, fallback: string): string {
  const yearLogs = monthsForReportingYear(logs, year);
  if (period === "Last Month") return yearLogs.at(-2)?.month ?? yearLogs.at(-1)?.month ?? fallback;
  if (period === "Entire Year" || period === "YTD") return yearLogs.at(-1)?.month ?? fallback;
  if (/^(0[1-9]|1[0-2])$/.test(period)) return `${year}-${period}`;
  return fallback;
}

export function selectedPeriodAnchorIndex(months: readonly string[], period: string): number {
  if (months.length === 0) return -1;
  if (period === "Last Month") return Math.max(0, months.length - 2);
  const exact = /^(0[1-9]|1[0-2])$/.test(period) ? months.findIndex(month => month.endsWith(`-${period}`)) : -1;
  return exact >= 0 ? exact : months.length - 1;
}
