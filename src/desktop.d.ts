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

export type {
  OpenWorkbookPayload,
  SaveWorkbookPayload,
  RecoverySnapshot,
  IpcResult,
  AppConfig,
  BackupEntry,
  WorkbookHealth,
  ExcelIntegrityReport,
  WorkbookValidation
};

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
  excel: {
    open(path: string | null): Promise<IpcResult<OpenWorkbookPayload | { canceled: true }>>;
    reload(path: string): Promise<IpcResult<OpenWorkbookPayload>>;
    save(payload: { path: string; logs: unknown[] }): Promise<IpcResult<SaveWorkbookPayload>>;
    saveAs(payload: { sourcePath: string; logs: unknown[] }): Promise<IpcResult<SaveWorkbookPayload | { canceled: true }>>;
    checkLock(path: string): Promise<IpcResult<{ locked: boolean; excelOwnerFilePresent: boolean }>>;
    validate(path: string): Promise<
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
