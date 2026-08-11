import type { MonthlyLog } from "../../src/types";
import { computeUpsGroupHistorySnapshot } from "../../src/domain/upsGroupHistorySnapshot";
import { HttpError } from "../errors";
import type { BackendRepository, BackupConfigRecord, BackupLogRecord, CompleteBackupInput, CreateGoogleOAuthStateInput, GoogleOAuthStateRecord, GoogleSheetsConnectionRecord, PeriodRecord, RackCapacityHistoryRecord, RackSnapshotRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SiteRecord, StartBackupInput, UpdateBackupConfigInput, UpdateSettingsInput, UpsertGoogleSheetsConnectionInput, UpsGroupHistoryRecord, UpsGroupHistoryUpsertRow } from "./contracts";
import { maskSpreadsheetId } from "../backup/googleSheetsUrl";
import type { DisplayPeriod } from "../policies/displayPeriod";

export interface InMemoryRepositoryOptions {
  sites?: SiteRecord[];
  logs?: Record<number, MonthlyLog[]>;
  settings?: DisplayPeriod | null;
  rackSnapshots?: Record<string, RackSnapshotRecord>;
  rackUnitSnapshots?: Record<string, RackUnitSnapshotRecord>;
  rackCapacityHistory?: Record<number, RackCapacityHistoryRecord[]>;
  upsGroupHistory?: Record<number, UpsGroupHistoryRecord[]>;
  databaseReady?: boolean;
  auditFailure?: boolean;
  backupConfig?: BackupConfigRecord;
}

export interface InMemoryAuditEvent {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  correlationId: string;
  occurredAt: string;
}
export class InMemoryRepository implements BackendRepository {
  private readonly sites: SiteRecord[];
  private logs: Record<number, MonthlyLog[]>;
  private periodVersions: Record<string, number> = {};
  private settings: DisplayPeriod | null;
  private readonly rackSnapshots: Record<string, RackSnapshotRecord>;
  private readonly rackUnitSnapshots: Record<string, RackUnitSnapshotRecord>;
  private readonly rackCapacityHistory: Record<number, RackCapacityHistoryRecord[]>;
  private readonly upsGroupHistory: Record<number, UpsGroupHistoryRecord[]>;
  private readonly databaseReady: boolean;
  private readonly auditFailure: boolean;
  private readonly backupRuns: BackupLogRecord[] = [];
  private nextBackupId = 1;
  private backupConfig: BackupConfigRecord;
  private readonly googleOAuthStates = new Map<string, GoogleOAuthStateRecord>();
  private readonly googleSheetsConnections = new Map<number, { record: GoogleSheetsConnectionRecord; encryptedRefreshToken: string }>();
  readonly auditEvents: InMemoryAuditEvent[] = [];

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.sites = options.sites ?? [];
    this.logs = structuredClone(options.logs ?? {});
    this.settings = options.settings ?? null;
    this.rackSnapshots = options.rackSnapshots ?? {};
    this.rackUnitSnapshots = options.rackUnitSnapshots ?? {};
    this.rackCapacityHistory = options.rackCapacityHistory ?? {};
    this.upsGroupHistory = options.upsGroupHistory ?? {};
    this.databaseReady = options.databaseReady ?? true;
    this.auditFailure = options.auditFailure ?? false;
    this.backupConfig = options.backupConfig ?? { spreadsheetId: null, sheetUrl: null, enabled: false, updatedBy: null, updatedAt: null, connectedGoogleUserId: null };
  }

  async ping(): Promise<void> { if (!this.databaseReady) throw new Error("in-memory repository is not ready"); }
  async listSites(): Promise<SiteRecord[]> { return this.sites.filter(site => site.active).map(site => ({ ...site })); }
  async getSite(siteId: number): Promise<SiteRecord | null> { return this.sites.find(site => site.id === siteId) ?? null; }
  async getGlobalSettings(): Promise<DisplayPeriod | null> { return this.settings ? { ...this.settings } : null; }

  async updateGlobalSettings(input: UpdateSettingsInput, correlationId = "settings-update"): Promise<DisplayPeriod> {
    const previous = this.settings ? { ...this.settings } : null;
    const auditLength = this.auditEvents.length;
    try {
      if (!this.settings) {
        if (input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
        this.settings = { startMonth: input.startMonth, endMonth: input.endMonth, rowVersion: 1 };
      } else {
        if (this.settings.rowVersion !== input.expectedRowVersion) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
        this.settings = { startMonth: input.startMonth, endMonth: input.endMonth, rowVersion: input.expectedRowVersion + 1 };
      }
      this.recordAudit({
        actorUserId: input.actorUserId ?? null,
        action: previous ? "update" : "create",
        entityType: "global_settings",
        entityId: "1",
        previousValue: previous ? { startMonth: previous.startMonth, endMonth: previous.endMonth, rowVersion: previous.rowVersion } : null,
        newValue: { startMonth: this.settings.startMonth, endMonth: this.settings.endMonth, rowVersion: this.settings.rowVersion },
        correlationId
      });
      return { ...this.settings };
    } catch (error) {
      this.settings = previous;
      this.auditEvents.length = auditLength;
      throw error;
    }
  }

  async listPeriods(siteId: number): Promise<PeriodRecord[]> {
    return [...new Set((this.logs[siteId] ?? []).map(log => log.month))].sort().map((month, index) => ({ id: index + 1, siteId, month, hasData: true, rowVersion: this.periodVersions[`${siteId}:${month}`] ?? 1 }));
  }

  async getMonthlyLogs(siteId: number, months: readonly string[]): Promise<MonthlyLog[]> {
    const wanted = new Set(months);
    return (this.logs[siteId] ?? []).filter(log => wanted.has(log.month)).map(log => structuredClone(log));
  }

  async saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const logs = this.logs[input.siteId] ?? (this.logs[input.siteId] = []);
    const index = logs.findIndex(log => log.month === input.log.month);
    const key = `${input.siteId}:${input.log.month}`;
    const current = index >= 0 ? { rowVersion: this.periodVersions[key] ?? 1 } : null;
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
    const previousLogs = structuredClone(logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const auditLength = this.auditEvents.length;
    try {
      const rowVersion = current ? current.rowVersion + 1 : 1;
      const cloned = structuredClone(input.log);
      if (index >= 0) logs[index] = cloned; else logs.push(cloned);
      this.periodVersions[key] = rowVersion;
      const site = this.sites.find(item => item.id === input.siteId);
      if (site) {
        const upsGroupHistoryRows = computeUpsGroupHistorySnapshot(site.code, input.log);
        if (upsGroupHistoryRows) await this.saveUpsGroupHistoryRows(input.siteId, site.code, upsGroupHistoryRows, true);
      }
      this.recordAudit({
        actorUserId: input.actorUserId ?? null,
        action: "upsert",
        entityType: "monthly_period",
        entityId: key,
        previousValue: { dataset: "monthly_log", siteId: input.siteId, month: input.log.month, rowVersion: current?.rowVersion ?? null },
        newValue: { dataset: "monthly_log", siteId: input.siteId, month: input.log.month, record: "raw_inputs", rowVersion, provenance: input.provenance?.sourceType ?? "web-api" },
        correlationId: input.correlationId
      });
      return { id: index >= 0 ? index + 1 : logs.length, siteId: input.siteId, month: input.log.month, hasData: true, rowVersion };
    } catch (error) {
      this.logs[input.siteId] = previousLogs;
      this.periodVersions = previousPeriodVersions;
      this.auditEvents.length = auditLength;
      throw error;
    }
  }

  async getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null> { return this.rackSnapshots[`${siteId}:${month}`] ?? null; }
  async getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null> { return this.rackUnitSnapshots[`${siteId}:${month}`] ?? null; }
  async listRackCapacityHistory(siteId: number): Promise<RackCapacityHistoryRecord[]> { return (this.rackCapacityHistory[siteId] ?? []).map(row => ({ ...row })).sort((a, b) => a.month === b.month ? a.rackZone.localeCompare(b.rackZone) : a.month.localeCompare(b.month)); }
  async listRackUnitCapacityHistory(siteId: number): Promise<RackUnitSnapshotRecord[]> {
    return Object.entries(this.rackUnitSnapshots)
      .filter(([key]) => key.startsWith(`${siteId}:`))
      .map(([, record]) => ({ ...record }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
  async getUpsGroupHistory(siteId: number): Promise<UpsGroupHistoryRecord[]> { return this.upsGroupHistory[siteId] ?? []; }

  async saveUpsGroupHistoryRows(siteId: number, facility: string, rows: UpsGroupHistoryUpsertRow[], overwrite: boolean): Promise<void> {
    const existing = this.upsGroupHistory[siteId] ?? (this.upsGroupHistory[siteId] = []);
    const generatedAt = new Date().toISOString();
    for (const row of rows) {
      const index = existing.findIndex(item => item.month === row.month && item.group === row.group);
      if (index >= 0) {
        if (!overwrite) continue;
        existing[index] = { facility, month: row.month, group: row.group, totalLoadKw: row.totalLoadKw, totalLoadKva: row.totalLoadKva, capacity: row.capacity, loadPercent: row.loadPercent, availablePercent: row.availablePercent, monthlyEnergyKwh: row.monthlyEnergyKwh, generatedAt, dataVersion: 1 };
      } else {
        existing.push({ facility, month: row.month, group: row.group, totalLoadKw: row.totalLoadKw, totalLoadKva: row.totalLoadKva, capacity: row.capacity, loadPercent: row.loadPercent, availablePercent: row.availablePercent, monthlyEnergyKwh: row.monthlyEnergyKwh, generatedAt, dataVersion: 1 });
      }
    }
  }

  async startBackupRun(input: StartBackupInput): Promise<BackupLogRecord> {
    const record: BackupLogRecord = { id: this.nextBackupId++, backupType: input.backupType, status: "running", startedAt: new Date().toISOString(), completedAt: null, recordsProcessed: 0, recordsSuccess: 0, recordsFailed: 0, errorSummary: null, initiatedBy: input.initiatedBy, spreadsheetId: null };
    this.backupRuns.push(record);
    return { ...record };
  }

  async completeBackupRun(input: CompleteBackupInput): Promise<BackupLogRecord> {
    const record = this.backupRuns.find(run => run.id === input.id);
    if (!record) throw new HttpError(404, "BACKUP_RUN_NOT_FOUND", "Backup run was not found.");
    record.status = input.status;
    record.completedAt = new Date().toISOString();
    record.recordsProcessed = input.recordsProcessed;
    record.recordsSuccess = input.recordsSuccess;
    record.recordsFailed = input.recordsFailed;
    record.errorSummary = input.errorSummary;
    record.spreadsheetId = input.spreadsheetId;
    return { ...record };
  }

  async getBackupConfig(): Promise<BackupConfigRecord> { return { ...this.backupConfig }; }

  async updateBackupConfig(input: UpdateBackupConfigInput): Promise<BackupConfigRecord> {
    const before = { ...this.backupConfig };
    this.backupConfig = { ...this.backupConfig, spreadsheetId: input.spreadsheetId, sheetUrl: input.sheetUrl, enabled: input.enabled, updatedBy: input.updatedBy, updatedAt: new Date().toISOString() };
    this.recordAudit({
      actorUserId: input.updatedBy,
      action: "backup_destination_change",
      entityType: "backup_config",
      entityId: "1",
      previousValue: { spreadsheetIdMasked: maskSpreadsheetId(before.spreadsheetId), enabled: before.enabled },
      newValue: { spreadsheetIdMasked: maskSpreadsheetId(this.backupConfig.spreadsheetId), enabled: this.backupConfig.enabled },
      correlationId: input.correlationId
    });
    return { ...this.backupConfig };
  }

  async setBackupConnectedGoogleUser(userId: number | null, actorUserId: number | null, correlationId: string): Promise<void> {
    const before = this.backupConfig.connectedGoogleUserId;
    this.backupConfig = { ...this.backupConfig, connectedGoogleUserId: userId, updatedAt: new Date().toISOString() };
    this.recordAudit({
      actorUserId,
      action: userId === null ? "backup_google_disconnected" : "backup_google_connected",
      entityType: "backup_config",
      entityId: "1",
      previousValue: { connectedGoogleUserId: before },
      newValue: { connectedGoogleUserId: userId },
      correlationId
    });
  }

  async createGoogleOAuthState(input: CreateGoogleOAuthStateInput): Promise<void> {
    this.googleOAuthStates.set(input.stateHash, { stateHash: input.stateHash, userId: input.userId, sessionId: input.sessionId, encryptedCodeVerifier: input.encryptedCodeVerifier, expiresAt: input.expiresAt });
  }

  async consumeGoogleOAuthState(stateHash: string): Promise<GoogleOAuthStateRecord | null> {
    const record = this.googleOAuthStates.get(stateHash);
    if (!record) return null;
    this.googleOAuthStates.delete(stateHash);
    return { ...record };
  }

  async upsertGoogleSheetsConnection(input: UpsertGoogleSheetsConnectionInput): Promise<GoogleSheetsConnectionRecord> {
    const record: GoogleSheetsConnectionRecord = { userId: input.userId, email: input.email, updatedAt: new Date().toISOString() };
    this.googleSheetsConnections.set(input.userId, { record, encryptedRefreshToken: input.encryptedRefreshToken });
    return { ...record };
  }

  async getGoogleSheetsConnection(userId: number): Promise<GoogleSheetsConnectionRecord | null> {
    const entry = this.googleSheetsConnections.get(userId);
    return entry ? { ...entry.record } : null;
  }

  async getGoogleSheetsConnectionSecret(userId: number): Promise<string | null> {
    return this.googleSheetsConnections.get(userId)?.encryptedRefreshToken ?? null;
  }

  async deleteGoogleSheetsConnection(userId: number): Promise<void> {
    this.googleSheetsConnections.delete(userId);
  }

  async latestBackupRun(): Promise<BackupLogRecord | null> {
    const sorted = [...this.backupRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sorted[0] ? { ...sorted[0] } : null;
  }

  async listBackupRuns(limit: number): Promise<BackupLogRecord[]> {
    return [...this.backupRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(run => ({ ...run }));
  }

  async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> {
    const previous = this.settings ? { ...this.settings } : null;
    const previousLogs = structuredClone(this.logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const previousAudits = structuredClone(this.auditEvents);
    try { return await work(this); } catch (error) { this.settings = previous; this.logs = previousLogs; this.periodVersions = previousPeriodVersions; this.auditEvents.length = 0; this.auditEvents.push(...previousAudits); throw error; }
  }

  private recordAudit(event: Omit<InMemoryAuditEvent, "occurredAt">): void {
    if (this.auditFailure) throw new Error("audit write failed");
    this.auditEvents.push({ ...structuredClone(event), occurredAt: new Date().toISOString() });
  }
}
