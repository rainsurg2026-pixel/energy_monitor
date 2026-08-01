/**
 * IPC surface for Google Sheets sync on desktop. All OAuth state and the raw
 * access token stay in the main process (googleAuth.ts); this file only ever
 * sends the renderer a coarse status (see GoogleAuthStatus) plus sync
 * results/errors - never a token. See googleAuth.ts's header comment for why
 * this replaced the previous renderer-side Firebase popup/redirect flow.
 */
import { BrowserWindow, ipcMain } from "electron";
import { PayloadError, validateLogsPayload } from "../../excel/WorkbookValidator";
import {
  writeMonthlyLogTransactional,
  importLogsFromGoogleSheets,
  VerificationFailedError,
  DataIntegrityReport
} from "../../sheetsService";
import { MonthlyLog } from "../../types";
import {
  getGoogleAuthState,
  getValidAccessToken,
  onGoogleAuthStateChange,
  signOutGoogle,
  startGoogleSignIn,
  GoogleAuthState
} from "../googleAuth";
import { log } from "../paths";

export type { GoogleAuthState } from "../googleAuth";

export interface GoogleSheetsSyncResult {
  report: DataIntegrityReport;
}

function broadcastAuthState(state: GoogleAuthState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("google-auth-state", state);
  }
}

function sanitizeSpreadsheetId(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > 200) {
    throw new PayloadError("spreadsheetId must be a non-empty string.");
  }
  return raw.trim();
}

function sanitizeSingleLog(raw: unknown): MonthlyLog {
  const logs = validateLogsPayload([raw]);
  if (logs.length !== 1) throw new PayloadError("log must be a single valid MonthlyLog.");
  return logs[0];
}

function describeError(err: unknown): { code: string; message: string; mismatches?: string[] } {
  if (err instanceof VerificationFailedError) {
    return { code: "VERIFICATION_FAILED", message: err.message, mismatches: err.mismatches };
  }
  if (err instanceof PayloadError) return { code: "BAD_PAYLOAD", message: err.message };
  return { code: "ERROR", message: err instanceof Error ? err.message : String(err) };
}

/** Resolves a valid access token or throws a PayloadError-shaped error the
 *  renderer can present as "sign in required" - callers never proceed with
 *  a missing/expired token. */
async function requireAccessToken(): Promise<string> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("AUTH_REQUIRED: Google sign-in is required before syncing.");
  return token;
}

export function registerGoogleSheetsIpc(): void {
  onGoogleAuthStateChange(broadcastAuthState);

  ipcMain.handle("googleSheets:status", () => getGoogleAuthState());

  // Fire-and-forget: the full sign-in (system browser + loopback wait, up to
  // 5 minutes) happens in the background; the renderer follows progress via
  // the "google-auth-state" broadcast event instead of blocking this call.
  ipcMain.handle("googleSheets:signIn", () => {
    void startGoogleSignIn();
    return { ok: true };
  });

  ipcMain.handle("googleSheets:signOut", async () => {
    await signOutGoogle();
    return { ok: true };
  });

  ipcMain.handle("googleSheets:syncMonth", async (_event, raw: unknown) => {
    try {
      const body = (raw ?? {}) as Record<string, unknown>;
      const spreadsheetId = sanitizeSpreadsheetId(body.spreadsheetId);
      const monthLog = sanitizeSingleLog(body.log);
      const accessToken = await requireAccessToken();
      const result = await writeMonthlyLogTransactional(accessToken, spreadsheetId, monthLog);
      log.info(`Google Sheets sync: ${monthLog.month} -> ${spreadsheetId}`);
      return { ok: true, report: result.report };
    } catch (err) {
      return { ok: false, ...describeError(err) };
    }
  });

  ipcMain.handle("googleSheets:exportAll", async (_event, raw: unknown) => {
    try {
      const body = (raw ?? {}) as Record<string, unknown>;
      const spreadsheetId = sanitizeSpreadsheetId(body.spreadsheetId);
      const logs = validateLogsPayload(body.logs);
      if (logs.length === 0) throw new PayloadError("No local data to export.");
      const accessToken = await requireAccessToken();
      let lastReport: DataIntegrityReport | null = null;
      for (const monthLog of logs) {
        try {
          const result = await writeMonthlyLogTransactional(accessToken, spreadsheetId, monthLog);
          lastReport = result.report;
        } catch (err) {
          if (err instanceof VerificationFailedError) {
            throw new VerificationFailedError(`${monthLog.month}: ${err.message}`, err.mismatches);
          }
          throw new Error(`${monthLog.month}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      log.info(`Google Sheets export-all: ${logs.length} month(s) -> ${spreadsheetId}`);
      return { ok: true, report: lastReport };
    } catch (err) {
      return { ok: false, ...describeError(err) };
    }
  });

  ipcMain.handle("googleSheets:importAll", async (_event, raw: unknown) => {
    try {
      const body = (raw ?? {}) as Record<string, unknown>;
      const spreadsheetId = sanitizeSpreadsheetId(body.spreadsheetId);
      const accessToken = await requireAccessToken();
      const logs = await importLogsFromGoogleSheets(accessToken, spreadsheetId);
      log.info(`Google Sheets import-all: ${logs.length} month(s) <- ${spreadsheetId}`);
      return { ok: true, logs };
    } catch (err) {
      return { ok: false, ...describeError(err) };
    }
  });
}
