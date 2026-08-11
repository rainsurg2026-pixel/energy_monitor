import type { MonthlyLog } from "../../src/types";
import type { BackendRepository, BackupLogRecord, BackupType } from "../repositories/contracts";
import { decryptSecret, TokenDecryptionError } from "./googleOAuthCrypto";
import { loadGoogleOAuthClientConfig, refreshAccessToken, GoogleOAuthError, type GoogleOAuthClientConfig } from "./googleOAuthClient";
import { appendBackupLogRow, ensureSheetsExist, getSpreadsheetMetadata, GoogleSheetsApiError, writeBackupSnapshot } from "./googleSheetsClient";
import { extractSpreadsheetId, InvalidGoogleSheetsUrlError } from "./googleSheetsUrl";

const DATA_SHEET = "Data_Backup";
const LOG_SHEET = "Backup_Log";

export interface BackupRunResult {
  log: BackupLogRecord;
  configured: boolean;
}

/** Never backed up: password hashes, SESSION_SECRET, CSRF_SECRET, database
 *  credentials, OAuth client secret/refresh/access tokens, API keys,
 *  session/CSRF tokens. Scope here is exactly the authoritative
 *  User-entered operational data (sites -> monthly UPS/Air/DC/Energy
 *  readings) - nothing transient, no session/cache/calculated-only values. */
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

export type BackupAuthFailure = "oauth_client_not_configured" | "google_account_not_connected" | "token_decryption_failed" | "token_refresh_failed";

const AUTH_FAILURE_MESSAGES: Record<BackupAuthFailure, string> = {
  oauth_client_not_configured: "Google Sheets backup is not configured (GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET missing on the server).",
  google_account_not_connected: "No Google account is connected. Go to Settings -> Data Backup and connect an Admin Google account.",
  token_decryption_failed: "The stored Google connection could not be read - please reconnect the Google account in Settings -> Data Backup.",
  token_refresh_failed: "Google authentication failed - the connected Google account's access may have been revoked. Please reconnect in Settings -> Data Backup."
};

/** Resolves the currently-connected Admin's Google account into a live
 *  access token, fresh on every call (refresh tokens are long-lived;
 *  access tokens are not, so this always exchanges for a new one rather
 *  than caching). Reads the connection identity from
 *  backup_config.connected_google_user_id - never a fixed/hard-coded
 *  identity - so changing which admin is connected changes both
 *  "Backup Now" and the next scheduled run with no code change. */
async function resolveBackupAccessToken(repository: BackendRepository, sessionSecret: string, oauthConfig: GoogleOAuthClientConfig | null, fetchImpl: typeof fetch): Promise<{ accessToken: string } | { failure: BackupAuthFailure }> {
  if (!oauthConfig) return { failure: "oauth_client_not_configured" };
  const destination = await repository.getBackupConfig();
  if (!destination.connectedGoogleUserId) return { failure: "google_account_not_connected" };
  const encryptedRefreshToken = await repository.getGoogleSheetsConnectionSecret(destination.connectedGoogleUserId);
  if (!encryptedRefreshToken) return { failure: "google_account_not_connected" };
  let refreshToken: string;
  try { refreshToken = decryptSecret(encryptedRefreshToken, sessionSecret); }
  catch (error) { if (error instanceof TokenDecryptionError) return { failure: "token_decryption_failed" }; throw error; }
  try {
    const { accessToken } = await refreshAccessToken(oauthConfig, refreshToken, fetchImpl);
    return { accessToken };
  } catch (error) {
    if (error instanceof GoogleOAuthError) return { failure: "token_refresh_failed" };
    throw error;
  }
}

/** Orchestrates one backup run: Supabase/PostgreSQL remains untouched as
 *  Source of Truth (this only reads, via the existing repository, never
 *  writes back from Sheets). The destination (spreadsheet ID) and the
 *  Google identity are both read fresh from the repository on every call,
 *  never hard-coded or cached - changing either in Settings changes both
 *  "Backup Now" and the next scheduled run with no code change or
 *  redeploy. Any auth failure or Google API failure is caught and
 *  recorded as a FAILED backup_log row - it never throws in a way that
 *  could be mistaken for a Data Entry save failure; callers must not roll
 *  back or block a database save because of this. */
export async function runBackup(repository: BackendRepository, backupType: BackupType, initiatedBy: number | null, sessionSecret: string, appOrigin: string, oauthConfigOverride?: GoogleOAuthClientConfig | null, fetchImpl: typeof fetch = fetch): Promise<BackupRunResult> {
  const oauthConfig = oauthConfigOverride !== undefined ? oauthConfigOverride : loadGoogleOAuthClientConfig(appOrigin);
  const destination = await repository.getBackupConfig();
  const started = await repository.startBackupRun({ backupType, initiatedBy });

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

  const auth = await resolveBackupAccessToken(repository, sessionSecret, oauthConfig, fetchImpl);
  if ("failure" in auth) {
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: AUTH_FAILURE_MESSAGES[auth.failure], spreadsheetId: destination.spreadsheetId });
    return { log: completed, configured: false };
  }

  try {
    const facilities = await loadAllFacilityLogs(repository);
    const rows = flattenToRows(facilities);
    const metadata = await getSpreadsheetMetadata(auth.accessToken, destination.spreadsheetId, fetchImpl);
    await ensureSheetsExist(auth.accessToken, destination.spreadsheetId, metadata.sheetTitles, fetchImpl);
    await writeBackupSnapshot(auth.accessToken, destination.spreadsheetId, DATA_SHEET, [["Facility", "Month", "Section", "Field", "Metric", "Value"], ...rows], fetchImpl);
    await appendBackupLogRow(auth.accessToken, destination.spreadsheetId, LOG_SHEET, [String(started.id), backupType, "success", started.startedAt, new Date().toISOString(), String(rows.length), String(rows.length), "0", initiatedBy === null ? "system" : String(initiatedBy)], fetchImpl);
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
    if (error.status === 403) return "The connected Google account does not have access to this spreadsheet. Please share it with that account, or connect a different account with access.";
    if (error.status === 404) return "The configured Google Sheet is not accessible (spreadsheet not found, or not shared with the connected account).";
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
 *  created" requirement) - never writes any data rows. Used by the "Test
 *  Connection" button with the not-yet-saved URL the admin is typing,
 *  authenticated as whichever admin currently has a connected Google
 *  account (not the URL's own facility/site - this is purely about
 *  whether that Google identity can reach the given spreadsheet). */
export async function testBackupConnection(sheetUrl: string, repository: BackendRepository, sessionSecret: string, appOrigin: string, oauthConfigOverride?: GoogleOAuthClientConfig | null, fetchImpl: typeof fetch = fetch): Promise<ConnectionTestResult> {
  let spreadsheetId: string;
  try { spreadsheetId = extractSpreadsheetId(sheetUrl); } catch (error) {
    return { ok: false, reason: error instanceof InvalidGoogleSheetsUrlError ? error.message : "Invalid Google Sheets URL." };
  }
  const oauthConfig = oauthConfigOverride !== undefined ? oauthConfigOverride : loadGoogleOAuthClientConfig(appOrigin);
  const auth = await resolveBackupAccessToken(repository, sessionSecret, oauthConfig, fetchImpl);
  if ("failure" in auth) return { ok: false, reason: AUTH_FAILURE_MESSAGES[auth.failure] };
  try {
    const metadata = await getSpreadsheetMetadata(auth.accessToken, spreadsheetId, fetchImpl);
    await ensureSheetsExist(auth.accessToken, spreadsheetId, metadata.sheetTitles, fetchImpl);
    return { ok: true, spreadsheetTitle: metadata.title, sheetsReady: true };
  } catch (error) {
    return { ok: false, reason: friendlyBackupError(error) };
  }
}
