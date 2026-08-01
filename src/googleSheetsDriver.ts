/**
 * Renderer-side seam between the Google Sheets sync UI (GoogleSheetsSync.tsx)
 * and however the current environment actually talks to Google:
 *
 *   - Desktop (Electron): DesktopGoogleSheetsDriver - every privileged
 *     operation (OAuth, holding the token, calling the Sheets API) happens in
 *     the main process (see electron/googleAuth.ts, electron/ipc/
 *     googleSheets.ts); this driver only ever sends/receives plain data over
 *     IPC, never a token.
 *   - Browser (no Electron bridge - e.g. an iframe-embedded preview
 *     deployment): BrowserGoogleSheetsDriver - the pre-existing Firebase
 *     Auth + direct-fetch flow (firebaseAuth.ts/sheetsService.ts), left
 *     architecturally untouched. That flow's popup/redirect quirks are a
 *     genuinely different problem in a genuinely different deployment
 *     context (no Electron main process exists there to own OAuth), and are
 *     out of scope for the desktop-reliability fix.
 *
 * GoogleSheetsSync.tsx and App.tsx depend only on this interface, never on
 * firebaseAuth.ts or window.desktop.googleSheets directly - which backend is
 * live is decided once, by ProviderFactory's same isDesktop() check every
 * other provider seam already uses.
 */
import { MonthlyLog } from "./types";
import { googleSignIn, logout as firebaseLogout, initAuth } from "./firebaseAuth";
import { writeMonthlyLogTransactional, importLogsFromGoogleSheets, DataIntegrityReport } from "./sheetsService";

export type GoogleConnectionStatus = "disconnected" | "connecting" | "connected" | "authRequired" | "error";

export interface GoogleConnectionState {
  status: GoogleConnectionStatus;
  email: string | null;
  errorMessage: string | null;
}

export interface GoogleSheetsDriver {
  /** True on the desktop build - the UI uses this to skip the browser-only
   *  "open in a new tab" guidance, which does not apply to a packaged app. */
  readonly isDesktop: boolean;
  getState(): GoogleConnectionState;
  onStateChange(listener: (state: GoogleConnectionState) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  syncMonth(spreadsheetId: string, log: MonthlyLog): Promise<{ report: DataIntegrityReport }>;
  exportAll(spreadsheetId: string, logs: MonthlyLog[]): Promise<{ report: DataIntegrityReport | null }>;
  importAll(spreadsheetId: string): Promise<MonthlyLog[]>;
}

function ipcFailureMessage(result: { ok: false; code: string; message: string }): string {
  if (result.code === "ERROR" && result.message.startsWith("AUTH_REQUIRED")) {
    return "Google sign-in is required. Please connect your Google account and try again.";
  }
  return result.message;
}

/** Desktop: every call is a thin IPC wrapper - no token ever passes through
 *  this process's own memory beyond what main sends back as a plain result. */
export class DesktopGoogleSheetsDriver implements GoogleSheetsDriver {
  readonly isDesktop = true;
  private state: GoogleConnectionState = { status: "disconnected", email: null, errorMessage: null };
  private listeners: Array<(state: GoogleConnectionState) => void> = [];
  private unsubscribe: (() => void) | null = null;

  constructor() {
    void window.desktop!.googleSheets.status().then(state => this.setState(state));
    this.unsubscribe = window.desktop!.events.onGoogleAuthState(state => this.setState(state));
  }

  private setState(state: GoogleConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  getState(): GoogleConnectionState {
    return this.state;
  }

  onStateChange(listener: (state: GoogleConnectionState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async signIn(): Promise<void> {
    await window.desktop!.googleSheets.signIn();
    // Actual outcome (connected/error) arrives via onGoogleAuthState.
  }

  async signOut(): Promise<void> {
    await window.desktop!.googleSheets.signOut();
  }

  async syncMonth(spreadsheetId: string, log: MonthlyLog): Promise<{ report: DataIntegrityReport }> {
    const result = await window.desktop!.googleSheets.syncMonth({ spreadsheetId, log });
    if (result.ok === false) throw new Error(ipcFailureMessage(result));
    return { report: result.report as DataIntegrityReport };
  }

  async exportAll(spreadsheetId: string, logs: MonthlyLog[]): Promise<{ report: DataIntegrityReport | null }> {
    const result = await window.desktop!.googleSheets.exportAll({ spreadsheetId, logs });
    if (result.ok === false) throw new Error(ipcFailureMessage(result));
    return { report: (result.report as DataIntegrityReport | null) ?? null };
  }

  async importAll(spreadsheetId: string): Promise<MonthlyLog[]> {
    const result = await window.desktop!.googleSheets.importAll({ spreadsheetId });
    if (result.ok === false) throw new Error(ipcFailureMessage(result));
    return result.logs as MonthlyLog[];
  }

  dispose(): void {
    this.unsubscribe?.();
  }
}

/** Browser (no Electron bridge): the pre-existing Firebase Auth + direct
 *  client-side fetch flow, unchanged - a real access token does live in this
 *  renderer's memory in this mode, exactly as before. */
export class BrowserGoogleSheetsDriver implements GoogleSheetsDriver {
  readonly isDesktop = false;
  private state: GoogleConnectionState = { status: "disconnected", email: null, errorMessage: null };
  private listeners: Array<(state: GoogleConnectionState) => void> = [];
  private accessToken: string | null = null;
  private unsubscribe: () => void;

  constructor() {
    this.unsubscribe = initAuth(
      (user, token) => {
        this.accessToken = token;
        this.setState({ status: "connected", email: user.email, errorMessage: null });
      },
      () => {
        this.accessToken = null;
        this.setState({ status: "authRequired", email: null, errorMessage: null });
      }
    );
  }

  private setState(state: GoogleConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  getState(): GoogleConnectionState {
    return this.state;
  }

  onStateChange(listener: (state: GoogleConnectionState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async signIn(): Promise<void> {
    this.setState({ status: "connecting", email: null, errorMessage: null });
    try {
      await googleSignIn();
      // onAuthStateChanged (via initAuth) delivers the resulting connected state.
    } catch (err) {
      this.setState({ status: "error", email: null, errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async signOut(): Promise<void> {
    await firebaseLogout();
  }

  private requireToken(): string {
    if (!this.accessToken) throw new Error("Google sign-in is required.");
    return this.accessToken;
  }

  async syncMonth(spreadsheetId: string, log: MonthlyLog): Promise<{ report: DataIntegrityReport }> {
    return writeMonthlyLogTransactional(this.requireToken(), spreadsheetId, log);
  }

  async exportAll(spreadsheetId: string, logs: MonthlyLog[]): Promise<{ report: DataIntegrityReport | null }> {
    const token = this.requireToken();
    let lastReport: DataIntegrityReport | null = null;
    for (const log of logs) {
      const { report } = await writeMonthlyLogTransactional(token, spreadsheetId, log);
      lastReport = report;
    }
    return { report: lastReport };
  }

  async importAll(spreadsheetId: string): Promise<MonthlyLog[]> {
    return importLogsFromGoogleSheets(this.requireToken(), spreadsheetId);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

export function createGoogleSheetsDriver(isDesktopApp: boolean): GoogleSheetsDriver {
  return isDesktopApp ? new DesktopGoogleSheetsDriver() : new BrowserGoogleSheetsDriver();
}
