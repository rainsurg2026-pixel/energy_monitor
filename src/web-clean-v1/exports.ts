import type { MonthlyLog } from "../types";
import { buildCombinedCsv, buildSectionCsvs } from "../utils/exportData";
import { calculateEnergyCostForMonth } from "../domain/energyCost";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { ReportData, ReportMonthlyRow } from "../reports/reportTypes";

export interface ExportFacility {
  siteName: string;
  logs: MonthlyLog[];
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

export function exportCsv(logs: MonthlyLog[], siteName: string): void {
  download(buildCombinedCsv(logs), `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.csv`, "text/csv;charset=utf-8");
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

async function workbookForFacilities(facilities: ExportFacility[]) {
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

export async function exportExcel(logs: MonthlyLog[], siteName: string): Promise<void> {
  const workbook = await workbookForFacilities([{ siteName, logs }]);
  const data = await workbook.xlsx.writeBuffer();
  download(data, `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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

function facilityReportData(logs: MonthlyLog[], siteName: string, selectedMonth: string): ReportData {
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
    rack: null,
    rackHistory: [],
    rackUnitCapacity: [],
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: null,
    rackComparison: null
  };
}

/** Desktop's print HTML, populated only with the selected facility's API DTOs. */
export function printDesktopPdf(logs: MonthlyLog[], siteName: string, selectedMonth: string): void {
  const data = facilityReportData(logs, siteName, selectedMonth);
  const popup = window.open("", "energy-monitor-report", "noopener,noreferrer");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.document.open();
  popup.document.write(buildReportHtml(data));
  popup.document.close();
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

/** Uses Desktop report renderer; comparison values come from the scoped API DTO. */
export function printSiteComparisonPdf(data: SiteComparisonExport, referenceMonth: string): void {
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
    rackComparison: null
  };
  const popup = window.open("", "energy-monitor-site-comparison", "noopener,noreferrer");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.document.open();
  popup.document.write(buildReportHtml(report));
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}

/** Prints one full Desktop-compatible report per facility in one document. */
export function printAllFacilitiesPdf(facilities: ExportFacility[], selectedMonth: string): void {
  if (facilities.length === 0) throw new Error("No facilities are available for export.");
  const reports = facilities.map(facility => buildReportHtml(facilityReportData(facility.logs, facility.siteName, selectedMonth)));
  const parsed = reports.map(html => new DOMParser().parseFromString(html, "text/html"));
  const style = parsed[0]?.head.querySelector("style")?.textContent ?? "";
  const body = parsed.map(document => document.body.innerHTML).join("<div style=\"page-break-before:always\"></div>");
  const popup = window.open("", "energy-monitor-all-facilities", "noopener,noreferrer");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Energy Monitor All Facilities</title><style>${style}</style></head><body>${body}</body></html>`);
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}
