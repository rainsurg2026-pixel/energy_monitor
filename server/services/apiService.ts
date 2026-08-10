import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { buildFacilityComparisonMetrics } from "../../src/domain/facilityComparison";
import { calculateRackCapacityMetrics } from "../../src/domain/rackCapacity";
import { usagePercent } from "../../src/domain/rackUnitCapacity";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { HttpError } from "../errors";
import { assertDisplayPeriod, assertStrictMonth, allowedMonths, isAllowedMonth, latestAvailableMonth, previousCalculationMonth, visibleMonths, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, SiteRecord } from "../repositories/contracts";
import { parseExpectedRowVersion, parseMonthlyLog, parseProvenance } from "./rawInputValidation";
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
   * Returns only populated, currently-visible rows for the History and export
   * screens.  The server owns the visibility rule so a browser cannot use an
   * editor endpoint to enumerate months outside the configured period.
   */
  async getHistory(siteId: number): Promise<unknown> {
    await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const availability = await this.availableForSite(siteId, period);
    const logs = await this.repository.getMonthlyLogs(siteId, availability.availableMonths);
    return {
      siteId,
      displayPeriod: period,
      formulaVersion: DESKTOP_FORMULA_VERSION,
      months: availability.availableMonths,
      logs: logs.sort((left, right) => left.month.localeCompare(right.month))
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
