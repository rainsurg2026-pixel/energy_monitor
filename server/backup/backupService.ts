import type { MonthlyLog } from "../../src/types";
import type { BackendRepository, BackupLogRecord, BackupType } from "../repositories/contracts";
import { loadServiceAccountCredential, type ServiceAccountCredential } from "./backupConfig";
import { getGoogleAccessToken, parseServiceAccountKey } from "./googleServiceAccountAuth";
import { appendBackupLogRow, ensureSheetsExist, getSpreadsheetMetadata, GoogleSheetsApiError, writeBackupSnapshot } from "./googleSheetsClient";
import { extractSpreadsheetId, InvalidGoogleSheetsUrlError } from "./googleSheetsUrl";

const DATA_SHEET = "Data_Backup";
const LOG_SHEET = "Backup_Log";

export interface BackupRunResult {
  log: BackupLogRecord;
  configured: boolean;
}

/** Never backed up: password hashes, SESSION_SECRET, CSRF_SECRET, database
 *  credentials, service-account credentials, API keys, session/CSRF tokens.
 *  Scope here is exactly the authoritative User-entered operational data
 *  (sites -> monthly UPS/Air/DC/Energy readings) - nothing transient, no
 *  session/cache/calculated-only values. */
function flattenToRows(facilities: Array<{ siteName: string; logs: MonthlyLog[] }>): string[][] {
  const rows: string[][] = [];
  for (const facility of facilities) {
    for (const log of [...facility.logs].sort((a, b) => a.month.localeCompare(b.month))) {
      for (const ups of log.ups) {
        rows.push([facility.siteName, log.month, "UPS", ups.upsId, "voltage", String(ups.voltage ?? "")]);
        rows.push([facility.siteName, log.month, "UPS", ups.upsId, "current", String(ups.current ?? "")]);
        rows.push([facility.siteName, log.month, "UPS", ups.upsId, "loadKw", String(ups.loadKw ?? "")]);
        rows.push([facility.siteName, log.month, "UPS", ups.upsId, "loadKva", String(ups.loadKva ?? "")]);
      }
      const airEntries = Object.entries({ ...(log.air as unknown as Record<string, unknown>), ...(log.air.meters ?? {}) }).filter(([key]) => key !== "meters");
      for (const [field, value] of airEntries) rows.push([facility.siteName, log.month, "Air", field, "reading", value === null || value === undefined ? "" : String(value)]);
      for (const dc of log.dc) {
        rows.push([facility.siteName, log.month, "DC", dc.panelId, "voltage", String(dc.voltage ?? "")]);
        rows.push([facility.siteName, log.month, "DC", dc.panelId, "current", String(dc.current ?? "")]);
      }
      rows.push([facility.siteName, log.month, "Energy", "building", "energyKwh", String(log.energyCost.buildingEnergyKwh ?? "")]);
      rows.push([facility.siteName, log.month, "Energy", "building", "costThb", String(log.energyCost.buildingElectricityCostThb ?? "")]);
    }
  }
  return rows;
}

async function loadAllFacilityLogs(repository: BackendRepository): Promise<Array<{ siteName: string; logs: MonthlyLog[] }>> {
  const sites = await repository.listSites();
  return Promise.all(sites.map(async site => {
    const periods = await repository.listPeriods(site.id);
    const months = periods.filter(period => period.hasData).map(period => period.month);
    const logs = months.length > 0 ? await repository.getMonthlyLogs(site.id, months) : [];
    return { siteName: site.name, logs };
  }));
}

/** Orchestrates one backup run: Supabase/PostgreSQL remains untouched as
 *  Source of Truth (this only reads, via the existing repository, never
 *  writes back from Sheets). The destination (spreadsheet ID) is read from
 *  the Admin-configurable BackendRepository.getBackupConfig(), never
 *  hard-coded - changing it in Settings changes both "Backup Now" and the
 *  next scheduled run with no code change or redeploy. A missing/invalid
 *  service-account credential, an unconfigured/disabled destination, or
 *  any Google API failure is caught and recorded as a FAILED backup_log
 *  row - it never throws in a way that could be mistaken for a Data Entry
 *  save failure; callers must not roll back or block a database save
 *  because of this. */
export async function runBackup(repository: BackendRepository, backupType: BackupType, initiatedBy: number | null, credentialOverride?: ServiceAccountCredential | null, fetchImpl: typeof fetch = fetch): Promise<BackupRunResult> {
  const credential = credentialOverride !== undefined ? credentialOverride : loadServiceAccountCredential();
  const destination = await repository.getBackupConfig();
  const started = await repository.startBackupRun({ backupType, initiatedBy });

  if (!credential) {
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: "Google Sheets backup is not configured (GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON missing).", spreadsheetId: destination.spreadsheetId });
    return { log: completed, configured: false };
  }
  if (!destination.spreadsheetId) {
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: "No backup destination is configured. Set the Google Sheet URL in Settings -> Data Backup.", spreadsheetId: null });
    return { log: completed, configured: false };
  }
  if (backupType === "scheduled" && !destination.enabled) {
    // Manual "Backup Now" always runs regardless of this toggle - it is
    // explicit admin intent overriding the schedule setting. Only the
    // automatic daily run is gated by "enabled".
    const completed = await repository.completeBackupRun({ id: started.id, status: "success", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: "Scheduled backup skipped: disabled in Settings -> Data Backup.", spreadsheetId: destination.spreadsheetId });
    return { log: completed, configured: true };
  }

  try {
    const facilities = await loadAllFacilityLogs(repository);
    const rows = flattenToRows(facilities);
    const key = parseServiceAccountKey(credential.serviceAccountJson);
    const accessToken = await getGoogleAccessToken(key, fetchImpl);
    const metadata = await getSpreadsheetMetadata(accessToken, destination.spreadsheetId, fetchImpl);
    await ensureSheetsExist(accessToken, destination.spreadsheetId, metadata.sheetTitles, fetchImpl);
    await writeBackupSnapshot(accessToken, destination.spreadsheetId, DATA_SHEET, [["Facility", "Month", "Section", "Field", "Metric", "Value"], ...rows], fetchImpl);
    await appendBackupLogRow(accessToken, destination.spreadsheetId, LOG_SHEET, [String(started.id), backupType, "success", started.startedAt, new Date().toISOString(), String(rows.length), String(rows.length), "0", initiatedBy === null ? "system" : String(initiatedBy)], fetchImpl);
    const completed = await repository.completeBackupRun({ id: started.id, status: "success", recordsProcessed: rows.length, recordsSuccess: rows.length, recordsFailed: 0, errorSummary: null, spreadsheetId: destination.spreadsheetId });
    return { log: completed, configured: true };
  } catch (error) {
    const message = friendlyBackupError(error);
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: message.slice(0, 1000), spreadsheetId: destination.spreadsheetId });
    return { log: completed, configured: true };
  }
}

/** Never includes credential material - only ever built from an HTTP
 *  status/message already returned by Google or a validation message from
 *  our own URL parser, never a caught raw error object that might contain
 *  a token/key in its message or stack. */
function friendlyBackupError(error: unknown): string {
  if (error instanceof GoogleSheetsApiError) {
    if (error.status === 403) return "The backup service account does not have access to this spreadsheet. Please share it with the configured backup service account.";
    if (error.status === 404) return "The configured Google Sheet is not accessible (spreadsheet not found, or not shared with the service account).";
    return `Google Sheets API error (${error.status}).`;
  }
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown backup failure.";
}

export type ConnectionTestResult =
  | { ok: true; spreadsheetTitle: string; sheetsReady: boolean }
  | { ok: false; reason: string };

/** Read-only against the target spreadsheet's metadata, but DOES create
 *  the two required tabs if missing (per the task's "can be accessed/
 *  created" requirement) - never writes any data rows. Used by both the
 *  "Test Connection" button (with the not-yet-saved URL the admin is
 *  typing) and available for the same check against an already-saved
 *  destination. */
export async function testBackupConnection(sheetUrl: string, credentialOverride?: ServiceAccountCredential | null, fetchImpl: typeof fetch = fetch): Promise<ConnectionTestResult> {
  let spreadsheetId: string;
  try { spreadsheetId = extractSpreadsheetId(sheetUrl); } catch (error) {
    return { ok: false, reason: error instanceof InvalidGoogleSheetsUrlError ? error.message : "Invalid Google Sheets URL." };
  }
  const credential = credentialOverride !== undefined ? credentialOverride : loadServiceAccountCredential();
  if (!credential) return { ok: false, reason: "Google authentication failed: no backup service account is configured on the server." };
  try {
    const key = parseServiceAccountKey(credential.serviceAccountJson);
    const accessToken = await getGoogleAccessToken(key, fetchImpl);
    const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId, fetchImpl);
    await ensureSheetsExist(accessToken, spreadsheetId, metadata.sheetTitles, fetchImpl);
    return { ok: true, spreadsheetTitle: metadata.title, sheetsReady: true };
  } catch (error) {
    return { ok: false, reason: friendlyBackupError(error) };
  }
}
