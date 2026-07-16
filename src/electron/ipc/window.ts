/**
 * IPC surface for app/window/config concerns: app info, portable config
 * (config/config.json), recent files, and revealing files in Explorer.
 */

import { app, ipcMain, shell } from "electron";
import path from "path";
import { AppConfig, DEFAULT_CONFIG, loadConfig, saveConfig, updateConfig } from "../config";
import { getAppRoot, log } from "../paths";

function sanitizeConfigPatch(raw: unknown): Partial<AppConfig> {
  if (typeof raw !== "object" || raw === null) return {};
  const input = raw as Record<string, unknown>;
  const patch: Partial<AppConfig> = {};

  if (typeof input.defaultWorkbookPath === "string" || input.defaultWorkbookPath === null)
    patch.defaultWorkbookPath = input.defaultWorkbookPath as string | null;
  if (typeof input.lastWorkbookPath === "string" || input.lastWorkbookPath === null)
    patch.lastWorkbookPath = input.lastWorkbookPath as string | null;
  if (input.startupBehavior === "last" || input.startupBehavior === "default" || input.startupBehavior === "ask")
    patch.startupBehavior = input.startupBehavior;
  if (input.theme === "dark" || input.theme === "light") patch.theme = input.theme;
  if (input.language === "th" || input.language === "en") patch.language = input.language;
  if (typeof input.backupFolder === "string" || input.backupFolder === null)
    patch.backupFolder = input.backupFolder as string | null;
  if (typeof input.backupKeep === "number" && Number.isFinite(input.backupKeep))
    patch.backupKeep = Math.min(500, Math.max(1, Math.round(input.backupKeep)));
  if (typeof input.autoSaveIntervalMinutes === "number" && Number.isFinite(input.autoSaveIntervalMinutes))
    patch.autoSaveIntervalMinutes = Math.min(240, Math.max(0, Math.round(input.autoSaveIntervalMinutes)));
  if (typeof input.googleSheets === "object" && input.googleSheets !== null) {
    const gs = input.googleSheets as Record<string, unknown>;
    patch.googleSheets = {
      enabled: gs.enabled === true,
      spreadsheetId:
        typeof gs.spreadsheetId === "string" && gs.spreadsheetId.length < 200 ? gs.spreadsheetId : null
    };
  }
  if (typeof input.security === "object" && input.security !== null) {
    const sec = input.security as Record<string, unknown>;
    patch.security = {
      pinEnabled: sec.pinEnabled === true,
      pinHash: typeof sec.pinHash === "string" && sec.pinHash.length < 500 ? sec.pinHash : null
    };
  }
  return patch;
}

export function registerWindowIpc(): void {
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    appRoot: getAppRoot(),
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
  }));

  ipcMain.handle("config:get", async () => loadConfig());

  ipcMain.handle("config:update", async (_event, raw: unknown) => {
    const patch = sanitizeConfigPatch(raw);
    const next = await updateConfig(patch);
    log.info(`config updated: ${Object.keys(patch).join(", ") || "(nothing valid)"}`);
    return next;
  });

  ipcMain.handle("config:reset", async () => saveConfig({ ...DEFAULT_CONFIG }));

  ipcMain.handle("recent:clear", async () => updateConfig({ recentFiles: [] }));

  ipcMain.handle("shell:showItemInFolder", (_event, raw: unknown) => {
    if (typeof raw !== "string" || raw.length > 1000) return false;
    shell.showItemInFolder(path.normalize(raw));
    return true;
  });
}
