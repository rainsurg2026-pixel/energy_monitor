import { createHash } from "node:crypto";
import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { buildFacilityComparisonMetrics } from "../../src/domain/facilityComparison";
import { calculateRackCapacityMetrics, normalizeRackEditableValue, RACK_CANONICAL_STATUSES, type RackEditableField } from "../../src/domain/rackCapacity";
import { usagePercent } from "../../src/domain/rackUnitCapacity";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { computeUpsGroupHistorySnapshot } from "../../src/domain/upsGroupHistorySnapshot";
import type { MonthlyLog } from "../../src/types";
import { HttpError } from "../errors";
import { assertDisplayPeriod, assertStrictMonth, allowedMonths, isAllowedMonth, latestAvailableMonth, previousCalculationMonth, visibleMonths, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, RackFieldChange, RackUnitImageRecord, SiteRecord, UpsGroupHistoryRecord } from "../repositories/contracts";
import { validateImageBytes } from "../../src/utils/imageValidation";
import { imageObjectKey, type RackUnitImageStorage } from "../storage/rackUnitImageStorage";
import { parseExpectedRowVersion, parseMonthlyLog, parseProvenance } from "./rawInputValidation";
import { API_HEALTH_RESPONSE } from "../http/health";
import { historyMonthsForScope } from "./historyScope";

export interface ApiServiceOptions { repository: BackendRepository; now?: () => Date; imageStorage?: RackUnitImageStorage; }

export type HistoryScope = "dashboard" | "rack" | "full";

function monthOfDate(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

const RACK_EDITABLE_FIELDS: readonly RackEditableField[] = ["status", "cabinetSize", "detail", "deviceType", "remarks"];
function rackObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_RACK_CHANGES", `${field} must be an object.`);
  return value as Record<string, unknown>;
}
function rackEditValue(value: unknown, field: RackEditableField, path: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "INVALID_RACK_CHANGES", `${path} must be a string or null.`);
  return normalizeRackEditableValue(field, value);
}
function parseRackChanges(value: unknown): RackFieldChange[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, "INVALID_RACK_CHANGES", "changes must be a non-empty array.");
  const seenRows = new Set<number>();
  return value.map((entry, index) => {
    const source = rackObject(entry, `changes[${index}]`);
    const rowNumber = source.row_number ?? source.rowNumber;
    if (typeof rowNumber !== "number" || !Number.isSafeInteger(rowNumber) || rowNumber < 1) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes[${index}].row_number must be a positive integer.`);
    if (seenRows.has(rowNumber)) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes contains duplicate row ${rowNumber}.`);
    seenRows.add(rowNumber);
    if (typeof source.rack_id !== "string" && typeof source.rackId !== "string") throw new HttpError(400, "INVALID_RACK_CHANGES", `changes[${index}].rack_id must be a non-empty string.`);
    const rackId = String(source.rack_id ?? source.rackId).trim();
    if (!rackId) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes[${index}].rack_id must be a non-empty string.`);
    const result: RackFieldChange = { rowNumber, rackId };
    let fieldCount = 0;
    for (const field of RACK_EDITABLE_FIELDS) {
      if (!(field in source)) continue;
      const edit = rackObject(source[field], `changes[${index}].${field}`);
      if (!("expected" in edit) || !("next" in edit)) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes[${index}].${field} requires expected and next.`);
      const expected = rackEditValue(edit.expected, field, `changes[${index}].${field}.expected`);
      const next = rackEditValue(edit.next, field, `changes[${index}].${field}.next`);
      if (field === "status" && (next === null || !RACK_CANONICAL_STATUSES.includes(next as (typeof RACK_CANONICAL_STATUSES)[number]))) throw new HttpError(400, "INVALID_RACK_STATUS", "Rack status must be one of the canonical Rack Capacity statuses.");
      result[field] = { expected, next };
      fieldCount++;
    }
    if (fieldCount === 0) throw new HttpError(400, "INVALID_RACK_CHANGES", `changes[${index}] must contain at least one editable field.`);
    return result;
  });
}

export class ApiService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date(), private readonly imageStorage?: RackUnitImageStorage) {}

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

  private async rackUnitImageAvailable(image: RackUnitImageRecord | null | undefined): Promise<boolean> {
    if (!image || !this.imageStorage) return false;
    try {
      if (this.imageStorage.hasObject) return await this.imageStorage.hasObject(image.objectKey);
      return Boolean(await this.imageStorage.getObject(image.objectKey));
    } catch {
      // Metadata must never make the UI request a broken image URL. The image
      // endpoint still performs the authoritative read and integrity check.
      return false;
    }
  }

  private async availableForSite(siteId: number, period: DisplayPeriod): Promise<{ availableMonths: string[]; latestAvailableMonth: string | null }> {
    // A month can be populated by a secondary historical dataset even when
    // the monthly energy log is absent (for example an imported Rack Unit
    // Capacity row from Desktop).  The old implementation used only
    // monthly_periods, so those valid historical rows were silently hidden
    // from bootstrap/history and could never be selected in Data Entry.
    const [records, rackHistory, rackUnitHistory] = await Promise.all([
      this.repository.listPeriods(siteId),
      this.repository.listRackCapacityHistory(siteId),
      this.repository.listRackUnitCapacityHistory(siteId)
    ]);
    const asOf = monthOfDate(this.now());
    const available = [
      ...records.filter(record => record.hasData).map(record => record.month),
      ...rackHistory.map(record => record.month),
      ...rackUnitHistory.map(record => record.month)
    ].filter(month => month <= asOf);
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
   * Computes missing (month, group) rows for the response without persisting
   * them. GET /history must remain read-only; durable UPS Group History rows
   * are written by the transactional monthly-save and migration paths.
   *
   * The same shared formula Desktop uses for its persisted "2. UPS Group
   * History" sheet is used here, and existing rows always win. This keeps
   * older imported datasets readable without making a browser GET mutate the
   * database or race another reader.
   */
  private mergeComputedUpsGroupHistory(facility: string, logs: MonthlyLog[], existingRows: UpsGroupHistoryRecord[]): UpsGroupHistoryRecord[] {
    const existingKeys = new Set(existingRows.map(row => `${row.month}\u0000${row.group}`));
    const generatedAt = this.now().toISOString();
    const newRows: UpsGroupHistoryRecord[] = [];
    for (const log of logs) {
      const rows = computeUpsGroupHistorySnapshot(facility, log);
      if (!rows) continue;
      const missing = rows.filter(row => !existingKeys.has(`${row.month}\u0000${row.group}`));
      if (missing.length === 0) continue;
      for (const row of missing) newRows.push({ facility, ...row, generatedAt, dataVersion: 1 });
    }
    return newRows.length === 0 ? existingRows : [...existingRows, ...newRows];
  }

  /**
   * Returns only populated, currently-visible rows for the History and export
   * screens.  The server owns the visibility rule so a browser cannot use an
   * editor endpoint to enumerate months outside the configured period.
   */
  async getHistory(siteId: number, scope: HistoryScope = "full"): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const period = await this.requirePeriod();
    const availability = await this.availableForSite(siteId, period);
    const includeLogs = scope !== "rack";
    const includeUpsGroupHistory = scope !== "rack";
    const includeRackHistory = scope !== "dashboard";
    const includeRackUnitCapacity = scope !== "dashboard";
    const requestedLogMonths = historyMonthsForScope(availability.availableMonths, scope);
    const [logs, upsGroupHistoryRowsRaw, rackCapacityHistoryRows, rackUnitCapacityRows] = await Promise.all([
      includeLogs ? this.repository.getMonthlyLogs(siteId, requestedLogMonths) : Promise.resolve([]),
      includeUpsGroupHistory ? this.repository.getUpsGroupHistory(siteId) : Promise.resolve([]),
      includeRackHistory ? this.repository.listRackCapacityHistory(siteId) : Promise.resolve([]),
      includeRackUnitCapacity ? this.repository.listRackUnitCapacityHistory(siteId) : Promise.resolve([])
    ]);
    const upsGroupHistoryRows = includeUpsGroupHistory
      ? this.mergeComputedUpsGroupHistory(site.code, logs, upsGroupHistoryRowsRaw)
      : [];
    const visibleMonths = new Set(availability.availableMonths);
    const returnedHistoryMonths = new Set(requestedLogMonths);
    return {
      siteId,
      displayPeriod: period,
      formulaVersion: DESKTOP_FORMULA_VERSION,
      months: availability.availableMonths,
      logs: logs.sort((left, right) => left.month.localeCompare(right.month)),
      upsGroupHistory: {
        sourceSheet: "2. UPS Group History",
        rows: upsGroupHistoryRows.filter(row => visibleMonths.has(row.month) && returnedHistoryMonths.has(row.month))
      },
      rackCapacityHistory: rackCapacityHistoryRows
        .filter(row => visibleMonths.has(row.month))
        .map(row => ({ snapshotMonth: row.month, facility: row.facility, rackZone: row.rackZone, totalRacks: row.totalRacks, inUse: row.inUse, available: row.available, reserved: row.reserved, pendingDismantle: row.pendingDismantle, other: row.other, usagePct: row.usagePct, availabilityPct: row.availabilityPct, reservedPct: row.reservedPct, pendingDismantlePct: row.pendingDismantlePct, otherPct: row.otherPct, generatedAt: row.generatedAt, dataVersion: row.dataVersion })),
      rackUnitCapacity: rackUnitCapacityRows
        .filter(row => visibleMonths.has(row.month))
        .map(row => ({ month: row.month, totalU: row.totalU, usedU: row.usedU, availableU: row.totalU - row.usedU, availabilityPct: row.totalU > 0 ? (row.totalU - row.usedU) / row.totalU : null, imageAttached: Boolean(row.image), imageContentType: row.image?.contentType ?? null, imageSavedAt: row.image?.savedAt ?? null }))
    };
  }

  async getDashboard(siteId: number, month: unknown): Promise<unknown> {
    const periods = await this.getPeriods(siteId) as { latestAvailableMonth: string | null; availableMonths: string[] };
    const monthlyPeriods = await this.repository.listPeriods(siteId);
    const monthlyMonths = new Set(monthlyPeriods.filter(record => record.hasData).map(record => record.month));
    const latestEnergyMonth = periods.availableMonths.filter(candidate => monthlyMonths.has(candidate)).at(-1) ?? null;
    const selected = month === undefined || month === null || month === "" ? latestEnergyMonth : month;
    return { siteId, latestAvailableMonth: periods.latestAvailableMonth, selectedMonth: selected, energy: selected ? await this.getEnergy(siteId, selected) : null };
  }

  async getSiteComparison(): Promise<unknown> {
    const period = await this.requirePeriod();
    const sites = await this.repository.listSites();
    const states = await Promise.all(sites.map(async site => {
      // Keep all source reads for a site in one fan-out. The previous code
      // called availableForSite(), then fetched monthly periods and rack-unit
      // history again, which multiplied the cold-start/database latency of
      // the comparison page without changing the result.
      const [periods, rackHistory, rackUnitRows] = await Promise.all([
        this.repository.listPeriods(site.id),
        this.repository.listRackCapacityHistory(site.id),
        this.repository.listRackUnitCapacityHistory(site.id)
      ]);
      const available = [
        ...periods.filter(record => record.hasData).map(record => record.month),
        ...rackHistory.map(record => record.month),
        ...rackUnitRows.map(record => record.month)
      ].filter(month => month <= monthOfDate(this.now()));
      const availableMonths = visibleMonths(period, available);
      const monthlyMonths = new Set(periods.filter(record => record.hasData).map(record => record.month));
      const comparisonMonths = availableMonths.filter(month => monthlyMonths.has(month));
      const logs = await this.repository.getMonthlyLogs(site.id, comparisonMonths);
      const metrics = buildFacilityComparisonMetrics(logs, period.endMonth);
      return {
        site,
        availableMonths: comparisonMonths,
        metrics: Object.fromEntries(metrics),
        rackUnitCapacity: rackUnitRows
          .filter(row => availableMonths.includes(row.month))
          .map(row => ({
            month: row.month,
            totalU: row.totalU,
            usedU: row.usedU,
            availableU: row.totalU - row.usedU,
            usagePercent: usagePercent(row)
          }))
      };
    }));
    const months = [...new Set(states.flatMap(state => state.availableMonths))].sort();
    const data = states.map(state => ({
      site: state.site,
      months: months.map(month => ({ month, metrics: state.metrics[month] ?? null })),
      rackUnitCapacity: state.rackUnitCapacity
    }));
    return { displayPeriod: period, months, sites: data };
  }

  async getRacks(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const snapshot = await this.repository.getRackSnapshot(siteId, selected);
    return { siteId, month: selected, snapshot: snapshot ? { ...snapshot, metrics: calculateRackCapacityMetrics(snapshot.records) } : null };
  }

  async saveRacks(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const { month: selected, period } = await this.requireVisibleMonth(month);
    const source = body === null || typeof body !== "object" || Array.isArray(body)
      ? (() => { throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object."); })()
      : body as Record<string, unknown>;
    const changes = parseRackChanges(source.changes);
    const expectedRowVersion = parseExpectedRowVersion(source.expected_row_version);
    const saved = await this.repository.withTransaction(repository => repository.saveRackCapacity({ siteId, facility: site.code, month: selected, changes, expectedRowVersion, actorUserId, correlationId, generatedAt: this.now().toISOString() }));
    const history = (await this.repository.listRackCapacityHistory(siteId)).filter(row => period.startMonth <= row.month && row.month <= period.endMonth && row.month <= monthOfDate(this.now()));
    return { siteId, month: selected, snapshot: saved.snapshot, outcomes: saved.outcomes, changedCount: saved.changedCount, rackCapacityHistory: history };
  }

  async getRackUnit(siteId: number, month: unknown): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const snapshot = await this.repository.getRackUnitSnapshot(siteId, selected);
    if (!snapshot) return { siteId, month: selected, snapshot: null };
    const imageAvailable = await this.rackUnitImageAvailable(snapshot.image);
    return { siteId, month: selected, snapshot: { ...snapshot, image: snapshot.image ? { ...snapshot.image, available: imageAvailable } : null, availableU: snapshot.totalU - snapshot.usedU, usagePercent: usagePercent(snapshot), availabilityPercent: snapshot.totalU > 0 ? ((snapshot.totalU - snapshot.usedU) / snapshot.totalU) * 100 : null } };
  }

  async getRackUnitImage(siteId: number, month: unknown): Promise<{ contentType: "image/png" | "image/jpeg"; bytes: Buffer }> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    const snapshot = await this.repository.getRackUnitSnapshot(siteId, selected);
    if (!snapshot?.image) throw new HttpError(404, "IMAGE_NOT_FOUND", "No Rack Unit Capacity image exists for the requested month.");
    if (!this.imageStorage) throw new HttpError(503, "IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage is not configured.");
    let bytes: Buffer | null;
    try {
      bytes = await this.imageStorage.getObject(snapshot.image.objectKey);
    } catch {
      throw new HttpError(503, "IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage could not be read.");
    }
    if (!bytes) throw new HttpError(503, "IMAGE_OBJECT_MISSING", "Rack Unit Capacity image metadata exists but the stored object is unavailable.");
    if (snapshot.image.sha256 && createHash("sha256").update(bytes).digest("hex") !== snapshot.image.sha256) throw new HttpError(503, "IMAGE_CHECKSUM_MISMATCH", "Rack Unit Capacity image integrity verification failed.");
    return { contentType: snapshot.image.contentType, bytes };
  }

  async saveRackUnit(siteId: number, month: unknown, body: unknown, correlationId: string, actorUserId?: number | null): Promise<unknown> {
    await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_BODY", "Request body must be a JSON object.");
    const source = body as Record<string, unknown>;
    const totalU = source.total_u;
    const usedU = source.used_u;
    if (typeof totalU !== "number" || !Number.isFinite(totalU) || totalU < 0 || typeof usedU !== "number" || !Number.isFinite(usedU) || usedU < 0) throw new HttpError(400, "INVALID_RACK_UNIT_VALUES", "total_u and used_u must be finite non-negative numbers.");
    const saved = await this.repository.withTransaction(repository => repository.saveRackUnitSnapshot({ siteId, month: selected, totalU, usedU, expectedRowVersion: parseExpectedRowVersion(source.expected_row_version), actorUserId, correlationId }));
    const refreshed = await this.repository.getRackUnitSnapshot(siteId, selected);
    const snapshot = refreshed ?? saved;
    return { siteId, month: selected, rowVersion: snapshot.rowVersion, totalU: snapshot.totalU, usedU: snapshot.usedU, availableU: snapshot.totalU - snapshot.usedU, availabilityPercent: snapshot.totalU > 0 ? ((snapshot.totalU - snapshot.usedU) / snapshot.totalU) * 100 : null };
  }

  async saveRackUnitImage(siteId: number, month: unknown, bytes: Buffer, contentType: string | undefined, _correlationId: string, actorUserId?: number | null): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const { month: selected } = await this.requireVisibleMonth(month);
    if (!this.imageStorage) throw new HttpError(503, "IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage is not configured.");
    const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (normalizedContentType !== "image/png" && normalizedContentType !== "image/jpeg") throw new HttpError(400, "INVALID_IMAGE_TYPE", "Only PNG or JPEG images are supported.");
    const validation = validateImageBytes(bytes);
    if (validation.ok === false) throw new HttpError(400, "INVALID_IMAGE", "The uploaded Rack Unit Capacity image is invalid.");
    if (validation.image.mimeType !== normalizedContentType) throw new HttpError(400, "IMAGE_TYPE_MISMATCH", "The image content does not match its content type.");
    const existing = await this.repository.getRackUnitSnapshot(siteId, selected);
    if (!existing) throw new HttpError(409, "RACK_UNIT_CAPACITY_REQUIRED", "Save Rack Unit Capacity before saving its image.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = imageObjectKey(site.code, selected, bytes, validation.image.mimeType);
    await this.imageStorage.putObject(objectKey, bytes, validation.image.mimeType);
    try {
      const result = await this.repository.withTransaction(repository => repository.replaceRackUnitImage({ siteId, month: selected, objectKey, contentType: validation.image.mimeType, byteSize: bytes.length, sha256, width: validation.image.width, height: validation.image.height, actorUserId }));
      for (const oldKey of result.replacedObjectKeys.filter(key => key !== objectKey)) await this.imageStorage!.deleteObject(oldKey).catch(() => undefined);
      return { siteId, month: selected, image: result.image };
    } catch (error) {
      await this.imageStorage.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
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
