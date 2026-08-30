import type { MonthlyLog } from "../types";
import { buildCombinedCsv } from "../utils/exportData";
import { calculateEnergyCostForMonth } from "../domain/energyCost";
import { calculateRackCapacityMetrics, rackPositionExportRows } from "../domain/rackCapacity";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { ReportData, ReportMonthlyRow, RackCapacityReport, RackRecord, UpsGroupHistoryReport } from "../reports/reportTypes";
import { RACK_UNIT_CAPACITY_TREND_NOTE } from "../reports/reportTypes";
import { deriveRackCapacityReport } from "../reports/rackCapacityReportBuilder";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import type { DashboardUpsMappingReport } from "../reports/reportTypes";
import { buildDashboardUpsMapping } from "./dashboardUpsMapping";
import { getDesktopDashboardMapping } from "../domain/dashboardMapping";
import type { ReportSectionId } from "../reporting/reportingTypes";
import { addInteractiveDashboard, injectInteractiveDashboardCharts, type ExcelDashboardMetric, type ExcelDashboardPlan } from "./excelDashboard";

const workbookDashboardPlans = new WeakMap<object, ExcelDashboardPlan[]>();

export interface ExportRackUnitImageMetadata {
  reportingMonth: string;
  contentType: "image/png" | "image/jpeg";
  byteSize?: number;
  width?: number;
  height?: number;
  savedAt?: string | null;
}

export interface ExportRackUnitCapacityRow extends RackUnitCapacityRow {
  /** Metadata only; image bytes remain in server-side storage. */
  imageAttached?: boolean;
  imageContentType?: "image/png" | "image/jpeg" | null;
  imageSavedAt?: string | null;
}

export interface ExportFacility {
  siteName: string;
  /** Facility short code (e.g. "RST"/"rangsit"), for Excel sheet prefixes and
   *  the Site code column. Falls back to a slug of `siteName` when absent. */
  siteCode?: string;
  logs: MonthlyLog[];
  /** Full history used as calculation context when `logs` is a filtered report scope. */
  calculationLogs?: MonthlyLog[];
  rack?: RackCapacityReport | null;
  rackHistory?: RackCapacityHistoryRow[];
  rackUnitCapacity?: ExportRackUnitCapacityRow[];
  upsGroupHistory?: UpsGroupHistoryReport | null;
  dashboardMapping?: DashboardUpsMappingReport | null;
  /** The selected month's image loaded from the authenticated Storage API. */
  rackUnitCapacityImageDataUri?: string | null;
  rackUnitCapacityImageMeta?: ReportData["rackUnitCapacityImageMeta"];
  /** Retains discovered image metadata even when a legacy source has no
   * matching Rack Unit numeric row; bytes and storage keys are never exported. */
  rackUnitCapacityImages?: ExportRackUnitImageMetadata[];
  /** Explicit report scope for secondary tables when the selected month has
   * no MonthlyLog (for example a Rack Unit-only historical month). */
  reportingMonths?: string[];
}

export interface ReportDataExtras {
  /** Persisted Dashboard-FAC group status for the selected month. */
  upsGroupHistory?: UpsGroupHistoryReport | null;
  /** Desktop Dashboard-FAC hardware mapping, when available. */
  dashboardMapping?: DashboardUpsMappingReport | null;
  /** Authenticated web image bytes, already converted to a data URI. */
  rackUnitCapacityImageDataUri?: string | null;
  rackUnitCapacityImageMeta?: ReportData["rackUnitCapacityImageMeta"];
}

/** The GET /racks API response shape (server/services/apiService.ts's
 *  getRacks) - a local mirror, not an import from server/ code, matching
 *  this file's existing convention (no server-type imports into the
 *  frontend bundle). source_row_number can be null on a real row (it is
 *  optional metadata, never authoritative data); RackRecord.rowNumber is
 *  non-nullable, so a missing value falls back to the row's position in
 *  the snapshot (1-based) - the shared PDF renderer never reads
 *  rowNumber for a calculation, only for display, so this is a safe,
 *  honest ordinal, never fabricated data. */
export interface RackSnapshotApiRecord { rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }
export interface RackSnapshotApiResponse { siteId: number; month: string; snapshot: { month: string; rowVersion: number; records: RackSnapshotApiRecord[] } | null }

/** Reuses the same grouping/validation rules Desktop's Excel-based rack
 *  reader uses (deriveRackCapacityReport, extracted from
 *  rackCapacityReader.ts specifically so this file never needs to import
 *  ExcelJS) - never a second, Web-only rack calculation. */
export function rackReportFromSnapshot(response: RackSnapshotApiResponse | null): RackCapacityReport | null {
  const snapshot = response?.snapshot;
  if (!snapshot || snapshot.records.length === 0) return null;
  const records: RackRecord[] = snapshot.records.map((record, index) => ({ ...record, rowNumber: record.rowNumber ?? index + 1 }));
  return deriveRackCapacityReport(records, "Rack Capacity", "Table7", snapshot.month, []);
}

export interface ComparisonMetric {
  buildingEnergy: number | null;
  buildingCost: number | null;
  floorEnergy: number | null;
  floorCost: number | null;
  avgRate: number | null;
  floorShare: number | null;
}

export interface ComparisonSite {
  site: { id: number; code: string; name: string };
  months: Array<{ month: string; metrics: ComparisonMetric | null }>;
}

export interface SiteComparisonExport {
  displayPeriod: { startMonth: string; endMonth: string };
  months: string[];
  sites: Array<ComparisonSite & {
    rack?: RackCapacityReport | null;
    rackUnitCapacity?: Array<{ month: string; totalU: number; usedU: number; availableU: number; usagePercent?: number | null; availabilityPct?: number | null; imageAttached?: boolean; imageContentType?: "image/png" | "image/jpeg" | null; imageSavedAt?: string | null }>;
  }>;
}

export interface SiteComparisonReportSite {
  label: string;
  siteCode: string;
  metrics: ComparisonMetric | null;
  metricsByMonth: Record<string, ComparisonMetric | null>;
  rack: RackCapacityReport | null;
  rackUnit: Array<{ month: string; totalU: number; usedU: number; availableU: number;
                    usagePercent: number | null; availabilityPct: number | null }>;
}
export interface SiteComparisonReportModel {
  referenceMonth: string;
  months: string[];
  sites: SiteComparisonReportSite[];
}

/** The single N-site comparison shape consumed identically by the HTML/PDF
 *  renderer, the Excel `90`/`91` sheet builders, and the CSV section builder.
 *  Built once from the `/site-comparison` DTO (already Global-Display-Period
 *  scoped). No value is ever fabricated: a month a site has no metrics for
 *  stays `null`; `availabilityPct` is the persisted ratio or `availableU/totalU`,
 *  never a filled zero. */
export function buildSiteComparisonReportModel(
  data: SiteComparisonExport,
  referenceMonth: string,
): SiteComparisonReportModel {
  const months = [...data.months].filter(m => m <= referenceMonth).sort();
  const sites: SiteComparisonReportSite[] = data.sites.map(site => {
    const byMonth: Record<string, ComparisonMetric | null> = {};
    for (const m of months) {
      byMonth[m] = site.months.find(entry => entry.month === m)?.metrics ?? null;
    }
    const rackUnit = (site.rackUnitCapacity ?? []).map(row => ({
      month: row.month,
      totalU: row.totalU,
      usedU: row.usedU,
      availableU: row.availableU,
      usagePercent: row.usagePercent ?? (row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null),
      availabilityPct: row.availabilityPct ?? (row.totalU > 0 ? row.availableU / row.totalU : null),
    }));
    return {
      label: site.site.name,
      siteCode: site.site.code,
      metrics: byMonth[referenceMonth] ?? null,
      metricsByMonth: byMonth,
      rack: (site as { rack?: RackCapacityReport | null }).rack ?? null,
      rackUnit,
    };
  });
  return { referenceMonth, months, sites };
}

function download(content: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Chromium may not have consumed the object URL at the instant click()
  // returns. Keep it alive for one task so downloads are not intermittently
  // reported as started while producing a zero-byte file.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(logs: MonthlyLog[], siteName: string, fileName?: string, additional: ExportAdditional = {}): void {
  download(buildFacilityCsv({ siteName, logs, ...additional }), fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.csv`, "text/csv;charset=utf-8");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { fields.push(current); current = ""; }
    else current += character;
  }
  fields.push(current);
  return fields;
}

function sheetName(prefix: string, name: string): string {
  const title = name.replace(".csv", "").replace(/[\\/*?:\[\]]/g, "-");
  const prefixLength = Math.max(1, 31 - title.length - 1);
  return `${prefix.slice(0, prefixLength)}-${title}`.slice(0, 31);
}

function configureTableSheet(sheet: any, headers: unknown[], rows: unknown[][]): void {
  sheet.addRow(headers);
  rows.forEach(values => sheet.addRow(values));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: Math.max(1, sheet.rowCount), column: Math.max(1, sheet.getRow(1).cellCount) } };
  sheet.columns.forEach((column: any) => { column.width = 22; });
  sheet.columns.forEach((column: any, index: number) => {
    if (String(headers[index]).includes("JSON")) column.width = 48;
  });
}

function addTableSheet(workbook: any, prefix: string, title: string, headers: unknown[], rows: unknown[][]): any {
  const sheet = workbook.addWorksheet(sheetName(prefix, title));
  configureTableSheet(sheet, headers, rows);
  return sheet;
}

function monthSet(logs: MonthlyLog[]): Set<string> {
  return new Set(logs.map(log => log.month));
}

function fallbackDashboardMapping(siteName: string): DashboardUpsMappingReport | null {
  const normalized = siteName.trim().toLowerCase();
  const siteCode = normalized.includes("srinakarin") ? "srinakarin" : normalized.includes("rangsit") ? "rangsit" : "";
  if (!siteCode) return null;
  return { sourceSheet: "Dashboard-FAC", summary: [], mapping: getDesktopDashboardMapping(siteCode) };
}

interface ExcelDashboardModel {
  metrics: ExcelDashboardMetric[];
  dashboardRows: unknown[][];
  dashboardUpsRows: unknown[][];
  dashboardDetailRows: unknown[][];
  dashboardAirRows: unknown[][];
  dashboardDcRows: unknown[][];
}

function buildExcelDashboardModel(logs: MonthlyLog[], calculationLogs: MonthlyLog[], facility: ExportFacility): ExcelDashboardModel {
  const metrics: ExcelDashboardMetric[] = [];
  const dashboardRows: unknown[][] = [];
  const dashboardUpsRows: unknown[][] = [];
  const dashboardDetailRows: unknown[][] = [];
  const dashboardAirRows: unknown[][] = [];
  const dashboardDcRows: unknown[][] = [];
  for (const log of logs) {
    const mapping = buildDashboardUpsMapping(facility.upsGroupHistory ?? null, log.month, facility.dashboardMapping?.mapping ?? fallbackDashboardMapping(facility.siteName)?.mapping ?? []);
    const dashboard = buildEngineeringDashboardSnapshot(calculationLogs, log.month, mapping);
    const calculated = calculateEnergyCostForMonth(calculationLogs, log.month);
    const rackUnit = facility.rackUnitCapacity?.find(row => row.month === log.month) ?? null;
    const upsGroups = dashboard?.upsGroups ?? [];
    const upsCapacity = upsGroups.reduce((sum, row) => sum + (row.capacity ?? 0), 0);
    const upsLoadKva = upsGroups.reduce((sum, row) => sum + row.totalKva, 0);
    const upsLoadPercent = upsCapacity > 0 ? (upsLoadKva / upsCapacity) * 100 : null;
    const buildingEnergyKwh = dashboard?.buildingEnergyKwh ?? calculated.buildingEnergyKwh;
    const buildingCostThb = dashboard?.buildingCostThb ?? calculated.buildingElectricityCostThb;
    const floorEnergyKwh = dashboard?.floorEnergyKwh ?? calculated.floorEnergyKwh;
    const floorCostThb = dashboard?.floorCostThb ?? calculated.floorElectricityCostThb;
    const floorSharePercent = dashboard?.floorSharePercent ?? calculated.energySharePercent;
    metrics.push({
      month: log.month,
      buildingEnergyKwh,
      buildingCostThb,
      floorEnergyKwh,
      floorCostThb,
      floorSharePercent,
      upsEnergyKwh: dashboard?.totalUpsEnergyKwh ?? calculated.upsEnergyKwh,
      airEnergyKwh: dashboard?.airEnergyKwh ?? calculated.airEnergyKwh,
      dcEnergyKwh: dashboard?.totalDcEnergyKwh ?? calculated.dcEnergyKwh,
      upsLoadKw: dashboard?.totalUpsKw ?? null,
      upsLoadPercent,
      rackTotalU: rackUnit?.totalU ?? null,
      rackUsedU: rackUnit?.usedU ?? null,
      rackAvailableU: rackUnit?.availableU ?? null,
      rackUsagePercent: rackUnit && rackUnit.totalU > 0 ? (rackUnit.usedU / rackUnit.totalU) * 100 : null
    });
    dashboardRows.push([
      log.month,
      dashboard?.daysInMonth ?? null,
      dashboard?.previousMonth ?? null,
      dashboard?.totalUpsKw ?? null,
      dashboard?.totalUpsKva ?? null,
      dashboard?.totalUpsEnergyKwh ?? null,
      dashboard?.airEnergyKwh ?? null,
      dashboard?.totalDcEnergyKwh ?? null,
      buildingEnergyKwh,
      buildingCostThb,
      floorEnergyKwh,
      floorCostThb,
      dashboard?.averageRateThbPerKwh ?? calculated.averageElectricityRateThbPerKwh,
      floorSharePercent,
      floorEnergyKwh === null || !dashboard ? "Partial" : "Complete",
      rackUnit?.totalU ?? null,
      rackUnit?.usedU ?? null,
      rackUnit?.availableU ?? null,
      rackUnit?.availabilityPct ?? null
    ]);
    for (const row of [...(dashboard?.upsGroups ?? []), ...(dashboard?.upsOverallGroups ?? [])]) dashboardUpsRows.push([log.month, row.name, row.totalKw, row.totalKva, row.capacity, row.loadPercent, row.availablePercent, row.monthlyEnergyKwh]);
    for (const row of dashboard?.upsDetails ?? []) dashboardDetailRows.push([log.month, row.no, row.umdb, row.upsId, row.acPowerPanel, row.sts, row.oudb, row.voltage, row.current, row.loadKw, row.loadKva, row.capacity, row.loadPercent]);
    for (const field of dashboard?.airFields ?? []) dashboardAirRows.push([log.month, field, dashboard.airPrevious[field], dashboard.airCurrent[field], dashboard.airDifference[field]]);
    for (const row of dashboard?.dcPanels ?? []) dashboardDcRows.push([log.month, row.panelId, row.voltage, row.current, row.dcPowerW, row.acCurrentA, row.acPowerW, row.monthlyEnergyKwh]);
  }
  return { metrics, dashboardRows, dashboardUpsRows, dashboardDetailRows, dashboardAirRows, dashboardDcRows };
}

/**
 * Builds a workbook from the same DTOs used by the Web screens.  The old
 * implementation exported only four compact CSV-like sheets, which silently
 * omitted save metadata, persisted history, Rack Unit Capacity, and the
 * Dashboard-FAC calculation tables.  These sheets intentionally separate
 * facts, persisted/audit state, and derived values so an export can be
 * reconciled back to the source instead of looking complete while losing
 * information.
 */
export async function workbookForFacilities(facilities: ExportFacility[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const dashboardPlans: ExcelDashboardPlan[] = [];
  for (const facility of facilities) {
    const prefix = facility.siteName.replace(/[^a-z0-9]+/giu, "-").slice(0, 10) || "facility";
    const logs = [...facility.logs].sort((a, b) => a.month.localeCompare(b.month));
    const calculationLogs = [...(facility.calculationLogs ?? logs)].sort((a, b) => a.month.localeCompare(b.month));
    const months = new Set(facility.reportingMonths ?? [
      ...logs.map(log => log.month),
      ...(facility.rackUnitCapacity ?? []).map(row => row.month),
      ...(facility.rackHistory ?? []).map(row => row.snapshotMonth),
      ...(facility.upsGroupHistory?.rows ?? []).map(row => row.month)
    ]);
    const airFields = [...new Set(logs.flatMap(log => Object.keys(log.air.meters ?? {}).concat(["eb41a", "eb41b", "eb42a", "eb42b"])))].sort();

    const dashboardModel = buildExcelDashboardModel(logs, calculationLogs, facility);
    dashboardPlans.push(addInteractiveDashboard(workbook, prefix, facility.siteName, dashboardModel.metrics));

    addTableSheet(workbook, prefix, "UPS_Loads", ["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Raw phases JSON", "Last Saved"], logs.flatMap(log => log.ups.map(row => [log.month, row.upsId, row.voltage, row.current, row.loadKw, row.loadKva, JSON.stringify(row.phases ?? {}), log.lastSavedUps])));
    addTableSheet(workbook, prefix, "Air_Inputs", ["Month", ...airFields.map(field => `${field.toUpperCase()} (GWh)`), "Raw meters JSON", "Last Saved"], logs.map(log => [log.month, ...airFields.map(field => (log.air as unknown as Record<string, number | null | undefined>)[field] ?? log.air.meters?.[field] ?? null), JSON.stringify(log.air.meters ?? {}), log.lastSavedAir]));
    addTableSheet(workbook, prefix, "DC_Inputs", ["Month", "DC Panel", "Voltage (V)", "Current (A)", "Last Saved"], logs.flatMap(log => log.dc.map(row => [log.month, row.panelId, row.voltage, row.current, log.lastSavedDc])));
    addTableSheet(workbook, prefix, "Energy_Cost_Inputs", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "Stored Floor Cost (THB)", "Stored Average Rate (THB/kWh)", "Last Saved"], logs.map(log => [log.month, log.energyCost.buildingEnergyKwh, log.energyCost.buildingElectricityCostThb, log.energyCost.floorElectricityCostThb ?? null, log.energyCost.averageElectricityRateThbPerKwh ?? null, log.lastSavedEnergyCost]));
    const logsByMonth = new Map(logs.map(log => [log.month, log]));
    addTableSheet(workbook, prefix, "Saved_Records", ["Month", "UPS Last Saved", "Air Last Saved", "DC Last Saved", "Energy Cost Last Saved", "Source State"], [...months].sort().map(month => {
      const log = logsByMonth.get(month);
      return [month, log?.lastSavedUps ?? null, log?.lastSavedAir ?? null, log?.lastSavedDc ?? null, log?.lastSavedEnergyCost ?? null, log ? "persisted monthly log" : "persisted Rack Unit-only row"];
    }));
    addTableSheet(workbook, prefix, "Saved_Values", ["Month", "UPS Saved JSON", "Air Saved JSON", "DC Saved JSON", "Energy Cost Saved JSON", "Rack Unit Saved JSON", "Rack Unit Image JSON", "UPS Last Saved", "Air Last Saved", "DC Last Saved", "Energy Cost Last Saved"], [...months].sort().map(month => {
      const log = logsByMonth.get(month);
      const rackUnit = facility.rackUnitCapacity?.find(row => row.month === month) ?? null;
      const image = rackUnit?.imageAttached ? { attached: true, contentType: rackUnit.imageContentType ?? null, savedAt: rackUnit.imageSavedAt ?? null } : null;
      return [month, JSON.stringify(log?.ups ?? null), JSON.stringify(log?.air ?? null), JSON.stringify(log?.dc ?? null), JSON.stringify(log?.energyCost ?? null), JSON.stringify(rackUnit), JSON.stringify(image), log?.lastSavedUps ?? null, log?.lastSavedAir ?? null, log?.lastSavedDc ?? null, log?.lastSavedEnergyCost ?? null];
    }));
    addTableSheet(workbook, prefix, "Raw_Inputs", ["Month", "Raw Phase/Panel Values JSON"], logs.filter(log => log.srinakarinInputs).map(log => [log.month, JSON.stringify(log.srinakarinInputs)]));

    const calculated = logs.map(log => {
      const value = calculateEnergyCostForMonth(calculationLogs, log.month);
      return [log.month, value.buildingEnergyKwh, value.buildingElectricityCostThb, value.upsEnergyKwh, value.airEnergyKwh, value.dcEnergyKwh, value.floorEnergyKwh, value.floorElectricityCostThb, value.averageElectricityRateThbPerKwh, value.energySharePercent, value.floorEnergyKwh === null ? "Partial" : "Complete"];
    });
    addTableSheet(workbook, prefix, "Calculated_Energy", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "Floor Energy (kWh)", "Floor Cost (THB)", "Average Rate (THB/kWh)", "Floor Share (%)", "Status"], calculated);

    const { dashboardRows, dashboardUpsRows, dashboardDetailRows, dashboardAirRows, dashboardDcRows } = dashboardModel;
    addTableSheet(workbook, prefix, "Dashboard-FAC", ["Month", "Days", "Previous Month", "UPS Total kW", "UPS Total kVA", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "Building Energy (kWh)", "Building Cost (THB)", "Floor Energy (kWh)", "Floor Cost (THB)", "Average Rate (THB/kWh)", "Floor Share (%)", "Status", "Rack Total (U)", "Rack Used (U)", "Rack Available (U)", "Rack Availability (%)"], dashboardRows);
    addTableSheet(workbook, prefix, "Dashboard-FAC UPS", ["Month", "Group", "Total Load (kW)", "Total Load (kVA)", "Capacity", "Load (%)", "Available (%)", "Monthly Energy (kWh)"], dashboardUpsRows);
    addTableSheet(workbook, prefix, "Dashboard-FAC Details", ["Month", "No", "UMDB", "UPS ID", "AC Power Panel", "STS", "OUDB", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Capacity", "Load (%)"], dashboardDetailRows);
    addTableSheet(workbook, prefix, "Dashboard-FAC Air", ["Month", "Field", "Previous", "Current", "Difference"], dashboardAirRows);
    addTableSheet(workbook, prefix, "Dashboard-FAC DC", ["Month", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current (A)", "AC Power (W)", "Monthly Energy (kWh)"], dashboardDcRows);

    const rackUnitRows = (facility.rackUnitCapacity ?? []).filter(row => months.has(row.month)).sort((a, b) => a.month.localeCompare(b.month));
    const rackUnitSheet = addTableSheet(workbook, prefix, "Rack Unit Capacity", ["Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Attached", "Image Content Type", "Image Saved At"], rackUnitRows.map(row => [row.month, row.totalU, row.usedU, row.availableU, row.totalU > 0 ? row.usedU / row.totalU : null, row.availabilityPct, row.imageAttached ? "Yes" : "No", row.imageContentType ?? null, row.imageSavedAt ?? null]));
    rackUnitSheet.getColumn(5).numFmt = "0.0%";
    rackUnitSheet.getColumn(6).numFmt = "0.0%";
    const rackHistoryRows = (facility.rackHistory ?? []).filter(row => months.has(row.snapshotMonth)).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth) || a.rackZone.localeCompare(b.rackZone));
    addTableSheet(workbook, prefix, "Rack Capacity History", ["Snapshot Month", "Facility", "Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle", "Other", "Usage (%)", "Availability (%)", "Reserved (%)", "Pending Dismantle (%)", "Other (%)", "Generated At", "Data Version"], rackHistoryRows.map(row => [row.snapshotMonth, row.facility, row.rackZone, row.totalRacks, row.inUse, row.available, row.reserved, row.pendingDismantle, row.other, row.usagePct, row.availabilityPct, row.reservedPct, row.pendingDismantlePct, row.otherPct, row.generatedAt, row.dataVersion]));
    const upsHistoryRows = (facility.upsGroupHistory?.rows ?? []).filter(row => months.has(row.month)).sort((a, b) => a.month.localeCompare(b.month) || a.group.localeCompare(b.group));
    addTableSheet(workbook, prefix, "UPS Group History", ["Month", "Facility", "Group", "Total Load (kW)", "Total Load (kVA)", "Capacity", "Load (%)", "Available (%)", "Monthly Energy (kWh)", "Generated At", "Data Version"], upsHistoryRows.map(row => [row.month, row.facility, row.group, row.totalLoadKw, row.totalLoadKva, row.capacity, row.loadPercent, row.availablePercent, row.monthlyEnergyKwh, row.generatedAt, row.dataVersion]));
    const rackRecords = facility.rack?.records ?? [];
    addTableSheet(workbook, prefix, "Rack Capacity Raw", ["Snapshot Month", "Row", "Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"], rackRecords.map(row => [facility.rack?.sourceSnapshot ?? null, row.rowNumber, row.rackZone, row.rackId, row.status, row.cabinetSize, row.detail, row.deviceType, row.remarks]));
    for (const section of facilityExportSections(facility)) {
      const sheet = addTableSheet(workbook, prefix, section.name, section.headers, section.rows);
      section.headers.forEach((header, index) => {
        if (String(header).includes("Usage (%)") || String(header).includes("Availability (%)")) sheet.getColumn(index + 1).numFmt = "0.0%";
      });
    }
  }
  workbookDashboardPlans.set(workbook, dashboardPlans);
  return workbook;
}

type ExportAdditional = Omit<ExportFacility, "siteName" | "logs">;

/** Serializes the workbook and adds native OOXML charts to each interactive
 * Dashboard sheet. Formula cells are recalculated by Excel when the file is
 * opened, while cached values keep the default/latest month immediately
 * visible in viewers that do not calculate formulas themselves. */
export async function writeInteractiveExcelWorkbook(workbook: any): Promise<Uint8Array> {
  workbook.calcProperties.fullCalcOnLoad = true;
  const buffer = await workbook.xlsx.writeBuffer();
  return injectInteractiveDashboardCharts(buffer, workbookDashboardPlans.get(workbook) ?? []);
}


export interface ExportTableSection {
  name: string;
  headers: string[];
  rows: unknown[][];
}

function exportRatio(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function exportRackUnitUsage(row: { totalU: number; usedU: number }): number | null {
  return row.totalU > 0 ? row.usedU / row.totalU : null;
}

function exportRackUnitRows(facility: ExportFacility): unknown[][] {
  return [...(facility.rackUnitCapacity ?? [])]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map(row => [
      facility.siteName,
      row.month,
      row.totalU,
      row.usedU,
      row.availableU,
      exportRackUnitUsage(row),
      exportRatio(row.availabilityPct),
      row.imageAttached ? "Yes" : "No",
      row.imageContentType ?? null,
      row.imageSavedAt ?? null
    ]);
}

function exportRackUnitTrendRows(facility: ExportFacility): unknown[][] {
  const allRows = [...(facility.rackUnitCapacity ?? [])].sort((left, right) => left.month.localeCompare(right.month));
  const endMonth = facility.rack?.sourceSnapshot ?? allRows.at(-1)?.month ?? null;
  return allRows
    .filter(row => !endMonth || row.month <= endMonth)
    .slice(-6)
    .map(row => [
      facility.siteName,
      row.month,
      row.totalU,
      row.usedU,
      row.availableU,
      exportRackUnitUsage(row),
      exportRatio(row.availabilityPct)
    ]);
}

const NO_RACK_POSITIONS_MESSAGE = "No Available, Reserved, or Pending Decommission rack positions in the confirmed snapshot.";

/** One RACK_POSITIONS table row per deployable/exception position, using the
 *  canonical `rackPositionExportRows` contract (Available/Reserved/Pending
 *  Decommission only - never "In Use"). */
function rackPositionSectionRows(siteName: string, sourceMonth: string | null, records: readonly RackRecord[]): unknown[][] {
  return rackPositionExportRows(records).map(row => [siteName, sourceMonth, row.status, row.rackId, row.cabinetSize, row.detail]);
}

function exportRackPositionRows(facility: ExportFacility): unknown[][] {
  return rackPositionSectionRows(facility.siteName, facility.rack?.sourceSnapshot ?? null, facility.rack?.records ?? []);
}

/** Explicit no-data row for a confirmed snapshot that holds no deployable
 *  positions. A month with no confirmed snapshot at all emits no rack sections
 *  (the caller never reaches here), so this never masks a stale fallback. */
function noRackPositionRow(facility: ExportFacility): unknown[] {
  return [facility.siteName, facility.rack?.sourceSnapshot ?? null, "NO_DATA", null, null, NO_RACK_POSITIONS_MESSAGE];
}

export function facilityExportSections(facility: ExportFacility): ExportTableSection[] {
  const sections: ExportTableSection[] = [];
  if (facility.rack) {
    const metrics = calculateRackCapacityMetrics(facility.rack.records);
    const sourceMonth = facility.rack.sourceSnapshot;
    sections.push({
      name: "RACK_CAPACITY_SUMMARY",
      headers: ["Site", "Snapshot Month", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other", "Usage (%)", "Availability (%)"],
      rows: [[
        facility.siteName,
        sourceMonth,
        metrics.total,
        metrics.inUse.count,
        metrics.available.count,
        metrics.reserved.count,
        metrics.pendingDismantle.count,
        metrics.other.count,
        exportRatio(metrics.total > 0 ? metrics.inUse.count / metrics.total : null),
        exportRatio(metrics.total > 0 ? metrics.available.count / metrics.total : null)
      ]]
    });
    sections.push({
      name: "RACK_CAPACITY_DETAILS",
      headers: ["Site", "Snapshot Month", "Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other"],
      rows: metrics.zoneMetrics.map(zone => [
        facility.siteName,
        sourceMonth,
        zone.zone,
        zone.total,
        zone.inUse.count,
        zone.available.count,
        zone.reserved.count,
        zone.pendingDismantle.count,
        zone.other.count
      ])
    });
    const rackPositionRows = exportRackPositionRows(facility);
    sections.push({
      name: "RACK_POSITIONS",
      headers: ["Site", "Snapshot Month", "Status", "Rack ID", "Cabinet Size (cm)", "Detail"],
      rows: rackPositionRows.length > 0 ? rackPositionRows : [noRackPositionRow(facility)]
    });
  }

  if (facility.rackUnitCapacity?.length) {
    sections.push({
      name: "RACK_UNIT_CAPACITY",
      headers: ["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Attached", "Image Content Type", "Image Saved At"],
      rows: exportRackUnitRows(facility)
    });
    sections.push({
      name: "RACK_UNIT_TREND",
      headers: ["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"],
      rows: exportRackUnitTrendRows(facility)
    });
    sections.push({
      name: "RACK_UNIT_TREND_NOTE",
      headers: ["Site", "Note"],
      rows: [[facility.siteName, RACK_UNIT_CAPACITY_TREND_NOTE]]
    });
  }

  const images = [...(facility.rackUnitCapacityImages ?? [])].sort((left, right) => left.reportingMonth.localeCompare(right.reportingMonth));
  if (images.length) {
    sections.push({
      name: "RACK_UNIT_CAPACITY_IMAGES",
      headers: ["Site", "Reporting Month", "Content Type", "Byte Size", "Width", "Height", "Saved At"],
      rows: images.map(image => [facility.siteName, image.reportingMonth, image.contentType, image.byteSize ?? null, image.width ?? null, image.height ?? null, image.savedAt ?? null])
    });
  }

  return sections;
}

function csvValue(header: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (header.includes("(%)") && typeof value === "number") return `${(value * 100).toFixed(1)}%`;
  return value;
}

function csvSection(section: ExportTableSection): string {
  return [section.headers, ...section.rows]
    .map(row => row.map((value, index) => csvCell(csvValue(section.headers[index] ?? "", value))).join(","))
    .join("\n");
}

export function buildFacilityCsv(facility: ExportFacility): string {
  const sections = facilityExportSections(facility);
  const parts = [`# Facility: ${facility.siteName}`, buildCombinedCsv(facility.logs)];
  for (const section of sections) parts.push(`# Section: ${section.name}\n${csvSection(section)}`);
  return parts.join("\n\n");
}

/** Supports both the object form used by CleanWeb v1 and the positional form
 * retained by the older Web report screen.  Both forms produce the same full
 * workbook, including raw, saved, calculated, Dashboard-FAC, rack, and image
 * metadata sheets. */
export async function exportExcel(logs: MonthlyLog[], siteName: string, fileName?: string, additional?: ExportAdditional): Promise<void>;
export async function exportExcel(logs: MonthlyLog[], siteName: string, fileName?: string, calculationLogs?: MonthlyLog[], rack?: RackCapacityReport | null, rackHistory?: RackCapacityHistoryRow[], rackUnitCapacity?: ExportRackUnitCapacityRow[], upsGroupHistory?: UpsGroupHistoryReport | null, dashboardMapping?: DashboardUpsMappingReport | null): Promise<void>;
export async function exportExcel(logs: MonthlyLog[], siteName: string, fileName?: string, additionalOrCalculationLogs: ExportAdditional | MonthlyLog[] = {}, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: ExportRackUnitCapacityRow[] = [], upsGroupHistory: UpsGroupHistoryReport | null = null, dashboardMapping: DashboardUpsMappingReport | null = null): Promise<void> {
  const additional: ExportAdditional = Array.isArray(additionalOrCalculationLogs)
    ? { calculationLogs: additionalOrCalculationLogs, rack, rackHistory, rackUnitCapacity, upsGroupHistory, dashboardMapping }
    : additionalOrCalculationLogs;
  const workbook = await workbookForFacilities([{ siteName, logs, ...additional }]);
  const data = await writeInteractiveExcelWorkbook(workbook);
  download(data, fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export function buildAllFacilitiesCsv(facilities: ExportFacility[]): string {
  return facilities.map(buildFacilityCsv).join("\n\n");
}

export function exportAllFacilitiesCsv(facilities: ExportFacility[]): void {
  download(buildAllFacilitiesCsv(facilities), "all-facilities-energy-monitor.csv", "text/csv;charset=utf-8");
}

export async function exportAllFacilitiesExcel(facilities: ExportFacility[]): Promise<void> {
  const workbook = await workbookForFacilities(facilities);
  const data = await writeInteractiveExcelWorkbook(workbook);
  download(data, "all-facilities-energy-monitor.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}


function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const comparisonNumber = (value: number | null): string => value === null || !Number.isFinite(value) ? "" : value.toFixed(2);

function comparisonRackUsageRatio(row: { totalU: number; usedU: number; usagePercent?: number | null }): number | null {
  if (row.usagePercent !== null && row.usagePercent !== undefined && Number.isFinite(row.usagePercent)) return row.usagePercent / 100;
  return row.totalU > 0 ? row.usedU / row.totalU : null;
}

function comparisonRackUnitRows(site: SiteComparisonExport["sites"][number], referenceMonth: string): unknown[][] {
  return (site.rackUnitCapacity ?? [])
    .filter(row => row.month === referenceMonth)
    .map(row => [site.site.name, row.month, row.totalU, row.usedU, row.availableU, comparisonRackUsageRatio(row), exportRatio(row.availabilityPct ?? (row.totalU > 0 ? row.availableU / row.totalU : null)), row.imageAttached ? "Yes" : "No", row.imageContentType ?? null, row.imageSavedAt ?? null]);
}

function comparisonRackUnitTrendRows(site: SiteComparisonExport["sites"][number], referenceMonth: string): unknown[][] {
  return (site.rackUnitCapacity ?? [])
    .filter(row => row.month <= referenceMonth)
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-6)
    .map(row => [site.site.name, row.month, row.totalU, row.usedU, row.availableU, comparisonRackUsageRatio(row), exportRatio(row.availabilityPct ?? (row.totalU > 0 ? row.availableU / row.totalU : null))]);
}

export function siteComparisonExportSections(data: SiteComparisonExport, referenceMonth: string): ExportTableSection[] {
  const sections: ExportTableSection[] = [{
    name: "SITE_COMPARISON",
    headers: ["Facility", "Site code", "Reporting month", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"],
    rows: data.sites.map(item => {
      const metrics = item.months.find(entry => entry.month === referenceMonth)?.metrics ?? null;
      return [item.site.name, item.site.code, referenceMonth, comparisonNumber(metrics?.buildingEnergy ?? null), comparisonNumber(metrics?.buildingCost ?? null), comparisonNumber(metrics?.floorEnergy ?? null), comparisonNumber(metrics?.floorCost ?? null), comparisonNumber(metrics?.avgRate ?? null), comparisonNumber(metrics?.floorShare ?? null)];
    })
  }];

  const rackSummaryRows: unknown[][] = [];
  const rackDetailRows: unknown[][] = [];
  const rackPositionRows: unknown[][] = [];
  const rackUnitRows: unknown[][] = [];
  const rackUnitTrendRows: unknown[][] = [];
  for (const site of data.sites) {
    if (site.rack) {
      const metrics = calculateRackCapacityMetrics(site.rack.records);
      const month = site.rack.sourceSnapshot ?? referenceMonth;
      rackSummaryRows.push([site.site.name, month, metrics.total, metrics.inUse.count, metrics.available.count, metrics.reserved.count, metrics.pendingDismantle.count, metrics.other.count, exportRatio(metrics.total > 0 ? metrics.inUse.count / metrics.total : null), exportRatio(metrics.total > 0 ? metrics.available.count / metrics.total : null)]);
      rackDetailRows.push(...metrics.zoneMetrics.map(zone => [site.site.name, month, zone.zone, zone.total, zone.inUse.count, zone.available.count, zone.reserved.count, zone.pendingDismantle.count, zone.other.count]));
      const positions = rackPositionSectionRows(site.site.name, month, site.rack.records);
      rackPositionRows.push(...(positions.length > 0 ? positions : [[site.site.name, month, "NO_DATA", null, null, NO_RACK_POSITIONS_MESSAGE]]));
    }
    rackUnitRows.push(...comparisonRackUnitRows(site, referenceMonth));
    rackUnitTrendRows.push(...comparisonRackUnitTrendRows(site, referenceMonth));
  }
  if (rackSummaryRows.length) sections.push({ name: "RACK_CAPACITY_SUMMARY", headers: ["Site", "Snapshot Month", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other", "Usage (%)", "Availability (%)"], rows: rackSummaryRows });
  if (rackDetailRows.length) sections.push({ name: "RACK_CAPACITY_DETAILS", headers: ["Site", "Snapshot Month", "Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other"], rows: rackDetailRows });
  if (rackPositionRows.length) sections.push({ name: "RACK_POSITIONS", headers: ["Site", "Snapshot Month", "Status", "Rack ID", "Cabinet Size (cm)", "Detail"], rows: rackPositionRows });
  if (rackUnitRows.length) sections.push({ name: "RACK_UNIT_CAPACITY_COMPARISON", headers: ["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Attached", "Image Content Type", "Image Saved At"], rows: rackUnitRows });
  if (rackUnitTrendRows.length) sections.push({ name: "RACK_UNIT_TREND_COMPARISON", headers: ["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"], rows: rackUnitTrendRows });
  if (rackUnitTrendRows.length) sections.push({ name: "RACK_UNIT_TREND_NOTE", headers: ["Scope", "Note"], rows: [["All facilities", RACK_UNIT_CAPACITY_TREND_NOTE]] });
  return sections;
}

function comparisonWorksheetRows(section: ExportTableSection): unknown[][] {
  return section.rows.map(row => row.map((value, index) => {
    if (section.name === "SITE_COMPARISON" && index >= 3 && index <= 8 && typeof value === "string" && value !== "") return Number(value);
    return value;
  }));
}

export function buildSiteComparisonCsv(data: SiteComparisonExport, referenceMonth: string): string {
  return siteComparisonExportSections(data, referenceMonth).map(section => "# Section: " + section.name + "\n" + csvSection(section)).join("\n\n");
}

export function exportSiteComparisonCsv(data: SiteComparisonExport, referenceMonth: string): void {
  download(buildSiteComparisonCsv(data, referenceMonth), "site-comparison-" + referenceMonth + ".csv", "text/csv;charset=utf-8");
}


export async function workbookForSiteComparison(data: SiteComparisonExport, referenceMonth: string): Promise<any> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sections = siteComparisonExportSections(data, referenceMonth);
  const [energySection, ...additionalSections] = sections;
  if (energySection) {
    const sheet = workbook.addWorksheet("Site Comparison");
    configureTableSheet(sheet, energySection.headers, comparisonWorksheetRows(energySection));
  }
  for (const section of additionalSections) {
    const sheet = addTableSheet(workbook, "Comparison", section.name, section.headers, comparisonWorksheetRows(section));
    section.headers.forEach((header, index) => {
      if (String(header).includes("Usage (%)") || String(header).includes("Availability (%)")) sheet.getColumn(index + 1).numFmt = "0.0%";
    });
  }
  return workbook;
}

export async function exportSiteComparisonExcel(data: SiteComparisonExport, referenceMonth: string): Promise<void> {
  const workbook = await workbookForSiteComparison(data, referenceMonth);
  const bytes = await workbook.xlsx.writeBuffer();
  download(bytes, "site-comparison-" + referenceMonth + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
function reportRows(logs: MonthlyLog[], calculationLogs: MonthlyLog[] = logs): ReportMonthlyRow[] {
  return [...logs].sort((left, right) => left.month.localeCompare(right.month)).map(log => {
    const calculation = calculateEnergyCostForMonth(calculationLogs, log.month);
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
      status: calculation.floorEnergyKwh === null ? "Partial" : "Complete"
    };
  });
}

export function facilityReportData(logs: MonthlyLog[], siteName: string, selectedMonth: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, extras: ReportDataExtras = {}): ReportData {
  // `logs` is the visible/reporting-period scope. `calculationLogs` is the
  // complete history used only to resolve previous readings and derived
  // values. Keeping these separate makes a Month Range affect the actual
  // report pages instead of silently exporting the full calculation history.
  const rows = reportRows(logs, calculationLogs);
  const current = rows.find(row => row.month === selectedMonth) ?? null;
  const dashboardMapping = extras.dashboardMapping?.mapping?.length
    ? extras.dashboardMapping
    : fallbackDashboardMapping(siteName);
  const upsMapping = buildDashboardUpsMapping(extras.upsGroupHistory ?? null, selectedMonth, dashboardMapping?.mapping ?? []);
  return {
    title: "Data Center Energy & Facility Monitor Report",
    thaiSubtitle: "รายงานการใช้พลังงานและระบบวิศวกรรม",
    facility: siteName,
    sourceWorkbook: "Supabase PostgreSQL",
    generatedAt: new Date().toISOString(),
    appVersion: "2.3.1 Web Clean v1",
    reportingMonth: selectedMonth,
    historicalStart: rows[0]?.month ?? null,
    historicalEnd: rows.at(-1)?.month ?? null,
    status: current?.status === "Complete" ? "Complete" : "Partial",
    validationWarnings: current?.status === "Partial" ? ["The selected month has incomplete source readings."] : [],
    monthlyRows: rows,
    currentRow: current,
    engineeringDashboard: buildEngineeringDashboardSnapshot(calculationLogs, selectedMonth, upsMapping),
    rack,
    rackHistory,
    rackUnitCapacity,
    rackUnitCapacityImageDataUri: extras.rackUnitCapacityImageDataUri ?? null,
    rackUnitCapacityImageMeta: extras.rackUnitCapacityImageMeta ?? null,
    comparison: null,
    rackComparison: null
  };
}

function reportDataFromFacility(facility: ExportFacility, selectedMonth: string): ReportData {
  return facilityReportData(
    facility.logs,
    facility.siteName,
    selectedMonth,
    facility.rack ?? null,
    facility.rackHistory ?? [],
    facility.rackUnitCapacity ?? [],
    facility.calculationLogs ?? facility.logs,
    {
      upsGroupHistory: facility.upsGroupHistory ?? null,
      dashboardMapping: facility.dashboardMapping ?? null,
      rackUnitCapacityImageDataUri: facility.rackUnitCapacityImageDataUri ?? null,
      rackUnitCapacityImageMeta: facility.rackUnitCapacityImageMeta ?? null
    }
  );
}

function ensureExtension(fileName: string, extension: string): string {
  const suffix = `.${extension}`;
  return fileName.toLowerCase().endsWith(suffix) ? fileName : `${fileName}${suffix}`;
}

export interface PdfImagePlacement {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

const PDF_RENDER_SCALE = 2;

/** Fit a rendered report page inside an A4 landscape content box without
 * changing its aspect ratio. This is deliberately pure so the geometry can
 * be regression-tested without a browser or PDF viewer. */
export function fitPdfImageToPage(canvasWidth: number, canvasHeight: number, pageWidthMm = 297, pageHeightMm = 210, marginMm = 10): PdfImagePlacement {
  if (![canvasWidth, canvasHeight, pageWidthMm, pageHeightMm, marginMm].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("PDF image dimensions and margin must be positive finite numbers.");
  }
  const availableWidth = pageWidthMm - (marginMm * 2);
  const availableHeight = pageHeightMm - (marginMm * 2);
  if (availableWidth <= 0 || availableHeight <= 0) throw new Error("PDF margin leaves no printable area.");
  const scale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
  const widthMm = canvasWidth * scale;
  const heightMm = canvasHeight * scale;
  return {
    xMm: (pageWidthMm - widthMm) / 2,
    yMm: (pageHeightMm - heightMm) / 2,
    widthMm,
    heightMm
  };
}

/**
 * Neutralizes `src/index.css`'s app-wide dark-theme table readability override
 * inside the offscreen PDF renderer.
 *
 * That stylesheet forces `color/fill/font-weight` `!important` on every
 * `table:not(.dashboard-table)` and all its descendants so in-app legacy tables
 * stay legible; in the default (non-`.theme-light`) theme it resolves to
 * `--color-text: #f4f7fb` (near-white). The PDF exporter mounts the report into
 * the main document, so that rule cascades onto the report's tables and their
 * `<td>` values render near-white on the white PDF page - while KPI cards,
 * cover, and hand-built SVG charts (not inside `<table>`) stay correct. The
 * `srcdoc` Live Preview is unaffected because its iframe is an isolated
 * document the app CSS never reaches.
 *
 * Redefining the foreground custom properties on the renderer host makes the
 * leaked `color: var(--color-text) !important` resolve to a readable dark
 * value; the explicit `td`/`th` rules (higher specificity than the app rule,
 * plus later source order) restore the report's intended print colours and
 * bold headers. Scoped to `[data-energy-monitor-pdf-renderer]` only.
 */
export const PDF_EXPORT_SURFACE_CSS =
  "[data-energy-monitor-pdf-renderer]{--color-text:#243247;--color-text-secondary:#40566e;--color-text-muted:#5f6f82;--ui-text:#243247;color:#243247}" +
  "html [data-energy-monitor-pdf-renderer] table:not(.dashboard-table)," +
  "html [data-energy-monitor-pdf-renderer] table:not(.dashboard-table) *{color:#243247!important;-webkit-text-fill-color:#243247!important;fill:#243247!important;opacity:1!important}" +
  "html [data-energy-monitor-pdf-renderer] table:not(.dashboard-table) td{color:#1f2937!important;-webkit-text-fill-color:#1f2937!important}" +
  "html [data-energy-monitor-pdf-renderer] table:not(.dashboard-table) th{color:#40566e!important;-webkit-text-fill-color:#40566e!important;font-weight:bold!important}";

async function waitForReportImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(images.map(async image => {
    if (image.complete) return;
    try { await image.decode(); } catch { /* html2canvas will render the placeholder */ }
  }));
  if (typeof document.fonts?.ready?.then === "function") await document.fonts.ready;
}

/**
 * Creates a real PDF download from the same report HTML used by the preview
 * and the old print renderer. The report is rendered by the user's browser,
 * so Thai glyphs and inline SVG charts are captured exactly as displayed;
 * jsPDF then packages each report page into a downloadable PDF blob. This is
 * intentionally asynchronous and does not open a popup or invoke print().
 */
export async function exportReportPdfFromHtml(html: string, fileName: string): Promise<void> {
  if (typeof document === "undefined") throw new Error("PDF export requires a browser document.");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf")
  ]);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const staleHost of [...document.querySelectorAll<HTMLElement>("[data-energy-monitor-pdf-renderer]")]) staleHost.remove();
  const host = document.createElement("div");
  host.dataset.energyMonitorPdfRenderer = "true";
  Object.assign(host.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1123px",
    minHeight: "1px",
    overflow: "visible",
    background: "#ffffff",
    color: "#243247",
    fontFamily: '"TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif',
    pointerEvents: "none",
    opacity: "0.01",
    zIndex: "-1"
  });
  const reportStyle = parsed.head.querySelector("style");
  if (reportStyle) host.appendChild(reportStyle.cloneNode(true));
  const surfaceStyle = document.createElement("style");
  surfaceStyle.dataset.energyMonitorPdfSurface = "true";
  surfaceStyle.textContent = PDF_EXPORT_SURFACE_CSS;
  host.appendChild(surfaceStyle);
  for (const child of [...parsed.body.childNodes]) host.appendChild(child.cloneNode(true));
  document.body.appendChild(host);
  try {
    await waitForReportImages(host);
    // Let the offscreen renderer finish layout so html2canvas reads settled
    // geometry and computed styles (no arbitrary timeout).
    if (typeof requestAnimationFrame === "function") {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    const pages = [...host.querySelectorAll<HTMLElement>(".cover, .page")];
    if (pages.length === 0) throw new Error("The report did not contain any printable pages.");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    for (const [index, page] of pages.entries()) {
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        // Render every PDF page at 2x before fitting it into A4. The prior
        // 1x JPEG pipeline visibly softened SVG text, chart labels, and
        // attached Rack Unit Capacity images across the whole document.
        scale: PDF_RENDER_SCALE,
        useCORS: true,
        logging: false,
        width: Math.max(page.scrollWidth, 1),
        height: Math.max(page.scrollHeight, page.offsetHeight, 1),
        windowWidth: Math.max(page.scrollWidth, 1),
        // Belt-and-suspenders: guarantee the readable-table-surface CSS is in
        // the cloned document html2canvas actually rasterizes, independent of
        // whether it carries body <style> clones through.
        onclone: clonedDoc => {
          if (clonedDoc.getElementById("__em-pdf-surface")) return;
          const cloneStyle = clonedDoc.createElement("style");
          cloneStyle.id = "__em-pdf-surface";
          cloneStyle.textContent = PDF_EXPORT_SURFACE_CSS;
          clonedDoc.head.appendChild(cloneStyle);
        }
      });
      if (index > 0) pdf.addPage("a4", "landscape");
      const placement = fitPdfImageToPage(canvas.width, canvas.height);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", placement.xMm, placement.yMm, placement.widthMm, placement.heightMm, undefined, "FAST");
    }
    pdf.save(ensureExtension(fileName, "pdf"));
  } finally {
    host.remove();
  }
}

export async function exportDesktopPdf(logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, sections?: readonly ReportSectionId[], extras: ReportDataExtras = {}): Promise<void> {
  const data = facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs, extras);
  await exportReportPdfFromHtml(buildReportHtml(data, sections), fileName ?? `Energy_Report_${siteName}_${selectedMonth}`);
}

/**
 * Opens the print popup - must be called synchronously, in the same event
 * loop turn as the triggering click, before any `await`. Browsers key
 * window.open()'s popup-blocker permission off the original user gesture;
 * once an async gap (e.g. an awaited API fetch for rack data) has elapsed,
 * that gesture has expired and window.open() gets silently blocked. The
 * caller opens the (initially blank) window immediately on click, then
 * writes the real report into it once any async data has loaded, via
 * printDesktopPdf/printSiteComparisonPdf/printAllFacilitiesPdf below.
 */
const reportPopupStyle = "body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:32px;background:#f8fafc;color:#0f172a}main{max-width:720px;margin:10vh auto;padding:28px;border:1px solid #cbd5e1;border-radius:16px;background:#fff;box-shadow:0 12px 32px #0f172a1a}h1{font-size:20px;margin:0 0 10px}p{line-height:1.6;color:#475569}.spinner{display:inline-block;width:14px;height:14px;margin-right:8px;border:2px solid #cbd5e1;border-top-color:#0f766e;border-radius:50%;vertical-align:-2px;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}";

function popupStatusHtml(title: string, heading: string, message: string, loading: boolean): string {
  const indicator = loading ? '<span class="spinner" aria-hidden="true"></span>' : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${reportPopupStyle}</style></head><body><main><h1>${indicator}${heading}</h1><p>${message}</p></main></body></html>`;
}

function writePopupDocument(popup: Window, html: string, title: string): void {
  if (popup.closed) throw new Error("The report window was closed before the report was ready.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.document.title = title;
}

export function openReportPopup(name: string): Window {
  // `noopener`/`noreferrer` make window.open() return null in Chromium. That
  // leaves a visible about:blank tab but removes the WindowProxy needed to
  // write the report into it. Open the same-origin blank popup first, sever
  // its opener immediately, then populate it below.
  const popup = window.open("", name, "popup");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.opener = null;
  // The report data may require an API request before it can be rendered. A
  // real loading document prevents the browser from showing a blank tab while
  // that request is in flight.
  writePopupDocument(popup, popupStatusHtml("Preparing report…", "Preparing report", "The report is being assembled. This window will open the print dialog when it is ready.", true), "Preparing report…");
  popup.document.title = "Preparing report…";
  popup.setTimeout(() => { if (!popup.closed) popup.document.title = "Preparing report…"; }, 0);
  return popup;
}

/** Replaces a stalled/failed report popup with a visible, non-sensitive error. */
export function renderReportErrorPopup(popup: Window): void {
  try {
    writePopupDocument(popup, popupStatusHtml("Report export failed", "Report could not be generated", "The report data could not be prepared. Return to the application and try again.", false), "Report export failed");
  } catch {
    // The user may have closed the popup. The main application still receives
    // the original error through the caller's promise and can show a notice.
  }
}

/** Write the report before printing and handle both possible document-load
 * states. `document.close()` can complete before a listener is registered;
 * checking readyState and scheduling a fallback avoids a blank/stuck popup. */
export function renderReportPopup(popup: Window, html: string, fileName?: string): void {
  writePopupDocument(popup, html, fileName ?? "Energy Monitor report");
  let printed = false;
  const print = () => {
    if (printed || popup.closed) return;
    printed = true;
    popup.focus();
    popup.print();
  };
  popup.addEventListener("load", print, { once: true });
  // `load` is the normal path. The timeout is a compatibility fallback for a
  // document written with document.open/write/close where the load event can
  // race the listener registration.
  popup.setTimeout(print, popup.document.readyState !== "loading" ? 0 : 750);
}

/** Desktop's print HTML, populated only with the selected facility's API DTOs.
 *  fileName (without extension) becomes the print dialog's suggested "Save
 *  as PDF" name, via document.title - the browser convention for print-to-PDF.
 *  `popup` must come from openReportPopup(), called synchronously on click. */
export function printDesktopPdf(popup: Window, logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, sections?: readonly import("../reporting/reportingTypes").ReportSectionId[], extras: ReportDataExtras = {}): void {
  const data = facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs, extras);
  renderReportPopup(popup, buildReportHtml(data, sections), fileName);
}

function comparisonRow(site: ComparisonSite, referenceMonth: string) {
  const metrics = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null;
  return {
    label: site.site.name,
    month: referenceMonth,
    buildingEnergyKwh: metrics?.buildingEnergy ?? null,
    buildingCostThb: metrics?.buildingCost ?? null,
    floorEnergyKwh: metrics?.floorEnergy ?? null,
    floorCostThb: metrics?.floorCost ?? null,
    averageRateThbPerKwh: metrics?.avgRate ?? null,
    floorSharePercent: metrics?.floorShare ?? null
  };
}

function comparisonTrend(site: ComparisonSite, months: string[]): ReportMonthlyRow[] {
  return months.map(month => {
    const metrics = site.months.find(entry => entry.month === month)?.metrics ?? null;
    return {
      month,
      buildingEnergyKwh: metrics?.buildingEnergy ?? null,
      buildingCostThb: metrics?.buildingCost ?? null,
      floorEnergyKwh: metrics?.floorEnergy ?? null,
      floorCostThb: metrics?.floorCost ?? null,
      averageRateThbPerKwh: metrics?.avgRate ?? null,
      floorSharePercent: metrics?.floorShare ?? null,
      upsEnergyKwh: null,
      airEnergyKwh: null,
      dcEnergyKwh: null,
      status: metrics ? "Complete" : "Partial"
    };
  });
}


function comparisonRackUnitRowsForReport(site: SiteComparisonExport["sites"][number]): RackUnitCapacityRow[] {
  return (site.rackUnitCapacity ?? []).map(row => ({
    month: row.month,
    totalU: row.totalU,
    usedU: row.usedU,
    availableU: row.availableU,
    availabilityPct: row.availabilityPct ?? (row.totalU > 0 ? row.availableU / row.totalU : null)
  }));
}

function comparisonRackUnitReport(data: SiteComparisonExport): ReportData["rackUnitComparison"] {
  return {
    sites: data.sites.map(site => ({ label: site.site.name, rows: comparisonRackUnitRowsForReport(site) }))
  };
}

function siteComparisonReportForDownload(data: SiteComparisonExport, referenceMonth: string, selfRack: RackCapacityReport | null = null, otherRack: RackCapacityReport | null = null): ReportData {
  const [primary, secondary] = data.sites;
  if (!primary) throw new Error("No facilities are available for comparison.");
  const trendMonths = data.months.filter(month => month <= referenceMonth).slice(-12);
  return {
    title: "Data Center Energy & Facility Monitor Site Comparison",
    thaiSubtitle: "รายงานเปรียบเทียบการใช้พลังงานระหว่างไซต์",
    facility: "All Facilities",
    sourceWorkbook: "Supabase PostgreSQL",
    generatedAt: new Date().toISOString(),
    appVersion: "2.3.1 Web Clean v1",
    reportingMonth: referenceMonth,
    historicalStart: trendMonths[0] ?? null,
    historicalEnd: trendMonths.at(-1) ?? null,
    status: "Complete",
    validationWarnings: [],
    monthlyRows: comparisonTrend(primary, trendMonths),
    currentRow: null,
    engineeringDashboard: null,
    rack: null,
    rackHistory: [],
    rackUnitCapacity: comparisonRackUnitRowsForReport(primary),
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: {
      self: comparisonRow(primary, referenceMonth),
      other: secondary ? comparisonRow(secondary, referenceMonth) : null,
      selfTrend: comparisonTrend(primary, trendMonths),
      otherTrend: secondary ? comparisonTrend(secondary, trendMonths) : []
    },
    rackComparison: (selfRack ?? primary.rack) ? { self: { label: primary.site.name, records: (selfRack ?? primary.rack)!.records }, other: secondary && (otherRack ?? secondary.rack) ? { label: secondary.site.name, records: (otherRack ?? secondary.rack)!.records } : null } : null,
    rackUnitComparison: comparisonRackUnitReport(data)
  };
}

/** Uses Desktop report renderer; comparison values come from the scoped API DTO.
 *  selfRack/otherRack feed the shared renderer's "Rack Capacity Site
 *  Comparison" page (rackComparisonPage in reportHtml.ts) - the same
 *  reused RackCapacityReport shape as the main facility report, never a
 *  second comparison calculation. */
export function printSiteComparisonPdf(popup: Window, data: SiteComparisonExport, referenceMonth: string, selfRack: RackCapacityReport | null = null, otherRack: RackCapacityReport | null = null): void {
  const [primary, secondary] = data.sites;
  if (!primary) throw new Error("No facilities are available for comparison.");
  const trendMonths = data.months.filter(month => month <= referenceMonth).slice(-12);
  const primaryRow = comparisonRow(primary, referenceMonth);
  const report: ReportData = {
    title: "Data Center Energy & Facility Monitor Site Comparison",
    thaiSubtitle: "รายงานเปรียบเทียบการใช้พลังงานระหว่างไซต์",
    facility: "All Facilities",
    sourceWorkbook: "Supabase PostgreSQL",
    generatedAt: new Date().toISOString(),
    appVersion: "2.3.1 Web Clean v1",
    reportingMonth: referenceMonth,
    historicalStart: trendMonths[0] ?? null,
    historicalEnd: trendMonths.at(-1) ?? null,
    status: "Complete",
    validationWarnings: [],
    monthlyRows: comparisonTrend(primary, trendMonths),
    currentRow: null,
    engineeringDashboard: null,
    rack: null,
    rackHistory: [],
    rackUnitCapacity: comparisonRackUnitRowsForReport(primary),
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: {
      self: primaryRow,
      other: secondary ? comparisonRow(secondary, referenceMonth) : null,
      selfTrend: comparisonTrend(primary, trendMonths),
      otherTrend: secondary ? comparisonTrend(secondary, trendMonths) : []
    },
    rackComparison: (selfRack ?? primary.rack) ? { self: { label: primary.site.name, records: (selfRack ?? primary.rack)!.records }, other: secondary && (otherRack ?? secondary.rack) ? { label: secondary.site.name, records: (otherRack ?? secondary.rack)!.records } : null } : null,
    rackUnitComparison: comparisonRackUnitReport(data)
  };
  renderReportPopup(popup, buildReportHtml(report));
}

/** Generates a real PDF download for the site-comparison report without
 * opening a popup or invoking the browser print dialog. */
export async function exportSiteComparisonPdf(data: SiteComparisonExport, referenceMonth: string, fileName?: string, selfRack: RackCapacityReport | null = null, otherRack: RackCapacityReport | null = null, sections?: readonly ReportSectionId[]): Promise<void> {
  await exportReportPdfFromHtml(buildSiteComparisonReportHtml(data, referenceMonth, selfRack, otherRack, sections), fileName ?? `site-comparison-${referenceMonth}`);
}

export function exportHtml(logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, sections?: readonly ReportSectionId[], extras: ReportDataExtras = {}): void {
  const html = buildReportHtml(facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs, extras), sections);
  download(html, fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.html`, "text/html;charset=utf-8");
}

export function exportAllFacilitiesHtml(facilities: ExportFacility[], selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): void {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const reports = facilities.map(facility => buildReportHtml(reportDataFromFacility(facility, selectedMonth), sections));
  const html = reports.join("<div style=\"page-break-before:always\"></div>");
  download(html, fileName ?? "all-facilities-energy-monitor.html", "text/html;charset=utf-8");
}

export function exportSiteComparisonHtml(data: SiteComparisonExport, referenceMonth: string, fileName?: string, selfRack: RackCapacityReport | null = null, otherRack: RackCapacityReport | null = null, sections?: readonly ReportSectionId[]): void {
  download(buildSiteComparisonReportHtml(data, referenceMonth, selfRack, otherRack, sections), fileName ?? `site-comparison-${referenceMonth}.html`, "text/html;charset=utf-8");
}

/** One combined report document, one facility report per section. Exported so
 *  the Live Preview renders exactly the same content the All Facilities export
 *  produces (report model -> preview and the same model -> PDF-safe capture),
 *  never a duplicate table generation. */
export function buildAllFacilitiesReportHtml(facilities: ExportFacility[], selectedMonth: string, sections?: readonly ReportSectionId[]): string {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const reports = facilities.map(facility => buildReportHtml(reportDataFromFacility(facility, selectedMonth), sections));
  const parsed = reports.map(html => new DOMParser().parseFromString(html, "text/html"));
  const style = parsed[0]?.head.querySelector("style")?.textContent ?? "";
  const body = parsed.map(document => document.body.innerHTML).join("<div style=\"page-break-before:always\"></div>");
  return `<!doctype html><html><head><meta charset=\"utf-8\"><title>Data Center Energy &amp; Facility Monitor All Facilities</title><style>${style}</style></head><body>${body}</body></html>`;
}

/** Same-model source for the Site Energy & Cost Comparison Live Preview and the
 *  comparison HTML/PDF exports. */
export function buildSiteComparisonReportHtml(data: SiteComparisonExport, referenceMonth: string, selfRack: RackCapacityReport | null = null, otherRack: RackCapacityReport | null = null, sections?: readonly ReportSectionId[]): string {
  return buildReportHtml(siteComparisonReportForDownload(data, referenceMonth, selfRack, otherRack), sections);
}

/** Generates one real PDF download containing one report per facility. */
export async function exportAllFacilitiesPdf(facilities: ExportFacility[], selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): Promise<void> {
  await exportReportPdfFromHtml(buildAllFacilitiesReportHtml(facilities, selectedMonth, sections), fileName ?? "all-facilities-energy-monitor");
}

/** Prints one full Desktop-compatible report per facility in one document.
 *  `popup` must come from openReportPopup(), called synchronously on click. */
export function printAllFacilitiesPdf(popup: Window, facilities: ExportFacility[], selectedMonth: string): void {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const reports = facilities.map(facility => buildReportHtml(reportDataFromFacility(facility, selectedMonth)));
  const parsed = reports.map(html => new DOMParser().parseFromString(html, "text/html"));
  const style = parsed[0]?.head.querySelector("style")?.textContent ?? "";
  const body = parsed.map(document => document.body.innerHTML).join("<div style=\"page-break-before:always\"></div>");
  renderReportPopup(popup, `<!doctype html><html><head><meta charset="utf-8"><title>Data Center Energy & Facility Monitor All Facilities</title><style>${style}</style></head><body>${body}</body></html>`);
}
