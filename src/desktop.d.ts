/**
 * Renderer-side typing for the preload bridge (window.desktop).
 * Types are imported `import type`-only from the main-process sources, so
 * nothing from the Electron side is ever bundled into the renderer.
 */

import type {
  OpenWorkbookPayload,
  SaveWorkbookPayload,
  RackCapacitySavePayload,
  RackUnitCapacitySavePayload,
  RecoverySnapshot,
  IpcResult,
  WorkbookAccessStatus
} from "./electron/ipc/excel";
import type { SaveFailureStage } from "./excel/WorkbookWriter";
import type { AppConfig } from "./electron/config";
import type { BackupEntry } from "./electron/sync/BackupManager";
import type { WorkbookHealth } from "./excel/WorkbookValidator";
import type { ExcelIntegrityReport, WorkbookValidation } from "./excel/WorkbookReader";
import type { DeviceLists } from "./excel/SheetMapper";
import type { FacilityEntry, FacilityProfile, FacilityDashboardConfig } from "./electron/facilities";
import type { UpsGroupConfig } from "./utils/upsGroupAggregation";
import type { GoogleAuthState } from "./electron/googleAuth";

export type {
  OpenWorkbookPayload,
  SaveWorkbookPayload,
  RackCapacitySavePayload,
  RackUnitCapacitySavePayload,
  RecoverySnapshot,
  IpcResult,
  WorkbookAccessStatus,
  SaveFailureStage,
  AppConfig,
  BackupEntry,
  WorkbookHealth,
  ExcelIntegrityReport,
  WorkbookValidation,
  DeviceLists,
  GoogleAuthState,
  FacilityEntry,
  FacilityProfile,
  FacilityDashboardConfig
};

export interface ExportProgress {
  requestId: string;
  stage: "preparing" | "validating" | "rendering" | "building" | "saving" | "completed";
  detail?: string;
}

export interface AllReportExportPayload {
  requestId: string;
  defaultName: string;
  workbookPath: string;
  facility: string;
  dashboard?: FacilityDashboardConfig;
  selectedMonth: string | null;
  appVersion: string;
}

export interface FacilitiesPayload {
  defaultFacility: string;
  activeFacilityId: string;
  facilities: FacilityEntry[];
}

export interface DesktopBridge {
  app: {
    getInfo(): Promise<{
      version: string;
      platform: string;
      appRoot: string;
      portable: boolean;
      /** Workbook found beside the executable (opened on first launch). */
      bundledWorkbookPath: string | null;
    }>;
  };
  facilities: {
    list(): Promise<FacilitiesPayload>;
    setActive(id: string): Promise<IpcResult<{ facility: FacilityEntry }>>;
  };
  excel: {
    open(
      path: string | null,
      devices?: DeviceLists,
      upsGroupContext?: { facilityId: string; upsGroups: UpsGroupConfig[] }
    ): Promise<IpcResult<OpenWorkbookPayload | { canceled: true }>>;
    /** Read-only multi-workbook open for site comparison. Per-path devices required. */
    openMultiple(
      requests: Array<{ path: string; devices: DeviceLists }>
    ): Promise<IpcResult<{ workbooks: Record<string, OpenWorkbookPayload> }>>;
    reload(
      path: string,
      devices?: DeviceLists,
      upsGroupContext?: { facilityId: string; upsGroups: UpsGroupConfig[] }
    ): Promise<IpcResult<OpenWorkbookPayload>>;
    save(payload: {
      path: string;
      logs: unknown[];
      devices?: DeviceLists;
      upsGroupHistory?: { facilityId: string; upsGroups: UpsGroupConfig[]; onlyMonths?: string[] };
    }): Promise<IpcResult<SaveWorkbookPayload>>;
    saveAs(payload: {
      sourcePath: string;
      logs: unknown[];
      devices?: DeviceLists;
      upsGroupHistory?: { facilityId: string; upsGroups: UpsGroupConfig[]; onlyMonths?: string[] };
    }): Promise<IpcResult<SaveWorkbookPayload | { canceled: true }>>;
    /** Staged Rack Capacity field edits (Status/Cabinet Size/Detail/Device
     *  Type). Only rows whose current on-disk value for every edited field
     *  matches its `expected` are applied; the rest come back as conflicts
     *  in the same result rather than throwing. */
    saveRackCapacity(payload: {
      path: string;
      changes: Array<{
        rowNumber: number;
        rackId: string;
        status?: { expected: string | null; next: string };
        cabinetSize?: { expected: string | null; next: string | null };
        detail?: { expected: string | null; next: string | null };
        deviceType?: { expected: string | null; next: string | null };
      }>;
      /** Raw image bytes; re-validated by real content (magic bytes) in the
       *  main process regardless of what the renderer believes it is. */
      image?: { bytes: Uint8Array } | null;
      /** Drives the Rack Capacity History snapshot's Facility + reporting
       *  month lookup; omit to skip history entirely (status/image save
       *  still succeeds either way). */
      facilityId?: string | null;
      /** Explicit "YYYY-MM" for the History snapshot this save should
       *  upsert - the Editor's own Month/Year selector, not a silent
       *  system-month assumption. Omit to fall back to auto-detection. */
      snapshotMonth?: string | null;
    }): Promise<IpcResult<RackCapacitySavePayload>>;
    /** Rack Unit Capacity: Month/Total (U)/Used (U) upsert (Available (U)
     *  and Availability Capacity (%) are derived server-side) plus an
     *  optional "Rack Unit Capacity Image" upload, in one atomic save. */
    saveRackUnitCapacity(payload: {
      path: string;
      input: { month: string; totalU: number; usedU: number };
      /** Raw image bytes; re-validated by real content (magic bytes) in the
       *  main process regardless of what the renderer believes it is. */
      image?: { bytes: Uint8Array } | null;
    }): Promise<IpcResult<RackUnitCapacitySavePayload>>;
    checkLock(path: string): Promise<IpcResult<{ locked: boolean; excelOwnerFilePresent: boolean }>>;
    access(path: string): Promise<IpcResult<WorkbookAccessStatus>>;
    validate(path: string, devices?: DeviceLists): Promise<
      IpcResult<{ health: WorkbookHealth; integrity: ExcelIntegrityReport; validation: WorkbookValidation }>
    >;
  };
  backups: {
    list(workbookPath: string): Promise<IpcResult<{ backups: BackupEntry[] }>>;
    restore(payload: {
      workbookPath: string;
      backupPath: string;
    }): Promise<IpcResult<OpenWorkbookPayload & { safetyBackupPath: string }>>;
  };
  recovery: {
    get(): Promise<IpcResult<{ snapshot: RecoverySnapshot | null }>>;
    set(payload: { workbookPath: string; logs: unknown[] }): Promise<IpcResult<{ saved: boolean }>>;
    clear(): Promise<IpcResult<{ saved: boolean }>>;
  };
  config: {
    get(): Promise<AppConfig>;
    update(patch: Partial<AppConfig>): Promise<AppConfig>;
    reset(): Promise<AppConfig>;
    clearRecent(): Promise<AppConfig>;
  };
  exportFile(payload: { defaultName: string; content: string }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
  exportCenter: {
    pdf(payload: { defaultName: string }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
    png(payload: { defaultName: string }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
    excel(payload: {
      defaultName: string;
      facility: string;
      dashboard?: FacilityDashboardConfig;
      logs: unknown[];
    }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
    allReport(payload: AllReportExportPayload): Promise<IpcResult<{ path: string } | { canceled: true }>>;
    cancel(requestId: string): Promise<{ ok: boolean }>;
    zip(payload: {
      defaultName: string;
      facility: string;
      logs: unknown[];
      csvs: { name: string; content: string }[];
      integrityText: string | null;
    }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
  };
  shell: {
    showItemInFolder(path: string): Promise<boolean>;
  };
  /** Desktop Google Sheets sync - main-process-owned OAuth (googleAuth.ts).
   *  The renderer never receives an access/refresh token, only status. */
  googleSheets: {
    status(): Promise<GoogleAuthState>;
    /** Fire-and-forget: opens the system browser and starts the loopback
     *  OAuth flow; follow progress via events.onGoogleAuthState. */
    signIn(): Promise<{ ok: boolean }>;
    signOut(): Promise<{ ok: boolean }>;
    syncMonth(payload: { spreadsheetId: string; log: unknown }): Promise<
      { ok: true; report: unknown } | { ok: false; code: string; message: string; mismatches?: string[] }
    >;
    exportAll(payload: { spreadsheetId: string; logs: unknown[] }): Promise<
      { ok: true; report: unknown } | { ok: false; code: string; message: string; mismatches?: string[] }
    >;
    importAll(payload: { spreadsheetId: string }): Promise<
      { ok: true; logs: unknown[] } | { ok: false; code: string; message: string }
    >;
  };
  files: {
    getPathForFile(file: File): string;
  };
  events: {
    onOpenFilePath(callback: (path: string) => void): () => void;
    onExportProgress(callback: (progress: ExportProgress) => void): () => void;
    /** Non-blocking UPS Group History migration progress (excel:open/reload). */
    onMigrationProgress(callback: (progress: { stage: string }) => void): () => void;
    /** Broadcasts every Google OAuth state transition (connecting/connected/
     *  authRequired/error/disconnected) - the renderer's single source of
     *  truth for the sign-in UI, in place of Firebase's onAuthStateChanged. */
    onGoogleAuthState(callback: (state: GoogleAuthState) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
