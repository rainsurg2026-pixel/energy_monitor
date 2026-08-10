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
}
export interface StartBackupInput { backupType: BackupType; initiatedBy: number | null; }
export interface CompleteBackupInput { id: number; status: BackupStatus; recordsProcessed: number; recordsSuccess: number; recordsFailed: number; errorSummary: string | null; }
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
  getUpsGroupHistory(siteId: number): Promise<UpsGroupHistoryRecord[]>;
  startBackupRun(input: StartBackupInput): Promise<BackupLogRecord>;
  completeBackupRun(input: CompleteBackupInput): Promise<BackupLogRecord>;
  latestBackupRun(): Promise<BackupLogRecord | null>;
  listBackupRuns(limit: number): Promise<BackupLogRecord[]>;
  withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T>;
}
