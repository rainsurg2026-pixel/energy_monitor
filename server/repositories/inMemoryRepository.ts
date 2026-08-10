import type { MonthlyLog } from "../../src/types";
import { HttpError } from "../errors";
import type { BackendRepository, GoogleOAuthStateRecord, GoogleSheetsConnectionRecord, MonthlySectionKey, PeriodRecord, RackSnapshotRecord, RackUnitImageRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SaveRackCapacityHistoryInput, SaveRackSnapshotInput, SaveRackUnitImageInput, SaveRackUnitSnapshotInput, SaveUpsGroupHistoryInput, SaveWorkbookSourceInput, SiteRecord, UpdateSettingsInput, WorkbookSourceRecord } from "./contracts";
import type { RackCapacityHistoryRow } from "../../src/excel/RackCapacityHistoryWriter";
import type { UpsGroupHistoryRow } from "../../src/reports/reportTypes";
import type { DisplayPeriod } from "../policies/displayPeriod";

export interface InMemoryRepositoryOptions {
  sites?: SiteRecord[];
  logs?: Record<number, MonthlyLog[]>;
  settings?: DisplayPeriod | null;
  rackSnapshots?: Record<string, RackSnapshotRecord>;
  rackUnitSnapshots?: Record<string, RackUnitSnapshotRecord>;
  rackCapacityHistory?: Record<number, RackCapacityHistoryRow[]>;
  upsGroupHistory?: Record<number, { sourceSheet: string; rows: UpsGroupHistoryRow[] }>;
  rackUnitImages?: Record<string, RackUnitImageRecord>;
  workbookSources?: Record<number, WorkbookSourceRecord[]>;
  googleOAuthStates?: GoogleOAuthStateRecord[];
  googleSheetsConnections?: GoogleSheetsConnectionRecord[];
  databaseReady?: boolean;
  auditFailure?: boolean;
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
  private rackCapacityHistory: Record<number, RackCapacityHistoryRow[]>;
  private upsGroupHistory: Record<number, { sourceSheet: string; rows: UpsGroupHistoryRow[] }>;
  private rackUnitImages: Record<string, RackUnitImageRecord>;
  private workbookSources: Record<number, WorkbookSourceRecord[]>;
  private googleOAuthStates: GoogleOAuthStateRecord[];
  private googleSheetsConnections: GoogleSheetsConnectionRecord[];
  private sourceHashes: Record<number, string[]> = {};
  private readonly databaseReady: boolean;
  private readonly auditFailure: boolean;
  readonly auditEvents: InMemoryAuditEvent[] = [];

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.sites = options.sites ?? [];
    this.logs = structuredClone(options.logs ?? {});
    this.settings = options.settings ?? null;
    this.rackSnapshots = options.rackSnapshots ?? {};
    this.rackUnitSnapshots = options.rackUnitSnapshots ?? {};
    this.rackCapacityHistory = structuredClone(options.rackCapacityHistory ?? {});
    this.upsGroupHistory = structuredClone(options.upsGroupHistory ?? {});
    this.rackUnitImages = structuredClone(options.rackUnitImages ?? {});
    this.workbookSources = structuredClone(options.workbookSources ?? {});
    this.googleOAuthStates = structuredClone(options.googleOAuthStates ?? []);
    this.googleSheetsConnections = structuredClone(options.googleSheetsConnections ?? []);
    this.databaseReady = options.databaseReady ?? true;
    this.auditFailure = options.auditFailure ?? false;
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
    return [...new Set((this.logs[siteId] ?? []).map(log => log.month))].sort().map((month, index) => {
      const log = (this.logs[siteId] ?? []).find(item => item.month === month);
      return { id: index + 1, siteId, month, hasData: true, rowVersion: this.periodVersions[`${siteId}:${month}`] ?? 1, lastSavedUps: log?.lastSavedUps ?? null, lastSavedAir: log?.lastSavedAir ?? null, lastSavedDc: log?.lastSavedDc ?? null, lastSavedEnergyCost: log?.lastSavedEnergyCost ?? null };
    });
  }

  async getMonthlyLogs(siteId: number, months: readonly string[]): Promise<MonthlyLog[]> {
    const wanted = new Set(months);
    return (this.logs[siteId] ?? []).filter(log => wanted.has(log.month)).map(log => structuredClone(log));
  }

  async hasImportedSourceHash(siteId: number, sourceFileHash: string): Promise<boolean> {
    return (this.sourceHashes[siteId] ?? []).includes(sourceFileHash);
  }

  async saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const logs = this.logs[input.siteId] ?? (this.logs[input.siteId] = []);
    const index = logs.findIndex(log => log.month === input.log.month);
    const key = `${input.siteId}:${input.log.month}`;
    const current = index >= 0 ? { rowVersion: this.periodVersions[key] ?? 1, log: logs[index] } : null;
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
    const previousLogs = structuredClone(logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const auditLength = this.auditEvents.length;
    try {
      const rowVersion = current ? current.rowVersion + 1 : 1;
      const cloned = structuredClone(input.log);
      const savedAt = input.savedAt ?? new Date().toISOString();
      const sections = new Set<MonthlySectionKey>(input.savedSections ?? []);
      const applyTimestamp = (section: MonthlySectionKey, field: "lastSavedUps" | "lastSavedAir" | "lastSavedDc" | "lastSavedEnergyCost") => {
        if (sections.has(section)) cloned[field] = savedAt;
        else if (!cloned[field] && current?.log?.[field]) cloned[field] = current.log[field];
      };
      applyTimestamp("ups", "lastSavedUps");
      applyTimestamp("air", "lastSavedAir");
      applyTimestamp("dc", "lastSavedDc");
      applyTimestamp("energyCost", "lastSavedEnergyCost");
      if (index >= 0) logs[index] = cloned; else logs.push(cloned);
      this.periodVersions[key] = rowVersion;
      if (input.provenance?.sourceFileHash) {
        const hashes = this.sourceHashes[input.siteId] ?? (this.sourceHashes[input.siteId] = []);
        if (!hashes.includes(input.provenance.sourceFileHash)) hashes.push(input.provenance.sourceFileHash);
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
      return { id: index >= 0 ? index + 1 : logs.length, siteId: input.siteId, month: input.log.month, hasData: true, rowVersion, lastSavedUps: cloned.lastSavedUps, lastSavedAir: cloned.lastSavedAir, lastSavedDc: cloned.lastSavedDc, lastSavedEnergyCost: cloned.lastSavedEnergyCost };
    } catch (error) {
      this.logs[input.siteId] = previousLogs;
      this.periodVersions = previousPeriodVersions;
      this.auditEvents.length = auditLength;
      throw error;
    }
  }

  async saveRackSnapshot(input: SaveRackSnapshotInput): Promise<RackSnapshotRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackSnapshots[key];
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
    const result = { month: input.month, rowVersion: current ? current.rowVersion + 1 : 1, records: structuredClone(input.records) };
    this.rackSnapshots[key] = result;
    return structuredClone(result);
  }

  async saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackUnitSnapshots[key];
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
    const result = { month: input.month, rowVersion: current ? current.rowVersion + 1 : 1, totalU: input.totalU, usedU: input.usedU };
    this.rackUnitSnapshots[key] = result;
    return { ...result };
  }

  async getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null> { const value = this.rackSnapshots[`${siteId}:${month}`]; return value ? structuredClone(value) : null; }
  async getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null> { const value = this.rackUnitSnapshots[`${siteId}:${month}`]; return value ? { ...value } : null; }
  async listRackUnitSnapshots(siteId: number): Promise<RackUnitSnapshotRecord[]> {
    return Object.entries(this.rackUnitSnapshots)
      .filter(([key]) => key.startsWith(`${siteId}:`))
      .map(([, value]) => ({ ...value }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
  async saveRackCapacityHistory(input: SaveRackCapacityHistoryInput): Promise<void> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const rows = this.rackCapacityHistory[input.siteId] ?? (this.rackCapacityHistory[input.siteId] = []);
    for (const incoming of input.rows) {
      const index = rows.findIndex(row => row.snapshotMonth === incoming.snapshotMonth && row.rackZone === incoming.rackZone);
      if (index >= 0) rows[index] = structuredClone(incoming); else rows.push(structuredClone(incoming));
    }
    rows.sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth) || a.rackZone.localeCompare(b.rackZone));
  }
  async getRackCapacityHistory(siteId: number): Promise<RackCapacityHistoryRow[]> {
    return structuredClone([...(this.rackCapacityHistory[siteId] ?? [])].sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth) || a.rackZone.localeCompare(b.rackZone)));
  }
  async saveUpsGroupHistory(input: SaveUpsGroupHistoryInput): Promise<void> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const current = this.upsGroupHistory[input.siteId] ?? (this.upsGroupHistory[input.siteId] = { sourceSheet: input.sourceSheet, rows: [] });
    current.sourceSheet = input.sourceSheet;
    for (const incoming of input.rows) {
      const index = current.rows.findIndex(row => row.month === incoming.month && row.group === incoming.group);
      if (index >= 0) current.rows[index] = structuredClone(incoming); else current.rows.push(structuredClone(incoming));
    }
    current.rows.sort((a, b) => a.month.localeCompare(b.month) || a.group.localeCompare(b.group));
  }
  async getUpsGroupHistory(siteId: number): Promise<{ sourceSheet: string; rows: UpsGroupHistoryRow[] }> {
    const current = this.upsGroupHistory[siteId];
    return structuredClone(current ?? { sourceSheet: "2. UPS Group History", rows: [] });
  }
  async saveRackUnitImage(input: SaveRackUnitImageInput): Promise<RackUnitImageRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const result: RackUnitImageRecord = { ...input, savedAt: input.savedAt ?? new Date().toISOString() };
    this.rackUnitImages[`${input.siteId}:${input.month}`] = structuredClone(result);
    return structuredClone(result);
  }
  async getRackUnitImage(siteId: number, month: string): Promise<RackUnitImageRecord | null> {
    const image = this.rackUnitImages[`${siteId}:${month}`];
    return image ? structuredClone(image) : null;
  }
  async saveWorkbookSource(input: SaveWorkbookSourceInput): Promise<WorkbookSourceRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const versions = this.workbookSources[input.siteId] ?? (this.workbookSources[input.siteId] = []);
    const result: WorkbookSourceRecord = {
      id: versions.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      siteId: input.siteId,
      sourceFileName: input.sourceFileName,
      sourceFileHash: input.sourceFileHash,
      objectKey: input.objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      importedAt: new Date().toISOString(),
      actorUserId: input.actorUserId ?? null
    };
    versions.push(result);
    return structuredClone(result);
  }
  async getWorkbookSource(siteId: number): Promise<WorkbookSourceRecord | null> {
    const current = (this.workbookSources[siteId] ?? []).at(-1);
    return current ? structuredClone(current) : null;
  }
  async listWorkbookSources(siteId: number): Promise<WorkbookSourceRecord[]> { return structuredClone([...(this.workbookSources[siteId] ?? [])].sort((a, b) => a.importedAt.localeCompare(b.importedAt) || a.id - b.id)); }
  async restoreWorkbookSourceCurrent(siteId: number, sourceId: number): Promise<WorkbookSourceRecord> {
    const versions = this.workbookSources[siteId] ?? [];
    const index = versions.findIndex(item => item.id === sourceId);
    if (index < 0) throw new HttpError(404, "WORKBOOK_BACKUP_NOT_FOUND", "The workbook backup was not found.");
    const [source] = versions.splice(index, 1);
    versions.push(source);
    return structuredClone(source);
  }
  async saveGoogleOAuthState(input: GoogleOAuthStateRecord): Promise<void> {
    this.googleOAuthStates = this.googleOAuthStates.filter(item => item.stateHash !== input.stateHash);
    this.googleOAuthStates.push(structuredClone(input));
  }
  async consumeGoogleOAuthState(stateHash: string, userId: number, sessionId: string): Promise<GoogleOAuthStateRecord | null> {
    const index = this.googleOAuthStates.findIndex(item => item.stateHash === stateHash && item.userId === userId && item.sessionId === sessionId && new Date(item.expiresAt).getTime() > Date.now());
    if (index < 0) return null;
    const [record] = this.googleOAuthStates.splice(index, 1);
    return record ? structuredClone(record) : null;
  }
  async saveGoogleSheetsConnection(input: GoogleSheetsConnectionRecord): Promise<void> {
    const index = this.googleSheetsConnections.findIndex(item => item.userId === input.userId);
    if (index < 0) this.googleSheetsConnections.push(structuredClone(input));
    else this.googleSheetsConnections[index] = structuredClone(input);
  }
  async getGoogleSheetsConnection(userId: number): Promise<GoogleSheetsConnectionRecord | null> {
    const record = this.googleSheetsConnections.find(item => item.userId === userId);
    return record ? structuredClone(record) : null;
  }
  async deleteGoogleSheetsConnection(userId: number): Promise<void> { this.googleSheetsConnections = this.googleSheetsConnections.filter(item => item.userId !== userId); }

  async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> {
    const previous = this.settings ? { ...this.settings } : null;
    const previousLogs = structuredClone(this.logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const previousSourceHashes = structuredClone(this.sourceHashes);
    const previousRackSnapshots = structuredClone(this.rackSnapshots);
    const previousRackUnitSnapshots = structuredClone(this.rackUnitSnapshots);
    const previousRackCapacityHistory = structuredClone(this.rackCapacityHistory);
    const previousUpsGroupHistory = structuredClone(this.upsGroupHistory);
    const previousRackUnitImages = structuredClone(this.rackUnitImages);
    const previousWorkbookSources = structuredClone(this.workbookSources);
    const previousGoogleOAuthStates = structuredClone(this.googleOAuthStates);
    const previousGoogleSheetsConnections = structuredClone(this.googleSheetsConnections);
    const previousAudits = structuredClone(this.auditEvents);
    try { return await work(this); } catch (error) { this.settings = previous; this.logs = previousLogs; this.periodVersions = previousPeriodVersions; this.sourceHashes = previousSourceHashes; for (const key of Object.keys(this.rackSnapshots)) delete this.rackSnapshots[key]; Object.assign(this.rackSnapshots, previousRackSnapshots); for (const key of Object.keys(this.rackUnitSnapshots)) delete this.rackUnitSnapshots[key]; Object.assign(this.rackUnitSnapshots, previousRackUnitSnapshots); this.rackCapacityHistory = previousRackCapacityHistory; this.upsGroupHistory = previousUpsGroupHistory; this.rackUnitImages = previousRackUnitImages; this.workbookSources = previousWorkbookSources; this.googleOAuthStates = previousGoogleOAuthStates; this.googleSheetsConnections = previousGoogleSheetsConnections; this.auditEvents.length = 0; this.auditEvents.push(...previousAudits); throw error; }
  }

  private recordAudit(event: Omit<InMemoryAuditEvent, "occurredAt">): void {
    if (this.auditFailure) throw new Error("audit write failed");
    this.auditEvents.push({ ...structuredClone(event), occurredAt: new Date().toISOString() });
  }
}
