/**
 * Desktop v2.3.1's Reports & Export ("Reporting Center") names generated
 * files `Energy_Report_<Facility>_<YYYY-MM>.<ext>` - confirmed from its
 * Recent Reports history (e.g. "Energy_Report_Rangsit_2026-06.pdf",
 * "Energy_Report_Srinakarin_2026-06.pdf"), not assumed.
 */

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const KNOWN_EXTENSIONS = ["xlsx", "csv", "html", "pdf"] as const;
const MONTH_ABBREVIATIONS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type ExportExtension = (typeof KNOWN_EXTENSIONS)[number];

/** Strips characters invalid in a Windows filename, normalizing rather than
 *  rejecting - never modifies a name that was already valid. */
export function sanitizeFilename(name: string): string {
  return name.replace(INVALID_WINDOWS_CHARS, "-").trim();
}

/** Appends the correct extension, replacing any existing one of the three
 *  known export extensions (case-insensitive) so a user-typed ".xlsx" or
 *  ".XLSX" never becomes a duplicate ".xlsx.xlsx". An unrecognized
 *  extension (e.g. a literal ".xlsx" the user meant as part of the name)
 *  is left alone - only a match against a KNOWN export extension is
 *  stripped, so this never mangles user intent it can't recognize. */
export function withExtension(name: string, ext: ExportExtension): string {
  const knownExtPattern = new RegExp(`\\.(${KNOWN_EXTENSIONS.join("|")})$`, "i");
  const base = name.replace(knownExtPattern, "");
  return `${base}.${ext}`;
}

function currentFacilitySiteCode(facilityName: string): string {
  if (/rangsit/i.test(facilityName)) return "RST";
  if (/srinakarin/i.test(facilityName)) return "SNK";
  const fallback = sanitizeFilename(facilityName).replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return fallback.slice(0, 3) || "SITE";
}

function reportMonthToken(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const monthNumber = match ? Number(match[2]) : NaN;
  return match && monthNumber >= 1 && monthNumber <= 12
    ? `${MONTH_ABBREVIATIONS_EN[monthNumber - 1]}-${match[1]}`
    : sanitizeFilename(month);
}

/** Current Facility default basename, keyed to the selected report month. */
export function defaultReportFilename(facilityName: string, month: string): string {
  return `DC_Status_MonthlyReport of ${currentFacilitySiteCode(facilityName)}_${reportMonthToken(month)}`;
}

/** All Facilities stable default basename using the requested YYYY-Mmm token.
 * Facility names are appended when supplied so multi-site artifacts are
 * self-identifying outside the application. */
export function defaultAllFacilitiesReportFilename(month: string, facilityNames: readonly string[] = []): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const monthNumber = match ? Number(match[2]) : NaN;
  const token = match && monthNumber >= 1 && monthNumber <= 12
    ? `${match[1]}-${MONTH_ABBREVIATIONS_EN[monthNumber - 1]}`
    : sanitizeFilename(month);
  const sites = [...new Set(facilityNames.map(name => sanitizeFilename(name).replace(/\s+/g, "")).filter(Boolean))];
  const suffix = sites.length > 0 ? `_${sites.join("_")}` : "";
  return `All_Facilities_Energy_Report_${token}${suffix}`;
}

/** The name actually used at export time: sanitized, and never empty -
 *  falls back to the Desktop-standard default rather than ever producing
 *  a bare ".xlsx"/".csv"/".pdf". */
export function resolveFilename(userInput: string, facilityName: string, month: string): string {
  const sanitized = sanitizeFilename(userInput);
  return sanitized.length > 0 ? sanitized : defaultReportFilename(facilityName, month);
}
