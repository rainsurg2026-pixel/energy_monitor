import type { MonthlyLog } from "../types";
import { buildCombinedCsv, buildSectionCsvs } from "../utils/exportData";
import { calculateEnergyCostForMonth } from "../domain/energyCost";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { ReportData, ReportMonthlyRow, RackCapacityReport, RackRecord } from "../reports/reportTypes";
import { deriveRackCapacityReport } from "../reports/rackCapacityReportBuilder";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";

export interface ExportFacility {
  siteName: string;
  logs: MonthlyLog[];
  rack?: RackCapacityReport | null;
  rackHistory?: RackCapacityHistoryRow[];
  rackUnitCapacity?: RackUnitCapacityRow[];
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
  sites: ComparisonSite[];
}

function download(content: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(logs: MonthlyLog[], siteName: string, fileName?: string): void {
  download(buildCombinedCsv(logs), fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.csv`, "text/csv;charset=utf-8");
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
  return `${prefix}-${name.replace(".csv", "")}`.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31);
}

export async function workbookForFacilities(facilities: ExportFacility[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const facility of facilities) {
    const prefix = facility.siteName.replace(/[^a-z0-9]+/giu, "-").slice(0, 12) || "facility";
    for (const section of buildSectionCsvs(facility.logs)) {
      const sheet = workbook.addWorksheet(sheetName(prefix, section.name));
      for (const row of section.content.split("\n")) sheet.addRow(parseCsvLine(row));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: "A1", to: { row: 1, column: Math.max(1, sheet.getRow(1).cellCount) } };
      sheet.columns.forEach(column => { column.width = 22; });
    }
  }
  return workbook;
}

export async function exportExcel(logs: MonthlyLog[], siteName: string, fileName?: string): Promise<void> {
  const workbook = await workbookForFacilities([{ siteName, logs }]);
  const data = await workbook.xlsx.writeBuffer();
  download(data, fileName ?? `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export function buildAllFacilitiesCsv(facilities: ExportFacility[]): string {
  return facilities.map(facility => `# Facility: ${facility.siteName}\n${buildCombinedCsv(facility.logs)}`).join("\n\n");
}

export function exportAllFacilitiesCsv(facilities: ExportFacility[]): void {
  download(buildAllFacilitiesCsv(facilities), "all-facilities-energy-monitor.csv", "text/csv;charset=utf-8");
}

export async function exportAllFacilitiesExcel(facilities: ExportFacility[]): Promise<void> {
  const workbook = await workbookForFacilities(facilities);
  const data = await workbook.xlsx.writeBuffer();
  download(data, "all-facilities-energy-monitor.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

const csvCell = (value: string | number | null): string => value === null ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
const comparisonNumber = (value: number | null): string => value === null || !Number.isFinite(value) ? "" : value.toFixed(2);

export function buildSiteComparisonCsv(data: SiteComparisonExport, referenceMonth: string): string {
  const rows = [["Facility", "Site code", "Reporting month", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"]];
  for (const item of data.sites) {
    const metrics = item.months.find(entry => entry.month === referenceMonth)?.metrics ?? null;
    rows.push([item.site.name, item.site.code, referenceMonth, comparisonNumber(metrics?.buildingEnergy ?? null), comparisonNumber(metrics?.buildingCost ?? null), comparisonNumber(metrics?.floorEnergy ?? null), comparisonNumber(metrics?.floorCost ?? null), comparisonNumber(metrics?.avgRate ?? null), comparisonNumber(metrics?.floorShare ?? null)]);
  }
  return rows.map(row => row.map(csvCell).join(",")).join("\n");
}

export function exportSiteComparisonCsv(data: SiteComparisonExport, referenceMonth: string): void {
  download(buildSiteComparisonCsv(data, referenceMonth), `site-comparison-${referenceMonth}.csv`, "text/csv;charset=utf-8");
}

export async function exportSiteComparisonExcel(data: SiteComparisonExport, referenceMonth: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Site Comparison");
  for (const row of buildSiteComparisonCsv(data, referenceMonth).split("\n")) sheet.addRow(parseCsvLine(row));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.getRow(1).cellCount } };
  sheet.columns.forEach(column => { column.width = 24; });
  const bytes = await workbook.xlsx.writeBuffer();
  download(bytes, `site-comparison-${referenceMonth}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function reportRows(logs: MonthlyLog[]): ReportMonthlyRow[] {
  return [...logs].sort((left, right) => left.month.localeCompare(right.month)).map(log => {
    const calculation = calculateEnergyCostForMonth(logs, log.month);
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

export function facilityReportData(logs: MonthlyLog[], siteName: string, selectedMonth: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = []): ReportData {
  const rows = reportRows(logs);
  const current = rows.find(row => row.month === selectedMonth) ?? null;
  return {
    title: "Energy Monitor Report",
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
    engineeringDashboard: buildEngineeringDashboardSnapshot(logs, selectedMonth, null),
    rack,
    rackHistory,
    rackUnitCapacity,
    // No Web/DB image-storage API exists yet for the Rack Unit Capacity
    // photo (see docs/web-clean-v1/DESKTOP_WEB_PARITY_AUDIT.md's Rack
    // Capacity section) - left null rather than fabricated.
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: null,
    rackComparison: null
  };
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
export function openReportPopup(name: string): Window {
  const popup = window.open("", name, "noopener,noreferrer");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.document.title = "Preparing report…";
  return popup;
}

/** Desktop's print HTML, populated only with the selected facility's API DTOs.
 *  fileName (without extension) becomes the print dialog's suggested "Save
 *  as PDF" name, via document.title - the browser convention for print-to-PDF.
 *  `popup` must come from openReportPopup(), called synchronously on click. */
export function printDesktopPdf(popup: Window, logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = []): void {
  const data = facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity);
  popup.document.open();
  popup.document.write(buildReportHtml(data));
  popup.document.close();
  if (fileName) popup.document.title = fileName;
  popup.addEventListener("load", () => popup.print(), { once: true });
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
    title: "Energy Monitor Site Comparison",
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
    rackUnitCapacity: [],
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: {
      self: primaryRow,
      other: secondary ? comparisonRow(secondary, referenceMonth) : null,
      selfTrend: comparisonTrend(primary, trendMonths),
      otherTrend: secondary ? comparisonTrend(secondary, trendMonths) : []
    },
    rackComparison: selfRack ? { self: { label: primary.site.name, records: selfRack.records }, other: secondary && otherRack ? { label: secondary.site.name, records: otherRack.records } : null } : null
  };
  popup.document.open();
  popup.document.write(buildReportHtml(report));
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}

/** Prints one full Desktop-compatible report per facility in one document.
 *  `popup` must come from openReportPopup(), called synchronously on click. */
export function printAllFacilitiesPdf(popup: Window, facilities: ExportFacility[], selectedMonth: string): void {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const reports = facilities.map(facility => buildReportHtml(facilityReportData(facility.logs, facility.siteName, selectedMonth, facility.rack ?? null, facility.rackHistory ?? [], facility.rackUnitCapacity ?? [])));
  const parsed = reports.map(html => new DOMParser().parseFromString(html, "text/html"));
  const style = parsed[0]?.head.querySelector("style")?.textContent ?? "";
  const body = parsed.map(document => document.body.innerHTML).join("<div style=\"page-break-before:always\"></div>");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Energy Monitor All Facilities</title><style>${style}</style></head><body>${body}</body></html>`);
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}
