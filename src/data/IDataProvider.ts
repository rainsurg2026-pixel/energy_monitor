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
import type { ExcelIntegrityReport, WorkbookHealth, WorkbookValidation } from "../desktop";

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
}

export interface SaveOutcome {
  savedAt: string;
  backupPath?: string | null;
  /** Path may change on Save As. */
  path?: string;
}

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

  /** Persist the complete data set (Excel = whole workbook rewrite). */
  saveAll(logs: MonthlyLog[]): Promise<SaveOutcome>;

  /**
   * Persist a single month. Providers that only support full writes may
   * implement this as saveAll.
   */
  saveMonth(log: MonthlyLog, allLogs: MonthlyLog[]): Promise<SaveOutcome>;
}
