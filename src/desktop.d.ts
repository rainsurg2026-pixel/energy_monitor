/**
 * Renderer-side typing for the preload bridge (window.desktop).
 * Types are imported `import type`-only from the main-process sources, so
 * nothing from the Electron side is ever bundled into the renderer.
 */

import type { OpenWorkbookPayload, SaveWorkbookPayload, RecoverySnapshot, IpcResult } from "./electron/ipc/excel";
import type { AppConfig } from "./electron/config";
import type { BackupEntry } from "./electron/sync/BackupManager";
import type { WorkbookHealth } from "./excel/WorkbookValidator";
import type { ExcelIntegrityReport, WorkbookValidation } from "./excel/WorkbookReader";
import type { DeviceLists } from "./excel/SheetMapper";
import type { FacilityEntry, FacilityProfile } from "./electron/facilities";

export type {
  OpenWorkbookPayload,
  SaveWorkbookPayload,
  RecoverySnapshot,
  IpcResult,
  AppConfig,
  BackupEntry,
  WorkbookHealth,
  ExcelIntegrityReport,
  WorkbookValidation,
  DeviceLists,
  FacilityEntry,
  FacilityProfile
};

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
    open(path: string | null, devices?: DeviceLists): Promise<IpcResult<OpenWorkbookPayload | { canceled: true }>>;
    reload(path: string, devices?: DeviceLists): Promise<IpcResult<OpenWorkbookPayload>>;
    save(payload: { path: string; logs: unknown[]; devices?: DeviceLists }): Promise<IpcResult<SaveWorkbookPayload>>;
    saveAs(payload: {
      sourcePath: string;
      logs: unknown[];
      devices?: DeviceLists;
    }): Promise<IpcResult<SaveWorkbookPayload | { canceled: true }>>;
    checkLock(path: string): Promise<IpcResult<{ locked: boolean; excelOwnerFilePresent: boolean }>>;
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
      logs: unknown[];
    }): Promise<IpcResult<{ path: string } | { canceled: true }>>;
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
  files: {
    getPathForFile(file: File): string;
  };
  events: {
    onOpenFilePath(callback: (path: string) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
