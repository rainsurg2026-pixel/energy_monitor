import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { buildFacilityComparisonMetrics } from "../../src/domain/facilityComparison";
import { calculateRackCapacityMetrics } from "../../src/domain/rackCapacity";
import { usagePercent } from "../../src/domain/rackUnitCapacity";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { computeUpsGroupHistorySnapshot } from "../../src/domain/upsGroupHistorySnapshot";
import type { MonthlyLog } from "../../src/types";
import { HttpError } from "../errors";
import { assertDisplayPeriod, assertStrictMonth, allowedMonths, isAllowedMonth, latestAvailableMonth, previousCalculationMonth, visibleMonths, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, RackCapacityHistoryRecord, RackSnapshotRecord, SiteRecord, UpsGroupHistoryRecord } from "../repositories/contracts";
import { parseExpectedRowVersion, parseMonthlyLog, parseProvenance, parseRackFieldChanges, parseRackUnitCapacity } from "./rawInputValidation";
import { API_HEALTH_RESPONSE } from "../http/health";

export interface ApiServiceOptions { repository: BackendRepository; now?: () => Date; }

function monthOfDate(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

export class ApiService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date()) {}

  async health(): Promise<typeof API_HEALTH_RESPONSE> { return API_HEALTH_RESPONSE; }
  async readiness(): Promise<{ status: "ready" }> {
    try {
      await this.repository.ping();
      return { status: "ready" };
    } catch {
      throw new HttpError(503, "DATABASE_NOT_READY", "The database is not ready.");
    }
  }

  private async requirePeriod(): Promise<DisplayPeriod> {
    const settings = await this.repository.getGlobalSettings();
    if (!settings) throw new HttpError(503, "DISPLAY_PERIOD_NOT_CONFIGURED", "Global Display Period has not been configured.");
    return settings;
  }

  private strictMonth(value: unknown, field: string): string {
    try { return assertStrictMonth(value, field); }
    catch (error) { throw new HttpError(400, "INVALID_MONTH", error instanceof Error ? error.message : `${field} must use canonical YYYY-MM format.`); }
  }

  private async requireSite(siteId: number): Promise<SiteRecord> {
    const site = await this.repository.getSite(siteId);
    if (!site || !site.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    return site;
  }

  private async availableForSite(siteId: number, period: DisplayPeriod): Promise<{ availableMonths: string[]; latestAvailableMonth: string | null }> {
    const records = await this.repository.listPeriods(siteId);
    const asOf = monthOfDate(this.now());
    const available = records.filter(record => record.hasData && record.month <= asOf).map(record => record.month);
    return { availableMonths: visibleMonths(period, available), latestAvailableMonth: latestAvailableMonth(period, available) };
  }

  async bootstrap(): Promise<unknown> {
    const period = await this.requirePeriod();
    const sites = await this.repository.listSites();
    const siteStates = await Promise.all(sites.map(async site => ({ site, ...(await this.availableForSite(site.id, period)) })));
    const union = [...new Set(siteStates.flatMap(state => state.availableMonths))].sort();
    return { formulaVersion: DESKTOP_FORMULA_VERSION, displayPeriod: period, allowedMonths: allowedMonths(period), availableMonths: union, latestAvailableMonth: latestAvailableMonth(period, union), sites: siteStates };
  }

  async listSites(): Promise<SiteRecord[]> { return this.repository.listSites(); }

  async getSettings(): Promise<DisplayPeriod> {
    const period = await this.requirePeriod();
    return period;
  }

  async updateSettings(startMonth: unknown, endMonth: unknown, expectedRowVersion: unknown, correlationId: string, actorUserId?: number | null): Promise<DisplayPeriod> {
    const start = this.strictMonth(startMonth, "start_month");
    const end = this.strictMonth(endMonth, "end_month");
    if (typeof expectedRowVersion !== "number" || !Number.isSafeInteger(expectedRowVersion) || expectedRowVersion < 0 || expectedRowVersion > 2147483647) throw new HttpError(400, "INVALID_ROW_VERSION", "expected_row_version must be a PostgreSQL-safe non-negative integer.");
    const expected = expectedRowVersion;
    try { assertDisplayPeriod(start, end); } catch (error) { throw new HttpError(400, "INVALID_DISPLAY_PERIOD", error instanceof Error ? error.message : "Invalid Display Period."); }
    return this.repository.updateGlobalSettings({ startMonth: start, endMonth: end, expectedRowVersion: expected, actorUserId }, correlationId);
  }

  async getPeriods(siteId: number): Promise<unknown> {
    await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const state = await this.availableForSite(siteId, period);
    return { siteId, displayPeriod: period, allowedMonths: allowedMonths(period), ...state };
  }

  private async requireVisibleMonth(month: unknown): Promise<{ period: DisplayPeriod; month: string }> {
    const period = await this.requirePeriod();
    const normalized = this.strictMonth(month, "month");
    if (!isAllowedMonth(normalized, period)) throw new HttpError(404, "MONTH_OUTSIDE_DISPLAY_PERIOD", "The requested month is outside the Global Display Period.");
    if (normalized > monthOfDate(this.now())) throw new HttpError(404, "MONTH_NOT_AVAILABLE", "The requested month is not available yet.");
    return { period, month: normalized };
  }

  private async loadLogForVisibleMonth(siteId: number, month: string, allowPrevious = false) {
    const months = allowPrevious && previousCalculationMonth(month) ? [previousCalculationMonth(month) as string, month] : [month];
    return this.repository.getMonthlyLogs(siteId, months);
  }

  async getEnergy(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const logs = await this.loadLogForVisibleMonth(siteId, selected, true);
    return { siteId, month: selected, formulaVersion: DESKTOP_FORMULA_VERSION, calculation: calculateEnergyCostForMonth(logs, selected) };
  }

  async getCost(siteId: number, month: unknown): Promise<unknown> {
    const energy = await this.getEnergy(siteId, month) as { siteId: number; month: string; formulaVersion: string; calculation: ReturnType<typeof calculateEnergyCostForMonth> };
    return { siteId: energy.siteId, month: energy.month, formulaVersion: energy.formulaVersion, building: { energyKwh: energy.calculation.buildingEnergyKwh, costThb: energy.calculation.buildingElectricityCostThb }, derived: { floorEnergyKwh: energy.calculation.floorEnergyKwh, floorElectricityCostThb: energy.calculation.floorElectricityCostThb, averageElectricityRateThbPerKwh: energy.calculation.averageElectricityRateThbPerKwh, energySharePercent: energy.calculation.energySharePercent } };
  }

  async getElectrical(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const logs = await this.loadLogForVisibleMonth(siteId, selected);
    const log = logs.find(item => item.month === selected);
    return { siteId, month: selected, formulaVersion: DESKTOP_FORMULA_VERSION, ups: log?.ups ?? [], air: log?.air ?? null, dc: log?.dc ?? [] };
  }

  /**
   * Returns the selected month's authoritative raw inputs for an editor.
   * Previous-month rows are used only inside the domain calculation and are
   * deliberately not included in this DTO.
   */
  async getMonthlyLog(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const [logs, periods] = await Promise.all([
      this.repository.getMonthlyLogs(siteId, [selected]),
      this.repository.listPeriods(siteId)
    ]);
    const log = logs.find(item => item.month === selected) ?? null;
    const period = periods.find(item => item.month === selected) ?? null;
    const calculationLogs = await this.loadLogForVisibleMonth(siteId, selected, true);
    return {
      siteId,
      month: selected,
      dataset: "monthly_log",
      formulaVersion: DESKTOP_FORMULA_VERSION,
      rowVersion: period?.rowVersion ?? null,
      log,
      calculation: log ? calculateEnergyCostForMonth(calculationLogs, selected) : null
    };
  }

  /**
   * Backfills any (month, group) key that has no ups_group_history row yet
   * - computed with the exact same shared formula Desktop uses to generate
   * its own persisted "2. UPS Group History" sheet (see
   * computeUpsGroupHistorySnapshot), from that month's real saved readings.
   * Checked per key, not per month, so a month with partial history (e.g.
   * one group's row missing) still gets exactly the missing rows filled in
   * - matching UpsGroupHistoryWriter.ts's own key-level backfill semantics
   * on the Desktop side, never a coarser "skip the whole month" check.
   * Never overwrites an existing row (overwrite=false) and never fabricates
   * data for a facility with no known topology. Mirrors Desktop's own
   * migrateUpsGroupHistoryIfNeeded: lazy, idempotent, backfill-only.
   */
  private async backfillMissingUpsGroupHistory(siteId: number, facility: string, logs: MonthlyLog[], existingRows: UpsGroupHistoryRecord[]): Promise<UpsGroupHistoryRecord[]> {
    const existingKeys = new Set(existingRows.map(row => `${row.month} ${row.group}`));
    const generatedAt = this.now().toISOString();
    const newRows: UpsGroupHistoryRecord[] = [];
    for (const log of logs) {
      const rows = computeUpsGroupHistorySnapshot(facility, log);
      if (!rows) continue;
      const missing = rows.filter(row => !existingKeys.has(`${row.month} ${row.group}`));
      if (missing.length === 0) continue;
      await this.repository.saveUpsGroupHistoryRows(siteId, facility, missing, false);
      for (const row of missing) newRows.push({ facility, ...row, generatedAt, dataVersion: 1 });
    }
    return newRows.length === 0 ? existingRows : [...existingRows, ...newRows];
  }

  /**
   * Returns only populated, currently-visible rows for the History and export
   * screens.  The server owns the visibility rule so a browser cannot use an
   * editor endpoint to enumerate months outside the configured period.
   */
  async getHistory(siteId: number): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const availability = await this.availableForSite(siteId, period);
    const [logs, upsGroupHistoryRowsRaw, rackCapacityHistoryRows, rackUnitCapacityRows] = await Promise.all([
      this.repository.getMonthlyLogs(siteId, availability.availableMonths),
      this.repository.getUpsGroupHistory(siteId),
      this.repository.listRackCapacityHistory(siteId),
      this.repository.listRackUnitCapacityHistory(siteId)
    ]);
    const upsGroupHistoryRows = await this.backfillMissingUpsGroupHistory(siteId, site.code, logs, upsGroupHistoryRowsRaw);
    const visibleMonths = new Set(availability.availableMonths);
    return {
      siteId,
      displayPeriod: period,
      formulaVersion: DESKTOP_FORMULA_VERSION,
      months: availability.availableMonths,
      logs: logs.sort((left, right) => left.month.localeCompare(right.month)),
      upsGroupHistory: {
        sourceSheet: "2. UPS Group History",
        rows: upsGroupHistoryRows.filter(row => visibleMonths.has(row.month))
      },
      rackCapacityHistory: rackCapacityHistoryRows
        .filter(row => visibleMonths.has(row.month))
        .map(row => ({ snapshotMonth: row.month, facility: row.facility, rackZone: row.rackZone, totalRacks: row.totalRacks, inUse: row.inUse, available: row.available, reserved: row.reserved, pendingDismantle: row.pendingDismantle, other: row.other, usagePct: row.usagePct, availabilityPct: row.availabilityPct, reservedPct: row.reservedPct, pendingDismantlePct: row.pendingDismantlePct, otherPct: row.otherPct, generatedAt: row.generatedAt, dataVersion: row.dataVersion })),
      rackUnitCapacity: rackUnitCapacityRows
        .filter(row => visibleMonths.has(row.month))
        .map(row => ({ month: row.month, totalU: row.totalU, usedU: row.usedU, availableU: row.totalU - row.usedU, availabilityPct: row.totalU > 0 ? (row.totalU - row.usedU) / row.totalU : null }))
    };
  }

  async getDashboard(siteId: number, month: unknown): Promise<unknown> {
    const periods = await this.getPeriods(siteId) as { latestAvailableMonth: string | null };
    const selected = month === undefined || month === null || month === "" ? periods.latestAvailableMonth : month;
    return { siteId, latestAvailableMonth: periods.latestAvailableMonth, selectedMonth: selected, energy: selected ? await this.getEnergy(siteId, selected) : null };
  }

  async getSiteComparison(): Promise<unknown> {
    const period = await this.requirePeriod();
    const sites = await this.repository.listSites();
    const states = await Promise.all(sites.map(async site => {
      const state = await this.availableForSite(site.id, period);
      const logs = await this.repository.getMonthlyLogs(site.id, state.availableMonths);
      const metrics = buildFacilityComparisonMetrics(logs, period.endMonth);
      return { site, availableMonths: state.availableMonths, metrics: Object.fromEntries(metrics) };
    }));
    const months = [...new Set(states.flatMap(state => state.availableMonths))].sort();
    const data = states.map(state => ({
      site: state.site,
      months: months.map(month => ({ month, metrics: state.metrics[month] ?? null }))
    }));
    return { displayPeriod: period, months, sites: data };
  }

  async getRacks(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const snapshot = await this.repository.getRackSnapshot(siteId, selected);
    return { siteId, month: selected, snapshot: snapshot ? { ...snapshot, metrics: calculateRackCapacityMetrics(snapshot.records) } : null };
  }

  async getRackUnit(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const snapshot = await this.repository.getRackUnitSnapshot(siteId, selected);
    if (!snapshot) return { siteId, month: selected, snapshot: null };
    return { siteId, month: selected, snapshot: { ...snapshot, availableU: snapshot.totalU - snapshot.usedU, usagePercent: usagePercent(snapshot), availabilityPercent: snapshot.totalU > 0 ? ((snapshot.totalU - snapshot.usedU) / snapshot.totalU) * 100 : null } };
  }

  private rackHistoryRows(facility: string, month: string, snapshot: RackSnapshotRecord): RackCapacityHistoryRecord[] {
    const metrics = calculateRackCapacityMetrics(snapshot.records);
    const toRow = (rackZone: string, item: { total: number; inUse: { count: number; ratio: number | null }; available: { count: number; ratio: number | null }; reserved: { count: number; ratio: number | null }; pendingDismantle: { count: number; ratio: number | null }; other: { count: number; ratio: number | null } }): RackCapacityHistoryRecord => ({ month, facility, rackZone, totalRacks: item.total, inUse: item.inUse.count, available: item.available.count, reserved: item.reserved.count, pendingDismantle: item.pendingDismantle.count, other: item.other.count, usagePct: item.inUse.ratio, availabilityPct: item.available.ratio, reservedPct: item.reserved.ratio, pendingDismantlePct: item.pendingDismantle.ratio, otherPct: item.other.ratio, generatedAt: this.now().toISOString(), dataVersion: 1 });
    return [toRow("(Total)", metrics), ...metrics.zoneMetrics.map(zone => toRow(zone.zone, zone))];
  }

  async saveRacks(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const changes = parseRackFieldChanges(source.changes ?? []);
    const forceSnapshot = source.force_snapshot === true;
    if (changes.length === 0 && !forceSnapshot) throw new HttpError(400, "INVALID_BODY", "Rack Capacity save requires a field change or an explicit snapshot request.");
    return this.repository.withTransaction(async repository => {
      const saved = await repository.saveRackCapacity({ siteId, month: selected, changes, forceSnapshot, correlationId, actorUserId });
      if (saved.changedCount > 0 || forceSnapshot) await repository.saveRackCapacityHistoryRows(siteId, this.rackHistoryRows(site.code, selected, saved.snapshot));
      const history = await repository.listRackCapacityHistory(siteId);
      return { siteId, month: selected, snapshot: { ...saved.snapshot, metrics: calculateRackCapacityMetrics(saved.snapshot.records) }, outcomes: saved.outcomes, changedCount: saved.changedCount, rackCapacityHistory: history };
    });
  }

  async saveRackUnit(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const input = parseRackUnitCapacity(body, selected);
    const snapshot = await this.repository.saveRackUnitCapacity({ siteId, month: selected, totalU: input.totalU, usedU: input.usedU, expectedRowVersion: input.expectedRowVersion, forceSnapshot: input.forceSnapshot, correlationId, actorUserId });
    const rows = await this.repository.listRackUnitCapacityHistory(siteId);
    return { siteId, month: selected, snapshot: { ...snapshot, availableU: snapshot.totalU - snapshot.usedU, usagePercent: usagePercent(snapshot), availabilityPercent: snapshot.totalU > 0 ? ((snapshot.totalU - snapshot.usedU) / snapshot.totalU) * 100 : null }, rows: rows.map(row => ({ month: row.month, totalU: row.totalU, usedU: row.usedU, availableU: row.totalU - row.usedU, availabilityPct: row.totalU > 0 ? (row.totalU - row.usedU) / row.totalU : null })) };
  }

  async saveMonthlyLog(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const log = parseMonthlyLog(source.log, selected);
    const expectedRowVersion = parseExpectedRowVersion(source.expected_row_version);
    return this.repository.saveMonthlyLog({ siteId, log, expectedRowVersion, correlationId, actorUserId, provenance: parseProvenance(source.provenance) ?? { sourceType: "web-api" } });
  }

  asOfMonth(): string { return monthOfDate(this.now()); }
}
