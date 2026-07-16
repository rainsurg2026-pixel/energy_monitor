/**
 * GoogleSheetsProvider - IDataProvider over the pre-existing Google Sheets
 * transactional sync engine (sheetsService.ts). Untouched engine underneath;
 * this adapter only gives it the same face as the Excel provider so the UI
 * never needs to know which source is active.
 */

import { MonthlyLog } from "../types";
import { importLogsFromGoogleSheets, writeMonthlyLogTransactional } from "../sheetsService";
import { DataSnapshot, IDataProvider, ProviderCapabilities, ProviderError, SaveOutcome } from "./IDataProvider";

export interface GoogleSheetsProviderDeps {
  /** Returns the current OAuth access token, or null when signed out. */
  getAccessToken: () => string | null;
  getSpreadsheetId: () => string;
}

export class GoogleSheetsProvider implements IDataProvider {
  readonly kind = "googleSheets" as const;
  readonly capabilities: ProviderCapabilities = {
    canOpenFile: false,
    canSaveAs: false,
    canListBackups: false,
    requiresNetwork: true
  };

  private deps: GoogleSheetsProviderDeps;

  constructor(deps: GoogleSheetsProviderDeps) {
    this.deps = deps;
  }

  private requireToken(): string {
    const token = this.deps.getAccessToken();
    if (!token) {
      throw new ProviderError("NOT_SIGNED_IN", "Google account is not connected. Sign in to sync with Google Sheets.");
    }
    return token;
  }

  getSourceLabel(): string | null {
    const id = this.deps.getSpreadsheetId();
    return id ? `Google Sheets (${id.slice(0, 8)}…)` : null;
  }

  async load(options?: { target?: string | null; signal?: AbortSignal }): Promise<DataSnapshot | null> {
    const token = this.requireToken();
    const spreadsheetId = options?.target ?? this.deps.getSpreadsheetId();
    const logs = await importLogsFromGoogleSheets(token, spreadsheetId, options?.signal);
    return { logs, sourceLabel: this.getSourceLabel() ?? "Google Sheets" };
  }

  async saveMonth(log: MonthlyLog, _allLogs: MonthlyLog[]): Promise<SaveOutcome> {
    const token = this.requireToken();
    await writeMonthlyLogTransactional(token, this.deps.getSpreadsheetId(), log);
    return { savedAt: new Date().toISOString() };
  }

  async saveAll(logs: MonthlyLog[]): Promise<SaveOutcome> {
    const token = this.requireToken();
    for (const log of logs) {
      await writeMonthlyLogTransactional(token, this.deps.getSpreadsheetId(), log);
    }
    return { savedAt: new Date().toISOString() };
  }
}
