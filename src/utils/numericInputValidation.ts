export function exceedsDecimalPlaces(value: string, maxDecimalPlaces: number): boolean {
  if (!Number.isInteger(maxDecimalPlaces) || maxDecimalPlaces < 0) return false;
  const normalized = value.trim().replace(/,/g, "");
  const match = normalized.match(/^[+-]?(?:\d+)?(?:\.(\d*))?$/);
  if (!match) return false;
  return (match[1]?.length ?? 0) > maxDecimalPlaces;
}
