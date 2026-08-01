/**
 * Canonical "YYYY-MM" month helpers shared by every Rack Capacity view
 * (summary card, editors, history panel, timeline, KPI cards). Consolidates
 * what used to be separate MONTH_NAMES_EN/TH arrays and shiftMonth copies in
 * RackCapacitySummaryCard.tsx, RackCapacityEditor.tsx, RackUnitCapacityPanel.tsx
 * and RackCapacityHistoryPanel.tsx - one source, so a locale fix or an
 * off-by-one never has to be found and fixed four times.
 */

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const MONTH_ABBR_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_ABBR_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function monthNames(lang: "th" | "en"): string[] {
  return lang === "th" ? MONTH_NAMES_TH : MONTH_NAMES_EN;
}

/** "2026-07" -> "July 2026" / "กรกฎาคม 2026". Falls back to the raw string if unparsable. */
export function monthLabelLong(month: string, lang: "th" | "en"): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const names = monthNames(lang);
  if (!Number.isFinite(year) || !names[monthIndex]) return month;
  return `${names[monthIndex]} ${year}`;
}

/** "2026-07" -> "Jul-26" / "ก.ค.-26" - compact form for tables/charts/timeline. */
export function monthLabelShort(month: string, lang: "th" | "en"): string {
  const [yearStr, monthStr] = month.split("-").map(Number);
  const names = lang === "th" ? MONTH_ABBR_TH : MONTH_ABBR_EN;
  const name = names[monthStr - 1];
  if (!name || !Number.isFinite(yearStr)) return month;
  return `${name}-${String(yearStr).slice(2)}`;
}

/** Shifts a "YYYY-MM" string by `delta` whole months (negative goes back). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** Current calendar month as canonical "YYYY-MM". Local-time-safe: uses
 *  getFullYear/getMonth rather than toISOString, which can report the
 *  previous month for the first hours of the 1st in UTC+ timezones. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** The "YYYY" year portion of a canonical "YYYY-MM" string. */
export function yearOf(month: string): string {
  return month.split("-")[0] ?? month;
}
