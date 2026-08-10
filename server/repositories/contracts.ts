import type { MonthlyLog } from "../../src/types";
import type { DisplayPeriod } from "../policies/displayPeriod";
import type { RackCapacityHistoryRow } from "../../src/excel/RackCapacityHistoryWriter";
import type { UpsGroupHistoryRow } from "../../src/reports/reportTypes";

export interface SiteRecord { id: number; code: string; name: string; active: boolean; }
export type MonthlySectionKey = "ups" | "air" | "dc" | "energyCost";
export interface PeriodRecord {
  id: number;
  siteId: number;
  month: string;
  hasData: boolean;
  rowVersion: number;
  lastSavedUps?: string | null;
  lastSavedAir?: string | null;
  lastSavedDc?: string | null;
  lastSavedEnergyCost?: string | null;
}
export interface RackSnapshotRecord {
  month: string;
  rowVersion: number;
  records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }>;
}
export interface RackUnitSnapshotRecord { month: string; rowVersion: number; totalU: number; usedU: number; }
export interface RackUnitImageRecord {
  siteId: number;
  month: string;
  objectKey: string;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  savedAt: string;
  savedBy: string;
}
export interface WorkbookSourceRecord {
  id: number;
  siteId: number;
  sourceFileName: string;
  sourceFileHash: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  importedAt: string;
  actorUserId: number | null;
}
export interface UpdateSettingsInput { startMonth: string; endMonth: string; expectedRowVersion: number; actorUserId?: number | null; }
export interface SaveMonthlyLogInput {
  siteId: number;
  log: MonthlyLog;
  expectedRowVersion: number | null;
  correlationId: string;
  actorUserId?: number | null;
  provenance?: { sourceType: string; sourceFileHash?: string | null; sourceFileName?: string | null; sourceSheet?: string | null; sourceLocation?: string | null };
  /** Sections explicitly persisted by the Web editor; omitted for imported source timestamps. */
  savedSections?: readonly MonthlySectionKey[];
  /** One server-side timestamp shared by a single Web save operation. */
  savedAt?: string;
}
export interface SaveRackSnapshotInput { siteId: number; month: string; records: RackSnapshotRecord["records"]; expectedRowVersion: number | null; correlationId: string; actorUserId?: number | null; }
export interface SaveRackUnitSnapshotInput { siteId: number; month: string; totalU: number; usedU: number; expectedRowVersion: number | null; correlationId: string; actorUserId?: number | null; }
export interface SaveRackCapacityHistoryInput {
  siteId: number;
  rows: readonly RackCapacityHistoryRow[];
  correlationId: string;
  actorUserId?: number | null;
}
export interface SaveUpsGroupHistoryInput {
  siteId: number;
  sourceSheet: string;
  rows: readonly UpsGroupHistoryRow[];
  correlationId: string;
  actorUserId?: number | null;
}
export interface SaveRackUnitImageInput extends Omit<RackUnitImageRecord, "siteId" | "savedAt"> {
  siteId: number;
  savedAt?: string;
  correlationId: string;
}
export interface SaveWorkbookSourceInput {
  siteId: number;
  sourceFileName: string;
  sourceFileHash: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  actorUserId?: number | null;
  correlationId: string;
}
export interface GoogleOAuthStateRecord {
  stateHash: string;
  userId: number;
  sessionId: string;
  encryptedCodeVerifier: string;
  expiresAt: string;
}
export interface GoogleSheetsConnectionRecord {
  userId: number;
  encryptedRefreshToken: string;
  email: string | null;
  updatedAt: string;
}

export interface BackendRepository {
  ping(): Promise<void>;
  listSites(): Promise<SiteRecord[]>;
  getSite(siteId: number): Promise<SiteRecord | null>;
  getGlobalSettings(): Promise<DisplayPeriod | null>;
  updateGlobalSettings(input: UpdateSettingsInput, correlationId: string): Promise<DisplayPeriod>;
  listPeriods(siteId: number): Promise<PeriodRecord[]>;
  getMonthlyLogs(siteId: number, months: readonly string[]): Promise<MonthlyLog[]>;
  hasImportedSourceHash(siteId: number, sourceFileHash: string): Promise<boolean>;
  saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord>;
  saveRackSnapshot(input: SaveRackSnapshotInput): Promise<RackSnapshotRecord>;
  saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord>;
  getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null>;
  getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null>;
  listRackUnitSnapshots(siteId: number): Promise<RackUnitSnapshotRecord[]>;
  saveRackCapacityHistory(input: SaveRackCapacityHistoryInput): Promise<void>;
  getRackCapacityHistory(siteId: number): Promise<RackCapacityHistoryRow[]>;
  saveUpsGroupHistory(input: SaveUpsGroupHistoryInput): Promise<void>;
  getUpsGroupHistory(siteId: number): Promise<{ sourceSheet: string; rows: UpsGroupHistoryRow[] }>;
  saveRackUnitImage(input: SaveRackUnitImageInput): Promise<RackUnitImageRecord>;
  getRackUnitImage(siteId: number, month: string): Promise<RackUnitImageRecord | null>;
  saveWorkbookSource(input: SaveWorkbookSourceInput): Promise<WorkbookSourceRecord>;
  getWorkbookSource(siteId: number): Promise<WorkbookSourceRecord | null>;
  listWorkbookSources(siteId: number): Promise<WorkbookSourceRecord[]>;
  restoreWorkbookSourceCurrent(siteId: number, sourceId: number): Promise<WorkbookSourceRecord>;
  saveGoogleOAuthState(input: GoogleOAuthStateRecord): Promise<void>;
  consumeGoogleOAuthState(stateHash: string, userId: number, sessionId: string): Promise<GoogleOAuthStateRecord | null>;
  saveGoogleSheetsConnection(input: GoogleSheetsConnectionRecord): Promise<void>;
  getGoogleSheetsConnection(userId: number): Promise<GoogleSheetsConnectionRecord | null>;
  deleteGoogleSheetsConnection(userId: number): Promise<void>;
  withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T>;
}
