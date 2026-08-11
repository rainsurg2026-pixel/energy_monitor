export class GoogleSheetsApiError extends Error {
  readonly code = "GOOGLE_SHEETS_API_ERROR";
  constructor(message: string, readonly status: number) { super(message); }
}

const REQUIRED_SHEETS = ["Data_Backup", "Backup_Log"] as const;

function sheetsBaseUrl(spreadsheetId: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const bodyText = await response.text().catch(() => "");
  throw new GoogleSheetsApiError(`${action} failed (${response.status}): ${bodyText.slice(0, 500)}`, response.status);
}

export interface SpreadsheetMetadata { title: string; sheetTitles: string[] }

/** Read-only: confirms the spreadsheet exists and the service account can
 *  see it, without writing anything - used by Test Connection so a check
 *  never has a side effect on the destination being tested. A 404 means
 *  the ID doesn't exist (or isn't shared at all - Sheets returns 404, not
 *  403, for a spreadsheet the caller has zero visibility into); a 403
 *  means it exists but the service account lacks access, which is the
 *  case the "please share this sheet" message is for. */
export async function getSpreadsheetMetadata(accessToken: string, spreadsheetId: string, fetchImpl: typeof fetch = fetch): Promise<SpreadsheetMetadata> {
  const response = await fetchImpl(`${sheetsBaseUrl(spreadsheetId)}?fields=properties.title,sheets.properties.title`, { headers: { authorization: `Bearer ${accessToken}` } });
  await assertOk(response, "Reading spreadsheet metadata");
  const body = await response.json() as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> };
  return { title: body.properties?.title ?? "(untitled)", sheetTitles: (body.sheets ?? []).map(sheet => sheet.properties?.title).filter((title): title is string => Boolean(title)) };
}

/** Creates whichever of the two required tabs (Data_Backup, Backup_Log)
 *  don't already exist in the spreadsheet. Never deletes or renames an
 *  existing tab, and is a no-op if both already exist - safe to call on
 *  every backup run, not just the first one against a given spreadsheet. */
export async function ensureSheetsExist(accessToken: string, spreadsheetId: string, existingTitles: readonly string[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const missing = REQUIRED_SHEETS.filter(title => !existingTitles.includes(title));
  if (missing.length === 0) return;
  const response = await fetchImpl(`${sheetsBaseUrl(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title } } })) })
  });
  await assertOk(response, "Creating required backup sheets");
}

/** Overwrites a sheet range with a fresh snapshot: clears the prior content
 *  first so a smaller new snapshot never leaves stale trailing rows behind,
 *  then writes the new rows. This is a snapshot-per-run strategy, not
 *  append-only - see DATA_BACKUP_AND_RECOVERY.md for why, given the current
 *  data volume this is unverified against (Supabase access blocked this
 *  session). Point-in-time recovery relies on Google Sheets' own built-in
 *  version history rather than a hand-rolled row-level revision log. */
export async function writeBackupSnapshot(accessToken: string, spreadsheetId: string, sheetName: string, rows: readonly (readonly (string | number)[])[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const clearResponse = await fetchImpl(`${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(sheetName)}:clear`, { method: "POST", headers });
  await assertOk(clearResponse, `Clearing sheet "${sheetName}"`);

  if (rows.length === 0) return;
  const updateResponse = await fetchImpl(
    `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(sheetName)}?valueInputOption=RAW`,
    { method: "PUT", headers, body: JSON.stringify({ range: sheetName, majorDimension: "ROWS", values: rows }) }
  );
  await assertOk(updateResponse, `Writing sheet "${sheetName}"`);
}

/** Appends rows to the end of a sheet without touching existing content -
 *  used for Backup_Log, which is genuinely append-only (one row per
 *  completed backup run, not a snapshot of current state). */
export async function appendBackupLogRow(accessToken: string, spreadsheetId: string, sheetName: string, row: readonly (string | number)[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(
    `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ range: sheetName, majorDimension: "ROWS", values: [row] }) }
  );
  await assertOk(response, `Appending to "${sheetName}"`);
}
