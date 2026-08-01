/**
 * Save orchestration (lock check -> backup -> atomic write) for "Rack Unit
 * Capacity", kept in its own Node-only module rather than folded into
 * RackUnitCapacityWriter.ts - that file's pure read/upsert logic is safely
 * imported into the RENDERER bundle (reportDataBuilder.ts, for the PDF's
 * Rack Unit Capacity block), and importing fs/path/WorkbookWriter there
 * would drag the whole Node-only dependency graph into the browser bundle,
 * exactly the regression ExcelZipUtils.ts's header comment already
 * documents for the History module. Same split as RackCapacityWriter.ts
 * (Node-only save orchestration) vs RackCapacityHistoryWriter.ts (browser-
 * safe read/upsert).
 */
import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";
import { checkWorkbookLock, createBackup, WorkbookError } from "./WorkbookWriter";
import {
  ensureRackUnitCapacitySheet,
  upsertRackUnitCapacityRow,
  readRackUnitCapacityFromBuffer,
  RackUnitCapacityInput,
  RackUnitCapacityRow
} from "./RackUnitCapacityWriter";

export interface RackUnitCapacityWriteResult {
  buffer: Buffer;
  changed: boolean;
}

export async function applyRackUnitCapacityChange(
  original: Buffer,
  input: RackUnitCapacityInput
): Promise<RackUnitCapacityWriteResult> {
  const zip = await JSZip.loadAsync(original);
  const { xmlPath, tablePath, created } = await ensureRackUnitCapacitySheet(zip);
  const changed = await upsertRackUnitCapacityRow(zip, xmlPath, tablePath, input);

  if (!created && !changed) {
    return { buffer: original, changed: false };
  }
  const buffer = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
  return { buffer, changed: true };
}

export interface RackUnitCapacitySaveResult {
  path: string;
  backupPath: string | null;
  savedAt: string;
  rows: RackUnitCapacityRow[];
}

/**
 * Full controlled save: lock check -> apply Total (U)/Used (U) upsert ->
 * backup -> atomic write -> re-read for verification. Mirrors
 * saveRackCapacityFieldChanges's lock/backup/atomic-write shape. If the
 * save produces zero actual change (identical month/values), the file on
 * disk is never touched and backupPath is null - a read-only/no-op attempt
 * must never appear as a save in the backup history.
 */
export async function saveRackUnitCapacity(
  filePath: string,
  input: RackUnitCapacityInput,
  options: { backupDir: string; backupKeep: number },
  /** Same "record a monthly snapshot even with zero changes" opt-in as
   *  saveRackCapacityFieldChanges - default false, existing no-op-skip
   *  behavior for the normal Save button is untouched. */
  forceSnapshot?: boolean
): Promise<RackUnitCapacitySaveResult> {
  let original: Buffer;
  try {
    original = await fs.readFile(filePath);
  } catch {
    throw new WorkbookError("NOT_FOUND", `Workbook not found: ${filePath}`, "read");
  }

  const lock = await checkWorkbookLock(filePath);
  if (lock.locked) {
    throw new WorkbookError("LOCKED", "The workbook is currently open in Excel (or another program). Close it and retry.", "lock");
  }

  const { buffer, changed } = await applyRackUnitCapacityChange(original, input);

  if (!changed && !forceSnapshot) {
    const rows = await readRackUnitCapacityFromBuffer(original);
    return { path: filePath, backupPath: null, savedAt: new Date().toISOString(), rows };
  }

  let backupPath: string | null = null;
  try {
    backupPath = await createBackup(filePath, options.backupDir, options.backupKeep);
  } catch (err) {
    throw new WorkbookError("WRITE_FAILED", `Could not create a backup before saving: ${(err as Error).message}`, "backup");
  }

  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {
      /* already gone */
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new WorkbookError("LOCKED", "The workbook became locked while saving. Close it in Excel and retry.", "write");
    }
    throw new WorkbookError("WRITE_FAILED", `Could not write Rack Unit Capacity changes: ${(err as Error).message}`, "write");
  }

  const rows = await readRackUnitCapacityFromBuffer(buffer);
  return { path: filePath, backupPath, savedAt: new Date().toISOString(), rows };
}
