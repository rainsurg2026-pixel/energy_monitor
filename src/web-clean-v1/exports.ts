import type { MonthlyLog } from "../types";
import { buildCombinedCsv } from "../utils/exportData";
import { calculateEnergyCostForMonth } from "../domain/energyCost";
import { calculateRackCapacityMetrics, rackPositionExportRows } from "../domain/rackCapacity";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildCrossSiteComparisonPages, buildCurrentFacilityPdfHtml, buildReportHtml, buildReportBodyPages, facilityBandPage, REPORT_CSS } from "../reports/pdf/reportHtml";
import type { ComparisonMetric, ReportData, ReportMonthlyRow, RackCapacityReport, RackRecord, SiteComparisonReportModel, SiteComparisonReportSite, UpsGroupHistoryReport } from "../reports/reportTypes";
export type { ComparisonMetric, SiteComparisonReportModel, SiteComparisonReportSite } from "../reports/reportTypes";
import { RACK_UNIT_CAPACITY_TREND_NOTE } from "../reports/reportTypes";
import { deriveRackCapacityReport } from "../reports/rackCapacityReportBuilder";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import type { DashboardUpsMappingReport } from "../reports/reportTypes";
import { buildDashboardUpsMapping } from "./dashboardUpsMapping";
import { getDesktopDashboardMapping } from "../domain/dashboardMapping";
import type { ReportSectionId } from "../reporting/reportingTypes";
import { recentMonthsThroughSelected } from "../utils/historyWindow";
import { addDashboardDataSheet, addCurrentFacilityDashboard, addInteractiveDashboard, injectInteractiveDashboardCharts, type CurrentFacilityDashboardOptions, type ExcelDashboardMetric, type ExcelDashboardPlan } from "./excelDashboard";
import { defaultAllFacilitiesReportFilename } from "./reportFilename";
import { formatBangkokReportTimestamp } from "../utils";

const workbookDashboardPlans = new WeakMap<object, ExcelDashboardPlan[]>();

function escapeHtmlLocal(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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
  /** Full Rack Unit history used only for chart context when a one-month report requests a trailing 12-month trend. */
  trendRackUnitCapacity?: ExportRackUnitCapacityRow[];
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
  /** Month selected in the Current Facility report UI. */
  selectedMonth?: string;
  /** Authenticated display name that initiated this export. */
  generatedBy?: string | null;
  /** One export timestamp reused across the PDF/Excel artifact. */
  generatedAt?: string;
}

export interface ReportDataExtras {
  /** Persisted Dashboard-FAC group status for the selected month. */
  upsGroupHistory?: UpsGroupHistoryReport | null;
  /** Desktop Dashboard-FAC hardware mapping, when available. */
  dashboardMapping?: DashboardUpsMappingReport | null;
  /** Authenticated web image bytes, already converted to a data URI. */
  rackUnitCapacityImageDataUri?: string | null;
  rackUnitCapacityImageMeta?: ReportData["rackUnitCapacityImageMeta"];
  /** Authenticated display name that initiated this export. */
  generatedBy?: string | null;
  /** One timestamp captured at export start so every page uses the same value. */
  generatedAt?: string;
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

function sheetName(prefix: string, name: string): string {
  const title = name.replace(".csv", "").replace(/[\\/*?:\[\]]/g, "-");
  const prefixLength = Math.max(1, 31 - title.length - 1);
  return `${prefix.slice(0, prefixLength)}-${title}`.slice(0, 31);
}

export function sheetOrderName(facilityCode: string | undefined, order: number, title: string): string {
  const code = (facilityCode ?? "").replace(/[^a-z0-9]+/giu, "").toUpperCase().slice(0, 6);
  const clean = title.replace(/[\\/*?:\[\]]/g, "-").trim();
  const prefix = `${code ? code + " " : ""}${String(order).padStart(2, "0")} `;
  return `${prefix}${clean}`.slice(0, 31).trim();
}

const RAW_SHEET_ORDER: Record<string, number> = {
  UPS_Loads: 20, Air_Inputs: 21, DC_Inputs: 22, Energy_Cost_Inputs: 23, Saved_Records: 24, Saved_Values: 25, Raw_Inputs: 26, Calculated_Energy: 27,
  "Dashboard-FAC": 28, "Dashboard-FAC UPS": 29, "Dashboard-FAC Details": 30, "Dashboard-FAC Air": 31, "Dashboard-FAC DC": 32,
  "Rack Unit Capacity": 33, "Rack Capacity History": 34, "UPS Group History": 35, "Rack Capacity Raw": 36
};

function excelColumnNameForTable(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function configureTableSheet(sheet: any, headers: unknown[], rows: unknown[][], tableName?: string): void {
  const tableRows = rows.length > 0 ? rows : [headers.map(() => null)];
  sheet.addRow(headers);
  tableRows.forEach(values => sheet.addRow(values));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (!tableName) sheet.autoFilter = { from: "A1", to: { row: Math.max(1, sheet.rowCount), column: Math.max(1, sheet.getRow(1).cellCount) } };
  sheet.columns.forEach((column: any) => { column.width = 22; });
  sheet.columns.forEach((column: any, index: number) => {
    if (String(headers[index]).includes("JSON")) column.width = 48;
  });
  if (tableName) sheet.addTable({ name: tableName, ref: "A1:" + excelColumnNameForTable(headers.length) + Math.max(2, tableRows.length + 1), headerRow: true, totalsRow: false, columns: headers.map(header => ({ name: String(header) })), rows: tableRows });
}

function addTableSheet(workbook: any, prefix: string, title: string, headers: unknown[], rows: unknown[][]): any {
  const order = RAW_SHEET_ORDER[title];
  const name = order ? sheetOrderName(prefix || undefined, order, title) : sheetName(prefix || "sheet", title);
  const sheet = workbook.addWorksheet(name);
  const tableName = "tbl" + (prefix || "Sheet") + title.replace(/[^a-z0-9]/giu, "");
  configureTableSheet(sheet, headers, rows, tableName);
  return sheet;
}

function addPresentationSheet(workbook: any, name: string, title: string): any {
  const sheet = workbook.addWorksheet(name);
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { name: "Aptos Display", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  return sheet;
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
      averageRateThbPerKwh: dashboard?.averageRateThbPerKwh ?? calculated.averageElectricityRateThbPerKwh,
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
function workbookSheetRef(name: string): string { return "'" + name.replace(/'/g, "''") + "'"; }

function addCurrentTableSheet(workbook: any, name: string, tableName: string, headers: unknown[], rows: unknown[][]): any {
  const sheet = workbook.addWorksheet(name);
  configureTableSheet(sheet, headers, rows, tableName);
  return sheet;
}
function addRackUnitImageToSavedSheet(workbook: any, sheet: any, dataUri: string | null | undefined, meta: ReportData["rackUnitCapacityImageMeta"]): void {
  sheet.mergeCells("K1:P1");
  sheet.getCell("K1").value = "Rack Unit Capacity Image";
  sheet.getCell("K1").font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("K1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  if (!dataUri || !/^data:image\/(png|jpe?g);base64,/i.test(dataUri)) {
    sheet.mergeCells("K2:P9");
    sheet.getCell("K2").value = "No rack image available for the selected reporting month.";
    sheet.getCell("K2").alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    sheet.getCell("K2").font = { italic: true, color: { argb: "FF657488" } };
    sheet.getCell("K2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    return;
  }
  const imageId = workbook.addImage({ base64: dataUri, extension: /^data:image\/jpe?g;/i.test(dataUri) ? "jpeg" : "png" });
  const width = 340;
  const height = meta && meta.width > 0 && meta.height > 0 ? Math.min(190, width * meta.height / meta.width) : 190;
  sheet.addImage(imageId, { tl: { col: 10, row: 1 }, ext: { width, height } });
  sheet.mergeCells("K11:P11");
  sheet.getCell("K11").value = "Embedded Rack Unit Capacity image" + (meta && meta.savedAt ? " - captured " + meta.savedAt : "");
  sheet.getCell("K11").font = { italic: true, color: { argb: "FF657488" } };
}

function currentMetricRows(metrics: ExcelDashboardMetric[]): unknown[][] {
  return metrics.map(metric => [metric.month, metric.buildingEnergyKwh, metric.buildingCostThb, metric.floorEnergyKwh, metric.floorCostThb, metric.averageRateThbPerKwh, metric.floorSharePercent, metric.upsEnergyKwh, metric.airEnergyKwh, metric.dcEnergyKwh, metric.upsLoadKw, metric.upsLoadPercent]);
}

function emptyDashboardMetric(month: string): ExcelDashboardMetric {
  return {
    month, buildingEnergyKwh: null, buildingCostThb: null, floorEnergyKwh: null, floorCostThb: null, averageRateThbPerKwh: null,
    floorSharePercent: null, upsEnergyKwh: null, airEnergyKwh: null, dcEnergyKwh: null, upsLoadKw: null, upsLoadPercent: null,
    rackTotalU: null, rackUsedU: null, rackAvailableU: null, rackUsagePercent: null
  };
}

function dashboardMetricsForMonths(model: { metrics: ExcelDashboardMetric[] }, months: readonly string[]): ExcelDashboardMetric[] {
  const byMonth = new Map(model.metrics.map(metric => [metric.month, metric]));
  return months.map(month => byMonth.get(month) ?? emptyDashboardMetric(month));
}

async function workbookForCurrentFacility(facility: ExportFacility): Promise<any> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const logs = [...facility.logs].sort((a, b) => a.month.localeCompare(b.month));
  const calculationLogs = [...(facility.calculationLogs ?? logs)].sort((a, b) => a.month.localeCompare(b.month));
  const months = [...new Set([
    ...(facility.reportingMonths ?? []), ...logs.map(log => log.month),
    ...(facility.rackHistory ?? []).map(row => row.snapshotMonth),
    ...(facility.rackUnitCapacity ?? []).map(row => row.month),
    ...(facility.upsGroupHistory?.rows ?? []).map(row => row.month)
  ])].sort();
  const baseModel = buildExcelDashboardModel(logs, calculationLogs, facility);
  const metrics = dashboardMetricsForMonths(baseModel, months);
  const selectedMonth = facility.selectedMonth && months.includes(facility.selectedMonth) ? facility.selectedMonth : (months.at(-1) ?? "");
  const trendMonths = exportTrendMonths(months, calculationLogs.map(log => log.month), selectedMonth);
  const trendMonthSet = new Set(trendMonths);
  const trendLogs = calculationLogs.filter(log => trendMonthSet.has(log.month));
  const trendFacility: ExportFacility = { ...facility, logs: trendLogs, rackUnitCapacity: facility.trendRackUnitCapacity ?? facility.rackUnitCapacity, reportingMonths: trendMonths };
  const trendModel = buildExcelDashboardModel(trendLogs, calculationLogs, trendFacility);
  const trendMetrics = dashboardMetricsForMonths(trendModel, trendMonths);
  const airFields = [...new Set(logs.flatMap(log => Object.keys(log.air.meters ?? {}).concat(["eb41a", "eb41b", "eb42a", "eb42b"])))].sort();
  const airRows = logs.map(log => ({ month: log.month, values: airFields.map(field => (log.air as unknown as Record<string, number | null | undefined>)[field] ?? log.air.meters?.[field] ?? null) }));
  const rackRows: CurrentFacilityDashboardOptions["rackRows"] = (facility.rackHistory ?? []).map(row => ({
    month: row.snapshotMonth, zone: row.rackZone, total: row.totalRacks, inUse: row.inUse, available: row.available, reserved: row.reserved,
    pending: row.pendingDismantle, other: row.other, usage: row.usagePct, availability: row.availabilityPct
  }));
  if (rackRows.length === 0 && facility.rack) {
    const rackMetrics = calculateRackCapacityMetrics(facility.rack.records);
    rackRows.push({ month: facility.rack.sourceSnapshot, zone: "(Total)", total: rackMetrics.total, inUse: rackMetrics.inUse.count, available: rackMetrics.available.count, reserved: rackMetrics.reserved.count, pending: rackMetrics.pendingDismantle.count, other: rackMetrics.other.count, usage: rackMetrics.total > 0 ? rackMetrics.inUse.count / rackMetrics.total : null, availability: rackMetrics.total > 0 ? rackMetrics.available.count / rackMetrics.total : null });
  }
  rackRows.sort((a, b) => a.month.localeCompare(b.month) || (a.zone.toLowerCase().includes("total") ? -1 : b.zone.toLowerCase().includes("total") ? 1 : a.zone.localeCompare(b.zone)));
  const rackUnitRows: CurrentFacilityDashboardOptions["rackUnitRows"] = (facility.rackUnitCapacity ?? []).map(row => ({
    month: row.month, total: row.totalU, used: row.usedU, available: row.availableU, usage: row.totalU > 0 ? row.usedU / row.totalU : null, availability: row.availabilityPct
  })).sort((a, b) => a.month.localeCompare(b.month));
  const dashboardSheetName = "01_Dashboard";
  const trendDataSheetName = "98_Trend_Data";
  const dataSheetName = "99_Dashboard_Data";
  const plan = addCurrentFacilityDashboard(workbook, facility.siteName, metrics, {
    dashboardSheetName, dataSheetName, selectedMonth, exportedAt: facility.generatedAt ?? new Date().toISOString(), exportedBy: facility.generatedBy ?? null,
    trendMetrics, trendDataSheetName,
    airSheetName: "06_Input_AirConditioning", rackSheetName: "03_Saved_Rack", rackUnitSheetName: "04_Saved_RackUnit",
    airFields, airRows, rackRows, rackUnitRows, rackImageDataUri: facility.rackUnitCapacityImageDataUri ?? null, rackImageMeta: facility.rackUnitCapacityImageMeta ?? null
  });
  const savedEnergy = addCurrentTableSheet(workbook, "02_Saved_Energy", "tblSavedEnergy",
    ["Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "UPS Load (kW)", "UPS Load (%)", "Status"],
    metrics.map(metric => [...currentMetricRows([metric])[0], metric.floorEnergyKwh === null ? "Partial" : "Complete"]));
  const savedRack = addCurrentTableSheet(workbook, "03_Saved_Rack", "tblSavedRack",
    ["Month", "Facility", "Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other", "Usage (%)", "Availability (%)"],
    rackRows.map(row => [row.month, facility.siteName, row.zone, row.total, row.inUse, row.available, row.reserved, row.pending, row.other, row.usage, row.availability]));
  const savedRackUnit = addCurrentTableSheet(workbook, "04_Saved_RackUnit", "tblSavedRackUnit",
    ["Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Attached", "Image Content Type", "Image Saved At"],
    rackUnitRows.map(row => { const source = facility.rackUnitCapacity?.find(item => item.month === row.month); return [row.month, row.total, row.used, row.available, row.usage, row.availability, source?.imageAttached ? "Yes" : "No", source?.imageContentType ?? null, source?.imageSavedAt ?? null]; }));
  addRackUnitImageToSavedSheet(workbook, savedRackUnit, facility.rackUnitCapacityImageDataUri ?? null, facility.rackUnitCapacityImageMeta ?? null);
  addCurrentTableSheet(workbook, "05_Input_UPS", "tblInputUPS", ["Month", "Facility", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Raw phases JSON", "Last Saved"], logs.flatMap(log => log.ups.map(row => [log.month, facility.siteName, row.upsId, row.voltage, row.current, row.loadKw, row.loadKva, JSON.stringify(row.phases ?? {}), log.lastSavedUps])));
  const inputAirRows = airRows.map(row => [row.month, facility.siteName, ...row.values, JSON.stringify(logs.find(log => log.month === row.month)?.air.meters ?? {}), logs.find(log => log.month === row.month)?.lastSavedAir ?? null]);
  const inputAir = addCurrentTableSheet(workbook, "06_Input_AirConditioning", "tblInputAir", ["Month", "Facility", ...airFields.map(field => field.toUpperCase() + " (GWh)"), "Raw meters JSON", "Last Saved"], inputAirRows);
  airFields.forEach((_field, index) => { for (let row = 2; row <= Math.max(2, inputAirRows.length + 1); row++) inputAir.getCell(row, index + 3).numFmt = "0.000000"; });
  addCurrentTableSheet(workbook, "07_Input_DCPower", "tblInputDCPower", ["Month", "Facility", "DC Panel", "Voltage (V)", "Current (A)", "Last Saved"], logs.flatMap(log => log.dc.map(row => [log.month, facility.siteName, row.panelId, row.voltage, row.current, log.lastSavedDc])));
  addCurrentTableSheet(workbook, "08_Input_Rack", "tblInputRack", ["Snapshot Month", "Facility", "Row", "Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"], (facility.rack?.records ?? []).map(row => [facility.rack?.sourceSnapshot ?? selectedMonth, facility.siteName, row.rowNumber, row.rackZone, row.rackId, row.status, row.cabinetSize, row.detail, row.deviceType, row.remarks]));
  addCurrentTableSheet(workbook, "09_History_Energy", "tblHistoryEnergy", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "Status"], metrics.map(metric => [metric.month, metric.buildingEnergyKwh, metric.buildingCostThb, metric.floorEnergyKwh, metric.floorCostThb, metric.averageRateThbPerKwh, metric.upsEnergyKwh, metric.airEnergyKwh, metric.dcEnergyKwh, metric.floorEnergyKwh === null ? "Partial" : "Complete"]));
  addCurrentTableSheet(workbook, "10_History_Rack", "tblHistoryRack", ["Month", "Facility", "Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Decommission", "Other", "Usage (%)", "Availability (%)"], rackRows.map(row => [row.month, facility.siteName, row.zone, row.total, row.inUse, row.available, row.reserved, row.pending, row.other, row.usage, row.availability]));
  savedRack.getColumn(10).numFmt = "0.0%"; savedRack.getColumn(11).numFmt = "0.0%";
  savedRackUnit.getColumn(5).numFmt = "0.0%"; savedRackUnit.getColumn(6).numFmt = "0.0%";
  savedEnergy.getColumn(6).numFmt = "#,##0.00"; savedEnergy.getColumn(7).numFmt = "0.00"; savedEnergy.getColumn(12).numFmt = "0.00";
  // Compatibility tables retain the historical export contract for downstream
  // consumers while the prefixed Current Facility tables above are the
  // authoritative interactive workbook sources.
  addTableSheet(workbook, "", "UPS_Loads", ["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Raw phases JSON", "Last Saved"], logs.flatMap(log => log.ups.map(row => [log.month, row.upsId, row.voltage, row.current, row.loadKw, row.loadKva, JSON.stringify(row.phases ?? {}), log.lastSavedUps])));
  const legacyAir = addTableSheet(workbook, "", "Air_Inputs", ["Month", ...airFields.map(field => field.toUpperCase() + " (GWh)"), "Raw meters JSON", "Last Saved"], airRows.map(row => [row.month, ...row.values, JSON.stringify(logs.find(log => log.month === row.month)?.air.meters ?? {}), logs.find(log => log.month === row.month)?.lastSavedAir ?? null]));
  airFields.forEach((_field, index) => { for (let row = 2; row <= Math.max(2, airRows.length + 1); row++) legacyAir.getCell(row, index + 2).numFmt = "0.000000"; });
  addTableSheet(workbook, "", "DC_Inputs", ["Month", "DC Panel", "Voltage (V)", "Current (A)", "Last Saved"], logs.flatMap(log => log.dc.map(row => [log.month, row.panelId, row.voltage, row.current, log.lastSavedDc])));
  addTableSheet(workbook, "", "Energy_Cost_Inputs", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "Stored Floor Cost (THB)", "Stored Average Rate (THB/kWh)", "Last Saved"], logs.map(log => [log.month, log.energyCost.buildingEnergyKwh, log.energyCost.buildingElectricityCostThb, log.energyCost.floorElectricityCostThb ?? null, log.energyCost.averageElectricityRateThbPerKwh ?? null, log.lastSavedEnergyCost]));
  const logsByMonth = new Map(logs.map(log => [log.month, log]));
  addTableSheet(workbook, "", "Saved_Records", ["Month", "UPS Last Saved", "Air Last Saved", "DC Last Saved", "Energy Cost Last Saved", "Source State"], months.map(month => {
    const log = logsByMonth.get(month);
    return [month, log?.lastSavedUps ?? null, log?.lastSavedAir ?? null, log?.lastSavedDc ?? null, log?.lastSavedEnergyCost ?? null, log ? "persisted monthly log" : "persisted Rack Unit-only row"];
  }));
  addTableSheet(workbook, "", "Saved_Values", ["Month", "UPS Saved JSON", "Air Saved JSON", "DC Saved JSON", "Energy Cost Saved JSON", "Rack Unit Saved JSON", "Rack Unit Image JSON", "UPS Last Saved", "Air Last Saved", "DC Last Saved", "Energy Cost Last Saved"], months.map(month => {
    const log = logsByMonth.get(month);
    const rackUnit = facility.rackUnitCapacity?.find(row => row.month === month) ?? null;
    const image = rackUnit?.imageAttached ? { attached: true, contentType: rackUnit.imageContentType ?? null, savedAt: rackUnit.imageSavedAt ?? null } : null;
    return [month, JSON.stringify(log?.ups ?? null), JSON.stringify(log?.air ?? null), JSON.stringify(log?.dc ?? null), JSON.stringify(log?.energyCost ?? null), JSON.stringify(rackUnit), JSON.stringify(image), log?.lastSavedUps ?? null, log?.lastSavedAir ?? null, log?.lastSavedDc ?? null, log?.lastSavedEnergyCost ?? null];
  }));
  addTableSheet(workbook, "", "Raw_Inputs", ["Month", "Raw Phase/Panel Values JSON"], logs.filter(log => log.srinakarinInputs).map(log => [log.month, JSON.stringify(log.srinakarinInputs)]));
  addTableSheet(workbook, "", "Calculated_Energy", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "Floor Energy (kWh)", "Floor Cost (THB)", "Average Rate (THB/kWh)", "Floor Share (%)", "Status"], metrics.map(metric => [metric.month, metric.buildingEnergyKwh, metric.buildingCostThb, metric.upsEnergyKwh, metric.airEnergyKwh, metric.dcEnergyKwh, metric.floorEnergyKwh, metric.floorCostThb, metric.averageRateThbPerKwh, metric.floorSharePercent, metric.floorEnergyKwh === null ? "Partial" : "Complete"]));
  addTableSheet(workbook, "", "Dashboard-FAC", ["Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "Floor Share (%)", "Status"], metrics.map(metric => [metric.month, metric.buildingEnergyKwh, metric.buildingCostThb, metric.floorEnergyKwh, metric.floorCostThb, metric.averageRateThbPerKwh, metric.floorSharePercent, metric.floorEnergyKwh === null ? "Partial" : "Complete"]));
  addTableSheet(workbook, "", "Dashboard-FAC UPS", ["Month", "Group", "Total Load (kW)", "Total Load (kVA)", "Capacity", "Load (%)", "Available (%)", "Monthly Energy (kWh)"], baseModel.dashboardUpsRows);
  addTableSheet(workbook, "", "Dashboard-FAC Details", ["Month", "No", "UMDB", "UPS ID", "AC Power Panel", "STS", "OUDB", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Capacity", "Load (%)"], baseModel.dashboardDetailRows);
  addTableSheet(workbook, "", "Dashboard-FAC Air", ["Month", "Field", "Previous", "Current", "Difference"], baseModel.dashboardAirRows);
  addTableSheet(workbook, "", "Dashboard-FAC DC", ["Month", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current (A)", "AC Power (W)", "Monthly Energy (kWh)"], baseModel.dashboardDcRows);
  const legacyRackUnit = addTableSheet(workbook, "", "Rack Unit Capacity", ["Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Attached", "Image Content Type", "Image Saved At"], (facility.rackUnitCapacity ?? []).filter(row => months.includes(row.month)).map(row => [row.month, row.totalU, row.usedU, row.availableU, row.totalU > 0 ? row.usedU / row.totalU : null, row.availabilityPct, row.imageAttached ? "Yes" : "No", row.imageContentType ?? null, row.imageSavedAt ?? null]));
  legacyRackUnit.getColumn(5).numFmt = "0.0%"; legacyRackUnit.getColumn(6).numFmt = "0.0%";
  addTableSheet(workbook, "", "Rack Capacity History", ["Snapshot Month", "Facility", "Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle", "Other", "Usage (%)", "Availability (%)", "Reserved (%)", "Pending Dismantle (%)", "Other (%)", "Generated At", "Data Version"], (facility.rackHistory ?? []).map(row => [row.snapshotMonth, row.facility, row.rackZone, row.totalRacks, row.inUse, row.available, row.reserved, row.pendingDismantle, row.other, row.usagePct, row.availabilityPct, row.reservedPct, row.pendingDismantlePct, row.otherPct, row.generatedAt, row.dataVersion]));
  addTableSheet(workbook, "", "UPS Group History", ["Month", "Facility", "Group", "Total Load (kW)", "Total Load (kVA)", "Capacity", "Load (%)", "Available (%)", "Monthly Energy (kWh)", "Generated At", "Data Version"], (facility.upsGroupHistory?.rows ?? []).map(row => [row.month, row.facility, row.group, row.totalLoadKw, row.totalLoadKva, row.capacity, row.loadPercent, row.availablePercent, row.monthlyEnergyKwh, row.generatedAt, row.dataVersion]));
  addTableSheet(workbook, "", "Rack Capacity Raw", ["Snapshot Month", "Row", "Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"], (facility.rack?.records ?? []).map(row => [facility.rack?.sourceSnapshot ?? selectedMonth, row.rowNumber, row.rackZone, row.rackId, row.status, row.cabinetSize, row.detail, row.deviceType, row.remarks]));
  if ((facility.rackUnitCapacityImages ?? []).length > 0) {
    const imageMetadata = addPresentationSheet(workbook, "05 Rack Unit Capacity", "Rack Unit Capacity image metadata");
    imageMetadata.addRow(["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)", "Image Content Type", "Byte Size", "Width", "Height", "Saved At"]);
    (facility.rackUnitCapacityImages ?? []).forEach(image => {
      const row = facility.rackUnitCapacity?.find(item => item.month === image.reportingMonth);
      imageMetadata.addRow([facility.siteName, image.reportingMonth, row?.totalU ?? null, row?.usedU ?? null, row?.availableU ?? null, row && row.totalU > 0 ? row.usedU / row.totalU : null, row?.availabilityPct ?? null, image.contentType, image.byteSize ?? null, image.width ?? null, image.height ?? null, image.savedAt ?? null]);
    });
    imageMetadata.getColumn(6).numFmt = "0.0%"; imageMetadata.getColumn(7).numFmt = "0.0%";
  }
  addDashboardDataSheet(workbook, trendDataSheetName, trendMetrics);
  addDashboardDataSheet(workbook, dataSheetName, metrics);
  const dataEnd = Math.max(2, metrics.length + 1);
  workbook.definedNames.add(workbookSheetRef(dataSheetName) + "!$A$2:$A$" + dataEnd, "AvailableReportingMonths");
  workbook.definedNames.add(workbookSheetRef(dashboardSheetName) + "!$B$3", "CurrentReportingMonth");
  (workbook as any).views = [{ activeTab: 0, firstSheet: 0 }];
  workbookDashboardPlans.set(workbook, [plan]);
  return workbook;
}

export async function workbookForFacilities(facilities: ExportFacility[], comparison?: SiteComparisonReportModel | null) {
  if (facilities.length === 1 && !comparison) return workbookForCurrentFacility(facilities[0]);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const dashboardPlans: ExcelDashboardPlan[] = [];
  const deferredDashboardData: Array<{ name: string; metrics: ExcelDashboardMetric[] }> = [];
  const multiFacility = facilities.length > 1;
  for (const facility of facilities) {
    const code = multiFacility ? (facility.siteCode || facility.siteName.replace(/[^a-z0-9]+/giu, "").slice(0, 6)) : undefined;
    const prefix = code ?? "";
    const dashboardDataName = `${code ? code + " " : ""}Dashboard_Data`.slice(0, 31);
    const trendDataName = `${code ? code + " " : ""}Trend_Data`.slice(0, 31);
    const logs = [...facility.logs].sort((a, b) => a.month.localeCompare(b.month));
    const calculationLogs = [...(facility.calculationLogs ?? logs)].sort((a, b) => a.month.localeCompare(b.month));
    const months = new Set(facility.reportingMonths ?? [
      ...logs.map(log => log.month),
      ...(facility.rackUnitCapacity ?? []).map(row => row.month),
      ...(facility.rackHistory ?? []).map(row => row.snapshotMonth),
      ...(facility.upsGroupHistory?.rows ?? []).map(row => row.month)
    ]);
    const selectedMonth = facility.selectedMonth ?? facility.reportingMonths?.at(-1) ?? logs.at(-1)?.month ?? facility.rack?.sourceSnapshot ?? "";
    const reportMonths = [...months].sort();
    const trendMonths = exportTrendMonths(reportMonths, calculationLogs.map(log => log.month), selectedMonth);
    const trendMonthSet = new Set(trendMonths);
    const trendLogs = calculationLogs.filter(log => trendMonthSet.has(log.month));
    const trendFacility: ExportFacility = { ...facility, logs: trendLogs, rackUnitCapacity: facility.trendRackUnitCapacity ?? facility.rackUnitCapacity, reportingMonths: trendMonths };
    const airFields = [...new Set(logs.flatMap(log => Object.keys(log.air.meters ?? {}).concat(["eb41a", "eb41b", "eb42a", "eb42b"])))].sort();

    const dashboardModel = buildExcelDashboardModel(logs, calculationLogs, facility);
    const trendDashboardModel = buildExcelDashboardModel(trendLogs, calculationLogs, trendFacility);
    const trendMetrics = dashboardMetricsForMonths(trendDashboardModel, trendMonths);
    const separateTrendData = trendMonths.join(",") !== reportMonths.join(",");
    dashboardPlans.push(addInteractiveDashboard(workbook, prefix, facility.siteName, dashboardModel.metrics, { dashboardSheetName: sheetOrderName(code, 1, "Dashboard"), dataSheetName: dashboardDataName, includeDataSheet: false, exportedBy: facility.generatedBy ?? null, exportedAt: facility.generatedAt, trendMetrics, trendDataSheetName: separateTrendData ? trendDataName : dashboardDataName }));
    if (separateTrendData) deferredDashboardData.push({ name: trendDataName, metrics: trendMetrics });
    deferredDashboardData.push({ name: dashboardDataName, metrics: dashboardModel.metrics });
    const report = reportDataFromFacility(facility, selectedMonth);
    const executive = addPresentationSheet(workbook, sheetOrderName(code, 2, "Executive"), `${facility.siteName} — Executive Summary`);
    configureTableSheet(executive, ["Reporting Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)", "Status"], [[selectedMonth, report.currentRow?.buildingEnergyKwh ?? null, report.currentRow?.buildingCostThb ?? null, report.currentRow?.floorEnergyKwh ?? null, report.currentRow?.floorCostThb ?? null, report.currentRow?.averageRateThbPerKwh ?? null, report.currentRow?.floorSharePercent == null ? null : report.currentRow.floorSharePercent / 100, report.currentRow?.status ?? "Partial"]]);
    executive.getColumn(7).numFmt = "0.0%";
    const engineering = addPresentationSheet(workbook, sheetOrderName(code, 3, "Engineering"), `${facility.siteName} — Engineering Analysis`);
    engineering.addRow(["Selected Month", selectedMonth]);
    engineering.addRow(["UPS Energy (kWh)", report.engineeringDashboard?.totalUpsEnergyKwh ?? null]);
    engineering.addRow(["Air Energy (kWh)", report.engineeringDashboard?.airEnergyKwh ?? null]);
    engineering.addRow(["DC Energy (kWh)", report.engineeringDashboard?.totalDcEnergyKwh ?? null]);
    engineering.addRow(["Building Energy (kWh)", report.engineeringDashboard?.buildingEnergyKwh ?? null]);
    engineering.addRow(["Building Cost (THB)", report.engineeringDashboard?.buildingCostThb ?? null]);
    const sections = facilityExportSections(facility);
    const rack = addPresentationSheet(workbook, sheetOrderName(code, 4, "Rack Capacity"), `${facility.siteName} — Rack Capacity`);
    sections.filter(section => ["RACK_CAPACITY_SUMMARY", "RACK_CAPACITY_DETAILS", "RACK_POSITIONS"].includes(section.name)).forEach(section => { rack.addRow([section.name]); rack.addRow(section.headers); section.rows.forEach(row => rack.addRow(row)); });
    const rackUnit = addPresentationSheet(workbook, sheetOrderName(code, 5, "Rack Unit Capacity"), `${facility.siteName} — Rack Unit Capacity`);
    sections.filter(section => section.name.startsWith("RACK_UNIT_")).forEach(section => { rackUnit.addRow([section.name]); rackUnit.addRow(section.headers); section.rows.forEach(row => rackUnit.addRow(row)); });
    addRackUnitImageToSavedSheet(workbook, rackUnit, facility.rackUnitCapacityImageDataUri ?? null, facility.rackUnitCapacityImageMeta ?? null);
    rackUnit.getColumn(6).numFmt = "0.0%";
    rackUnit.getColumn(7).numFmt = "0.0%";
    const history = addPresentationSheet(workbook, sheetOrderName(code, 6, "History"), `${facility.siteName} — History`);
    history.addRow(["Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)"]);
    report.monthlyRows.forEach(row => history.addRow([row.month, row.buildingEnergyKwh, row.buildingCostThb, row.floorEnergyKwh, row.floorCostThb, row.upsEnergyKwh, row.airEnergyKwh, row.dcEnergyKwh]));
    const trends = addPresentationSheet(workbook, sheetOrderName(code, 7, "Trends"), `${facility.siteName} — Trends`);
    trends.addRow(["Month", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)"]);
    (report.executiveTrendRows ?? report.monthlyRows).forEach(row => trends.addRow([row.month, row.floorEnergyKwh, row.floorCostThb, row.upsEnergyKwh, row.airEnergyKwh, row.dcEnergyKwh]));

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
  }
  if (comparison) {
    const energy = addPresentationSheet(workbook, sheetOrderName(undefined, 90, "Site Energy Comparison"), "Site Energy & Cost Comparison");
    energy.addRow(["Facility", "Site code", "Reporting month", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "Estimated 4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"]);
    comparison.sites.forEach(site => energy.addRow([site.label, site.siteCode, comparison.referenceMonth, site.metrics?.buildingEnergy ?? null, site.metrics?.buildingCost ?? null, site.metrics?.floorEnergy ?? null, site.metrics?.floorCost ?? null, site.metrics?.avgRate ?? null, site.metrics?.floorShare == null ? null : site.metrics.floorShare / 100]));
    energy.getColumn(9).numFmt = "0.0%";
    for (const [title, pick] of [["Total Building Energy", "buildingEnergy"], ["4th Floor Energy", "floorEnergy"], ["Total Building Cost", "buildingCost"], ["Estimated 4th Floor Cost", "floorCost"]] as const) {
      energy.addRow([]); energy.addRow([title, ...comparison.sites.map(site => site.label)]);
      comparison.months.forEach(month => energy.addRow([month, ...comparison.sites.map(site => site.metricsByMonth[month]?.[pick] ?? null)]));
    }
    const rack = addPresentationSheet(workbook, sheetOrderName(undefined, 91, "Site Rack Comparison"), "Site Rack Capacity & Availability Comparison");
    for (const section of siteComparisonSectionsFromModel(comparison).filter(section => section.name !== "SITE_COMPARISON")) {
      rack.addRow([section.name]); rack.addRow(section.headers); section.rows.forEach(row => rack.addRow(comparisonWorksheetRows({ ...section, rows: [row] })[0])); rack.addRow([]);
    }
  }
  deferredDashboardData.forEach(item => addDashboardDataSheet(workbook, item.name, item.metrics));
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

export function buildAllFacilitiesCsv(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null): string {
  return facilities.map(buildFacilityCsv).join("\n\n") + (comparison ? "\n\n" + siteComparisonSectionsFromModel(comparison).map(section => "# Section: " + section.name + "\n" + csvSection(section)).join("\n\n") : "");
}

function allFacilitiesDefaultFileName(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null): string {
  const month = comparison?.referenceMonth ?? facilities[0]?.selectedMonth ?? facilities[0]?.reportingMonths?.at(-1) ?? "";
  return defaultAllFacilitiesReportFilename(month, facilities.map(facility => facility.siteName));
}

export function exportAllFacilitiesCsv(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, fileName?: string): void {
  download(buildAllFacilitiesCsv(facilities, comparison), fileName ?? `${allFacilitiesDefaultFileName(facilities, comparison)}.csv`, "text/csv;charset=utf-8");
}

export async function exportAllFacilitiesExcel(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, fileName?: string): Promise<void> {
  // `logs` is the authoritative Quick Period scope. Full history stays in
  // calculationLogs only for derived values and the one-month 12-month chart exception.
  const workbook = await workbookForFacilities(facilities, comparison);
  const data = await writeInteractiveExcelWorkbook(workbook);
  download(data, fileName ?? `${allFacilitiesDefaultFileName(facilities, comparison)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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

export function siteComparisonExportSections(model: SiteComparisonReportModel): ExportTableSection[] {
  const data = modelAsSiteComparisonExport(model);
  const referenceMonth = model.referenceMonth;
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

/** Phase-1 adapter: view the N-site model through the existing SiteComparisonExport
 *  shape so the current section/HTML builders consume it unchanged. Phase 3/4
 *  replace this with the real N-site layout. */
function modelAsSiteComparisonExport(model: SiteComparisonReportModel): SiteComparisonExport {
  return {
    displayPeriod: { startMonth: model.months[0] ?? model.referenceMonth, endMonth: model.referenceMonth },
    months: model.months,
    sites: model.sites.map(site => ({
      site: { id: 0, code: site.siteCode, name: site.label },
      months: model.months.map(month => ({ month, metrics: site.metricsByMonth[month] ?? null })),
      rack: site.rack ?? null,
      rackUnitCapacity: site.rackUnit.map(row => ({
        month: row.month, totalU: row.totalU, usedU: row.usedU, availableU: row.availableU,
        usagePercent: row.usagePercent ?? undefined, availabilityPct: row.availabilityPct ?? undefined,
      })),
    })),
  };
}

function siteComparisonSectionsFromModel(model: SiteComparisonReportModel): ExportTableSection[] {
  return siteComparisonExportSections(model);
}

function comparisonWorksheetRows(section: ExportTableSection): unknown[][] {
  return section.rows.map(row => row.map((value, index) => {
    if (section.name === "SITE_COMPARISON" && index >= 3 && index <= 8 && typeof value === "string" && value !== "") return Number(value);
    return value;
  }));
}

export function buildSiteComparisonCsv(model: SiteComparisonReportModel): string {
  return siteComparisonExportSections(model).map(section => "# Section: " + section.name + "\n" + csvSection(section)).join("\n\n");
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

/** Resolves the chart window from the report scope. Multi-month Quick Periods
 * are authoritative. A one-month report is the only exception: charts receive
 * up to the previous 12 available months ending at the selected month. */
export function exportTrendMonths(reportMonths: readonly string[], calculationMonths: readonly string[], selectedMonth: string): string[] {
  const report = [...new Set(reportMonths)].filter(Boolean).sort();
  if (report.length !== 1) return report;
  return recentMonthsThroughSelected([...new Set(calculationMonths)].filter(Boolean).sort(), selectedMonth, 12).sort();
}

export function facilityReportData(logs: MonthlyLog[], siteName: string, selectedMonth: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, extras: ReportDataExtras = {}): ReportData {
  // `logs` is the visible/reporting-period scope. `calculationLogs` is the
  // complete history used only to resolve previous readings and derived
  // values. Keeping these separate makes a Month Range affect the actual
  // report pages instead of silently exporting the full calculation history.
  const rows = reportRows(logs, calculationLogs);
  const calculationRows = logs === calculationLogs ? rows : reportRows(calculationLogs, calculationLogs);
  const executiveTrendMonths = new Set(exportTrendMonths(rows.map(row => row.month), calculationRows.map(row => row.month), selectedMonth));
  const executiveTrendRows = (rows.length === 1 ? calculationRows : rows).filter(row => executiveTrendMonths.has(row.month));
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
    generatedAt: extras.generatedAt ?? new Date().toISOString(),
    generatedBy: extras.generatedBy ?? null,
    appVersion: "2.3.1 Web Clean v1",
    reportingMonth: selectedMonth,
    historicalStart: rows[0]?.month ?? null,
    historicalEnd: rows.at(-1)?.month ?? null,
    status: current?.status === "Complete" ? "Complete" : "Partial",
    validationWarnings: current?.status === "Partial" ? ["The selected month has incomplete source readings."] : [],
    monthlyRows: rows,
    executiveTrendRows,
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
      rackUnitCapacityImageMeta: facility.rackUnitCapacityImageMeta ?? null,
      generatedBy: facility.generatedBy ?? null,
      generatedAt: facility.generatedAt
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
const PDF_MOBILE_RENDER_SCALE = 1.35;

export function isMemoryConstrainedPdfClient(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> | null = typeof navigator !== "undefined" ? navigator : null): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  const iosDevice = /iPad|iPhone|iPod/i.test(ua);
  const ipadDesktopMode = nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
  return iosDevice || ipadDesktopMode;
}

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

/** Downloaded PDFs render inside the same isolated document model as Live Preview.
 * This prevents the application theme from leaking into report colors. */

async function waitForReportImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(images.map(async image => {
    if (image.complete) return;
    try { await image.decode(); } catch { /* html2canvas will render the placeholder */ }
  }));
  const fontSet = root.ownerDocument?.fonts;
  if (typeof fontSet?.ready?.then === "function") await fontSet.ready;
}

/**
 * Creates a real PDF download from the same report HTML used by the preview
 * and the old print renderer. The report is rendered by the user's browser,
 * so Thai glyphs and inline SVG charts are captured exactly as displayed;
 * jsPDF then packages each report page into a downloadable PDF blob. This is
 * intentionally asynchronous and does not open a popup or invoke print().
 */
export async function exportReportPdfFromHtml(html: string, fileName: string, options: { compact?: boolean } = {}): Promise<void> {
  if (typeof document === "undefined") throw new Error("PDF export requires a browser document.");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf")
  ]);

  // Live Preview uses srcDoc in an iframe. Use the same isolated document for
  // the downloadable PDF so app-level dark/light theme CSS cannot alter report
  // fills, text, tables, charts, or cover colors during html2canvas capture.
  for (const staleFrame of [...document.querySelectorAll<HTMLIFrameElement>("iframe[data-energy-monitor-pdf-renderer]")]) staleFrame.remove();
  const frame = document.createElement("iframe");
  frame.dataset.energyMonitorPdfRenderer = "true";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1123px",
    height: "794px",
    border: "0",
    overflow: "hidden",
    pointerEvents: "none",
    opacity: "0.01",
    zIndex: "-1"
  });

  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener("load", () => resolve(), { once: true });
    frame.addEventListener("error", () => reject(new Error("The report render frame could not be loaded.")), { once: true });
  });
  frame.srcdoc = html;
  document.body.appendChild(frame);

  try {
    await loaded;
    const frameDocument = frame.contentDocument;
    if (!frameDocument?.body) throw new Error("The report render frame is unavailable.");
    await waitForReportImages(frameDocument.body);
    if (typeof frame.contentWindow?.requestAnimationFrame === "function") {
      await new Promise<void>(resolve => frame.contentWindow!.requestAnimationFrame(() => frame.contentWindow!.requestAnimationFrame(() => resolve())));
    }
    const pages = [...frameDocument.querySelectorAll<HTMLElement>(".cover, .page")];
    if (pages.length === 0) throw new Error("The report did not contain any printable pages.");
    const compact = options.compact === true;
    const mobileMemoryMode = isMemoryConstrainedPdfClient();
    const lossy = compact || mobileMemoryMode;
    const renderScale = compact ? 1.5 : mobileMemoryMode ? PDF_MOBILE_RENDER_SCALE : PDF_RENDER_SCALE;
    const jpegQuality = compact ? 0.82 : 0.84;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    for (const [index, page] of pages.entries()) {
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        scale: renderScale,
        useCORS: true,
        logging: false,
        width: Math.max(page.scrollWidth, 1),
        height: Math.max(page.scrollHeight, page.offsetHeight, 1),
        windowWidth: Math.max(page.scrollWidth, 1)
      });
      if (index > 0) pdf.addPage("a4", "landscape");
      const placement = fitPdfImageToPage(canvas.width, canvas.height);
      let imageData: string | null = lossy ? canvas.toDataURL("image/jpeg", jpegQuality) : canvas.toDataURL("image/png");
      pdf.addImage(imageData, lossy ? "JPEG" : "PNG", placement.xMm, placement.yMm, placement.widthMm, placement.heightMm, undefined, "FAST");
      imageData = null;
      canvas.width = 1;
      canvas.height = 1;
      if (mobileMemoryMode) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
    pdf.save(ensureExtension(fileName, "pdf"));
  } finally {
    frame.remove();
  }
}

export async function exportDesktopPdf(logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, sections?: readonly ReportSectionId[], extras: ReportDataExtras = {}): Promise<void> {
  const data = facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs, extras);
  await exportReportPdfFromHtml(buildCurrentFacilityPdfHtml(data, sections), fileName ?? `Energy_Report_${siteName}_${selectedMonth}`);
}








export function exportHtml(logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs, sections?: readonly ReportSectionId[], extras: ReportDataExtras = {}): void {
  const html = buildReportHtml(facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs, extras), sections);
  download(html, fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.html`, "text/html;charset=utf-8");
}

export function exportAllFacilitiesHtml(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): void {
  download(buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections), fileName ?? `${defaultAllFacilitiesReportFilename(selectedMonth, facilities.map(facility => facility.siteName))}.html`, "text/html;charset=utf-8");
}


/** One combined report document, one facility report per section. Exported so
 *  the Live Preview renders exactly the same content the All Facilities export
 *  produces (report model -> preview and the same model -> PDF-safe capture),
 *  never a duplicate table generation. */
export function buildAllFacilitiesReportHtml(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, sections?: readonly ReportSectionId[]): string {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const sites = facilities.map(facility => escapeHtmlLocal(facility.siteName)).join(", ");
  const auditSource = facilities[0];
  const generatedBy = auditSource?.generatedBy?.trim() || "N/A";
  const generatedAt = auditSource?.generatedAt ? formatBangkokReportTimestamp(auditSource.generatedAt) : "N/A";
  const cover = `<main class="cover">
    <div class="cover-kicker">Portfolio Energy &amp; Facility Report</div>
    <h1>Data Center Energy &amp; Facility Monitor</h1>
    <h2>All Facilities Report</h2>
    <div class="cover-rule"></div>
    <div class="cover-meta-grid">
      <div class="cover-meta-card"><span class="cover-meta-label">Scope</span><span class="cover-meta-value">All Facilities</span></div>
      <div class="cover-meta-card"><span class="cover-meta-label">Reporting month</span><span class="cover-meta-value">${escapeHtmlLocal(selectedMonth)}</span></div>
      <div class="cover-meta-card"><span class="cover-meta-label">Included sites</span><span class="cover-meta-value">${sites}</span></div>
    </div>
    <div class="cover-audit">
      <div class="cover-audit-item"><span class="cover-meta-label">Generated by</span><span class="cover-meta-value">${escapeHtmlLocal(generatedBy)}</span></div>
      <div class="cover-audit-item"><span class="cover-meta-label">Generated at</span><span class="cover-meta-value">${escapeHtmlLocal(generatedAt)}</span></div>
    </div>
    <div class="cover-footer"><span>Data Center Energy &amp; Facility Monitor</span><span>Controlled export | GMT+7</span></div>
  </main>`;
  const perFacility = facilities.map(facility => {
    const data = reportDataFromFacility(facility, selectedMonth);
    return facilityBandPage(facility.siteName) + buildReportBodyPages(data, sections);
  }).join("");
  const cross = comparison ? buildCrossSiteComparisonPages(comparison, sections) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>All Facilities Report</title><style>${REPORT_CSS}</style></head><body>${cover}${perFacility}${cross}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}

/** Generates one real PDF download containing one report per facility. */
export async function exportAllFacilitiesPdf(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): Promise<void> {
  await exportReportPdfFromHtml(buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections), fileName ?? defaultAllFacilitiesReportFilename(selectedMonth, facilities.map(facility => facility.siteName)), { compact: true });
}
