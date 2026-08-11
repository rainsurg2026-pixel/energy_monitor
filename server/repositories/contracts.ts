import type { MonthlyLog } from "../../src/types";
import type { DisplayPeriod } from "../policies/displayPeriod";

export interface SiteRecord { id: number; code: string; name: string; active: boolean; }
export interface PeriodRecord { id: number; siteId: number; month: string; hasData: boolean; rowVersion: number; }
export interface RackSnapshotRecord {
  month: string;
  rowVersion: number;
  records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }>;
}
export interface RackUnitSnapshotRecord { month: string; rowVersion: number; totalU: number; usedU: number; }
export interface RackCapacityHistoryRecord {
  month: string;
  facility: string;
  rackZone: string;
  totalRacks: number;
  inUse: number;
  available: number;
  reserved: number;
  pendingDismantle: number;
  other: number;
  usagePct: number | null;
  availabilityPct: number | null;
  reservedPct: number | null;
  pendingDismantlePct: number | null;
  otherPct: number | null;
  generatedAt: string;
  dataVersion: number;
}
export interface UpsGroupHistoryRecord {
  facility: string;
  month: string;
  group: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
  generatedAt: string | null;
  dataVersion: number | null;
}
export type BackupType = "scheduled" | "manual";
export type BackupStatus = "running" | "success" | "partial" | "failed";
export interface BackupLogRecord {
  id: number;
  backupType: BackupType;
  status: BackupStatus;
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  recordsSuccess: number;
  recordsFailed: number;
  errorSummary: string | null;
  initiatedBy: number | null;
  spreadsheetId: string | null;
}
export interface StartBackupInput { backupType: BackupType; initiatedBy: number | null; }
export interface CompleteBackupInput { id: number; status: BackupStatus; recordsProcessed: number; recordsSuccess: number; recordsFailed: number; errorSummary: string | null; spreadsheetId: string | null; }
/** Non-secret backup destination configuration only - never a credential.
 *  connectedGoogleUserId points at whichever admin's google_sheets_connections
 *  row (if any) is the active backup identity - never a token itself. */
export interface BackupConfigRecord { spreadsheetId: string | null; sheetUrl: string | null; enabled: boolean; updatedBy: number | null; updatedAt: string | null; connectedGoogleUserId: number | null; }
export interface UpdateBackupConfigInput { spreadsheetId: string; sheetUrl: string; enabled: boolean; updatedBy: number | null; correlationId: string; }

/** google_oauth_states: single-use, session-bound, short-lived PKCE state -
 *  this IS the CSRF protection for the OAuth callback (a GET request
 *  Google issues via redirect, which cannot carry the app's normal
 *  double-submit CSRF token). encryptedCodeVerifier is encrypted the same
 *  way a refresh token is - it is a secret-adjacent value for the
 *  duration of the flow, even though it is discarded after one use. */
export interface GoogleOAuthStateRecord { stateHash: string; userId: number; sessionId: number; encryptedCodeVerifier: string; expiresAt: string; }
export interface CreateGoogleOAuthStateInput { stateHash: string; userId: number; sessionId: number; encryptedCodeVerifier: string; expiresAt: string; }

/** The safe, non-secret shape - callers that only need to display "who is
 *  connected" use this. The encrypted refresh token itself is only ever
 *  returned by getGoogleSheetsConnectionSecret, a separate, narrower
 *  accessor used exclusively by the backup service's own token-refresh
 *  logic - never by any route that serializes a response to the browser. */
export interface GoogleSheetsConnectionRecord { userId: number; email: string | null; updatedAt: string; }
export interface UpsertGoogleSheetsConnectionInput { userId: number; encryptedRefreshToken: string; email: string | null; }
export interface UpdateSettingsInput { startMonth: string; endMonth: string; expectedRowVersion: number; actorUserId?: number | null; }
export interface SaveMonthlyLogInput { siteId: number; log: MonthlyLog; expectedRowVersion: number | null; correlationId: string; actorUserId?: number | null; provenance?: { sourceType: string; sourceFileHash?: string | null; sourceFileName?: string | null; sourceSheet?: string | null; sourceLocation?: string | null }; }

export interface BackendRepository {
  ping(): Promise<void>;
  listSites(): Promise<SiteRecord[]>;
  getSite(siteId: number): Promise<SiteRecord | null>;
  getGlobalSettings(): Promise<DisplayPeriod | null>;
  updateGlobalSettings(input: UpdateSettingsInput, correlationId: string): Promise<DisplayPeriod>;
  listPeriods(siteId: number): Promise<PeriodRecord[]>;
  getMonthlyLogs(siteId: number, months: readonly string[]): Promise<MonthlyLog[]>;
  saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord>;
  getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null>;
  getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null>;
  listRackCapacityHistory(siteId: number): Promise<RackCapacityHistoryRecord[]>;
  listRackUnitCapacityHistory(siteId: number): Promise<RackUnitSnapshotRecord[]>;
  getUpsGroupHistory(siteId: number): Promise<UpsGroupHistoryRecord[]>;
  startBackupRun(input: StartBackupInput): Promise<BackupLogRecord>;
  completeBackupRun(input: CompleteBackupInput): Promise<BackupLogRecord>;
  latestBackupRun(): Promise<BackupLogRecord | null>;
  listBackupRuns(limit: number): Promise<BackupLogRecord[]>;
  getBackupConfig(): Promise<BackupConfigRecord>;
  updateBackupConfig(input: UpdateBackupConfigInput): Promise<BackupConfigRecord>;
  setBackupConnectedGoogleUser(userId: number | null, actorUserId: number | null, correlationId: string): Promise<void>;
  createGoogleOAuthState(input: CreateGoogleOAuthStateInput): Promise<void>;
  consumeGoogleOAuthState(stateHash: string): Promise<GoogleOAuthStateRecord | null>;
  upsertGoogleSheetsConnection(input: UpsertGoogleSheetsConnectionInput): Promise<GoogleSheetsConnectionRecord>;
  getGoogleSheetsConnection(userId: number): Promise<GoogleSheetsConnectionRecord | null>;
  getGoogleSheetsConnectionSecret(userId: number): Promise<string | null>;
  deleteGoogleSheetsConnection(userId: number): Promise<void>;
  withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T>;
}
