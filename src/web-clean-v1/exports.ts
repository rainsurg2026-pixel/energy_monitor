import type { MonthlyLog } from "../types";
import { buildCombinedCsv, buildSectionCsvs } from "../utils/exportData";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "../domain/energyCost";
import { daysInUtcMonth, previousUtcMonth } from "../domain/dates";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { ReportData, ReportMonthlyRow, RackCapacityReport, RackRecord } from "../reports/reportTypes";
import { deriveRackCapacityReport } from "../reports/rackCapacityReportBuilder";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";

export interface ExportFacility {
  siteName: string;
  logs: MonthlyLog[];
  /** Full saved history used to calculate the selected export rows.  A
   *  single-month export still needs its preceding meter reading to produce
   *  the same air-energy calculation as Desktop. */
  calculationLogs?: MonthlyLog[];
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

type ExcelCellValue = string | number | Date | null;

function excelMonth(month: string): Date | string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : month;
}

function excelSavedDate(value: string | null): Date | string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

/** All numbers remain numeric Excel values (not CSV text), so filters,
 *  formulas and downstream BI can use them.  Month and save timestamps are
 *  stored as Excel dates; invalid legacy timestamp text is deliberately
 *  retained as text rather than silently changed. */
function addTypedSheet(workbook: any, name: string, headers: string[], rows: ExcelCellValue[][]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const values of rows) sheet.addRow(values);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 34;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: { row: 1, column: Math.max(1, headers.length) } };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  };
  sheet.headerFooter.oddHeader = `&B${name}&B`;
  sheet.headerFooter.oddFooter = `Data Center Energy & Facility Monitor | ${name} | Page &P of &N`;
  sheet.properties.defaultRowHeight = 19;
  sheet.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
    if (rowNumber === 1) return;
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
      cell.alignment = { vertical: "middle", wrapText: false };
      if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
    row.eachCell({ includeEmpty: false }, (cell: any) => {
      if (typeof cell.value === "number") cell.numFmt = "#,##0.00";
      if (cell.value instanceof Date) cell.numFmt = "dd-mmm-yy";
    });
  });
  sheet.columns.forEach((column: any, index: number) => { column.width = index === 0 ? 16 : 22; });
  return sheet;
}

function facilitySheetName(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}`.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31);
}

function addFacilityExportSheets(workbook: any, facility: ExportFacility): void {
  const logs = [...facility.logs].sort((left, right) => left.month.localeCompare(right.month));
  const calculationLogs = facility.calculationLogs ?? facility.logs;
  const prefix = facility.siteName.replace(/[^a-z0-9]+/giu, "-").slice(0, 12) || "facility";
  const airFields = Array.from(new Set(logs.flatMap(log => getAirFields(log)))).sort();

  // Keep the first worksheet useful when a user opens the downloaded file.
  // This is the web equivalent of Desktop's report/dashboard summary: source
  // inputs, persisted values, and the same derived calculation snapshot are
  // visible together, while section-specific sheets below retain every raw
  // reading.  Nulls remain blank rather than being converted to zero.
  addTypedSheet(workbook, facilitySheetName(prefix, "Summary"), [
    "Reporting Month",
    "Building Energy Input (kWh)",
    "Building Cost Input (THB)",
    "Last Saved UPS Date",
    "Last Saved Air Date",
    "Last Saved DC Date",
    "Last Saved Energy/Cost Date",
    "4th Floor Cost Saved (THB)",
    "Average Rate Saved (THB/kWh)",
    "UPS Energy Calculated (kWh)",
    "Air Energy Calculated (kWh)",
    "DC Energy Calculated (kWh)",
    "4th Floor Energy Calculated (kWh)",
    "4th Floor Cost Calculated (THB)",
    "Average Rate Calculated (THB/kWh)",
    "4th Floor Energy Share Calculated (%)",
    "Data Status"
  ], logs.map(log => {
    const calculation = calculateEnergyCostForMonth(calculationLogs, log.month);
    return [
      excelMonth(log.month),
      log.energyCost.buildingEnergyKwh,
      log.energyCost.buildingElectricityCostThb,
      excelSavedDate(log.lastSavedUps),
      excelSavedDate(log.lastSavedAir),
      excelSavedDate(log.lastSavedDc),
      excelSavedDate(log.lastSavedEnergyCost),
      log.energyCost.floorElectricityCostThb ?? null,
      log.energyCost.averageElectricityRateThbPerKwh ?? null,
      calculation.upsEnergyKwh,
      calculation.airEnergyKwh,
      calculation.dcEnergyKwh,
      calculation.floorEnergyKwh,
      calculation.floorElectricityCostThb,
      calculation.averageElectricityRateThbPerKwh,
      calculation.energySharePercent,
      calculation.floorEnergyKwh === null ? "Partial" : "Complete"
    ] as ExcelCellValue[];
  }));

  addTypedSheet(workbook, facilitySheetName(prefix, "UPS_Loads"), ["Reporting Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Last Saved Date"], logs.flatMap(log => log.ups.map(ups => [excelMonth(log.month), ups.upsId, ups.voltage, ups.current, ups.loadKw, ups.loadKva, excelSavedDate(log.lastSavedUps)])));
  const upsPhaseRows = logs.flatMap(log => log.ups.flatMap(ups => Object.entries(ups.phases ?? {}).map(([phase, values]) => [excelMonth(log.month), ups.upsId, phase, values.voltage, values.current, values.loadKw, values.loadKva, excelSavedDate(log.lastSavedUps)] as ExcelCellValue[])));
  if (upsPhaseRows.length > 0) addTypedSheet(workbook, facilitySheetName(prefix, "UPS_Phases"), ["Reporting Month", "UPS ID", "Phase", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Last Saved Date"], upsPhaseRows);
  addTypedSheet(workbook, facilitySheetName(prefix, "UPS_Calculations"), ["Reporting Month", "UPS ID", "Load (kW)", "Days in Month", "Monthly Energy Calculated (kWh)", "Last Saved Date"], logs.flatMap(log => {
    const days = daysInUtcMonth(log.month);
    return log.ups.map(ups => [
      excelMonth(log.month),
      ups.upsId,
      ups.loadKw,
      days,
      ups.loadKw === null || days === null ? null : ups.loadKw * 24 * days,
      excelSavedDate(log.lastSavedUps)
    ] as ExcelCellValue[]);
  }));
  addTypedSheet(workbook, facilitySheetName(prefix, "Air_Conditioning"), ["Reporting Month", ...airFields.map(field => `${field.toUpperCase()} (GWh)`), "Last Saved Date"], logs.map(log => [excelMonth(log.month), ...airFields.map(field => getAirValue(log, field)), excelSavedDate(log.lastSavedAir)]));
  addTypedSheet(workbook, facilitySheetName(prefix, "DC_Panels"), ["Reporting Month", "DC Panel", "Voltage (V)", "Current (A)", "Last Saved Date"], logs.flatMap(log => log.dc.map(panel => [excelMonth(log.month), panel.panelId, panel.voltage, panel.current, excelSavedDate(log.lastSavedDc)])));

  addTypedSheet(workbook, facilitySheetName(prefix, "Energy_Cost"), ["Reporting Month", "Building Energy Input (kWh)", "Building Cost Input (THB)", "Last Saved Date", "4th Floor Cost Saved (THB)", "Average Rate Saved (THB/kWh)", "UPS Energy Calculated (kWh)", "Air Energy Calculated (kWh)", "DC Energy Calculated (kWh)", "4th Floor Energy Calculated (kWh)", "4th Floor Cost Calculated (THB)", "Average Rate Calculated (THB/kWh)", "4th Floor Energy Share Calculated (%)"], logs.map(log => {
    const calculation = calculateEnergyCostForMonth(calculationLogs, log.month);
    return [excelMonth(log.month), log.energyCost.buildingEnergyKwh, log.energyCost.buildingElectricityCostThb, excelSavedDate(log.lastSavedEnergyCost), log.energyCost.floorElectricityCostThb ?? null, log.energyCost.averageElectricityRateThbPerKwh ?? null, calculation.upsEnergyKwh, calculation.airEnergyKwh, calculation.dcEnergyKwh, calculation.floorEnergyKwh, calculation.floorElectricityCostThb, calculation.averageElectricityRateThbPerKwh, calculation.energySharePercent];
  }));

  addTypedSheet(workbook, facilitySheetName(prefix, "Air_Calculations"), ["Reporting Month", "Meter", "Previous Reading (GWh)", "Current Reading (GWh)", "Difference (GWh)", "Energy Contribution (kWh)", "Last Saved Date"], logs.flatMap(log => {
    const previousMonth = previousUtcMonth(log.month);
    const previous = previousMonth ? calculationLogs.find(candidate => candidate.month === previousMonth) ?? null : null;
    return getAirFields(log).map(field => {
      const current = getAirValue(log, field);
      const previousValue = previous ? getAirValue(previous, field) : null;
      const difference = current === null || previousValue === null ? null : current - previousValue;
      return [excelMonth(log.month), field.toUpperCase(), previousValue, current, difference, difference === null ? null : difference * 1000000, excelSavedDate(log.lastSavedAir)];
    });
  }));

  addTypedSheet(workbook, facilitySheetName(prefix, "DC_Calculations"), ["Reporting Month", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current (A)", "AC Power (W)", "Monthly Energy (kWh)", "Last Saved Date"], logs.flatMap(log => {
    const days = daysInUtcMonth(log.month);
    return log.dc.map(panel => {
      const dcPower = panel.voltage === null || panel.current === null ? null : panel.voltage * panel.current;
      const acPower = dcPower === null ? null : dcPower / 200 * 220;
      return [excelMonth(log.month), panel.panelId, panel.voltage, panel.current, dcPower, acPower === null ? null : acPower / 220, acPower, acPower === null || days === null ? null : acPower * 24 * days / 1000, excelSavedDate(log.lastSavedDc)];
    });
  }));

  const phaseRows: ExcelCellValue[][] = [];
  for (const log of logs) {
    const inputs = log.srinakarinInputs;
    if (!inputs) continue;
    for (const [id, value] of Object.entries(inputs.upsPhase)) phaseRows.push([excelMonth(log.month), "UPS phase", id, value.voltage, value.current, value.loadKw, value.loadKva, excelSavedDate(log.lastSavedUps)]);
    for (const [id, value] of Object.entries(inputs.acPhase)) phaseRows.push([excelMonth(log.month), "AC phase", id, value.voltage, value.current, null, null, excelSavedDate(log.lastSavedUps)]);
    for (const [id, current] of Object.entries(inputs.ppc43Current)) phaseRows.push([excelMonth(log.month), "PPC43 current", id, null, current, null, null, excelSavedDate(log.lastSavedUps)]);
    for (const [id, value] of Object.entries(inputs.ppc43Panel)) phaseRows.push([excelMonth(log.month), "PPC43 panel", id, null, null, value.loadKw, value.loadKva, excelSavedDate(log.lastSavedUps)]);
  }
  if (phaseRows.length > 0) addTypedSheet(workbook, facilitySheetName(prefix, "Srinakarin_Inputs"), ["Reporting Month", "Input Group", "Input ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Last Saved Date"], phaseRows);

  if (facility.rack?.records.length) {
    addTypedSheet(workbook, facilitySheetName(prefix, "Rack_Capacity_Snapshot"), ["Reporting Month", "Row Number", "Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"], facility.rack.records.map(record => [
      excelMonth(facility.rack?.sourceSnapshot ?? ""),
      record.rowNumber,
      record.rackZone,
      record.rackId,
      record.status,
      record.cabinetSize,
      record.detail,
      record.deviceType,
      record.remarks
    ]));
  }

  if (facility.rackHistory && facility.rackHistory.length > 0) {
    addTypedSheet(workbook, facilitySheetName(prefix, "Rack_Capacity_History"), ["Snapshot Month", "Facility", "Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle", "Other", "Usage Ratio", "Availability Ratio", "Reserved Ratio", "Pending Dismantle Ratio", "Other Ratio", "Generated Date", "Data Version"], facility.rackHistory.map(row => [
      excelMonth(row.snapshotMonth),
      row.facility,
      row.rackZone,
      row.totalRacks,
      row.inUse,
      row.available,
      row.reserved,
      row.pendingDismantle,
      row.other,
      row.usagePct,
      row.availabilityPct,
      row.reservedPct,
      row.pendingDismantlePct,
      row.otherPct,
      excelSavedDate(row.generatedAt),
      row.dataVersion
    ]));
  }

  if (facility.rackUnitCapacity && facility.rackUnitCapacity.length > 0) {
    addTypedSheet(workbook, facilitySheetName(prefix, "Rack_Unit_Capacity"), ["Reporting Month", "Total (U)", "Used (U)", "Available (U)", "Availability Ratio"], facility.rackUnitCapacity.map(row => [
      excelMonth(row.month),
      row.totalU,
      row.usedU,
      row.availableU,
      row.availabilityPct
    ]));
  }
}

export async function workbookForFacilities(facilities: ExportFacility[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const facility of facilities) addFacilityExportSheets(workbook, facility);
  return workbook;
}

export async function exportExcel(logs: MonthlyLog[], siteName: string, fileName?: string, calculationLogs: MonthlyLog[] = logs, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = []): Promise<void> {
  const workbook = await workbookForFacilities([{ siteName, logs, calculationLogs, rack, rackHistory, rackUnitCapacity }]);
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
  addTypedSheet(workbook, "Site Comparison", ["Facility", "Site code", "Reporting month", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"], data.sites.map(site => {
    const metrics = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null;
    return [site.site.name, site.site.code, excelMonth(referenceMonth), metrics?.buildingEnergy ?? null, metrics?.buildingCost ?? null, metrics?.floorEnergy ?? null, metrics?.floorCost ?? null, metrics?.avgRate ?? null, metrics?.floorShare ?? null];
  }));
  const bytes = await workbook.xlsx.writeBuffer();
  download(bytes, `site-comparison-${referenceMonth}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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

export function facilityReportData(logs: MonthlyLog[], siteName: string, selectedMonth: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs): ReportData {
  const rows = reportRows(logs, calculationLogs);
  const current = rows.find(row => row.month === selectedMonth) ?? null;
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
    engineeringDashboard: buildEngineeringDashboardSnapshot(calculationLogs, selectedMonth, null),
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
export function printDesktopPdf(popup: Window, logs: MonthlyLog[], siteName: string, selectedMonth: string, fileName?: string, rack: RackCapacityReport | null = null, rackHistory: RackCapacityHistoryRow[] = [], rackUnitCapacity: RackUnitCapacityRow[] = [], calculationLogs: MonthlyLog[] = logs): void {
  const data = facilityReportData(logs, siteName, selectedMonth, rack, rackHistory, rackUnitCapacity, calculationLogs);
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
  const reports = facilities.map(facility => buildReportHtml(facilityReportData(facility.logs, facility.siteName, selectedMonth, facility.rack ?? null, facility.rackHistory ?? [], facility.rackUnitCapacity ?? [], facility.calculationLogs ?? facility.logs)));
  const parsed = reports.map(html => new DOMParser().parseFromString(html, "text/html"));
  const style = parsed[0]?.head.querySelector("style")?.textContent ?? "";
  const body = parsed.map(document => document.body.innerHTML).join("<div style=\"page-break-before:always\"></div>");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Data Center Energy & Facility Monitor All Facilities</title><style>${style}</style></head><body>${body}</body></html>`);
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}
