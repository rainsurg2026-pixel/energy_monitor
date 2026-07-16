/**
 * BackupManager - listing and restoring the timestamped backups that
 * WorkbookWriter creates before every save (backup/Name_YYYY-MM-DD_HHMMSS.xlsm).
 *
 * Restore is itself protected: the current workbook is backed up first, the
 * backup is validated as a readable workbook, and the copy is atomic - so a
 * restore can never make things worse.
 */

import { promises as fs } from "fs";
import path from "path";
import { readWorkbookFromBuffer } from "../../excel/WorkbookReader";
import { WorkbookError, checkWorkbookLock, createBackup } from "../../excel/WorkbookWriter";

export interface BackupEntry {
  path: string;
  fileName: string;
  createdAt: string; // ISO timestamp derived from file mtime
  sizeBytes: number;
}

/** List backups belonging to the given workbook, newest first. */
export async function listBackups(workbookPath: string, backupDir: string): Promise<BackupEntry[]> {
  const ext = path.extname(workbookPath);
  const stem = path.basename(workbookPath, ext);
  let entries: string[];
  try {
    entries = await fs.readdir(backupDir);
  } catch {
    return [];
  }

  const result: BackupEntry[] = [];
  for (const name of entries) {
    if (!name.startsWith(`${stem}_`) || !name.endsWith(ext)) continue;
    const full = path.join(backupDir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      result.push({
        path: full,
        fileName: name,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size
      });
    } catch {
      /* skip unreadable entries */
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface RestoreResult {
  restoredFrom: string;
  safetyBackupPath: string;
}

/**
 * Replace the workbook with a chosen backup. The current workbook is first
 * backed up ("safety backup"), and the backup file is validated before it
 * replaces anything.
 */
export async function restoreBackup(
  workbookPath: string,
  backupPath: string,
  backupDir: string,
  backupKeep: number
): Promise<RestoreResult> {
  // The backup being restored must itself be a readable, structurally valid workbook.
  const buffer = await fs.readFile(backupPath);
  const read = await readWorkbookFromBuffer(buffer);
  if (!read.validation.ok) {
    throw new WorkbookError(
      "VALIDATION_FAILED",
      `Backup cannot be restored - it failed validation: ${read.validation.errors.join("; ")}`
    );
  }

  const lock = await checkWorkbookLock(workbookPath);
  if (lock.locked) {
    throw new WorkbookError("LOCKED", "The workbook is open in Excel. Close it before restoring a backup.");
  }

  const safetyBackupPath = await createBackup(workbookPath, backupDir, backupKeep);

  const tempPath = path.join(path.dirname(workbookPath), `.${path.basename(workbookPath)}.restore-${process.pid}`);
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, workbookPath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw new WorkbookError("WRITE_FAILED", `Restore failed: ${(err as Error).message}`);
  }

  return { restoredFrom: backupPath, safetyBackupPath };
}
