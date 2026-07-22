/**
 * One-time, idempotent migration: if "2. UPS Group History" does not exist
 * yet in a workbook, generate it for every historical month and persist it
 * to disk automatically on open - so a legacy workbook's Historical Explorer
 * is never empty and the user is never required to Save first.
 *
 * Dedicated service, called only from buildOpenPayload() (excel:open /
 * excel:reload). Historical Explorer never triggers this - it only ever
 * reads whatever DataSnapshot.upsGroupHistory it was handed.
 *
 * Reuses the existing zip-level UPS Group History writer (never ExcelJS
 * full-write) and the existing lock/backup primitives from WorkbookWriter.ts
 * - no parallel safety mechanism is invented here.
 */
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";
import { MonthlyLog } from "../types";
import type { UpsGroupConfig } from "../utils/upsGroupAggregation";
import { locateUpsGroupHistorySheet, patchUpsGroupHistoryBuffer } from "../excel/UpsGroupHistoryWriter";
import { checkWorkbookLock, createBackup } from "../excel/WorkbookWriter";

// Plain console, not electron/paths.ts's `log` - this service must stay
// runnable outside the Electron main process (tsx-driven test scripts),
// exactly like WorkbookWriter.ts already does.

export type MigrationStage =
  | "checking"
  | "not-found"
  | "migrating"
  | "generating"
  | "saving"
  | "reloading"
  | "complete"
  | "skipped-locked"
  | "skipped-no-groups";

export interface MigrationResult {
  migrated: boolean;
  rowsWritten: number;
}

/**
 * Runs the migration if, and only if, "2. UPS Group History" is missing
 * from the workbook at `filePath`. Returns immediately (migrated: false) if
 * the sheet already exists - migration must occur at most once per
 * workbook, and re-opening an already-migrated workbook is a cheap no-op
 * (a single zip read to confirm the sheet is there).
 */
export async function migrateUpsGroupHistoryIfNeeded(
  filePath: string,
  logs: MonthlyLog[],
  facilityId: string,
  upsGroups: UpsGroupConfig[],
  backupDir: string | null,
  backupKeep: number,
  onProgress?: (stage: MigrationStage) => void
): Promise<MigrationResult> {
  const emit = (stage: MigrationStage) => onProgress?.(stage);
  emit("checking");

  if (upsGroups.length === 0) {
    emit("skipped-no-groups");
    return { migrated: false, rowsWritten: 0 };
  }

  const original = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(original);
  const existing = await locateUpsGroupHistorySheet(zip);
  if (existing) {
    // Already migrated - skip completely, do not touch the file.
    return { migrated: false, rowsWritten: 0 };
  }
  emit("not-found");

  const lock = await checkWorkbookLock(filePath);
  if (lock.locked) {
    // Never write to a workbook that is open elsewhere (Excel, another
    // instance). The read side still works unmigrated; migration simply
    // retries automatically on the next open once it is unlocked.
    console.warn(`UPS Group History migration skipped (workbook locked): ${filePath}`);
    emit("skipped-locked");
    return { migrated: false, rowsWritten: 0 };
  }

  emit("migrating");
  emit("generating");
  const patched = await patchUpsGroupHistoryBuffer(original, facilityId, upsGroups, logs);

  // Prove the patched buffer is still a valid, re-openable workbook before
  // it ever touches disk.
  await JSZip.loadAsync(patched);

  if (backupDir) {
    try {
      await createBackup(filePath, backupDir, backupKeep);
    } catch (error) {
      console.warn(`UPS Group History migration: backup failed, proceeding anyway: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  emit("saving");
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-migrate-${process.pid}`);
  try {
    await fs.writeFile(tempPath, patched);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      /* already gone */
    }
    throw error;
  }

  emit("reloading");
  const rowsWritten = logs.length * upsGroups.length;
  console.info(`UPS Group History migrated on open: ${filePath} (${rowsWritten} rows, ${logs.length} months x ${upsGroups.length} groups)`);
  emit("complete");
  return { migrated: true, rowsWritten };
}
