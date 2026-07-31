/**
 * IPC surface for everything workbook-related. This is the ONLY place the
 * renderer's data layer talks to; every payload is validated here before any
 * filesystem access happens.
 *
 * All handlers resolve to { ok: true, ... } | { ok: false, code, message } so
 * the renderer gets structured, user-presentable failures (LOCKED,
 * VALIDATION_FAILED, ...) instead of opaque thrown strings.
 */

import { BrowserWindow, IpcMainInvokeEvent, dialog, ipcMain, app } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { MonthlyLog } from "../../types";
import { WorkbookReadResult, readWorkbookFromFile } from "../../excel/WorkbookReader";
import { SaveFailureStage, WorkbookError, checkWorkbookLock, saveWorkbook } from "../../excel/WorkbookWriter";
import { PayloadError, summarizeWorkbookHealth, validateLogsPayload } from "../../excel/WorkbookValidator";
import { WorkbookHealth } from "../../excel/WorkbookValidator";
import { DeviceLists } from "../../excel/SheetMapper";
import { listBackups, restoreBackup } from "../sync/BackupManager";
import { addRecentFile, loadConfig, resolveBackupDir } from "../config";
import { ensureDir, getExportsDir, getRecoveryPath, log } from "../paths";
import { readRackCapacityFromBuffer } from "../../reports/rackCapacityReader";
import { saveRackCapacityFieldChanges, RackFieldChange, RackCapacityImageInput } from "../../excel/RackCapacityWriter";
import { readRackCapacityHistoryFromBuffer, RackCapacityHistoryRow } from "../../excel/RackCapacityHistoryWriter";
import { readRackUnitCapacityFromBuffer, RackUnitCapacityInput, RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import { saveRackUnitCapacity } from "../../excel/RackUnitCapacitySaveWriter";
import { RACK_CANONICAL_STATUSES } from "../../utils/rackCapacity";
import { validateImageBytes } from "../../utils/imageValidation";
import { readUpsMappingFromBuffer } from "../../reports/upsMappingReader";
import { readUpsGroupHistoryFromBuffer } from "../../reports/upsGroupHistoryReader";
import type { DashboardUpsMappingReport, RackCapacitySummary, UpsGroupHistoryReport } from "../../reports/reportTypes";
import type { UpsGroupConfig } from "../../utils/upsGroupAggregation";
import { migrateUpsGroupHistoryIfNeeded, MigrationStage } from "../upsGroupHistoryMigration";

// ---------------------------------------------------------------------------
// Envelope + validation helpers
// ---------------------------------------------------------------------------

export type IpcResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string; stage?: SaveFailureStage };

function fail(code: string, message: string, stage?: SaveFailureStage): { ok: false; code: string; message: string; stage?: SaveFailureStage } {
  return { ok: false, code, message, stage };
}

async function wrap<T>(operation: string, fn: () => Promise<({ ok: true } & T) | { ok: false; code: string; message: string }>): Promise<IpcResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof WorkbookError) {
      log.warn(`${operation}: ${err.code} - ${err.message}`);
      return fail(err.code, err.message, err.stage);
    }
    if (err instanceof PayloadError) {
      log.warn(`${operation}: BAD_PAYLOAD - ${err.message}`);
      return fail("BAD_PAYLOAD", err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error(`${operation}: ${message}`);
    return fail("ERROR", message);
  }
}

const WORKBOOK_EXTENSIONS = [".xlsm", ".xlsx"];

function ensureWorkbookPath(value: unknown, label = "path"): string {
  if (typeof value !== "string" || value.trim() === "") throw new PayloadError(`${label} must be a non-empty string.`);
  if (value.length > 1000) throw new PayloadError(`${label} is too long.`);
  const ext = path.extname(value).toLowerCase();
  if (!WORKBOOK_EXTENSIONS.includes(ext)) {
    throw new PayloadError(`${label} must be an .xlsm or .xlsx workbook (got "${ext || "no extension"}").`);
  }
  if (!path.isAbsolute(value)) throw new PayloadError(`${label} must be an absolute path.`);
  return path.normalize(value);
}

function windowFor(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

/**
 * Optional per-facility device lists sent with workbook operations. This is
 * the IPC trust boundary for facility isolation: airFields must round-trip
 * here or every workbook read/write silently falls back to
 * DEFAULT_DEVICE_LISTS' 4-field Rangsit default regardless of which facility
 * is active, corrupting/dropping the extra meters a facility like Srinakarin
 * (6 fields: eb41a/b, eb43a/b, eb44a/b) declares in its profile.
 */
/** Trust boundary for the renderer-supplied UPS Group topology used by the
 *  UPS Group History writer - malformed/oversized input is dropped rather
 *  than trusted, same posture as sanitizeDevices(). */
function sanitizeUpsGroups(raw: unknown): UpsGroupConfig[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const groups = raw
    .filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null)
    .map(g => ({
      name: typeof g.name === "string" ? g.name.slice(0, 100) : "",
      ids: Array.isArray(g.ids) ? g.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 100).slice(0, 50) : [],
      capacity: typeof g.capacity === "number" && Number.isFinite(g.capacity) ? g.capacity : null
    }))
    .filter(g => g.name.length > 0 && g.ids.length > 0)
    .slice(0, 50);
  return groups.length > 0 ? groups : undefined;
}

function sanitizeUpsGroupHistoryOptions(raw: unknown): { facilityId: string; upsGroups: UpsGroupConfig[]; onlyMonths?: string[] } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const facilityId = typeof o.facilityId === "string" && o.facilityId.length > 0 ? o.facilityId.slice(0, 100) : null;
  const upsGroups = sanitizeUpsGroups(o.upsGroups);
  if (!facilityId || !upsGroups) return undefined;
  const onlyMonths = Array.isArray(o.onlyMonths)
    ? o.onlyMonths.filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)).slice(0, 12)
    : undefined;
  return { facilityId, upsGroups, onlyMonths: onlyMonths && onlyMonths.length > 0 ? onlyMonths : undefined };
}

function sanitizeDevices(raw: unknown): DeviceLists | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter(x => typeof x === "string" && x.length > 0 && x.length <= 100).slice(0, 50) : null;
  const upsIds = list(o.upsIds);
  const dcIds = list(o.dcIds);
  if (!upsIds || upsIds.length === 0 || !dcIds || dcIds.length === 0) return undefined;
  const airFields = list(o.airFields);
  return { upsIds, dcIds, ...(airFields && airFields.length > 0 ? { airFields } : {}) };
}

const RACK_FREE_TEXT_FIELDS = ["cabinetSize", "detail", "deviceType"] as const;

/** A field value of `null`/`undefined` means "no edit to this field"; an
 *  explicit `{ expected, next }` object (next may itself be null - clearing
 *  a free-text field to blank is legitimate) means "apply this edit". */
function sanitizeOptionalStringEdit(raw: unknown, label: string): { expected: string | null; next: string | null } | undefined {
  if (raw === null || typeof raw === "undefined") return undefined;
  if (typeof raw !== "object") throw new PayloadError(`${label} must be an object or omitted.`);
  const o = raw as Record<string, unknown>;
  const expectedRaw = o.expected;
  if (expectedRaw !== null && typeof expectedRaw !== "undefined" && (typeof expectedRaw !== "string" || expectedRaw.length > 200)) {
    throw new PayloadError(`${label}.expected must be a string or null.`);
  }
  const nextRaw = o.next;
  if (nextRaw !== null && (typeof nextRaw !== "string" || nextRaw.length > 200)) {
    throw new PayloadError(`${label}.next must be a string or null.`);
  }
  return { expected: typeof expectedRaw === "string" ? expectedRaw : null, next: typeof nextRaw === "string" ? nextRaw : null };
}

/** Trust boundary for staged Rack Capacity field edits: Status may only
 *  ever be one of the four canonical values (never an arbitrary UI-supplied
 *  string); Cabinet Size/Detail/Device Type are free text (no controlled
 *  value list exists in the real workbook data) but still length-capped.
 *  Every change carries the row identity + each edited field's
 *  previously-read value, which the writer re-verifies server-side before
 *  writing anything (optimistic concurrency, never trusting the renderer). */
function sanitizeRackFieldChanges(raw: unknown): RackFieldChange[] {
  if (typeof raw === "undefined") return [];
  if (!Array.isArray(raw)) throw new PayloadError("changes must be an array.");
  if (raw.length > 500) throw new PayloadError("Too many changes in a single save (max 500).");
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new PayloadError(`changes[${index}] must be an object.`);
    const o = entry as Record<string, unknown>;
    const rowNumber = o.rowNumber;
    if (typeof rowNumber !== "number" || !Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 100000) {
      throw new PayloadError(`changes[${index}].rowNumber must be a positive integer.`);
    }
    const rackId = o.rackId;
    if (typeof rackId !== "string" || rackId.trim() === "" || rackId.length > 200) {
      throw new PayloadError(`changes[${index}].rackId must be a non-empty string.`);
    }

    let status: RackFieldChange["status"];
    if (o.status !== null && typeof o.status !== "undefined") {
      const edit = sanitizeOptionalStringEdit(o.status, `changes[${index}].status`)!;
      if (!edit.next || !RACK_CANONICAL_STATUSES.includes(edit.next as (typeof RACK_CANONICAL_STATUSES)[number])) {
        throw new PayloadError(`changes[${index}].status.next must be one of: ${RACK_CANONICAL_STATUSES.join(", ")}.`);
      }
      status = { expected: edit.expected, next: edit.next };
    }

    const fieldEdits: Partial<Record<(typeof RACK_FREE_TEXT_FIELDS)[number], RackFieldChange["cabinetSize"]>> = {};
    for (const field of RACK_FREE_TEXT_FIELDS) {
      fieldEdits[field] = sanitizeOptionalStringEdit(o[field], `changes[${index}].${field}`);
    }

    if (!status && !fieldEdits.cabinetSize && !fieldEdits.detail && !fieldEdits.deviceType) {
      throw new PayloadError(`changes[${index}] must edit at least one field.`);
    }
    return { rowNumber, rackId, status, cabinetSize: fieldEdits.cabinetSize, detail: fieldEdits.detail, deviceType: fieldEdits.deviceType };
  });
}

/** Explicit "YYYY-MM" selected by the UI's own Month/Year selector - never
 *  trust-but-verify a system-detected month; malformed input is dropped
 *  (undefined) rather than passed through, so a bad value falls back to the
 *  writer's own auto-detection instead of silently corrupting a snapshot. */
function sanitizeSnapshotMonth(raw: unknown): string | null | undefined {
  if (raw === null || typeof raw === "undefined") return undefined;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}$/.test(raw)) return undefined;
  const month = Number(raw.slice(5, 7));
  return month >= 1 && month <= 12 ? raw : undefined;
}

/** Trust boundary for a Rack Unit Capacity save: Month must be a real
 *  "YYYY-MM" the UI's own selector produced (never freeform text), Total
 *  (U)/Used (U) must be finite, non-negative numbers - Used (U) is allowed
 *  to exceed Total (U) at the IPC layer (a real over-capacity state the
 *  facility may need to record, not something to silently clamp/reject). */
function sanitizeRackUnitCapacityInput(raw: unknown): RackUnitCapacityInput {
  if (typeof raw !== "object" || raw === null) throw new PayloadError("Rack Unit Capacity input must be an object.");
  const o = raw as Record<string, unknown>;
  const month = sanitizeSnapshotMonth(o.month);
  if (!month) throw new PayloadError("Rack Unit Capacity month must be a valid \"YYYY-MM\" string.");
  const totalU = o.totalU;
  const usedU = o.usedU;
  if (typeof totalU !== "number" || !Number.isFinite(totalU) || totalU < 0) {
    throw new PayloadError("Rack Unit Capacity Total (U) must be a non-negative number.");
  }
  if (typeof usedU !== "number" || !Number.isFinite(usedU) || usedU < 0) {
    throw new PayloadError("Rack Unit Capacity Used (U) must be a non-negative number.");
  }
  return { month, totalU, usedU };
}

/** Trust boundary for the Rack Capacity K9 image: the renderer's own
 *  validation is never trusted alone - bytes are re-validated by real magic
 *  numbers/dimension parsing here, in the main process, before anything is
 *  written to the workbook. A crafted "type"/"width"/"height" that doesn't
 *  match the actual bytes is rejected, not merely relabeled. */
function sanitizeRackImage(raw: unknown): RackCapacityImageInput | null {
  if (raw === null || typeof raw === "undefined") return null;
  if (typeof raw !== "object") throw new PayloadError("image must be an object or null.");
  const o = raw as Record<string, unknown>;
  const bytesInput = o.bytes;
  if (!(bytesInput instanceof Uint8Array)) throw new PayloadError("image.bytes must be raw byte data.");
  const bytes = Buffer.from(bytesInput);
  const validated = validateImageBytes(bytes);
  if (validated.ok === false) throw new PayloadError(`Uploaded file is not a valid PNG/JPEG image (${validated.reason}).`);
  return { bytes, type: validated.image.type, width: validated.image.width, height: validated.image.height };
}

// ---------------------------------------------------------------------------
// Payload shapes shared with the renderer (via `import type`)
// ---------------------------------------------------------------------------

export interface OpenWorkbookPayload {
  path: string;
  logs: MonthlyLog[];
  validation: WorkbookReadResult["validation"];
  integrity: WorkbookReadResult["integrity"];
  health: WorkbookHealth;
  lock: { locked: boolean; excelOwnerFilePresent: boolean };
  rackCapacity: RackCapacitySummary | null;
  upsMapping: DashboardUpsMappingReport | null;
  /** Set only when the workbook file itself could not be read for the UPS
   *  mapping pass (missing/locked/permission) - distinct from `upsMapping`
   *  legitimately being null because the workbook has no Dashboard-FAC UPS
   *  table. The renderer surfaces this instead of it being silently lost. */
  upsMappingError: string | null;
  /** Persisted "2. UPS Group History" worksheet, if present. */
  upsGroupHistory: UpsGroupHistoryReport | null;
  /** Persisted "Rack Capacity History" worksheet rows, if present. */
  rackCapacityHistory: RackCapacityHistoryRow[];
  /** Persisted "Rack Unit Capacity" worksheet rows, if present. */
  rackUnitCapacity: RackUnitCapacityRow[];
}

export interface SaveWorkbookPayload {
  path: string;
  backupPath: string | null;
  savedAt: string;
}

export interface RackCapacitySavePayload {
  path: string;
  backupPath: string | null;
  savedAt: string;
  outcomes: Array<{
    rowNumber: number;
    rackId: string;
    applied: boolean;
    conflictField?: "status" | "cabinetSize" | "detail" | "deviceType";
    conflictActualValue?: string | null;
    conflictReason?: "row_not_found" | "rack_id_mismatch" | "field_mismatch";
  }>;
  changedCount: number;
  imageEmbedded: boolean;
  rackCapacity: RackCapacitySummary | null;
  rackCapacityHistory: RackCapacityHistoryRow[];
}

export interface RackUnitCapacitySavePayload {
  path: string;
  backupPath: string | null;
  savedAt: string;
  imageEmbedded: boolean;
  rows: RackUnitCapacityRow[];
}

export interface RecoverySnapshot {
  workbookPath: string;
  savedAt: string;
  logs: MonthlyLog[];
}

/**
 * Full access picture for the open workbook (RC2 read-only mode + health
 * monitor). `reason` is null exactly when the workbook is safely writable.
 */
export interface WorkbookAccessStatus {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  locked: boolean;
  excelOwnerFilePresent: boolean;
  readOnlyAttribute: boolean;
  /** File modified time - doubles as the workbook "version" shown in the UI. */
  mtime: string | null;
  sizeBytes: number | null;
  /** Newest backup of this workbook, if any (health: backup status). */
  lastBackupAt: string | null;
  reason: "NOT_FOUND" | "NO_READ" | "LOCKED_EXCEL" | "LOCKED" | "READONLY_FILE" | null;
}

async function buildOpenPayload(
  filePath: string,
  devices?: DeviceLists,
  upsGroupContext?: { facilityId: string; upsGroups: UpsGroupConfig[] },
  onMigrationProgress?: (stage: MigrationStage) => void,
  options?: { trackRecent?: boolean; allowMigration?: boolean }
): Promise<{ ok: true } & OpenWorkbookPayload> {
  const trackRecent = options?.trackRecent !== false;
  const allowMigration = options?.allowMigration !== false;
  let read = await readWorkbookFromFile(filePath, devices);
  if (!read.validation.ok) {
    throw new WorkbookError(
      "INVALID_WORKBOOK",
      `This file is not a compatible workbook:\n${read.validation.errors.join("\n")}`
    );
  }

  // One-time, idempotent UPS Group History migration (dedicated service).
  // Runs only on open/reload, never on multi-facility comparison reads.
  if (allowMigration && upsGroupContext) {
    try {
      const config = await loadConfig();
      const migration = await migrateUpsGroupHistoryIfNeeded(
        filePath,
        read.logs,
        upsGroupContext.facilityId,
        upsGroupContext.upsGroups,
        resolveBackupDir(config),
        config.backupKeep,
        onMigrationProgress
      );
      if (migration.migrated) {
        read = await readWorkbookFromFile(filePath, devices);
      }
    } catch (error) {
      // Migration failure never blocks opening the workbook - the user can
      // still read/work with it; History simply stays unmigrated until the
      // next successful open.
      log.warn(`UPS Group History migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const lock = await checkWorkbookLock(filePath);
  let rackCapacity: RackCapacitySummary | null = null;
  try {
    const rack = await readRackCapacityFromBuffer(await fs.readFile(filePath));
    if (rack) {
      rackCapacity = {
        totalRacks: rack.records.length,
        records: rack.records,
        byStatus: rack.byStatus,
        byZone: rack.byZone
      };
    }
  } catch (error) {
    log.warn(`rack capacity summary unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let upsMapping: DashboardUpsMappingReport | null = null;
  let upsMappingError: string | null = null;
  let upsMappingBuffer: Buffer | null = null;
  try {
    upsMappingBuffer = await fs.readFile(filePath);
  } catch (error) {
    // The workbook file itself could not be read - this is not "no UPS
    // table in this workbook", it is a failure to even open the bytes the
    // rest of this function already opened successfully above. Surface it
    // structurally instead of only logging it away.
    upsMappingError = error instanceof Error ? error.message : String(error);
    log.error(`UPS mapping read failed (file unreadable): ${upsMappingError}`);
  }
  if (upsMappingBuffer) {
    try {
      upsMapping = await readUpsMappingFromBuffer(upsMappingBuffer);
    } catch (error) {
      // A real parse failure (corrupt sheet, unexpected structure) - also
      // surfaced, not swallowed. Sheet/table legitimately absent is not an
      // error path: readUpsMappingFromBuffer returns null for that, not a throw.
      upsMappingError = error instanceof Error ? error.message : String(error);
      log.error(`UPS mapping read failed (parse error): ${upsMappingError}`);
    }
  }
  let upsGroupHistory: UpsGroupHistoryReport | null = null;
  if (upsMappingBuffer) {
    try {
      upsGroupHistory = await readUpsGroupHistoryFromBuffer(upsMappingBuffer);
    } catch (error) {
      log.warn(`UPS Group History unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let rackCapacityHistory: RackCapacityHistoryRow[] = [];
  if (upsMappingBuffer) {
    try {
      rackCapacityHistory = await readRackCapacityHistoryFromBuffer(upsMappingBuffer);
    } catch (error) {
      log.warn(`Rack Capacity History unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let rackUnitCapacity: RackUnitCapacityRow[] = [];
  if (upsMappingBuffer) {
    try {
      rackUnitCapacity = await readRackUnitCapacityFromBuffer(upsMappingBuffer);
    } catch (error) {
      log.warn(`Rack Unit Capacity unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (trackRecent) {
    await addRecentFile(filePath);
    app.addRecentDocument(filePath);
  }
  log.info(`workbook opened: ${filePath} (${read.logs.length} months)`);
  return {
    ok: true,
    path: filePath,
    logs: read.logs,
    validation: read.validation,
    integrity: read.integrity,
    health: summarizeWorkbookHealth(read),
    lock: { locked: lock.locked, excelOwnerFilePresent: lock.excelOwnerFilePresent },
    rackCapacity,
    upsMapping,
    upsMappingError,
    upsGroupHistory,
    rackCapacityHistory,
    rackUnitCapacity
  };
}

/** Multi-facility comparison must supply a per-path DeviceLists. Soft-fallback
 *  to DEFAULT (Rangsit) would silently corrupt Srinakarin airFields/UPS ids. */
function requireDevices(raw: unknown, label: string): DeviceLists {
  const devices = sanitizeDevices(raw);
  const rawAirFields = typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>).airFields
    : undefined;
  const hasAirFields = Array.isArray(rawAirFields) && rawAirFields.length > 0;
  if (!devices || !hasAirFields || !devices.airFields) {
    throw new PayloadError(`${label} must include non-empty upsIds, dcIds, and airFields.`);
  }
  return devices;
}

function sanitizeOpenMultipleRequests(raw: unknown): Array<{ path: string; devices: DeviceLists }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PayloadError("openMultiple expects a non-empty array of { path, devices } requests.");
  }
  if (raw.length > 8) throw new PayloadError("openMultiple supports at most 8 workbooks.");
  return raw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new PayloadError(`openMultiple request[${index}] must be an object.`);
    }
    const body = item as Record<string, unknown>;
    return {
      path: ensureWorkbookPath(body.path, `request[${index}].path`),
      devices: requireDevices(body.devices, `request[${index}].devices`)
    };
  });
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerExcelIpc(): void {
  // --- Open (native picker when no path is given) ---
  ipcMain.handle("excel:open", (event, rawPath: unknown, rawDevices?: unknown, rawUpsGroupContext?: unknown) =>
    wrap<OpenWorkbookPayload | { canceled: true }>("excel:open", async () => {
      const devices = sanitizeDevices(rawDevices);
      const upsGroupContext = sanitizeUpsGroupHistoryOptions(rawUpsGroupContext);
      let filePath: string;
      if (rawPath === null || rawPath === undefined) {
        const result = await dialog.showOpenDialog(windowFor(event)!, {
          title: "Open Workbook",
          filters: [
            { name: "Excel Workbooks", extensions: ["xlsm", "xlsx"] },
            { name: "All Files", extensions: ["*"] }
          ],
          properties: ["openFile"]
        });
        if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true as const };
        filePath = ensureWorkbookPath(result.filePaths[0]);
      } else {
        filePath = ensureWorkbookPath(rawPath);
      }
      return buildOpenPayload(filePath, devices, upsGroupContext, stage => {
        if (!event.sender.isDestroyed()) event.sender.send("migration-progress", { stage });
      });
    })
  );

  // Multi-facility comparison: per-path devices, no recent-file/migration side effects.
  ipcMain.handle("excel:openMultiple", (_event, rawRequests: unknown) =>
    wrap<{ workbooks: Record<string, OpenWorkbookPayload> }>("excel:openMultiple", async () => {
      const requests = sanitizeOpenMultipleRequests(rawRequests);
      const results: Record<string, OpenWorkbookPayload> = {};
      for (const request of requests) {
        const buildResult = await buildOpenPayload(request.path, request.devices, undefined, undefined, {
          trackRecent: false,
          allowMigration: false
        });
        results[request.path] = buildResult as OpenWorkbookPayload;
      }
      return { ok: true, workbooks: results };
    })
  );

  // --- Reload current workbook from disk ---
  ipcMain.handle("excel:reload", (event, rawPath: unknown, rawDevices?: unknown, rawUpsGroupContext?: unknown) =>
    wrap<OpenWorkbookPayload>("excel:reload", async () => {
      const filePath = ensureWorkbookPath(rawPath);
      return buildOpenPayload(filePath, sanitizeDevices(rawDevices), sanitizeUpsGroupHistoryOptions(rawUpsGroupContext), stage => {
        if (!event.sender.isDestroyed()) event.sender.send("migration-progress", { stage });
      });
    })
  );

  // --- Save (with pre-save backup, validation, atomic replace) ---
  ipcMain.handle("excel:save", (_event, raw: unknown) =>
    wrap<SaveWorkbookPayload>("excel:save", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const filePath = ensureWorkbookPath(body.path);
      const logs = validateLogsPayload(body.logs);
      const config = await loadConfig();
      const result = await saveWorkbook(filePath, logs, {
        backupDir: resolveBackupDir(config),
        backupKeep: config.backupKeep,
        devices: sanitizeDevices(body.devices),
        upsGroupHistory: sanitizeUpsGroupHistoryOptions(body.upsGroupHistory)
      });
	      log.info(`workbook saved: ${filePath} (${result.months} months, backup: ${result.backupPath ?? "none"})`);
	      return { ok: true, path: result.path, backupPath: result.backupPath, savedAt: new Date().toISOString() };
    })
  );

  // --- Rack Capacity: staged field edits, save only what actually changed ---
  ipcMain.handle("excel:saveRackCapacity", (_event, raw: unknown) =>
    wrap<RackCapacitySavePayload>("excel:saveRackCapacity", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const filePath = ensureWorkbookPath(body.path);
      const changes: RackFieldChange[] = sanitizeRackFieldChanges(body.changes);
      const image = sanitizeRackImage(body.image);
      if (changes.length === 0 && !image) throw new PayloadError("Save requires at least one field change or an image.");
      const facilityId = typeof body.facilityId === "string" && body.facilityId.length > 0 ? body.facilityId.slice(0, 100) : null;
      const snapshotMonth = sanitizeSnapshotMonth(body.snapshotMonth);
      const config = await loadConfig();
      const result = await saveRackCapacityFieldChanges(
        filePath,
        changes,
        { backupDir: resolveBackupDir(config), backupKeep: config.backupKeep },
        image,
        facilityId,
        snapshotMonth
      );
      log.info(`rack capacity saved: ${filePath} (${result.changedCount} field change(s), image: ${result.imageEmbedded}, backup: ${result.backupPath ?? "none"})`);
      return {
        ok: true,
        path: result.path,
        backupPath: result.backupPath,
        savedAt: result.savedAt,
        outcomes: result.outcomes,
        changedCount: result.changedCount,
        imageEmbedded: result.imageEmbedded,
        rackCapacity: result.rackCapacity
          ? { totalRacks: result.rackCapacity.records.length, records: result.rackCapacity.records, byStatus: result.rackCapacity.byStatus, byZone: result.rackCapacity.byZone }
          : null,
        rackCapacityHistory: result.rackCapacityHistory
      };
    })
  );

  // --- Rack Unit Capacity: Month/Total(U)/Used(U) upsert + optional image ---
  ipcMain.handle("excel:saveRackUnitCapacity", (_event, raw: unknown) =>
    wrap<RackUnitCapacitySavePayload>("excel:saveRackUnitCapacity", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const filePath = ensureWorkbookPath(body.path);
      const input = sanitizeRackUnitCapacityInput(body.input);
      const image = sanitizeRackImage(body.image);
      const config = await loadConfig();
      const result = await saveRackUnitCapacity(
        filePath,
        input,
        { backupDir: resolveBackupDir(config), backupKeep: config.backupKeep },
        image
      );
      log.info(`rack unit capacity saved: ${filePath} (month ${input.month}, image: ${result.imageEmbedded}, backup: ${result.backupPath ?? "none"})`);
      return {
        ok: true,
        path: result.path,
        backupPath: result.backupPath,
        savedAt: result.savedAt,
        imageEmbedded: result.imageEmbedded,
        rows: result.rows
      };
    })
  );

  // --- Save As (native save dialog) ---
  ipcMain.handle("excel:saveAs", (event, raw: unknown) =>
    wrap<SaveWorkbookPayload | { canceled: true }>("excel:saveAs", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const sourcePath = ensureWorkbookPath(body.sourcePath, "sourcePath");
      const logs = validateLogsPayload(body.logs);

      const result = await dialog.showSaveDialog(windowFor(event)!, {
        title: "Save Workbook As",
        defaultPath: sourcePath,
        filters: [{ name: "Excel Macro-Enabled Workbook", extensions: [path.extname(sourcePath).replace(".", "") || "xlsm"] }]
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true as const };
      const targetPath = ensureWorkbookPath(result.filePath, "target path");

      const config = await loadConfig();
      const saved = await saveWorkbook(sourcePath, logs, {
        backupDir: resolveBackupDir(config),
        backupKeep: config.backupKeep,
        targetPath,
        devices: sanitizeDevices(body.devices),
        upsGroupHistory: sanitizeUpsGroupHistoryOptions(body.upsGroupHistory)
      });
      await addRecentFile(targetPath);
      app.addRecentDocument(targetPath);
      log.info(`workbook saved as: ${targetPath}`);
      return { ok: true, path: saved.path, backupPath: saved.backupPath, savedAt: new Date().toISOString() };
    })
  );

  // --- Lock check (used by the retry dialog) ---
  ipcMain.handle("excel:checkLock", (_event, rawPath: unknown) =>
    wrap<{ locked: boolean; excelOwnerFilePresent: boolean }>("excel:checkLock", async () => {
      const lock = await checkWorkbookLock(ensureWorkbookPath(rawPath));
      return { ok: true, ...lock };
    })
  );

  // --- Access status (RC2 read-only mode + continuous health monitor) ---
  ipcMain.handle("excel:access", (_event, rawPath: unknown) =>
    wrap<WorkbookAccessStatus>("excel:access", async () => {
      const filePath = ensureWorkbookPath(rawPath);
      const status: { ok: true } & WorkbookAccessStatus = {
        ok: true,
        exists: false,
        readable: false,
        writable: false,
        locked: false,
        excelOwnerFilePresent: false,
        readOnlyAttribute: false,
        mtime: null,
        sizeBytes: null,
        lastBackupAt: null,
        reason: null
      };

      // Excel owner file (~$name): the workbook is (or was) open in Excel.
      try {
        await fs.access(path.join(path.dirname(filePath), `~$${path.basename(filePath)}`));
        status.excelOwnerFilePresent = true;
      } catch {
        /* no owner file */
      }

      try {
        const stat = await fs.stat(filePath);
        status.exists = true;
        status.mtime = stat.mtime.toISOString();
        status.sizeBytes = stat.size;
        // Windows maps the read-only file attribute onto the mode write bit.
        status.readOnlyAttribute = (stat.mode & 0o200) === 0;
      } catch {
        status.reason = "NOT_FOUND";
        return status;
      }

      try {
        const handle = await fs.open(filePath, "r");
        await handle.close();
        status.readable = true;
      } catch {
        status.reason = "NO_READ";
        return status;
      }

      try {
        const handle = await fs.open(filePath, "r+");
        await handle.close();
        status.writable = true;
      } catch {
        if (status.readOnlyAttribute) {
          status.reason = "READONLY_FILE";
        } else {
          status.locked = true;
          status.reason = status.excelOwnerFilePresent ? "LOCKED_EXCEL" : "LOCKED";
        }
      }

      // An owner file with no live write lock still means Excel has (or had)
      // the workbook open - writing under it risks corruption, so treat it as
      // not safely writable until the owner file disappears.
      if (status.writable && status.excelOwnerFilePresent) {
        status.writable = false;
        status.locked = true;
        status.reason = "LOCKED_EXCEL";
      }

      try {
        const config = await loadConfig();
        const backups = await listBackups(filePath, resolveBackupDir(config));
        status.lastBackupAt = backups[0]?.createdAt ?? null;
      } catch {
        /* no backup folder yet */
      }

      return status;
    })
  );

  // --- Standalone validation (Integrity Center "Validate now") ---
  ipcMain.handle("excel:validate", (_event, rawPath: unknown, rawDevices?: unknown) =>
    wrap<{ health: WorkbookHealth; integrity: WorkbookReadResult["integrity"]; validation: WorkbookReadResult["validation"] }>(
      "excel:validate",
      async () => {
        const filePath = ensureWorkbookPath(rawPath);
        const read = await readWorkbookFromFile(filePath, sanitizeDevices(rawDevices));
        return { ok: true, health: summarizeWorkbookHealth(read), integrity: read.integrity, validation: read.validation };
      }
    )
  );

  // --- Backups ---
  ipcMain.handle("backup:list", (_event, rawPath: unknown) =>
    wrap<{ backups: Awaited<ReturnType<typeof listBackups>> }>("backup:list", async () => {
      const workbookPath = ensureWorkbookPath(rawPath);
      const config = await loadConfig();
      const backups = await listBackups(workbookPath, resolveBackupDir(config));
      return { ok: true, backups };
    })
  );

  ipcMain.handle("backup:restore", (_event, raw: unknown) =>
    wrap<OpenWorkbookPayload & { safetyBackupPath: string }>("backup:restore", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const workbookPath = ensureWorkbookPath(body.workbookPath, "workbookPath");
      const backupPath = ensureWorkbookPath(body.backupPath, "backupPath");
      const config = await loadConfig();
      const backupDir = resolveBackupDir(config);
      if (path.dirname(backupPath).toLowerCase() !== path.normalize(backupDir).toLowerCase()) {
        throw new PayloadError("backupPath must point inside the configured backup folder.");
      }
      const restored = await restoreBackup(workbookPath, backupPath, backupDir, config.backupKeep);
      log.info(`backup restored: ${backupPath} -> ${workbookPath}`);
      const payload = await buildOpenPayload(workbookPath);
      return { ...payload, safetyBackupPath: restored.safetyBackupPath };
    })
  );

  // --- Crash-recovery journal (config/recovery.json) ---
  ipcMain.handle("recovery:get", () =>
    wrap<{ snapshot: RecoverySnapshot | null }>("recovery:get", async () => {
      try {
        const raw = await fs.readFile(getRecoveryPath(), "utf8");
        const parsed = JSON.parse(raw) as RecoverySnapshot;
        if (!parsed || typeof parsed.workbookPath !== "string" || !Array.isArray(parsed.logs)) {
          return { ok: true, snapshot: null };
        }
        return { ok: true, snapshot: parsed };
      } catch {
        return { ok: true, snapshot: null };
      }
    })
  );

  ipcMain.handle("recovery:set", (_event, raw: unknown) =>
    wrap<{ saved: boolean }>("recovery:set", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const workbookPath = ensureWorkbookPath(body.workbookPath, "workbookPath");
      const logs = validateLogsPayload(body.logs);
      const snapshot: RecoverySnapshot = { workbookPath, savedAt: new Date().toISOString(), logs };
      await ensureDir(path.dirname(getRecoveryPath()));
      await fs.writeFile(getRecoveryPath(), JSON.stringify(snapshot), "utf8");
      return { ok: true, saved: true };
    })
  );

  ipcMain.handle("recovery:clear", () =>
    wrap<{ saved: boolean }>("recovery:clear", async () => {
      await fs.unlink(getRecoveryPath()).catch(() => undefined);
      return { ok: true, saved: true };
    })
  );

  // --- Exports (JSON/CSV) into the portable exports/ folder ---
  ipcMain.handle("export:file", (event, raw: unknown) =>
    wrap<{ path: string } | { canceled: true }>("export:file", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const defaultName = typeof body.defaultName === "string" ? path.basename(body.defaultName) : "export.json";
      const content = typeof body.content === "string" ? body.content : null;
      if (content === null || content.length > 50 * 1024 * 1024) throw new PayloadError("content must be a string (max 50 MB).");
      const ext = path.extname(defaultName).replace(".", "") || "json";
      if (!["json", "csv", "txt"].includes(ext)) throw new PayloadError("Only .json/.csv/.txt exports are allowed.");

      // Same test hook as the Export Center: automated tests cannot drive
      // native dialogs.
      if (process.env.ENERGY_MONITOR_TEST_EXPORT_DIR) {
        const dir = await ensureDir(process.env.ENERGY_MONITOR_TEST_EXPORT_DIR);
        const testPath = path.join(dir, defaultName);
        await fs.writeFile(testPath, content, "utf8");
        log.info(`[EXPORT] file -> ${testPath}`);
        return { ok: true, path: testPath };
      }
      const exportsDir = await ensureDir(getExportsDir());
      const result = await dialog.showSaveDialog(windowFor(event)!, {
        title: "Export",
        defaultPath: path.join(exportsDir, defaultName),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true as const };
      await fs.writeFile(result.filePath, content, "utf8");
      log.info(`exported: ${result.filePath}`);
      return { ok: true, path: result.filePath };
    })
  );
}
