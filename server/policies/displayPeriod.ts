import { previousUtcMonth } from "../../src/domain/dates";

export interface DisplayPeriod { startMonth: string; endMonth: string; rowVersion: number; }

export function isStrictMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 9999;
}

export function assertStrictMonth(value: unknown, field = "month"): string {
  if (!isStrictMonth(value)) throw new Error(`${field} must use canonical YYYY-MM format.`);
  return value;
}

export function assertDisplayPeriod(startMonth: string, endMonth: string): DisplayPeriod {
  assertStrictMonth(startMonth, "start_month");
  assertStrictMonth(endMonth, "end_month");
  if (startMonth > endMonth) throw new Error("start_month must be less than or equal to end_month.");
  return { startMonth, endMonth, rowVersion: 1 };
}

export function enumerateMonths(startMonth: string, endMonth: string): string[] {
  assertStrictMonth(startMonth, "start_month");
  assertStrictMonth(endMonth, "end_month");
  if (startMonth > endMonth) return [];
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  const result: string[] = [];
  let year = startYear;
  let month = startNumber;
  while (year < endYear || (year === endYear && month <= endNumber)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
    if (month === 13) { month = 1; year++; }
  }
  return result;
}

export function isAllowedMonth(month: string, period: Pick<DisplayPeriod, "startMonth" | "endMonth">): boolean {
  return isStrictMonth(month) && month >= period.startMonth && month <= period.endMonth;
}

export function allowedMonths(period: Pick<DisplayPeriod, "startMonth" | "endMonth">): string[] {
  return enumerateMonths(period.startMonth, period.endMonth);
}

export function visibleMonths(period: Pick<DisplayPeriod, "startMonth" | "endMonth">, available: readonly string[]): string[] {
  const allowed = new Set(allowedMonths(period));
  return [...new Set(available.filter(month => allowed.has(month)))].sort();
}

export function latestAvailableMonth(period: Pick<DisplayPeriod, "startMonth" | "endMonth">, available: readonly string[]): string | null {
  return visibleMonths(period, available).at(-1) ?? null;
}

/** Internal-only calculation dependency. The returned month is never a visible API month. */
export function previousCalculationMonth(month: string): string | null { return previousUtcMonth(month); }
