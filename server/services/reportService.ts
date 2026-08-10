import { buildEngineeringDashboardSnapshot, type DashboardUpsTopology } from "../../src/domain/engineeringDashboard";
import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { buildFacilityComparisonMetrics } from "../../src/domain/facilityComparison";
import { buildReportHtml, type ReportRenderSection } from "../../src/reports/pdf/reportHtml";
import type { RackCapacityReport, ReportData, ReportMonthlyRow } from "../../src/reports/reportTypes";
import type { MonthlyLog } from "../../src/types";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { HttpError } from "../errors";
import { assertStrictMonth, isAllowedMonth, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, RackSnapshotRecord, SiteRecord } from "../repositories/contracts";
import type { ObjectStorage } from "../storage/objectStorage";
import { createHash } from "node:crypto";

function monthLabel(month: string): string { return month.replace("-", ""); }

function reportStatus(rows: readonly ReportMonthlyRow[]): ReportData["status"] {
  return rows.length > 0 && rows.every(row => row.status === "Complete") ? "Complete" : "Partial";
}

function monthlyRow(logs: readonly MonthlyLog[], log: MonthlyLog): ReportMonthlyRow {
  const calculation = calculateEnergyCostForMonth(logs, log.month);
  const values = [
    calculation.buildingEnergyKwh,
    calculation.buildingElectricityCostThb,
    calculation.floorEnergyKwh,
    calculation.floorElectricityCostThb,
    calculation.averageElectricityRateThbPerKwh,
    calculation.energySharePercent,
    calculation.upsEnergyKwh,
    calculation.airEnergyKwh,
    calculation.dcEnergyKwh
  ];
  return {
    month: log.month,
    buildingEnergyKwh: calculation.buildingEnergyKwh,
    buildingCostThb: calculation.buildingElectricityCostThb,
    floorEnergyKwh: calculation.floorEnergyKwh,
    floorCostThb: calculation.floorElectricityCostThb,
    averageRateThbPerKwh: calculation.averageElectricityRateThbPerKwh,
    floorSharePercent: calculation.energySharePercent,
    upsEnergyKwh: calculation.upsEnergyKwh,
    airEnergyKwh: calculation.airEnergyKwh,
    dcEnergyKwh: calculation.dcEnergyKwh,
    status: values.every(value => value !== null && Number.isFinite(value)) ? "Complete" : "Partial"
  };
}

function rackReport(snapshot: RackSnapshotRecord | null): RackCapacityReport | null {
  if (!snapshot) return null;
  const records = snapshot.records.map((record, index) => ({
    rowNumber: record.rowNumber ?? index + 1,
    rackZone: record.rackZone,
    rackId: record.rackId,
    status: record.status,
    cabinetSize: record.cabinetSize,
    detail: record.detail,
    deviceType: record.deviceType,
    remarks: record.remarks
  }));
  const countBy = (key: "rackZone" | "status" | "cabinetSize" | "deviceType") => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const value = record[key] ?? "(blank)";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ [key]: value, count })) as Array<{ [key: string]: string | number }>;
  };
  const toRows = (key: "rackZone" | "status" | "cabinetSize" | "deviceType") => countBy(key).map(item => ({ [key]: item[key], count: item.count })) as Array<{ zone?: string; status?: string; cabinetSize?: string; deviceType?: string; count: number }>;
  return {
    sourceSheet: "Rack Capacity",
    sourceTable: "Postgres rack_capacity_records",
    sourceSnapshot: snapshot.month,
    records,
    byZone: toRows("rackZone").map(item => ({ zone: item.zone ?? "(blank)", count: item.count })),
    byStatus: toRows("status").map(item => ({ status: item.status ?? "(blank)", count: item.count })),
    byCabinetSize: toRows("cabinetSize").map(item => ({ cabinetSize: item.cabinetSize ?? "(blank)", count: item.count })),
    byDeviceType: toRows("deviceType").map(item => ({ deviceType: item.deviceType ?? "(blank)", count: item.count })),
    validation: { duplicateIds: [], missingRequiredFields: [], invalidStatuses: [], invalidDataTypes: [], unsupportedUMetrics: [] }
  };
}

function topologyFor(log: MonthlyLog): DashboardUpsTopology | null {
  const groups = log.energyCalculation?.upsGroups ?? [];
  if (!groups.length) return null;
  return {
    upsGroups: groups.map((ids, index) => ({ name: ids[0] ?? `UPS Group ${index + 1}`, ids, capacity: null })),
    upsMapping: []
  };
}

function comparisonFacility(site: SiteRecord, rows: readonly ReportMonthlyRow[], month: string) {
  const row = rows.find(item => item.month === month) ?? null;
  return {
    label: site.name,
    month: row?.month ?? null,
    buildingEnergyKwh: row?.buildingEnergyKwh ?? null,
    buildingCostThb: row?.buildingCostThb ?? null,
    floorEnergyKwh: row?.floorEnergyKwh ?? null,
    floorCostThb: row?.floorCostThb ?? null,
    averageRateThbPerKwh: row?.averageRateThbPerKwh ?? null,
    floorSharePercent: row?.floorSharePercent ?? null
  };
}

function validateReportMonth(value: unknown): string {
  try { return assertStrictMonth(value, "month"); }
  catch (error) { throw new HttpError(400, "INVALID_MONTH", error instanceof Error ? error.message : "month must use YYYY-MM format."); }
}

export interface ReportBuildOptions {
  period?: "current" | "single" | "range" | "history";
  from?: unknown;
  to?: unknown;
  sections?: readonly ReportRenderSection[];
}

/**
 * Web report adapter. It deliberately feeds the Desktop report renderer with
 * Postgres-backed data; report formulas remain owned by the shared domain
 * layer and are not reimplemented in the browser.
 */
export class ReportService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date(), private readonly imageStorage?: ObjectStorage) {}

  private async requireSettings(): Promise<DisplayPeriod> {
    const settings = await this.repository.getGlobalSettings();
    if (!settings) throw new HttpError(503, "DISPLAY_PERIOD_NOT_CONFIGURED", "Global Display Period has not been configured.");
    return settings;
  }

  private async requireSite(siteId: number): Promise<SiteRecord> {
    const site = await this.repository.getSite(siteId);
    if (!site || !site.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    return site;
  }

  async buildAllReport(siteId: number, monthInput: unknown, options: ReportBuildOptions = {}): Promise<{ filename: string; month: string; facility: string; formulaVersion: string; status: ReportData["status"]; historicalStart: string | null; historicalEnd: string | null; html: string }> {
    const [site, period] = await Promise.all([this.requireSite(siteId), this.requireSettings()]);
    const periods = await this.repository.listPeriods(siteId);
    const availableMonths = periods.filter(item => item.hasData && item.month <= `${this.now().getUTCFullYear()}-${String(this.now().getUTCMonth() + 1).padStart(2, "0")}`).map(item => item.month).filter(month => isAllowedMonth(month, period));
    const latest = [...availableMonths].sort().at(-1);
    const reportPeriod = options.period ?? "current";
    const monthFrom = reportPeriod === "range" ? validateReportMonth(options.from) : null;
    const requestedTo = reportPeriod === "range" ? validateReportMonth(options.to) : null;
    if (monthFrom && requestedTo && monthFrom > requestedTo) throw new HttpError(400, "INVALID_REPORT_RANGE", "Report range must end on or after its start month.");
    const requestedMonth = reportPeriod === "history" ? latest : reportPeriod === "range" ? requestedTo : (monthInput === undefined || monthInput === null || monthInput === "" ? latest : validateReportMonth(monthInput));
    const month = requestedMonth;
    if (!month || !isAllowedMonth(month, period)) throw new HttpError(404, "MONTH_OUTSIDE_DISPLAY_PERIOD", "The requested month is outside the Global Display Period.");
    if (!availableMonths.includes(month)) throw new HttpError(404, "MONTH_NOT_AVAILABLE", "The requested month is not available yet or has no data.");

    const logs = (await this.repository.getMonthlyLogs(siteId, availableMonths)).sort((a, b) => a.month.localeCompare(b.month));
    const current = logs.find(log => log.month === month);
    if (!current) throw new HttpError(404, "MONTH_NOT_AVAILABLE", "The requested month has no monthly data.");
    const allRows = logs.map(log => monthlyRow(logs, log));
    // Desktop reportDataBuilder limits the historical table/trend to the
    // selected month and the preceding eleven available rows.
    const rows = reportPeriod === "history"
      ? allRows.filter(row => row.month <= month)
      : reportPeriod === "range"
        ? allRows.filter(row => row.month >= monthFrom! && row.month <= month!)
        : allRows.filter(row => row.month <= month).slice(-12);
    const engineeringDashboard = buildEngineeringDashboardSnapshot(logs, month, null, topologyFor(current));
    const rackSnapshot = await this.repository.getRackSnapshot(siteId, month);
    const rackUnitSnapshots = await this.repository.listRackUnitSnapshots(siteId);
    const rack = rackReport(rackSnapshot);
    const rackHistory = await this.repository.getRackCapacityHistory(siteId);
    const imageRecord = await this.repository.getRackUnitImage(siteId, month);
    let rackUnitCapacityImageDataUri: string | null = null;
    let rackUnitCapacityImageMeta: ReportData["rackUnitCapacityImageMeta"] = null;
    if (imageRecord && this.imageStorage) {
      const imageBytes = await this.imageStorage.get(imageRecord.objectKey);
      const hash = createHash("sha256").update(imageBytes).digest("hex");
      if (hash !== imageRecord.sha256 || imageBytes.length !== imageRecord.byteSize) throw new HttpError(503, "RACK_UNIT_IMAGE_INTEGRITY_FAILED", "The Rack Unit Capacity image failed its stored integrity check.");
      rackUnitCapacityImageDataUri = `data:${imageRecord.contentType};base64,${imageBytes.toString("base64")}`;
      rackUnitCapacityImageMeta = { savedAt: imageRecord.savedAt, savedBy: imageRecord.savedBy, width: imageRecord.width, height: imageRecord.height };
    }

    const allSites = (await this.repository.listSites()).filter(item => item.active);
    const otherSite = allSites.find(item => item.id !== siteId);
    let other: ReturnType<typeof comparisonFacility> | null = null;
    let otherRows: ReportMonthlyRow[] = [];
    let otherRack: RackCapacityReport | null = null;
    if (otherSite) {
      const otherPeriods = await this.repository.listPeriods(otherSite.id);
      const otherMonths = otherPeriods.filter(item => item.hasData && item.month <= month && isAllowedMonth(item.month, period)).map(item => item.month);
      const otherLogs = (await this.repository.getMonthlyLogs(otherSite.id, otherMonths)).sort((a, b) => a.month.localeCompare(b.month));
      const otherRowsAll = otherLogs.map(log => monthlyRow(otherLogs, log));
      otherRows = reportPeriod === "history"
        ? otherRowsAll
        : reportPeriod === "range"
          ? otherRowsAll.filter(row => row.month >= monthFrom! && row.month <= month!)
          : otherRowsAll.slice(-12);
      other = comparisonFacility(otherSite, otherRows, month);
      otherRack = rackReport(await this.repository.getRackSnapshot(otherSite.id, month));
    }

    const data: ReportData = {
      title: "Data Center Energy & Facility Monitor",
      thaiSubtitle: "รายงานสถานะประจำเดือน",
      facility: site.name,
      sourceWorkbook: "PostgreSQL migrated dataset",
      generatedAt: new Date().toISOString(),
      appVersion: "2.3.1",
      reportingMonth: month,
      historicalStart: rows[0]?.month ?? null,
      historicalEnd: rows.at(-1)?.month ?? null,
      status: reportStatus(rows),
      validationWarnings: [],
      monthlyRows: rows,
      currentRow: rows.find(row => row.month === month) ?? null,
      engineeringDashboard,
      rack,
      rackHistory,
      rackUnitCapacity: rackUnitSnapshots.map(snapshot => ({ month: snapshot.month, totalU: snapshot.totalU, usedU: snapshot.usedU, availableU: snapshot.totalU - snapshot.usedU, availabilityPct: snapshot.totalU > 0 ? (snapshot.totalU - snapshot.usedU) / snapshot.totalU : null })),
      rackUnitCapacityImageDataUri,
      rackUnitCapacityImageMeta,
      comparison: {
        self: comparisonFacility(site, rows, month),
        other,
        selfTrend: rows.slice(-12),
        otherTrend: otherRows.slice(-12)
      },
      rackComparison: rack ? { self: { label: site.name, records: rack.records }, other: otherRack ? { label: otherSite?.name ?? "Other site", records: otherRack.records } : null } : null
    };
    return { filename: `DC_Status_MonthlyReport of ${site.code}_${monthLabel(month)}`, month, facility: site.name, formulaVersion: DESKTOP_FORMULA_VERSION, status: data.status, historicalStart: data.historicalStart, historicalEnd: data.historicalEnd, html: buildReportHtml(data, { sections: options.sections }) };
  }
}
