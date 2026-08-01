/**
 * Portable path resolution + logging.
 *
 * The app is distributed as a portable exe: everything lives BESIDE the
 * executable (config/, backup/, logs/, exports/) - never in AppData, the
 * registry, or Local Storage.
 *
 * electron-builder's portable target extracts the real exe to a temp dir and
 * sets PORTABLE_EXECUTABLE_DIR to the folder the user double-clicked in, so
 * that env var wins. Unpacked builds fall back to the exe's directory, and
 * development falls back to the project root.
 */

import { app } from "electron";
import { promises as fs, appendFileSync, mkdirSync } from "fs";
import path from "path";

export function getAppRoot(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  // Test-only override keeps development E2E runs from writing migration data
  // into the real workbooks/config beside the repository.
  if (!app.isPackaged && process.env.ENERGY_MONITOR_APP_ROOT) return path.resolve(process.env.ENERGY_MONITOR_APP_ROOT);
  if (app.isPackaged) return path.dirname(process.execPath);
  return app.getAppPath();
}

export function getConfigDir(): string {
  return path.join(getAppRoot(), "config");
}

export function getDefaultBackupDir(): string {
  return path.join(getAppRoot(), "backup");
}

export function getLogsDir(): string {
  return path.join(getAppRoot(), "logs");
}

export function getExportsDir(): string {
  return path.join(getAppRoot(), "exports");
}

/** Root of the filesystem ImageStorageProvider (src/storage/ImageStorageProvider.ts)
 *  - `data/rack-unit-images/<Facility>/RUC-<Mon>-<YY>.png`, beside the
 *  executable like every other portable-app directory. Never inside the
 *  Excel workbook - see RackUnitCapacityImageMigration.ts for the one-time
 *  migration off every prior Excel-embedded image mechanism. */
export function getRackUnitImagesRootDir(): string {
  return path.join(getAppRoot(), "data", "rack-unit-images");
}

export function getRecoveryPath(): string {
  return path.join(getConfigDir(), "recovery.json");
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Logging - plain-text application log in logs/app.log, size-rotated once.
// ---------------------------------------------------------------------------

const MAX_LOG_BYTES = 1024 * 1024;

function logFilePath(): string {
  return path.join(getLogsDir(), "app.log");
}

export function logLine(level: "INFO" | "WARN" | "ERROR", message: string): void {
  try {
    const dir = getLogsDir();
    mkdirSync(dir, { recursive: true });
    const file = logFilePath();
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`, "utf8");
  } catch {
    /* logging must never break the app */
  }
}

export async function rotateLogIfNeeded(): Promise<void> {
  try {
    const file = logFilePath();
    const stat = await fs.stat(file);
    if (stat.size > MAX_LOG_BYTES) {
      await fs.rename(file, `${file}.1`).catch(async () => {
        await fs.copyFile(file, `${file}.1`);
        await fs.writeFile(file, "");
      });
    }
  } catch {
    /* no log yet */
  }
}

export const log = {
  info: (message: string) => logLine("INFO", message),
  warn: (message: string) => logLine("WARN", message),
  error: (message: string) => logLine("ERROR", message)
};
