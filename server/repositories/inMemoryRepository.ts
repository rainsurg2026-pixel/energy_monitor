import type { MonthlyLog } from "../../src/types";
import { computeUpsGroupHistorySnapshot } from "../../src/domain/upsGroupHistorySnapshot";
import { HttpError } from "../errors";
import type { BackendRepository, PeriodRecord, RackCapacityHistoryRecord, RackFieldChangeInput, RackFieldChangeOutcome, RackSnapshotRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SaveRackCapacityInput, SaveRackUnitCapacityInput, SiteRecord, UpdateSettingsInput, UpsGroupHistoryRecord, UpsGroupHistoryUpsertRow } from "./contracts";
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
  private rackSnapshots: Record<string, RackSnapshotRecord>;
  private rackUnitSnapshots: Record<string, RackUnitSnapshotRecord>;
  private rackCapacityHistory: Record<number, RackCapacityHistoryRecord[]>;
  private readonly upsGroupHistory: Record<number, UpsGroupHistoryRecord[]>;
  private readonly databaseReady: boolean;
  private readonly auditFailure: boolean;
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
  async saveRackCapacity(input: SaveRackCapacityInput): Promise<{ snapshot: RackSnapshotRecord; outcomes: RackFieldChangeOutcome[]; changedCount: number }> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackSnapshots[key];
    if (!current) throw new HttpError(404, "RACK_SNAPSHOT_NOT_FOUND", "Rack Capacity data is not available for the requested month.");
    const snapshot = structuredClone(current);
    const outcomes: RackFieldChangeOutcome[] = [];
    let changedCount = 0;
    const fields: Array<[keyof Pick<RackFieldChangeInput, "status" | "cabinetSize" | "detail" | "deviceType" | "remarks">, "status" | "cabinetSize" | "detail" | "deviceType" | "remarks"]> = [["status", "status"], ["cabinetSize", "cabinetSize"], ["detail", "detail"], ["deviceType", "deviceType"], ["remarks", "remarks"]];
    for (const change of input.changes) {
      const record = snapshot.records.find(item => item.rowNumber === change.rowNumber);
      if (!record) { outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" }); continue; }
      if ((record.rackId ?? "").trim() !== change.rackId.trim()) { outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "rack_id_mismatch" }); continue; }
      let conflict: RackFieldChangeOutcome | null = null;
      for (const [inputField, recordField] of fields) {
        const edit = change[inputField];
        if (!edit) continue;
        const actual = record[recordField] ?? null;
        if (actual !== edit.expected) { conflict = { rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "field_mismatch", conflictField: recordField, conflictActualValue: actual }; break; }
      }
      if (conflict) { outcomes.push(conflict); continue; }
      for (const [inputField, recordField] of fields) {
        const edit = change[inputField];
        if (!edit || edit.next === edit.expected) continue;
        record[recordField] = edit.next;
        changedCount++;
      }
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: true });
    }
    if (changedCount > 0) {
      snapshot.rowVersion++;
      this.rackSnapshots[key] = snapshot;
      this.recordAudit({ actorUserId: input.actorUserId ?? null, action: "update", entityType: "rack_capacity_snapshot", entityId: key, previousValue: { rowVersion: current.rowVersion }, newValue: { rowVersion: snapshot.rowVersion, changedCount }, correlationId: input.correlationId });
    }
    return { snapshot: structuredClone(snapshot), outcomes, changedCount };
  }
  async saveRackUnitCapacity(input: SaveRackUnitCapacityInput): Promise<RackUnitSnapshotRecord> {
    if (!this.sites.some(site => site.id === input.siteId && site.active)) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackUnitSnapshots[key] ?? null;
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity changed before this save was committed.");
    if (current && !input.forceSnapshot && current.totalU === input.totalU && current.usedU === input.usedU) return { ...current };
    const next: RackUnitSnapshotRecord = { month: input.month, rowVersion: current ? current.rowVersion + 1 : 1, totalU: input.totalU, usedU: input.usedU };
    this.rackUnitSnapshots[key] = next;
    this.recordAudit({ actorUserId: input.actorUserId ?? null, action: current ? "update" : "create", entityType: "rack_unit_capacity_snapshot", entityId: key, previousValue: current ? { rowVersion: current.rowVersion, totalU: current.totalU, usedU: current.usedU } : null, newValue: { rowVersion: next.rowVersion, totalU: next.totalU, usedU: next.usedU }, correlationId: input.correlationId });
    return { ...next };
  }
  async saveRackCapacityHistoryRows(siteId: number, rows: RackCapacityHistoryRecord[]): Promise<void> {
    const history = this.rackCapacityHistory[siteId] ?? (this.rackCapacityHistory[siteId] = []);
    for (const row of rows) {
      const index = history.findIndex(item => item.month === row.month && item.rackZone === row.rackZone);
      if (index >= 0) history[index] = { ...row }; else history.push({ ...row });
    }
  }
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

  async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> {
    const previous = this.settings ? { ...this.settings } : null;
    const previousLogs = structuredClone(this.logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const previousRackSnapshots = structuredClone(this.rackSnapshots);
    const previousRackUnitSnapshots = structuredClone(this.rackUnitSnapshots);
    const previousRackHistory = structuredClone(this.rackCapacityHistory);
    const previousAudits = structuredClone(this.auditEvents);
    try { return await work(this); } catch (error) { this.settings = previous; this.logs = previousLogs; this.periodVersions = previousPeriodVersions; this.rackSnapshots = previousRackSnapshots; this.rackUnitSnapshots = previousRackUnitSnapshots; this.rackCapacityHistory = previousRackHistory; this.auditEvents.length = 0; this.auditEvents.push(...previousAudits); throw error; }
  }

  private recordAudit(event: Omit<InMemoryAuditEvent, "occurredAt">): void {
    if (this.auditFailure) throw new Error("audit write failed");
    this.auditEvents.push({ ...structuredClone(event), occurredAt: new Date().toISOString() });
  }
}
