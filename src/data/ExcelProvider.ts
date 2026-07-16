/**
 * ExcelProvider - IDataProvider backed by a local .xlsm/.xlsx workbook.
 * All real work happens in the Electron main process; this class is a thin,
 * stateful adapter over the preload bridge (window.desktop).
 */

import { MonthlyLog } from "../types";
import type { DesktopBridge, DeviceLists, IpcResult, OpenWorkbookPayload } from "../desktop";
import { DataSnapshot, IDataProvider, ProviderCapabilities, ProviderError, SaveOutcome } from "./IDataProvider";

/**
 * Convert an IPC envelope into either its success payload or a thrown
 * ProviderError. (Centralized cast: the renderer tsconfig is non-strict,
 * where discriminant narrowing on `ok` does not apply.)
 */
function unwrap<T>(result: IpcResult<T>): { ok: true } & T {
  if (!result.ok) {
    const failure = result as unknown as { code: string; message: string };
    throw new ProviderError(failure.code, failure.message);
  }
  return result as { ok: true } & T;
}

function toSnapshot(payload: OpenWorkbookPayload): DataSnapshot {
  const fileName = payload.path.split(/[\\/]/).pop() ?? payload.path;
  return {
    logs: payload.logs,
    sourceLabel: fileName,
    path: payload.path,
    health: payload.health,
    integrity: payload.integrity,
    validation: payload.validation,
    lock: payload.lock
  };
}

export class ExcelProvider implements IDataProvider {
  readonly kind = "excel" as const;
  readonly capabilities: ProviderCapabilities = {
    canOpenFile: true,
    canSaveAs: true,
    canListBackups: true,
    requiresNetwork: false
  };

  private bridge: DesktopBridge;
  private currentPath: string | null = null;
  /** Active facility's canonical device lists; undefined = built-in defaults. */
  private devices: DeviceLists | undefined;

  constructor(bridge: DesktopBridge) {
    this.bridge = bridge;
  }

  setDeviceLists(devices: DeviceLists | undefined): void {
    this.devices = devices;
  }

  getSourceLabel(): string | null {
    if (!this.currentPath) return null;
    return this.currentPath.split(/[\\/]/).pop() ?? this.currentPath;
  }

  getPath(): string | null {
    return this.currentPath;
  }

  async load(options?: { target?: string | null; openDialog?: boolean }): Promise<DataSnapshot | null> {
    const target = options?.target ?? (options?.openDialog ? null : this.currentPath);
    if (!target && !options?.openDialog) {
      throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    }
    const result = unwrap(
      target ? await this.bridge.excel.open(target, this.devices) : await this.bridge.excel.open(null, this.devices)
    );
    if ("canceled" in result && result.canceled) return null;
    const payload = result as { ok: true } & OpenWorkbookPayload;
    this.currentPath = payload.path;
    return toSnapshot(payload);
  }

  /** Re-read the currently open workbook from disk. */
  async reload(): Promise<DataSnapshot> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.reload(this.currentPath, this.devices));
    return toSnapshot(result);
  }

  async saveAll(logs: MonthlyLog[]): Promise<SaveOutcome> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.save({ path: this.currentPath, logs, devices: this.devices }));
    return { savedAt: result.savedAt, backupPath: result.backupPath, path: result.path };
  }

  async saveMonth(_log: MonthlyLog, allLogs: MonthlyLog[]): Promise<SaveOutcome> {
    // The workbook is always written as a whole (single atomic file).
    return this.saveAll(allLogs);
  }

  async saveAs(logs: MonthlyLog[]): Promise<SaveOutcome | null> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.saveAs({ sourcePath: this.currentPath, logs, devices: this.devices }));
    if ("canceled" in result && result.canceled) return null;
    const saved = result as { ok: true; path: string; backupPath: string | null; savedAt: string };
    this.currentPath = saved.path;
    return { savedAt: saved.savedAt, backupPath: saved.backupPath, path: saved.path };
  }

  async checkLock(): Promise<{ locked: boolean; excelOwnerFilePresent: boolean }> {
    if (!this.currentPath) return { locked: false, excelOwnerFilePresent: false };
    const result = unwrap(await this.bridge.excel.checkLock(this.currentPath));
    return { locked: result.locked, excelOwnerFilePresent: result.excelOwnerFilePresent };
  }

  async validate(): Promise<DataSnapshot> {
    return this.reload();
  }
}
