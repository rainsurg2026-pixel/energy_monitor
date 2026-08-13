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
/** Row shape for writing computed UPS Group History - see
 *  src/domain/upsGroupHistorySnapshot.ts, the sole producer of these
 *  values (never fabricated, never simplified from Desktop's formula). */
export interface UpsGroupHistoryUpsertRow {
  month: string;
  group: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
}
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
  /** overwrite=false (backfill): inserts only keys that don't already
   *  exist, never touches existing history. overwrite=true (incremental
   *  save): inserts or updates exactly the given keys. Mirrors Desktop's
   *  own backfill-vs-incremental-save distinction in UpsGroupHistoryWriter.ts. */
  saveUpsGroupHistoryRows(siteId: number, facility: string, rows: UpsGroupHistoryUpsertRow[], overwrite: boolean): Promise<void>;
  withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T>;
}
