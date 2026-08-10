export class GoogleSheetsApiError extends Error {
  readonly code = "GOOGLE_SHEETS_API_ERROR";
}

function sheetsBaseUrl(spreadsheetId: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const bodyText = await response.text().catch(() => "");
  throw new GoogleSheetsApiError(`${action} failed (${response.status}): ${bodyText.slice(0, 500)}`);
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
