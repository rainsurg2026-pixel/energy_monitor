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

/** Optional per-facility device lists sent with workbook operations. */
function sanitizeDevices(raw: unknown): DeviceLists | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter(x => typeof x === "string" && x.length > 0 && x.length <= 100).slice(0, 50) : null;
  const upsIds = list(o.upsIds);
  const dcIds = list(o.dcIds);
  if (!upsIds || upsIds.length === 0 || !dcIds || dcIds.length === 0) return undefined;
  return { upsIds, dcIds };
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
}

export interface SaveWorkbookPayload {
  path: string;
  backupPath: string | null;
  savedAt: string;
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

async function buildOpenPayload(filePath: string, devices?: DeviceLists): Promise<{ ok: true } & OpenWorkbookPayload> {
  const read = await readWorkbookFromFile(filePath, devices);
  if (!read.validation.ok) {
    throw new WorkbookError(
      "INVALID_WORKBOOK",
      `This file is not a compatible workbook:\n${read.validation.errors.join("\n")}`
    );
  }
  const lock = await checkWorkbookLock(filePath);
  await addRecentFile(filePath);
  app.addRecentDocument(filePath);
  log.info(`workbook opened: ${filePath} (${read.logs.length} months)`);
  return {
    ok: true,
    path: filePath,
    logs: read.logs,
    validation: read.validation,
    integrity: read.integrity,
    health: summarizeWorkbookHealth(read),
    lock: { locked: lock.locked, excelOwnerFilePresent: lock.excelOwnerFilePresent }
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerExcelIpc(): void {
  // --- Open (native picker when no path is given) ---
  ipcMain.handle("excel:open", (event, rawPath: unknown, rawDevices?: unknown) =>
    wrap<OpenWorkbookPayload | { canceled: true }>("excel:open", async () => {
      const devices = sanitizeDevices(rawDevices);
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
      return buildOpenPayload(filePath, devices);
    })
  );

  // --- Reload current workbook from disk ---
  ipcMain.handle("excel:reload", (_event, rawPath: unknown, rawDevices?: unknown) =>
    wrap<OpenWorkbookPayload>("excel:reload", async () => {
      const filePath = ensureWorkbookPath(rawPath);
      return buildOpenPayload(filePath, sanitizeDevices(rawDevices));
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
        devices: sanitizeDevices(body.devices)
      });
      log.info(`workbook saved: ${filePath} (${result.months} months, backup: ${result.backupPath ?? "none"})`);
      return { ok: true, path: result.path, backupPath: result.backupPath, savedAt: new Date().toISOString() };
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
        devices: sanitizeDevices(body.devices)
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
