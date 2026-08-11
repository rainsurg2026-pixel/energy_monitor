export class InvalidGoogleSheetsUrlError extends Error {
  readonly code = "INVALID_GOOGLE_SHEETS_URL";
}

/** Google's spreadsheet ID character set, per Google's own documentation:
 *  letters, digits, hyphens, underscores. */
const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{20,100}$/;

/** Server-side extraction only - a browser-supplied spreadsheet ID is never
 *  trusted independently of the URL it was (re)derived from here, so the
 *  same input the admin can see and edit is the only thing that can ever
 *  become the backup destination. Accepts the standard
 *  https://docs.google.com/spreadsheets/d/<ID>/edit... form and rejects
 *  everything else, including http (non-HTTPS), any other host, and any
 *  path shape that isn't /spreadsheets/d/<ID>. */
export function extractSpreadsheetId(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new InvalidGoogleSheetsUrlError("That is not a valid URL."); }
  if (parsed.protocol !== "https:") throw new InvalidGoogleSheetsUrlError("The Google Sheet URL must use https://.");
  if (parsed.hostname !== "docs.google.com") throw new InvalidGoogleSheetsUrlError("The URL must be a docs.google.com/spreadsheets link.");
  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([^/]+)(?:\/.*)?$/);
  if (!match) throw new InvalidGoogleSheetsUrlError("The URL must look like https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit.");
  const spreadsheetId = match[1];
  if (!SPREADSHEET_ID_PATTERN.test(spreadsheetId)) throw new InvalidGoogleSheetsUrlError("The spreadsheet ID in that URL does not look valid.");
  return spreadsheetId;
}

/** Canonical URL form stored/displayed for a given ID - independent of
 *  whatever URL variant (query params, gid fragment, trailing slash) the
 *  admin originally pasted. */
export function canonicalSheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Never show a full spreadsheet ID in an audit trail or log line -
 *  enough to distinguish two IDs in a history view, not enough to be
 *  useful to reconstruct the full ID from a leaked log. */
export function maskSpreadsheetId(spreadsheetId: string | null): string {
  if (!spreadsheetId) return "(none)";
  if (spreadsheetId.length <= 8) return `${spreadsheetId.slice(0, 2)}…`;
  return `${spreadsheetId.slice(0, 4)}…${spreadsheetId.slice(-4)}`;
}
