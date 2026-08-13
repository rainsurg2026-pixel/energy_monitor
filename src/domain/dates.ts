/** Pure date rules used by the Desktop formula contract. */

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Preserves the Desktop parser, including its accepted prefix forms. */
export function normalizedMonth(month: string): string | null {
  const value = String(month ?? "").trim();
  const numericMatch = value.match(/^(\d{4})[-\/]?(\d{1,2})/);
  const shortMatch = value.match(/^([A-Za-z]{3})[-\/]?(\d{2}|\d{4})$/);
  let year: number;
  let monthNumber: number;
  if (numericMatch) {
    year = Number(numericMatch[1]);
    monthNumber = Number(numericMatch[2]);
  } else if (shortMatch) {
    const monthIndex = MONTH_NAMES.indexOf(shortMatch[1].toLowerCase());
    if (monthIndex < 0) return null;
    year = Number(shortMatch[2]);
    year = year < 100 ? 2000 + year : year;
    monthNumber = monthIndex + 1;
  } else {
    return null;
  }
  if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) return null;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export function previousUtcMonth(month: string): string | null {
  const normalized = normalizedMonth(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInUtcMonth(month: string): number | null {
  const normalized = normalizedMonth(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** Preserves the legacy UPS/dashboard fallback for malformed month strings. */
export function daysInLocalMonthOr30(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 30;
}

export function previousMonthOrEmpty(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  return `${monthNumber === 1 ? year - 1 : year}-${String(monthNumber === 1 ? 12 : monthNumber - 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year * 12 + (monthNumber - 1) + delta;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = ((total % 12) + 12) % 12;
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, "0")}`;
}

export function yearOf(month: string): string { return month.split("-")[0] ?? month; }
