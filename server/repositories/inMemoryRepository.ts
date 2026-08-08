import type { MonthlyLog } from "../../src/types";
import { HttpError } from "../errors";
import type { BackendRepository, PeriodRecord, RackSnapshotRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SiteRecord, UpdateSettingsInput } from "./contracts";
import type { DisplayPeriod } from "../policies/displayPeriod";

export interface InMemoryRepositoryOptions {
  sites?: SiteRecord[];
  logs?: Record<number, MonthlyLog[]>;
  settings?: DisplayPeriod | null;
  rackSnapshots?: Record<string, RackSnapshotRecord>;
  rackUnitSnapshots?: Record<string, RackUnitSnapshotRecord>;
  databaseReady?: boolean;
}
export class InMemoryRepository implements BackendRepository {
  private readonly sites: SiteRecord[];
  private logs: Record<number, MonthlyLog[]>;
  private periodVersions: Record<string, number> = {};
  private settings: DisplayPeriod | null;
  private readonly rackSnapshots: Record<string, RackSnapshotRecord>;
  private readonly rackUnitSnapshots: Record<string, RackUnitSnapshotRecord>;
  private readonly databaseReady: boolean;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.sites = options.sites ?? [];
    this.logs = options.logs ?? {};
    this.settings = options.settings ?? null;
    this.rackSnapshots = options.rackSnapshots ?? {};
    this.rackUnitSnapshots = options.rackUnitSnapshots ?? {};
    this.databaseReady = options.databaseReady ?? true;
  }

  async ping(): Promise<void> { if (!this.databaseReady) throw new Error("in-memory repository is not ready"); }
  async listSites(): Promise<SiteRecord[]> { return this.sites.filter(site => site.active).map(site => ({ ...site })); }
  async getSite(siteId: number): Promise<SiteRecord | null> { return this.sites.find(site => site.id === siteId) ?? null; }
  async getGlobalSettings(): Promise<DisplayPeriod | null> { return this.settings ? { ...this.settings } : null; }

  async updateGlobalSettings(input: UpdateSettingsInput): Promise<DisplayPeriod> {
    if (!this.settings) {
      if (input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
      this.settings = { startMonth: input.startMonth, endMonth: input.endMonth, rowVersion: 1 };
      return { ...this.settings };
    }
    if (this.settings.rowVersion !== input.expectedRowVersion) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
    this.settings = { startMonth: input.startMonth, endMonth: input.endMonth, rowVersion: input.expectedRowVersion + 1 };
    return { ...this.settings };
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
    const rowVersion = current ? current.rowVersion + 1 : 1;
    const cloned = structuredClone(input.log);
    if (index >= 0) logs[index] = cloned; else logs.push(cloned);
    this.periodVersions[key] = rowVersion;
    return { id: index >= 0 ? index + 1 : logs.length, siteId: input.siteId, month: input.log.month, hasData: true, rowVersion };
  }

  async getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null> { return this.rackSnapshots[`${siteId}:${month}`] ?? null; }
  async getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null> { return this.rackUnitSnapshots[`${siteId}:${month}`] ?? null; }

  async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> {
    const previous = this.settings ? { ...this.settings } : null;
    const previousLogs = structuredClone(this.logs);
    const previousPeriodVersions = { ...this.periodVersions };
    try { return await work(this); } catch (error) { this.settings = previous; this.logs = previousLogs; this.periodVersions = previousPeriodVersions; throw error; }
  }
}
