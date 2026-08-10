import type { MonthlyLog } from "../../src/types";
import type { BackendRepository, BackupLogRecord, BackupType } from "../repositories/contracts";
import { loadBackupConfig, type BackupConfig } from "./backupConfig";
import { getGoogleAccessToken, parseServiceAccountKey } from "./googleServiceAccountAuth";
import { appendBackupLogRow, writeBackupSnapshot } from "./googleSheetsClient";

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
 *  writes back from Sheets). A missing/invalid Google config or any Google
 *  API failure is caught and recorded as a FAILED backup_log row - it never
 *  throws in a way that could be mistaken for a Data Entry save failure;
 *  callers must not roll back or block a database save because of this. */
export async function runBackup(repository: BackendRepository, backupType: BackupType, initiatedBy: number | null, overrideConfig?: BackupConfig | null, fetchImpl: typeof fetch = fetch): Promise<BackupRunResult> {
  const config = overrideConfig !== undefined ? overrideConfig : loadBackupConfig();
  const started = await repository.startBackupRun({ backupType, initiatedBy });

  if (!config) {
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: "Google Sheets backup is not configured (GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON / GOOGLE_BACKUP_SPREADSHEET_ID missing)." });
    return { log: completed, configured: false };
  }

  try {
    const facilities = await loadAllFacilityLogs(repository);
    const rows = flattenToRows(facilities);
    const key = parseServiceAccountKey(config.serviceAccountJson);
    const accessToken = await getGoogleAccessToken(key, fetchImpl);
    await writeBackupSnapshot(accessToken, config.spreadsheetId, DATA_SHEET, [["Facility", "Month", "Section", "Field", "Metric", "Value"], ...rows.map((row, index) => [row[0], row[1], row[2], row[3], row[4], row[5]])], fetchImpl);
    await appendBackupLogRow(accessToken, config.spreadsheetId, LOG_SHEET, [String(started.id), backupType, "success", started.startedAt, new Date().toISOString(), String(rows.length), String(rows.length), "0", initiatedBy === null ? "system" : String(initiatedBy)], fetchImpl);
    const completed = await repository.completeBackupRun({ id: started.id, status: "success", recordsProcessed: rows.length, recordsSuccess: rows.length, recordsFailed: 0, errorSummary: null });
    return { log: completed, configured: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backup failure.";
    const completed = await repository.completeBackupRun({ id: started.id, status: "failed", recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: message.slice(0, 1000) });
    return { log: completed, configured: true };
  }
}
