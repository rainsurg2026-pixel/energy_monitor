import type { MonthlyLog } from "../../src/types";
import type { DashboardUpsMappingReport } from "../../src/reports/reportTypes";
import type { DisplayPeriod } from "../policies/displayPeriod";
import type { RackEditableField } from "../../src/domain/rackCapacity";

export interface SiteRecord {
  id: number;
  code: string;
  name: string;
  active: boolean;
  /** Read-only Dashboard-FAC topology extracted from the authoritative Desktop workbook. */
  dashboardMapping?: DashboardUpsMappingReport | null;
}
export interface PeriodRecord { id: number; siteId: number; month: string; hasData: boolean; rowVersion: number; }
export interface RackSnapshotRecord {
  month: string;
  rowVersion: number;
  records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }>;
}
export interface RackFieldEdit { expected: string | null; next: string | null; }
export interface RackFieldChange {
  rowNumber: number;
  rackId: string;
  status?: RackFieldEdit;
  cabinetSize?: RackFieldEdit;
  detail?: RackFieldEdit;
  deviceType?: RackFieldEdit;
  remarks?: RackFieldEdit;
}
export interface RackFieldChangeOutcome {
  rowNumber: number;
  rackId: string;
  applied: boolean;
  conflictField?: RackEditableField;
  conflictActualValue?: string | null;
  conflictReason?: "row_not_found" | "rack_id_mismatch" | "field_mismatch";
}
export interface SaveRackCapacityInput {
  siteId: number;
  facility: string;
  month: string;
  changes: RackFieldChange[];
  expectedRowVersion: number | null;
  actorUserId?: number | null;
  correlationId: string;
  generatedAt?: string;
  /** Explicit first-save carry-forward; GET remains side-effect-free. */
  initializeFromPrevious?: boolean;
  carryForwardSourceMonth?: string;
  carryForwardSourceRowVersion?: number;
}
export interface RackCapacitySaveResult {
  snapshot: RackSnapshotRecord;
  outcomes: RackFieldChangeOutcome[];
  changedCount: number;
}
export interface RackUnitImageRecord {
  objectKey: string;
  contentType: "image/png" | "image/jpeg";
  byteSize: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  savedAt: string;
  savedBy: string;
}
export interface RackUnitSnapshotRecord { month: string; rowVersion: number; totalU: number; usedU: number; image?: RackUnitImageRecord | null; }
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
export interface SaveRackUnitSnapshotInput { siteId: number; month: string; totalU: number; usedU: number; expectedRowVersion: number | null; actorUserId?: number | null; correlationId: string; }
export interface SaveRackUnitImageInput { siteId: number; month: string; objectKey: string; contentType: "image/png" | "image/jpeg"; byteSize: number; sha256: string; width: number; height: number; actorUserId?: number | null; }

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
  getLatestRackSnapshotBefore(siteId: number, month: string): Promise<RackSnapshotRecord | null>;
  saveRackCapacity(input: SaveRackCapacityInput): Promise<RackCapacitySaveResult>;
  getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null>;
  saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord>;
  replaceRackUnitImage(input: SaveRackUnitImageInput): Promise<{ image: RackUnitImageRecord; replacedObjectKeys: string[] }>;
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
