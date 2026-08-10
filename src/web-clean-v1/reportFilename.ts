/**
 * Desktop v2.3.1's Reports & Export ("Reporting Center") names generated
 * files `Energy_Report_<Facility>_<YYYY-MM>.<ext>` - confirmed from its
 * Recent Reports history (e.g. "Energy_Report_Rangsit_2026-06.pdf",
 * "Energy_Report_Srinakarin_2026-06.pdf"), not assumed.
 */

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const KNOWN_EXTENSIONS = ["xlsx", "csv", "pdf"] as const;
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

/** Desktop-standard default filename for a facility + reporting month. */
export function defaultReportFilename(facilityName: string, month: string): string {
  const safeFacility = sanitizeFilename(facilityName).replace(/\s+/g, "");
  return `Energy_Report_${safeFacility}_${month}`;
}

/** The name actually used at export time: sanitized, and never empty -
 *  falls back to the Desktop-standard default rather than ever producing
 *  a bare ".xlsx"/".csv"/".pdf". */
export function resolveFilename(userInput: string, facilityName: string, month: string): string {
  const sanitized = sanitizeFilename(userInput);
  return sanitized.length > 0 ? sanitized : defaultReportFilename(facilityName, month);
}
