/**
 * Portable configuration store - config/config.json beside the executable.
 * Read once at startup, written atomically on every change. This replaces
 * localStorage for everything that is app configuration (never business
 * data - that lives in the workbook).
 */

import { promises as fs } from "fs";
import path from "path";
import { ensureDir, getAppRoot, getConfigDir, log } from "./paths";

export interface AppConfig {
  /** Workbook opened when startupBehavior is "default". */
  defaultWorkbookPath: string | null;
  /** Last successfully opened workbook (startupBehavior "last"). */
  lastWorkbookPath: string | null;
  /** "last" = reopen last workbook, "default" = open default, "ask" = start empty. */
  startupBehavior: "last" | "default" | "ask";
  theme: "dark" | "light";
  language: "th" | "en";
  /** null = "<app root>/backup". */
  backupFolder: string | null;
  backupKeep: number;
  /** Minutes between auto-saves; 0 disables. */
  autoSaveIntervalMinutes: number;
  googleSheets: {
    enabled: boolean;
    spreadsheetId: string | null;
  };
  recentFiles: string[];
  window: { width: number; height: number; maximized: boolean };
  security: {
    pinEnabled: boolean;
    pinHash: string | null;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  defaultWorkbookPath: null,
  lastWorkbookPath: null,
  startupBehavior: "last",
  theme: "dark",
  language: "th",
  backupFolder: null,
  backupKeep: 20,
  autoSaveIntervalMinutes: 5,
  googleSheets: { enabled: false, spreadsheetId: null },
  recentFiles: [],
  window: { width: 1440, height: 920, maximized: false },
  security: { pinEnabled: false, pinHash: null }
};

const MAX_RECENT = 10;

function configFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}

let cached: AppConfig | null = null;

function mergeWithDefaults(raw: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    googleSheets: { ...DEFAULT_CONFIG.googleSheets, ...(raw.googleSheets ?? {}) },
    window: { ...DEFAULT_CONFIG.window, ...(raw.window ?? {}) },
    security: { ...DEFAULT_CONFIG.security, ...(raw.security ?? {}) },
    recentFiles: Array.isArray(raw.recentFiles) ? raw.recentFiles.filter(f => typeof f === "string").slice(0, MAX_RECENT) : []
  };
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(configFilePath(), "utf8");
    cached = mergeWithDefaults(JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export async function saveConfig(next: AppConfig): Promise<AppConfig> {
  cached = next;
  await ensureDir(getConfigDir());
  const file = configFilePath();
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, file).catch(async err => {
    // Windows can refuse the rename if something is scanning the file - fall
    // back to a direct write rather than losing the change.
    log.warn(`config rename failed (${(err as Error).message}); writing directly`);
    await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
    await fs.unlink(tmp).catch(() => undefined);
  });
  return next;
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  return saveConfig(mergeWithDefaults({ ...current, ...patch }));
}

export async function addRecentFile(filePath: string): Promise<AppConfig> {
  const current = await loadConfig();
  const rest = current.recentFiles.filter(f => f.toLowerCase() !== filePath.toLowerCase());
  return saveConfig({ ...current, recentFiles: [filePath, ...rest].slice(0, MAX_RECENT), lastWorkbookPath: filePath });
}

export function resolveBackupDir(config: AppConfig): string {
  return config.backupFolder ?? path.join(getAppRoot(), "backup");
}
