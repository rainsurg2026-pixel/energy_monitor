import type { MonthlyLog } from "../../src/types";
import { computeUpsGroupHistorySnapshot } from "../../src/domain/upsGroupHistorySnapshot";
import { HttpError } from "../errors";
import type { BackendRepository, PeriodRecord, RackCapacityHistoryRecord, RackCapacitySaveResult, RackFieldChangeOutcome, RackSnapshotRecord, RackUnitImageRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SaveRackCapacityInput, SaveRackUnitImageInput, SaveRackUnitSnapshotInput, SiteRecord, UpdateSettingsInput, UpsGroupHistoryRecord, UpsGroupHistoryUpsertRow } from "./contracts";
import type { DisplayPeriod } from "../policies/displayPeriod";
import { calculateRackCapacityMetrics, normalizeRackEditableValue, type RackCapacityMetrics } from "../../src/domain/rackCapacity";

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

function rackHistoryRows(facility: string, month: string, metrics: RackCapacityMetrics, generatedAt: string): RackCapacityHistoryRecord[] {
  const row = (rackZone: string, value: RackCapacityMetrics | RackCapacityMetrics["zoneMetrics"][number]): RackCapacityHistoryRecord => ({
    month,
    facility,
    rackZone,
    totalRacks: value.total,
    inUse: value.inUse.count,
    available: value.available.count,
    reserved: value.reserved.count,
    pendingDismantle: value.pendingDismantle.count,
    other: value.other.count,
    usagePct: value.inUse.ratio,
    availabilityPct: value.available.ratio,
    reservedPct: value.reserved.ratio,
    pendingDismantlePct: value.pendingDismantle.ratio,
    otherPct: value.other.ratio,
    generatedAt,
    dataVersion: 1
  });
  return [row("(Total)", metrics), ...metrics.zoneMetrics.map(zone => row(zone.zone, zone))];
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
  private transactionTail: Promise<void> = Promise.resolve();
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

  async getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null> { const snapshot = this.rackSnapshots[`${siteId}:${month}`]; return snapshot ? structuredClone(snapshot) : null; }
  async saveRackCapacity(input: SaveRackCapacityInput): Promise<RackCapacitySaveResult> {
    if (input.changes.length === 0) throw new HttpError(400, "INVALID_RACK_CHANGES", "changes must be a non-empty array.");
    const seenRows = new Set<number>();
    for (const change of input.changes) {
      if (seenRows.has(change.rowNumber)) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes contains duplicate row ${change.rowNumber}.`);
      seenRows.add(change.rowNumber);
    }
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackSnapshots[key];
    if (!current) throw new HttpError(404, "RACK_CAPACITY_NOT_FOUND", "Rack Capacity is not initialized for the requested month.");
    if (input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Rack Capacity changed before this save was committed.");

    const previous = structuredClone(current);
    const previousHistory = structuredClone(this.rackCapacityHistory[input.siteId] ?? []);
    const auditLength = this.auditEvents.length;
    const fields = ["status", "cabinetSize", "detail", "deviceType", "remarks"] as const;
    try {
      const records = structuredClone(current.records);
      const conflicts: RackFieldChangeOutcome[] = [];
      let changedCount = 0;
      for (const change of input.changes) {
        const index = records.findIndex(record => record.rowNumber === change.rowNumber);
        if (index < 0) {
          conflicts.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
          continue;
        }
        const record = records[index];
        if (record.rackId !== change.rackId) {
          conflicts.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "rack_id_mismatch" });
          continue;
        }
        for (const field of fields) {
          const edit = change[field];
          if (!edit) continue;
          const actual = record[field];
          if (normalizeRackEditableValue(field, actual) !== normalizeRackEditableValue(field, edit.expected)) {
            conflicts.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictField: field, conflictActualValue: actual, conflictReason: "field_mismatch" });
            break;
          }
        }
      }
      if (conflicts.length > 0) throw new HttpError(409, "RACK_CAPACITY_CONFLICT", "Rack Capacity changed before this save was committed.");

      const outcomes: RackFieldChangeOutcome[] = [];
      for (const change of input.changes) {
        const index = records.findIndex(record => record.rowNumber === change.rowNumber);
        if (index < 0) throw new HttpError(409, "RACK_CAPACITY_CONFLICT", "Rack Capacity changed before this save was committed.");
        const record = records[index];
        for (const field of fields) {
          const edit = change[field];
          if (!edit) continue;
          const next = normalizeRackEditableValue(field, edit.next);
          const actual = normalizeRackEditableValue(field, record[field]);
          if (actual !== next) changedCount++;
          record[field] = next;
        }
        outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: true });
      }

      const rowVersion = changedCount > 0 ? current.rowVersion + 1 : current.rowVersion;
      const snapshot: RackSnapshotRecord = { month: current.month, rowVersion, records };
      if (changedCount > 0) {
        this.rackSnapshots[key] = snapshot;
        const metrics = calculateRackCapacityMetrics(records);
        const generatedAt = input.generatedAt ?? new Date().toISOString();
        const history = this.rackCapacityHistory[input.siteId] ?? (this.rackCapacityHistory[input.siteId] = []);
        this.rackCapacityHistory[input.siteId] = [
          ...history.filter(row => row.month !== input.month),
          ...rackHistoryRows(input.facility, input.month, metrics, generatedAt)
        ];
        this.recordAudit({
          actorUserId: input.actorUserId ?? null,
          action: "update",
          entityType: "rack_capacity_snapshot",
          entityId: key,
          previousValue: { siteId: input.siteId, month: input.month, rowVersion: current.rowVersion },
          newValue: { siteId: input.siteId, month: input.month, rowVersion, changedCount },
          correlationId: input.correlationId
        });
      }
      return { snapshot: structuredClone(snapshot), outcomes, changedCount };
    } catch (error) {
      this.rackSnapshots[key] = previous;
      this.rackCapacityHistory[input.siteId] = previousHistory;
      this.auditEvents.length = auditLength;
      throw error;
    }
  }
  async getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null> { return this.rackUnitSnapshots[`${siteId}:${month}`] ?? null; }
  async saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord> {
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackUnitSnapshots[key] ?? null;
    if (current && input.expectedRowVersion !== current.rowVersion) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity changed before this save was committed.");
    if (!current && input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity changed before this save was committed.");
    const next: RackUnitSnapshotRecord = { month: input.month, rowVersion: current ? current.rowVersion + 1 : 1, totalU: input.totalU, usedU: input.usedU, image: current?.image ?? null };
    this.rackUnitSnapshots[key] = next;
    return { ...next, image: next.image ? { ...next.image } : null };
  }
  async replaceRackUnitImage(input: SaveRackUnitImageInput): Promise<{ image: RackUnitImageRecord; replacedObjectKeys: string[] }> {
    const key = `${input.siteId}:${input.month}`;
    const current = this.rackUnitSnapshots[key];
    if (!current) throw new HttpError(409, "RACK_UNIT_CAPACITY_REQUIRED", "Save Rack Unit Capacity before saving its image.");
    const image: RackUnitImageRecord = { objectKey: input.objectKey, contentType: input.contentType, byteSize: input.byteSize, sha256: input.sha256, width: input.width, height: input.height, savedAt: new Date().toISOString(), savedBy: String(input.actorUserId ?? "system") };
    const replacedObjectKeys = current.image?.objectKey ? [current.image.objectKey] : [];
    this.rackUnitSnapshots[key] = { ...current, image };
    return { image, replacedObjectKeys };
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
    const previousTransaction = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previousTransaction;
    const previous = this.settings ? { ...this.settings } : null;
    const previousLogs = structuredClone(this.logs);
    const previousPeriodVersions = { ...this.periodVersions };
    const previousRackSnapshots = structuredClone(this.rackSnapshots);
    const previousRackUnitSnapshots = structuredClone(this.rackUnitSnapshots);
    const previousRackCapacityHistory = structuredClone(this.rackCapacityHistory);
    const previousUpsGroupHistory = structuredClone(this.upsGroupHistory);
    const previousAudits = structuredClone(this.auditEvents);
    const transactionRepository = new Proxy(this, {
      get: (target, property) => {
        if (property === "withTransaction") return <NestedT>(nestedWork: (repository: BackendRepository) => Promise<NestedT>) => nestedWork(transactionRepository);
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      }
    }) as unknown as BackendRepository;
    try { return await work(transactionRepository); } catch (error) {
      const restoreMap = (target: object, snapshot: object) => {
        const mutable = target as Record<string, unknown>;
        for (const key of Object.keys(mutable)) delete mutable[key];
        Object.assign(mutable, snapshot);
      };
      this.settings = previous;
      this.logs = previousLogs;
      this.periodVersions = previousPeriodVersions;
      restoreMap(this.rackSnapshots, previousRackSnapshots);
      restoreMap(this.rackUnitSnapshots, previousRackUnitSnapshots);
      restoreMap(this.rackCapacityHistory, previousRackCapacityHistory);
      restoreMap(this.upsGroupHistory, previousUpsGroupHistory);
      this.auditEvents.length = 0;
      this.auditEvents.push(...previousAudits);
      throw error;
    } finally {
      release();
    }
  }

  private recordAudit(event: Omit<InMemoryAuditEvent, "occurredAt">): void {
    if (this.auditFailure) throw new Error("audit write failed");
    this.auditEvents.push({ ...structuredClone(event), occurredAt: new Date().toISOString() });
  }
}
