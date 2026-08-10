import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { buildEngineeringDashboardSnapshot, type DashboardUpsTopology } from "../../src/domain/engineeringDashboard";
import { buildFacilityComparisonMetrics } from "../../src/domain/facilityComparison";
import { calculateRackCapacityMetrics } from "../../src/domain/rackCapacity";
import { usagePercent } from "../../src/domain/rackUnitCapacity";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { HttpError } from "../errors";
import { assertDisplayPeriod, assertStrictMonth, allowedMonths, isAllowedMonth, latestAvailableMonth, previousCalculationMonth, visibleMonths, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, SiteRecord } from "../repositories/contracts";
import type { RackSnapshotRecord } from "../repositories/contracts";
import { parseExpectedRowVersion, parseMonthlyLog, parseProvenance, parseRackSnapshotRecords, parseRackUnitSnapshot, parseSavedSections } from "./rawInputValidation";
import { API_HEALTH_RESPONSE } from "../http/health";
import { createHash } from "node:crypto";
import type { ObjectStorage } from "../storage/objectStorage";
import { validateImageBytes } from "../../src/utils/imageValidation";
import { rackCapacityHistoryRowsFromMetrics } from "../../src/excel/RackCapacityHistoryWriter";

export interface ApiServiceOptions { repository: BackendRepository; now?: () => Date; }

function monthOfDate(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

export class ApiService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date(), private readonly imageStorage?: ObjectStorage) {}

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

  async getExportData(siteId: number): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const state = await this.availableForSite(siteId, period);
    const logs = await this.repository.getMonthlyLogs(siteId, state.availableMonths);
    const [rackCapacitySnapshots, rackUnitCapacitySnapshots] = await Promise.all([
      Promise.all(state.availableMonths.map(month => this.repository.getRackSnapshot(siteId, month))).then(rows => rows.filter((row): row is NonNullable<typeof row> => row !== null)),
      Promise.all(state.availableMonths.map(month => this.repository.getRackUnitSnapshot(siteId, month))).then(rows => rows.filter((row): row is NonNullable<typeof row> => row !== null))
    ]);
    return { site, siteId, formulaVersion: DESKTOP_FORMULA_VERSION, displayPeriod: period, logs: logs.sort((a, b) => a.month.localeCompare(b.month)), rackCapacitySnapshots, rackUnitCapacitySnapshots };
  }

  async getHistorical(siteId: number): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const state = await this.availableForSite(siteId, period);
    const [logs, rackCapacityHistory, rackUnitCapacity, upsGroupHistory] = await Promise.all([
      this.repository.getMonthlyLogs(siteId, state.availableMonths),
      this.repository.getRackCapacityHistory(siteId),
      this.repository.listRackUnitSnapshots(siteId),
      this.repository.getUpsGroupHistory(siteId)
    ]);
    return {
      site,
      siteId,
      formulaVersion: DESKTOP_FORMULA_VERSION,
      displayPeriod: period,
      logs: logs.sort((a, b) => a.month.localeCompare(b.month)),
      upsGroupHistory: {
        sourceSheet: upsGroupHistory.sourceSheet,
        rows: upsGroupHistory.rows.filter(row => row.month >= period.startMonth && row.month <= period.endMonth)
      },
      rackCapacityHistory: rackCapacityHistory.filter(row => row.snapshotMonth >= period.startMonth && row.snapshotMonth <= period.endMonth),
      rackUnitCapacity: rackUnitCapacity.filter(row => row.month >= period.startMonth && row.month <= period.endMonth).map(row => ({ ...row, availableU: row.totalU - row.usedU, availabilityPct: row.totalU > 0 ? (row.totalU - row.usedU) / row.totalU : null }))
    };
  }

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

  async getDashboard(siteId: number, month: unknown): Promise<unknown> {
    const periods = await this.getPeriods(siteId) as { latestAvailableMonth: string | null };
    const selected = month === undefined || month === null || month === ""
      ? periods.latestAvailableMonth
      : typeof month === "string" ? month : null;
    if (typeof selected !== "string" || selected === "") return { siteId, latestAvailableMonth: periods.latestAvailableMonth, selectedMonth: null, energy: null, engineeringDashboard: null };
    const calculationLogs = await this.loadLogForVisibleMonth(siteId, selected, true);
    const current = calculationLogs.find(log => log.month === selected);
    const topology: DashboardUpsTopology | null = current?.energyCalculation?.upsGroups?.length
      ? { upsGroups: current.energyCalculation.upsGroups.map((ids, index) => ({ name: ids[0] ?? `UPS Group ${index + 1}`, ids, capacity: null })), upsMapping: [] }
      : null;
    const calculation = calculateEnergyCostForMonth(calculationLogs, selected);
    return {
      siteId,
      latestAvailableMonth: periods.latestAvailableMonth,
      selectedMonth: selected,
      energy: { siteId, month: selected, formulaVersion: DESKTOP_FORMULA_VERSION, calculation },
      engineeringDashboard: current ? buildEngineeringDashboardSnapshot(calculationLogs, selected, null, topology) : null
    };
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
    const image = await this.repository.getRackUnitImage(siteId, selected);
    return { siteId, month: selected, image: image ? { contentType: image.contentType, byteSize: image.byteSize, width: image.width, height: image.height, savedAt: image.savedAt, savedBy: image.savedBy } : null, snapshot: { ...snapshot, availableU: snapshot.totalU - snapshot.usedU, usagePercent: usagePercent(snapshot), availabilityPercent: snapshot.totalU > 0 ? ((snapshot.totalU - snapshot.usedU) / snapshot.totalU) * 100 : null } };
  }

  async getRackUnitImage(siteId: number, month: unknown): Promise<{ contentType: "image/png" | "image/jpeg"; bytes: Buffer }> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const image = await this.repository.getRackUnitImage(siteId, selected);
    if (!image) throw new HttpError(404, "RACK_UNIT_IMAGE_NOT_FOUND", "No Rack Unit Capacity image is available for this month.");
    if (!this.imageStorage) throw new HttpError(503, "RACK_UNIT_IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage is not configured.");
    const bytes = await this.imageStorage.get(image.objectKey);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== image.sha256 || bytes.length !== image.byteSize) throw new HttpError(503, "RACK_UNIT_IMAGE_INTEGRITY_FAILED", "The Rack Unit Capacity image failed its stored integrity check.");
    return { contentType: image.contentType, bytes };
  }

  async saveRackSnapshot(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<RackSnapshotRecord> {
    const site = await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const records = parseRackSnapshotRecords(source.records);
    const expectedRowVersion = parseExpectedRowVersion(source.expected_row_version);
    const historyRows = rackCapacityHistoryRowsFromMetrics(site.name, selected, calculateRackCapacityMetrics(records), this.now().toISOString());
    return this.repository.withTransaction(async transaction => {
      const saved = await transaction.saveRackSnapshot({ siteId, month: selected, records, expectedRowVersion, correlationId, actorUserId });
      await transaction.saveRackCapacityHistory({ siteId, rows: historyRows, correlationId, actorUserId });
      return saved;
    });
  }

  async saveRackUnitSnapshot(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const values = parseRackUnitSnapshot(source);
    const expectedRowVersion = parseExpectedRowVersion(source.expected_row_version);
    return this.repository.saveRackUnitSnapshot({ siteId, month: selected, ...values, expectedRowVersion, correlationId, actorUserId });
  }

  async saveRackUnitImage(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (!this.imageStorage) throw new HttpError(503, "RACK_UNIT_IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage is not configured.");
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    if (typeof source.content_base64 !== "string" || source.content_base64.length === 0 || source.content_base64.length > 12_000_000 || source.content_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.content_base64)) throw new HttpError(400, "INVALID_IMAGE_UPLOAD", "content_base64 must be a valid PNG or JPEG payload.");
    const bytes = Buffer.from(source.content_base64, "base64");
    const validation = validateImageBytes(bytes);
    if (validation.ok === false) throw new HttpError(400, "INVALID_IMAGE_UPLOAD", `Image validation failed: ${validation.reason}.`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `rack-unit/${siteId}/${selected}/${hash}.${validation.image.type === "png" ? "png" : "jpg"}`;
    await this.imageStorage.put(objectKey, bytes, validation.image.mimeType);
    return this.repository.saveRackUnitImage({ siteId, month: selected, objectKey, contentType: validation.image.mimeType, byteSize: bytes.length, sha256: hash, width: validation.image.width, height: validation.image.height, savedBy: String(actorUserId ?? "web-user"), correlationId, savedAt: this.now().toISOString() });
  }

  async saveMonthlyLog(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const log = parseMonthlyLog(source.log, selected);
    const expectedRowVersion = parseExpectedRowVersion(source.expected_row_version);
    const savedSections = parseSavedSections(source.changed_sections) ?? ["ups", "air", "dc", "energyCost"] as const;
    return this.repository.saveMonthlyLog({ siteId, log, expectedRowVersion, correlationId, actorUserId, savedSections, savedAt: this.now().toISOString(), provenance: parseProvenance(source.provenance) ?? { sourceType: "web-api" } });
  }

  asOfMonth(): string { return monthOfDate(this.now()); }
}
