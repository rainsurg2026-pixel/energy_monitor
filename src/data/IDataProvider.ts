/**
 * IDataProvider - the seam between the UI and whatever actually stores the
 * monthly logs. The UI never knows which provider is active; it renders the
 * snapshot it is given and calls save/open through this interface.
 *
 * Implementations:
 *   ExcelProvider        - local .xlsm workbook via the Electron main process
 *   GoogleSheetsProvider - the pre-existing Google Sheets transactional sync
 */

import { MonthlyLog } from "../types";
import type { DeviceLists, ExcelIntegrityReport, WorkbookHealth, WorkbookValidation } from "../desktop";
import type { DashboardUpsMappingReport, RackCapacitySummary, UpsGroupHistoryReport } from "../reports/reportTypes";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import type { StoredImageMeta } from "../storage/ImageStorageProvider";

export interface RackFieldEditRequest {
  expected: string | null;
  next: string | null;
}

export interface RackFieldChangeRequest {
  rowNumber: number;
  rackId: string;
  /** next is always a canonical status string when present. */
  status?: { expected: string | null; next: string };
  cabinetSize?: RackFieldEditRequest;
  detail?: RackFieldEditRequest;
  deviceType?: RackFieldEditRequest;
  remarks?: RackFieldEditRequest;
}

export interface RackFieldChangeOutcome {
  rowNumber: number;
  rackId: string;
  applied: boolean;
  conflictField?: "status" | "cabinetSize" | "detail" | "deviceType" | "remarks";
  conflictActualValue?: string | null;
  conflictReason?: "row_not_found" | "rack_id_mismatch" | "field_mismatch";
}

export interface RackCapacitySaveOutcome {
  savedAt: string;
  backupPath?: string | null;
  outcomes: RackFieldChangeOutcome[];
  changedCount: number;
  rackCapacity: RackCapacitySummary | null;
  rackCapacityHistory: RackCapacityHistoryRow[];
}

export interface RackCapacityImageRequest {
  bytes: Uint8Array;
}

export interface RackUnitCapacityInputRequest {
  /** Canonical "YYYY-MM" - the UI's own Month/Year selector, first-of-month. */
  month: string;
  totalU: number;
  usedU: number;
}

export interface RackUnitCapacitySaveOutcome {
  savedAt: string;
  backupPath?: string | null;
  rows: RackUnitCapacityRow[];
}

export type DataSourceKind = "excel" | "googleSheets";

/** Everything the UI needs after a load: the data plus source diagnostics. */
export interface DataSnapshot {
  logs: MonthlyLog[];
  /** Where the data came from, for display ("RST_Dashboard.xlsm", sheet ID, ...). */
  sourceLabel: string;
  /** Absolute workbook path (Excel provider only). */
  path?: string;
  health?: WorkbookHealth;
  integrity?: ExcelIntegrityReport;
  validation?: WorkbookValidation;
  lock?: { locked: boolean; excelOwnerFilePresent: boolean };
  rackCapacity?: RackCapacitySummary | null;
  upsMapping?: DashboardUpsMappingReport | null;
  /** Set when the UPS mapping read itself failed (not "no table found"). */
  upsMappingError?: string | null;
  /** Persisted "2. UPS Group History" worksheet, if present. */
  upsGroupHistory?: UpsGroupHistoryReport | null;
  /** Persisted "Rack Capacity History" monthly snapshots, if any exist yet. */
  rackCapacityHistory?: RackCapacityHistoryRow[];
  /** Persisted "Rack Unit Capacity" monthly rows, if any exist yet. */
  rackUnitCapacity?: RackUnitCapacityRow[];
}

export interface SaveOutcome {
  savedAt: string;
  backupPath?: string | null;
  /** Path may change on Save As. */
  path?: string;
}

/** Scope of a local workbook save. Save All remains the default full path. */
export type WorkbookSaveScope = "all" | "air";

/** Structured, user-presentable provider failure. */
export class ProviderError extends Error {
  code: string;
  /** Which save-pipeline step actually failed, when the backend reported one. */
  stage?: string;
  constructor(code: string, message: string, stage?: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.stage = stage;
  }
}

export interface ProviderCapabilities {
  canOpenFile: boolean;
  canSaveAs: boolean;
  canListBackups: boolean;
  requiresNetwork: boolean;
}

export interface IDataProvider {
  readonly kind: DataSourceKind;
  readonly capabilities: ProviderCapabilities;

  /** Human-readable label of the currently connected source, if any. */
  getSourceLabel(): string | null;

  /**
   * Load all logs from the source. `target` selects/overrides the source
   * (workbook path or spreadsheet ID); null keeps the current one; for the
   * Excel provider `openDialog: true` shows the native picker.
   */
  load(options?: { target?: string | null; openDialog?: boolean; signal?: AbortSignal }): Promise<DataSnapshot | null>;

  /** Persist the complete data set (Excel = whole workbook rewrite).
   *  `currentMonth`, when known, scopes UPS Group History's incremental
   *  update to that one month instead of backfill-only-if-missing. */
  saveAll(logs: MonthlyLog[], currentMonth?: string, scope?: WorkbookSaveScope): Promise<SaveOutcome>;

  /**
   * Persist a single month. Providers that only support full writes may
   * implement this as saveAll.
   */

  saveMonth(log: MonthlyLog, allLogs: MonthlyLog[]): Promise<SaveOutcome>;

  /**
   * Side-effect-free multi-facility load for site comparison.
   * Excel: each entry supplies its own workbook path + DeviceLists so Rangsit
   * and Srinakarin never share meter/UPS config.
   * Returns Map keyed by facility path (or spreadsheetId for sheets providers).
   */
  loadMultipleFacilities?(
    facilities: Array<{ path: string; label: string; devices?: DeviceLists } | { spreadsheetId: string; label: string }>,
    options?: { signal?: AbortSignal }
  ): Promise<Map<string, DataSnapshot>>;

  /**
   * Staged Rack Capacity Status/field edits. Desktop/Excel-only (Rack
   * Capacity editing requires a local workbook); providers that cannot
   * support it simply omit this method, matching loadMultipleFacilities'
   * optionality. `snapshotMonth`, when given, is the explicit "YYYY-MM" the
   * UI's own Month/Year selector chose for the History snapshot this save
   * upserts - never a silent system-month assumption; omit to fall back to
   * auto-detection.
   */
  saveRackCapacity?(
    changes: RackFieldChangeRequest[],
    snapshotMonth?: string | null,
    /** Explicit "record a monthly snapshot even with zero field changes"
     *  request - its own UI action, never a default; default false leaves
     *  the "a no-op save never appears in the backup history" behavior
     *  untouched. */
    forceSnapshot?: boolean
  ): Promise<RackCapacitySaveOutcome>;

  /**
   * Rack Unit Capacity: Month/Total (U)/Used (U) upsert (Available (U) and
   * Availability Capacity (%) are derived server-side, never entered
   * directly). The monthly image is a separate save
   * (saveRackUnitCapacityImage below) through the filesystem
   * ImageStorageProvider, never embedded into the workbook.
   */
  saveRackUnitCapacity?(
    input: RackUnitCapacityInputRequest,
    forceSnapshot?: boolean
  ): Promise<RackUnitCapacitySaveOutcome>;

  /**
   * Saves the Rack Unit Capacity Image for exactly one (Facility, Reporting
   * Month) via the filesystem ImageStorageProvider. "User" is never
   * supplied by the caller; the provider's backing process records who
   * actually ran the save.
   */
  saveRackUnitCapacityImage?(
    facility: string,
    reportingMonth: string,
    image: RackCapacityImageRequest
  ): Promise<StoredImageMeta>;

  /**
   * Fetches the image for exactly one (Facility, Reporting Month), or null
   * if none was ever recorded for that month - never a fallback to the
   * latest/nearest month.
   */
  getRackUnitCapacityImage?(facility: string, reportingMonth: string): Promise<{ dataUri: string; meta: StoredImageMeta } | null>;

  /** All recorded images' metadata for a facility, sorted by month - never
   *  the image bytes themselves. */
  listRackUnitCapacityImages?(facility: string): Promise<StoredImageMeta[]>;
}
