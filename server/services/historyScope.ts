export const INITIAL_HISTORY_MONTHS = 6;

/** The dashboard/entry bootstrap window is intentionally bounded. The
 * complete visible month list remains available for navigation, while older
 * records are fetched by the month endpoint or the full History/Reports view. */
export function historyMonthsForScope(months: readonly string[], scope: "dashboard" | "rack" | "full"): string[] {
  return scope === "dashboard" ? [...months].sort().slice(-INITIAL_HISTORY_MONTHS) : [...months];
}
