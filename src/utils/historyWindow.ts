/**
 * Return the latest real months at or before the selected reporting month.
 * Month keys are normalized ISO YYYY-MM values, so lexical ordering is
 * chronological and works across year boundaries.
 */
export function recentMonthsThroughSelected(
  months: readonly string[],
  selectedMonth: string | null | undefined,
  limit: number
): string[] {
  const validLimit = Math.max(0, Math.floor(limit));
  if (validLimit === 0) return [];
  const selected = /^\d{4}-(0[1-9]|1[0-2])$/u.test(selectedMonth ?? "") ? selectedMonth! : null;
  return Array.from(new Set(months.filter(month => /^\d{4}-(0[1-9]|1[0-2])$/u.test(month))))
    .filter(month => selected === null || month <= selected)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, validLimit);
}
