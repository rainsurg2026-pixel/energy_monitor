/**
 * ExcelProvider - IDataProvider backed by a local .xlsm/.xlsx workbook.
 * All real work happens in the Electron main process; this class is a thin,
 * stateful adapter over the preload bridge (window.desktop).
 */

import { MonthlyLog } from "../types";
import type { DesktopBridge, DeviceLists, IpcResult, OpenWorkbookPayload, StoredImageMeta } from "../desktop";
import type { UpsGroupConfig } from "../utils/upsGroupAggregation";
import {
  DataSnapshot,
  IDataProvider,
  ProviderCapabilities,
  ProviderError,
  RackCapacityImageRequest,
  RackCapacitySaveOutcome,
  RackFieldChangeRequest,
  RackUnitCapacityInputRequest,
  RackUnitCapacitySaveOutcome,
  SaveOutcome
} from "./IDataProvider";

/**
 * Convert an IPC envelope into either its success payload or a thrown
 * ProviderError. (Centralized cast: the renderer tsconfig is non-strict,
 * where discriminant narrowing on `ok` does not apply.)
 */
function unwrap<T>(result: IpcResult<T>): { ok: true } & T {
  if (!result.ok) {
    const failure = result as unknown as { code: string; message: string; stage?: string };
    throw new ProviderError(failure.code, failure.message, failure.stage);
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
    lock: payload.lock,
    rackCapacity: payload.rackCapacity,
    upsMapping: payload.upsMapping,
    upsMappingError: payload.upsMappingError,
    upsGroupHistory: payload.upsGroupHistory,
    rackCapacityHistory: payload.rackCapacityHistory,
    rackUnitCapacity: payload.rackUnitCapacity
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
  /** Active facility's id + UPS Group topology, for UPS Group History persistence. */
  private upsGroupContext: { facilityId: string; upsGroups: UpsGroupConfig[] } | undefined;

  constructor(bridge: DesktopBridge) {
    this.bridge = bridge;
  }

  setDeviceLists(devices: DeviceLists | undefined): void {
    this.devices = devices;
  }

  setUpsGroupContext(context: { facilityId: string; upsGroups: UpsGroupConfig[] } | undefined): void {
    this.upsGroupContext = context;
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
      target
        ? await this.bridge.excel.open(target, this.devices, this.upsGroupContext)
        : await this.bridge.excel.open(null, this.devices, this.upsGroupContext)
    );
    if ("canceled" in result && result.canceled) return null;
    const payload = result as { ok: true } & OpenWorkbookPayload;
    this.currentPath = payload.path;
    return toSnapshot(payload);
  }

  /** Re-read the currently open workbook from disk. */
  async reload(): Promise<DataSnapshot> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.reload(this.currentPath, this.devices, this.upsGroupContext));
    return toSnapshot(result);
  }

  /**
   * Read comparison workbooks without changing currentPath, migration state,
   * recent files, or current facility device lists.
   */
  async loadMultipleFacilities(
    facilities: Array<{ path: string; label: string; devices?: DeviceLists } | { spreadsheetId: string; label: string }>,
    options?: { signal?: AbortSignal }
  ): Promise<Map<string, DataSnapshot>> {
    if (options?.signal?.aborted) throw new ProviderError("ABORTED", "Comparison load was cancelled.");
    const requests = facilities.map((facility, index) => {
      if (!("path" in facility) || !facility.path || !facility.devices) {
        throw new ProviderError("BAD_FACILITY", `Facility ${index + 1} requires a workbook path and device configuration.`);
      }
      return { path: facility.path, devices: facility.devices };
    });
    const result = unwrap(await this.bridge.excel.openMultiple(requests));
    if (options?.signal?.aborted) throw new ProviderError("ABORTED", "Comparison load was cancelled.");

    const snapshots = new Map<string, DataSnapshot>();
    for (const request of requests) {
      const payload = result.workbooks[request.path] as OpenWorkbookPayload | undefined;
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.logs)) {
        throw new ProviderError("MISSING_WORKBOOK", `Comparison result did not include ${request.path}.`);
      }
      snapshots.set(request.path, toSnapshot(payload));
    }
    return snapshots;
  }

  async saveAll(logs: MonthlyLog[], currentMonth?: string): Promise<SaveOutcome> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const upsGroupHistory = this.upsGroupContext
      ? { ...this.upsGroupContext, onlyMonths: currentMonth ? [currentMonth] : undefined }
      : undefined;
    const result = unwrap(await this.bridge.excel.save({ path: this.currentPath, logs, devices: this.devices, upsGroupHistory }));
    return { savedAt: result.savedAt, backupPath: result.backupPath, path: result.path };
  }

  async saveMonth(log: MonthlyLog, allLogs: MonthlyLog[]): Promise<SaveOutcome> {
    // The workbook is always written as a whole (single atomic file); only
    // UPS Group History's incremental scope narrows to the edited month.
    return this.saveAll(allLogs, log.month);
  }

  async saveAs(logs: MonthlyLog[]): Promise<SaveOutcome | null> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const upsGroupHistory = this.upsGroupContext ? { ...this.upsGroupContext } : undefined;
    const result = unwrap(await this.bridge.excel.saveAs({ sourcePath: this.currentPath, logs, devices: this.devices, upsGroupHistory }));
    if ("canceled" in result && result.canceled) return null;
    const saved = result as { ok: true; path: string; backupPath: string | null; savedAt: string };
    this.currentPath = saved.path;
    return { savedAt: saved.savedAt, backupPath: saved.backupPath, path: saved.path };
  }

  async saveRackCapacity(
    changes: RackFieldChangeRequest[],
    snapshotMonth?: string | null,
    forceSnapshot?: boolean
  ): Promise<RackCapacitySaveOutcome> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.saveRackCapacity({
      path: this.currentPath,
      changes,
      facilityId: this.upsGroupContext?.facilityId ?? null,
      snapshotMonth,
      forceSnapshot
    }));
    return {
      savedAt: result.savedAt,
      backupPath: result.backupPath,
      outcomes: result.outcomes,
      changedCount: result.changedCount,
      rackCapacity: result.rackCapacity,
      rackCapacityHistory: result.rackCapacityHistory
    };
  }

  async saveRackUnitCapacity(
    input: RackUnitCapacityInputRequest,
    forceSnapshot?: boolean
  ): Promise<RackUnitCapacitySaveOutcome> {
    if (!this.currentPath) throw new ProviderError("NO_WORKBOOK", "No workbook is open.");
    const result = unwrap(await this.bridge.excel.saveRackUnitCapacity({
      path: this.currentPath,
      input,
      forceSnapshot
    }));
    return {
      savedAt: result.savedAt,
      backupPath: result.backupPath,
      rows: result.rows
    };
  }

  async saveRackUnitCapacityImage(facility: string, reportingMonth: string, image: RackCapacityImageRequest): Promise<StoredImageMeta> {
    const result = unwrap(await this.bridge.images.save({ facility, reportingMonth, image: { bytes: image.bytes } }));
    return result.meta;
  }

  async getRackUnitCapacityImage(facility: string, reportingMonth: string): Promise<{ dataUri: string; meta: StoredImageMeta } | null> {
    const result = unwrap(await this.bridge.images.load({ facility, reportingMonth }));
    if (!result.found || !result.dataUri || !result.meta) return null;
    return { dataUri: result.dataUri, meta: result.meta };
  }

  async listRackUnitCapacityImages(facility: string): Promise<StoredImageMeta[]> {
    const result = unwrap(await this.bridge.images.list({ facility }));
    return result.images;
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
