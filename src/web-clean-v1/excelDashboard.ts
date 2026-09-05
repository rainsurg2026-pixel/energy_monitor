import JSZip from "jszip";
import { monthLabelShort } from "../utils/monthUtils";
import { formatBangkokReportTimestamp } from "../utils";

export interface ExcelDashboardMetric {
  month: string;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
  upsEnergyKwh: number | null;
  airEnergyKwh: number | null;
  dcEnergyKwh: number | null;
  upsLoadKw: number | null;
  upsLoadPercent: number | null;
  rackTotalU: number | null;
  rackUsedU: number | null;
  rackAvailableU: number | null;
  rackUsagePercent: number | null;
}

interface ExcelDashboardSeries {
  name: string;
  range: string;
  values: Array<number | null>;
  color: string;
}

interface ExcelDashboardChart {
  title: string;
  kind: "line" | "bar";
  categoryRange: string;
  categories: string[];
  series: ExcelDashboardSeries[];
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

export interface ExcelDashboardPlan {
  dashboardSheetName: string;
  charts: ExcelDashboardChart[];
}

const WHITE = "FFFFFFFF";
const DARK_BLUE = "FF0F172A";
const NAVY = "FF1E3A5F";
const TEAL = "FF007A75";
const LIGHT_TEAL = "FFE8F5F3";
const LIGHT_BLUE = "FFEAF1F8";
const LIGHT_AMBER = "FFFFF4DE";
const LIGHT_RED = "FFFDECEC";
const BORDER = "FFD5DEE8";
const TEXT = "FF243247";
const MUTED = "FF657488";

function safeSheetName(prefix: string, name: string): string {
  const title = name.replace(/[\\/*?:\[\]]/g, "-");
  const prefixLength = Math.max(1, 31 - title.length - 1);
  return `${prefix.slice(0, prefixLength)}-${title}`.slice(0, 31);
}

function excelSheetRef(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function cellFormula(formula: string, result: number | string | null): { formula: string; result: number | string } {
  return { formula, result: result ?? "" };
}

function applyCellStyle(cell: any, fill: string, font: any, alignment: any = { vertical: "middle" }): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.font = font;
  cell.alignment = alignment;
  cell.border = {
    top: { style: "thin", color: { argb: BORDER } },
    left: { style: "thin", color: { argb: BORDER } },
    bottom: { style: "thin", color: { argb: BORDER } },
    right: { style: "thin", color: { argb: BORDER } }
  };
}

function styleRange(sheet: any, fromRow: number, toRow: number, fromCol: number, toCol: number, fill: string, font: any, alignment?: any): void {
  for (let row = fromRow; row <= toRow; row++) {
    for (let col = fromCol; col <= toCol; col++) applyCellStyle(sheet.getCell(row, col), fill, font, alignment);
  }
}

function addCard(sheet: any, fromCol: number, toCol: number, topRow: number, label: string, formula: { formula: string; result: number | string }, numberFormat: string, _fill: string): void {
  sheet.mergeCells(topRow, fromCol, topRow, toCol);
  sheet.mergeCells(topRow + 1, fromCol, topRow + 2, toCol);
  styleRange(sheet, topRow, topRow, fromCol, toCol, WHITE, { name: "Aptos", size: 9, bold: true, color: { argb: MUTED } }, { vertical: "middle", horizontal: "left" });
  styleRange(sheet, topRow + 1, topRow + 2, fromCol, toCol, WHITE, { name: "Aptos Display", size: 18, bold: true, color: { argb: NAVY } }, { vertical: "middle", horizontal: "left" });
  sheet.getCell(topRow, fromCol).value = label;
  const valueCell = sheet.getCell(topRow + 1, fromCol);
  valueCell.value = formula;
  valueCell.numFmt = numberFormat;
}

function lookupFormula(dataSheetName: string, column: string, rowEnd: number, result: number | null): { formula: string; result: number | string } {
  const data = excelSheetRef(dataSheetName);
  return cellFormula(`IFERROR(INDEX(${data}!$${column}$2:$${column}$${rowEnd},MATCH($B$3,${data}!$A$2:$A$${rowEnd},0)),"")`, result);
}

function setFormulaCell(sheet: any, address: string, value: { formula: string; result: number | string }, numberFormat?: string): void {
  const cell = sheet.getCell(address);
  cell.value = value;
  if (numberFormat) cell.numFmt = numberFormat;
}

function metricValue(metric: ExcelDashboardMetric | undefined, key: keyof ExcelDashboardMetric): number | null {
  const value = metric?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chartRange(sheetName: string, column: string, firstRow: number, lastRow: number): string {
  return `${excelSheetRef(sheetName)}!$${column}$${firstRow}:$${column}$${lastRow}`;
}

export function addDashboardDataSheet(workbook: any, dataSheetName: string, metrics: ExcelDashboardMetric[]): void {
  const sheet = workbook.addWorksheet(dataSheetName);
  sheet.state = "hidden";
  sheet.addRow(["Month", "Label", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "UPS Load (kW)", "UPS Load (%)", "Rack Total (U)", "Rack Used (U)", "Rack Available (U)", "Rack Usage (%)"]);
  for (const metric of metrics) {
    sheet.addRow([
      metric.month,
      monthLabelShort(metric.month, "en"),
      metric.buildingEnergyKwh,
      metric.buildingCostThb,
      metric.floorEnergyKwh,
      metric.floorCostThb,
      metric.averageRateThbPerKwh,
      metric.floorSharePercent,
      metric.upsEnergyKwh,
      metric.airEnergyKwh,
      metric.dcEnergyKwh,
      metric.upsLoadKw,
      metric.upsLoadPercent,
      metric.rackTotalU,
      metric.rackUsedU,
      metric.rackAvailableU,
      metric.rackUsagePercent
    ]);
  }
  sheet.getRow(1).font = { name: "Aptos", bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column: any, index: number) => { column.width = index < 2 ? 14 : 20; });
  for (let row = 2; row <= Math.max(2, metrics.length + 1); row++) {
    for (const column of [3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16]) sheet.getCell(row, column).numFmt = "#,##0.00";
    for (const column of [8, 13, 17]) sheet.getCell(row, column).numFmt = "0.00";
  }
}

export function addInteractiveDashboard(workbook: any, prefix: string, siteName: string, metrics: ExcelDashboardMetric[], options: { dashboardSheetName?: string; dataSheetName?: string; includeDataSheet?: boolean; exportedBy?: string | null; exportedAt?: string; trendMetrics?: ExcelDashboardMetric[]; trendDataSheetName?: string } = {}): ExcelDashboardPlan {
  const dashboardSheetName = options.dashboardSheetName ?? safeSheetName(prefix, "Dashboard");
  const dataSheetName = options.dataSheetName ?? safeSheetName(prefix, "Dashboard_Data");
  const trendMetrics = options.trendMetrics ?? metrics;
  const trendDataSheetName = options.trendDataSheetName ?? dataSheetName;
  const dashboard = workbook.addWorksheet(dashboardSheetName);
  if (options.includeDataSheet !== false) {
    if (trendDataSheetName !== dataSheetName) addDashboardDataSheet(workbook, trendDataSheetName, trendMetrics);
    addDashboardDataSheet(workbook, dataSheetName, metrics);
  }
  const dataRowEnd = Math.max(2, metrics.length + 1);
  const selectedMetric = metrics.at(-1);
  const data = excelSheetRef(dataSheetName);
  const lookup = (column: string, key: keyof ExcelDashboardMetric) => lookupFormula(dataSheetName, column, dataRowEnd, metricValue(selectedMetric, key));

  dashboard.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  dashboard.properties.tabColor = TEAL;
  dashboard.mergeCells("A1:N1");
  dashboard.getCell("A1").value = "Data Center Energy & Facility Monitor — Interactive Dashboard";
  dashboard.getCell("A1").font = { name: "Aptos Display", size: 20, bold: true, color: { argb: NAVY } };
  dashboard.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  dashboard.getRow(1).height = 34;
  dashboard.mergeCells("A2:N2");
  dashboard.getCell("A2").value = `${siteName} · Select a reporting month to refresh the cards and selected-month chart`;
  dashboard.getCell("A2").font = { name: "Aptos", size: 10, color: { argb: MUTED }, italic: true };
  dashboard.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
  dashboard.getCell("A3").value = "Reporting Month";
  dashboard.getCell("A3").font = { name: "Aptos", size: 10, bold: true, color: { argb: TEXT } };
  dashboard.getCell("B3").value = selectedMetric?.month ?? "";
  dashboard.getCell("B3").font = { name: "Aptos", size: 11, bold: true, color: { argb: TEAL } };
  dashboard.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("B3").border = { top: { style: "thin", color: { argb: TEAL } }, left: { style: "thin", color: { argb: TEAL } }, bottom: { style: "thin", color: { argb: TEAL } }, right: { style: "thin", color: { argb: TEAL } } };
  if (metrics.length > 0) dashboard.getCell("B3").dataValidation = { type: "list", allowBlank: false, formulae: [`$Z$2:$Z$${metrics.length + 1}`] };
  dashboard.getCell("D3").value = "Facility";
  dashboard.getCell("D3").font = { name: "Aptos", size: 10, bold: true, color: { argb: TEXT } };
  dashboard.mergeCells("E3:G3");
  dashboard.getCell("E3").value = siteName;
  dashboard.getCell("E3").font = { name: "Aptos", size: 10, color: { argb: TEXT } };
  dashboard.getCell("I3").value = "Source";
  dashboard.getCell("I3").font = { name: "Aptos", size: 10, bold: true, color: { argb: TEXT } };
  dashboard.mergeCells("J3:N3");
  dashboard.getCell("J3").value = "Supabase PostgreSQL / Production API";
  dashboard.getCell("J3").font = { name: "Aptos", size: 10, color: { argb: MUTED } };
  dashboard.getRow(4).height = 24;
  dashboard.getCell("A4").value = "Generated By";
  dashboard.getCell("A4").font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  dashboard.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("A4").alignment = { vertical: "middle", horizontal: "center" };
  dashboard.mergeCells("B4:E4");
  dashboard.getCell("B4").value = options.exportedBy?.trim() || "N/A";
  dashboard.getCell("B4").font = { name: "Aptos", size: 10, bold: true, color: { argb: NAVY } };
  dashboard.getCell("B4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("B4").alignment = { vertical: "middle", horizontal: "left" };
  dashboard.getCell("G4").value = "Generated At";
  dashboard.getCell("G4").font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  dashboard.getCell("G4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("G4").alignment = { vertical: "middle", horizontal: "center" };
  dashboard.mergeCells("H4:N4");
  dashboard.getCell("H4").value = options.exportedAt ? formatBangkokReportTimestamp(options.exportedAt) : "N/A";
  dashboard.getCell("H4").font = { name: "Aptos", size: 10, color: { argb: MUTED } };
  dashboard.getCell("H4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("H4").alignment = { vertical: "middle", horizontal: "right" };

  const percentFormat = "0.00";
  const numberFormat = "#,##0.00";
  addCard(dashboard, 1, 3, 5, "Building Energy (kWh)", lookup("C", "buildingEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 4, 6, 5, "Building Cost (THB)", lookup("D", "buildingCostThb"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 7, 9, 5, "4th Floor Energy (kWh)", lookup("E", "floorEnergyKwh"), numberFormat, LIGHT_TEAL);
  addCard(dashboard, 10, 12, 5, "4th Floor Cost (THB)", lookup("F", "floorCostThb"), numberFormat, LIGHT_TEAL);
  addCard(dashboard, 13, 14, 5, "Floor Share (%)", lookup("H", "floorSharePercent"), percentFormat, LIGHT_AMBER);
  const upsStatus = selectedMetric?.upsLoadPercent === null || selectedMetric?.upsLoadPercent === undefined
    ? "No data"
    : selectedMetric.upsLoadPercent >= 90 ? "Critical" : selectedMetric.upsLoadPercent >= 80 ? "Warning" : "Normal";
  addCard(dashboard, 1, 3, 9, "UPS Status", cellFormula('IF(Q9="","No data",IF(Q9>=90,"Critical",IF(Q9>=80,"Warning","Normal")))', upsStatus), "@", upsStatus === "Critical" ? LIGHT_RED : upsStatus === "Warning" ? LIGHT_AMBER : LIGHT_TEAL);
  addCard(dashboard, 4, 6, 9, "UPS Energy (kWh)", lookup("I", "upsEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 7, 9, 9, "Air Energy (kWh)", lookup("J", "airEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 10, 12, 9, "DC Energy (kWh)", lookup("K", "dcEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 13, 14, 9, "Rack Usage (%)", lookup("Q", "rackUsagePercent"), percentFormat, LIGHT_AMBER);

  dashboard.mergeCells("A13:N13");
  dashboard.getCell("A13").value = "Selected-month Engineering Analysis";
  dashboard.getCell("A13").font = { name: "Aptos Display", size: 13, bold: true, color: { argb: NAVY } };
  dashboard.getCell("A13").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  dashboard.getCell("A13").alignment = { vertical: "middle", horizontal: "left" };
  dashboard.getRow(13).height = 24;
  dashboard.getCell("A14").value = "Metric";
  dashboard.getCell("B14").value = "Value";
  dashboard.getCell("C14").value = "Unit / Interpretation";
  dashboard.mergeCells("C14:D14");
  for (const address of ["A14", "B14", "C14"]) applyCellStyle(dashboard.getCell(address), WHITE, { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } }, { vertical: "middle", horizontal: "left" });
  const selectedRows: Array<[string, { formula: string; result: number | string }, string]> = [
    ["UPS Load", lookup("L", "upsLoadKw"), "kW"],
    ["UPS Load", lookup("M", "upsLoadPercent"), "%"],
    ["Rack Used", lookup("O", "rackUsedU"), "U"],
    ["Rack Available", lookup("P", "rackAvailableU"), "U"],
    ["Rack Total", lookup("N", "rackTotalU"), "U"]
  ];
  selectedRows.forEach(([label, value, unit], index) => {
    const row = 15 + index;
    dashboard.getCell(row, 1).value = label;
    dashboard.getCell(row, 2).value = value;
    dashboard.getCell(row, 2).numFmt = unit === "%" ? percentFormat : numberFormat;
    dashboard.mergeCells(row, 3, row, 4);
    dashboard.getCell(row, 3).value = unit;
    for (const column of [1, 2, 3]) applyCellStyle(dashboard.getCell(row, column), "FFFFFFFF", { name: "Aptos", size: 9, color: { argb: TEXT } }, { vertical: "middle", horizontal: column === 2 ? "right" : "left" });
  });

  // Helper cells drive the selected-month chart. They are hidden from the
  // polished dashboard surface but remain normal formulas that Excel updates
  // when B3 changes.
  const helperLabels = [["UPS Energy"], ["Air Energy"], ["DC Energy"], ["4th Floor Energy"], ["Used (U)"], ["Available (U)"], ["Total (U)"], ["UPS Load (%)"], ["UPS Available (%)"]];
  helperLabels.forEach(([label], index) => { dashboard.getCell(index + 2, 16).value = label; });
  setFormulaCell(dashboard, "Q2", lookup("I", "upsEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q3", lookup("J", "airEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q4", lookup("K", "dcEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q5", lookup("E", "floorEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q6", lookup("O", "rackUsedU"), numberFormat);
  setFormulaCell(dashboard, "Q7", lookup("P", "rackAvailableU"), numberFormat);
  setFormulaCell(dashboard, "Q8", lookup("N", "rackTotalU"), numberFormat);
  setFormulaCell(dashboard, "Q9", lookup("M", "upsLoadPercent"), percentFormat);
  setFormulaCell(dashboard, "Q10", cellFormula('IF(Q9="","",100-Q9)', selectedMetric?.upsLoadPercent === null || selectedMetric?.upsLoadPercent === undefined ? "" : 100 - selectedMetric.upsLoadPercent), percentFormat);
  dashboard.getColumn(16).hidden = true;
  dashboard.getColumn(17).hidden = true;
  dashboard.getColumn(26).hidden = true;
  metrics.forEach((metric, index) => { dashboard.getCell(index + 2, 26).value = metric.month; });

  dashboard.columns = [
    { key: "a", width: 19 }, { key: "b", width: 16 }, { key: "c", width: 16 }, { key: "d", width: 16 },
    { key: "e", width: 16 }, { key: "f", width: 16 }, { key: "g", width: 16 }, { key: "h", width: 16 },
    { key: "i", width: 16 }, { key: "j", width: 16 }, { key: "k", width: 16 }, { key: "l", width: 16 },
    { key: "m", width: 16 }, { key: "n", width: 16 }
  ];
  for (const row of [5, 6, 7, 9, 10, 11]) dashboard.getRow(row).height = 22;
  for (let row = 20; row <= 52; row++) dashboard.getRow(row).height = 18;

  const firstDataRow = 2;
  const lastDataRow = Math.max(firstDataRow, trendMetrics.length + 1);
  const categoryRange = chartRange(trendDataSheetName, "B", firstDataRow, lastDataRow);
  const categories = trendMetrics.map(metric => monthLabelShort(metric.month, "en"));
  const series = (name: string, column: string, key: keyof ExcelDashboardMetric, color: string): ExcelDashboardSeries => ({ name, range: chartRange(trendDataSheetName, column, firstDataRow, lastDataRow), values: trendMetrics.map(metric => metricValue(metric, key)), color });
  return {
    dashboardSheetName,
    charts: trendMetrics.length === 0 ? [] : [
      { title: "Monthly Energy Consumption Trend", kind: "line", categoryRange, categories, series: [series("Building Energy", "C", "buildingEnergyKwh", "E4572E"), series("4th Floor Energy", "E", "floorEnergyKwh", "007A75"), series("UPS Energy", "I", "upsEnergyKwh", "4472C4"), series("Air Energy", "J", "airEnergyKwh", "ED9B40"), series("DC Energy", "K", "dcEnergyKwh", "6B7280")], fromCol: 0, fromRow: 19, toCol: 7, toRow: 35 },
      { title: "Monthly Energy Cost Trend", kind: "line", categoryRange, categories, series: [series("Building Cost", "D", "buildingCostThb", "E4572E"), series("4th Floor Cost", "F", "floorCostThb", "007A75")], fromCol: 7, fromRow: 19, toCol: 14, toRow: 35 },
      { title: "Rack Unit Capacity and Utilization Trend", kind: "line", categoryRange, categories, series: [series("Total (U)", "N", "rackTotalU", "1E3A5F"), series("Used (U)", "O", "rackUsedU", "E4572E"), series("Available (U)", "P", "rackAvailableU", "00A878")], fromCol: 0, fromRow: 36, toCol: 7, toRow: 52 },
      { title: "Selected Month Energy Breakdown", kind: "bar", categoryRange: `${excelSheetRef(dashboardSheetName)}!$P$2:$P$5`, categories: ["UPS Energy", "Air Energy", "DC Energy", "4th Floor Energy"], series: [{ name: "Energy (kWh)", range: `${excelSheetRef(dashboardSheetName)}!$Q$2:$Q$5`, values: [metricValue(selectedMetric, "upsEnergyKwh"), metricValue(selectedMetric, "airEnergyKwh"), metricValue(selectedMetric, "dcEnergyKwh"), metricValue(selectedMetric, "floorEnergyKwh")], color: "007A75" }], fromCol: 7, fromRow: 36, toCol: 14, toRow: 52 }
    ]
  };
}

export interface CurrentFacilityDashboardOptions {
  dashboardSheetName: string;
  dataSheetName: string;
  selectedMonth: string;
  exportedAt: string;
  exportedBy?: string | null;
  airSheetName: string;
  airDashboardSheetName: string;
  rackSheetName: string;
  rackUnitSheetName: string;
  upsSheetName: string;
  detailSheetName: string;
  dcSheetName: string;
  airFields: string[];
  airRows: Array<{ month: string; values: Array<number | null> }>;
  airDashboardRows: unknown[][];
  upsRows: unknown[][];
  detailRows: unknown[][];
  dcRows: unknown[][];
  rackRows: Array<{ month: string; zone: string; total: number; inUse: number; available: number; reserved: number; pending: number; other: number; usage: number | null; availability: number | null }>;
  rackUnitRows: Array<{ month: string; total: number; used: number; available: number; usage: number | null; availability: number | null }>;
  /** Chart-only scope. Matches Quick Period unless the report contains one month, when it is trailing 12. */
  trendMetrics?: ExcelDashboardMetric[];
  trendDataSheetName?: string;
  rackImageDataUri?: string | null;
  rackImageMeta?: { savedAt: string; savedBy: string; width: number; height: number } | null;
}

function excelColumnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function currentLookup(sheetName: string, column: string, rowEnd: number, result: number | string | null): { formula: string; result: number | string } {
  const data = excelSheetRef(sheetName);
  const formula = "IFERROR(INDEX(" + data + "!$" + column + "$2:$" + column + "$" + rowEnd + ",MATCH($B$3," + data + "!$A$2:$A$" + rowEnd + ",0)),\"\")";
  return cellFormula(formula, result);
}

function nthMonthLookup(sheetName: string, column: string, rowEnd: number, nth: number, result: number | string | null): { formula: string; result: number | string } {
  const data = excelSheetRef(sheetName);
  const rows = `ROW(${data}!$A$2:$A$${rowEnd})-ROW(${data}!$A$2)+1`;
  const position = `AGGREGATE(15,6,(${rows})/(${data}!$A$2:$A$${rowEnd}=$B$3),${nth})`;
  return cellFormula(`IFERROR(INDEX(${data}!$${column}$2:$${column}$${rowEnd},${position}),\"\")`, result);
}

function rowsForMonth(rows: unknown[][], month: string): unknown[][] {
  return rows.filter(row => String(row[0] ?? "") === month);
}

function maxRowsPerMonth(rows: unknown[][]): number {
  const counts = new Map<string, number>();
  rows.forEach(row => { const month = String(row[0] ?? ""); counts.set(month, (counts.get(month) ?? 0) + 1); });
  return Math.max(1, ...counts.values());
}

function numberResult(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textResult(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function sectionHeading(sheet: any, row: number, title: string): void {
  sheet.mergeCells(row, 1, row, 14);
  const cell = sheet.getCell(row, 1);
  cell.value = title;
  cell.font = { name: "Aptos Display", size: 14, bold: true, color: { argb: NAVY } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(row).height = 25;
}

function dashboardTableHeader(sheet: any, row: number, headers: string[], fromCol = 1): void {
  headers.forEach((header, index) => {
    const cell = sheet.getCell(row, fromCol + index);
    cell.value = header;
    applyCellStyle(cell, WHITE, { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } }, { vertical: "middle", horizontal: "left" });
  });
}

function dashboardBodyRow(sheet: any, row: number, values: unknown[], fromCol = 1): void {
  values.forEach((value, index) => {
    const cell = sheet.getCell(row, fromCol + index);
    cell.value = value as any;
    applyCellStyle(cell, "FFFFFFFF", { name: "Aptos", size: 9, color: { argb: TEXT } }, { vertical: "middle", horizontal: index === 1 ? "right" : "left" });
  });
}

function addCurrentFacilityImage(workbook: any, sheet: any, dataUri: string | null | undefined, meta: CurrentFacilityDashboardOptions["rackImageMeta"], row: number): void {
  if (!dataUri || !/^data:image\/(png|jpe?g);base64,/i.test(dataUri)) {
    sheet.mergeCells(row, 9, row + 7, 14);
    sheet.getCell(row, 9).value = "No rack image available for the selected reporting month.";
    sheet.getCell(row, 9).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    sheet.getCell(row, 9).font = { name: "Aptos", size: 10, italic: true, color: { argb: MUTED } };
    sheet.getCell(row, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
    return;
  }
  const imageId = workbook.addImage({ base64: dataUri, extension: /^data:image\/jpe?g;/i.test(dataUri) ? "jpeg" : "png" });
  const width = 340;
  const height = meta && meta.width > 0 && meta.height > 0 ? Math.min(190, width * meta.height / meta.width) : 190;
  sheet.addImage(imageId, { tl: { col: 8, row: row - 1 }, ext: { width, height } });
  sheet.mergeCells(row + 8, 9, row + 8, 14);
  sheet.getCell(row + 8, 9).value = "Embedded Rack Unit Capacity image" + (meta && meta.savedAt ? " - captured " + meta.savedAt : "");
  sheet.getCell(row + 8, 9).font = { name: "Aptos", size: 9, italic: true, color: { argb: MUTED } };
}

/** Current Facility's single-sheet dashboard: shared values are looked up by
 * the selected month; Excel recalculates formulas and native charts on open. */
export function addCurrentFacilityDashboard(workbook: any, siteName: string, metrics: ExcelDashboardMetric[], options: CurrentFacilityDashboardOptions): ExcelDashboardPlan {
  const sheet = workbook.addWorksheet(options.dashboardSheetName);
  const dataRowEnd = Math.max(2, metrics.length + 1);
  const selected = metrics.find(metric => metric.month === options.selectedMonth);
  const selectedIndex = metrics.findIndex(metric => metric.month === options.selectedMonth);
  const previousMetric = selectedIndex > 0 ? metrics[selectedIndex - 1] : undefined;
  const lookup = (column: string, key: keyof ExcelDashboardMetric) => currentLookup(options.dataSheetName, column, dataRowEnd, metricValue(selected, key));
  const data = excelSheetRef(options.dataSheetName);
  const rackEnd = Math.max(2, options.rackRows.length + 1);
  const unitEnd = Math.max(2, options.rackUnitRows.length + 1);
  const upsEnd = Math.max(2, options.upsRows.length + 1);
  const detailEnd = Math.max(2, options.detailRows.length + 1);
  const dcEnd = Math.max(2, options.dcRows.length + 1);
  const airDashboardEnd = Math.max(2, options.airDashboardRows.length + 1);
  const trendMetrics = options.trendMetrics ?? metrics;
  const trendDataSheetName = options.trendDataSheetName ?? options.dataSheetName;
  const trendDataRowEnd = Math.max(2, trendMetrics.length + 1);
  const reportPeriodLabel = metrics.length > 0 ? `${monthLabelShort(metrics[0].month, "en")} - ${monthLabelShort(metrics.at(-1)!.month, "en")}` : "N/A";
  const trendPeriodLabel = trendMetrics.length > 0 ? `${monthLabelShort(trendMetrics[0].month, "en")} - ${monthLabelShort(trendMetrics.at(-1)!.month, "en")}` : "N/A";
  const upsSelectedRows = rowsForMonth(options.upsRows, options.selectedMonth);
  const detailSelectedRows = rowsForMonth(options.detailRows, options.selectedMonth);
  const dcSelectedRows = rowsForMonth(options.dcRows, options.selectedMonth);
  const airDashboardSelectedRows = rowsForMonth(options.airDashboardRows, options.selectedMonth);
  const upsMaxRows = maxRowsPerMonth(options.upsRows);
  const detailMaxRows = maxRowsPerMonth(options.detailRows);
  const dcMaxRows = maxRowsPerMonth(options.dcRows);

  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.properties.tabColor = TEAL;
  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = "Data Center Energy & Facility Monitor Report";
  sheet.getCell("A1").font = { name: "Aptos Display", size: 22, bold: true, color: { argb: NAVY } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getCell("A1").border = { bottom: { style: "medium", color: { argb: TEAL } } };
  sheet.getRow(1).height = 38;
  sheet.mergeCells("A2:N2");
  sheet.getCell("A2").value = `${siteName} | Current Facility | Excel report aligned to the PDF report layout`;
  sheet.getCell("A2").font = { name: "Aptos", size: 10, italic: true, color: { argb: MUTED } };
  sheet.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 26;
  sheet.getCell("A3").value = "Reporting Month";
  sheet.getCell("D3").value = "Facility";
  sheet.getCell("G3").value = "Generated By";
  sheet.getCell("J3").value = "Generated At";
  for (const address of ["A3", "D3", "G3", "J3"]) {
    const cell = sheet.getCell(address);
    cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  }
  sheet.getCell("B3").value = options.selectedMonth;
  sheet.getCell("B3").font = { name: "Aptos", size: 11, bold: true, color: { argb: TEAL } };
  sheet.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
  sheet.getCell("B3").alignment = { vertical: "middle", horizontal: "center" };
  sheet.getCell("B3").border = { top: { style: "thin", color: { argb: TEAL } }, left: { style: "thin", color: { argb: TEAL } }, bottom: { style: "thin", color: { argb: TEAL } }, right: { style: "thin", color: { argb: TEAL } } };
  sheet.getCell("B3").dataValidation = { type: "list", allowBlank: false, formulae: ["AvailableReportingMonths"] };
  sheet.mergeCells("E3:F3");
  sheet.getCell("E3").value = siteName;
  sheet.getCell("E3").font = { name: "Aptos", size: 10, bold: true, color: { argb: NAVY } };
  sheet.mergeCells("H3:I3");
  sheet.getCell("H3").value = options.exportedBy?.trim() || "N/A";
  sheet.getCell("H3").font = { name: "Aptos", size: 10, bold: true, color: { argb: NAVY } };
  sheet.mergeCells("K3:N3");
  sheet.getCell("K3").value = formatBangkokReportTimestamp(options.exportedAt);
  sheet.getCell("K3").font = { name: "Aptos", size: 10, color: { argb: MUTED } };
  sheet.getRow(4).height = 22;
  sheet.getCell("A4").value = "Report Period";
  sheet.getCell("B4").value = reportPeriodLabel;
  sheet.getCell("D4").value = "Trend Period";
  sheet.mergeCells("E4:G4");
  sheet.getCell("E4").value = trendPeriodLabel;
  sheet.getCell("I4").value = "Report Layout";
  sheet.mergeCells("J4:N4");
  sheet.getCell("J4").value = "Engineering View -> Executive View -> Rack Capacity -> Rack Unit Capacity";
  for (const address of ["A4", "D4", "I4"]) sheet.getCell(address).font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  for (const address of ["B4", "E4", "J4"]) sheet.getCell(address).font = { name: "Aptos", size: 9, color: { argb: MUTED } };

  sectionHeading(sheet, 5, "Engineering View");
  addCard(sheet, 1, 3, 7, "Total 4th Floor Energy", lookup("E", "floorEnergyKwh"), "#,##0.00", LIGHT_TEAL);
  addCard(sheet, 4, 6, 7, "Estimated 4th Floor Electricity Cost", lookup("F", "floorCostThb"), "#,##0.00", LIGHT_BLUE);
  addCard(sheet, 7, 10, 7, "4th Floor Energy Share", lookup("H", "floorSharePercent"), "0.00", LIGHT_AMBER);
  addCard(sheet, 11, 14, 7, "Building Average Electricity Rate", lookup("G", "averageRateThbPerKwh"), "#,##0.00", LIGHT_BLUE);

  const upsStart = 12;
  sheet.mergeCells(upsStart, 1, upsStart, 14);
  sheet.getCell(upsStart, 1).value = "1. UPS Load Status - DCM 4th Floor";
  sheet.getCell(upsStart, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  dashboardTableHeader(sheet, upsStart + 1, ["No.", "UPS Group", "Total kW", "Total kVA", "Capacity kVA", "Load %", "Available %", "Monthly Energy kWh"]);
  for (let index = 0; index < upsMaxRows; index++) {
    const row = upsStart + 2 + index;
    const cached = upsSelectedRows[index] ?? [];
    const values: unknown[] = [
      cellFormula(`IF(B${row}=\"\",\"\",${index + 1})`, cached.length ? index + 1 : ""),
      nthMonthLookup(options.upsSheetName, "B", upsEnd, index + 1, textResult(cached[1])),
      nthMonthLookup(options.upsSheetName, "C", upsEnd, index + 1, numberResult(cached[2])),
      nthMonthLookup(options.upsSheetName, "D", upsEnd, index + 1, numberResult(cached[3])),
      nthMonthLookup(options.upsSheetName, "E", upsEnd, index + 1, numberResult(cached[4])),
      nthMonthLookup(options.upsSheetName, "F", upsEnd, index + 1, numberResult(cached[5])),
      nthMonthLookup(options.upsSheetName, "G", upsEnd, index + 1, numberResult(cached[6])),
      nthMonthLookup(options.upsSheetName, "H", upsEnd, index + 1, numberResult(cached[7]))
    ];
    dashboardBodyRow(sheet, row, values);
    for (const col of [3, 4, 5, 8]) sheet.getCell(row, col).numFmt = "#,##0.00";
    for (const col of [6, 7]) sheet.getCell(row, col).numFmt = "0.00";
  }
  const upsNoteRow = upsStart + upsMaxRows + 2;
  sheet.mergeCells(upsNoteRow, 1, upsNoteRow, 14);
  sheet.getCell(upsNoteRow, 1).value = "UPS group capacity and mapping values are sourced from Dashboard-FAC. Monthly energy uses the selected-month engineering calculation.";
  sheet.getCell(upsNoteRow, 1).font = { name: "Aptos", size: 9, italic: true, color: { argb: MUTED } };

  const detailStart = upsNoteRow + 2;
  sheet.mergeCells(detailStart, 1, detailStart, 14);
  sheet.getCell(detailStart, 1).value = "UPS / PPC Detailed Configuration Mapping";
  sheet.getCell(detailStart, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  dashboardTableHeader(sheet, detailStart + 1, ["No.", "UMDB", "UPS ID", "AC Panel", "STS", "OUDB", "V", "A", "kW", "kVA", "Capacity", "Load %"]);
  for (let index = 0; index < detailMaxRows; index++) {
    const row = detailStart + 2 + index;
    const cached = detailSelectedRows[index] ?? [];
    const sourceColumns = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
    const values = sourceColumns.map((column, columnIndex) => nthMonthLookup(options.detailSheetName, column, detailEnd, index + 1, columnIndex < 6 ? textResult(cached[columnIndex + 1]) : numberResult(cached[columnIndex + 1])));
    dashboardBodyRow(sheet, row, values);
    for (const col of [7, 8, 9, 10, 11, 12]) sheet.getCell(row, col).numFmt = "#,##0.00";
  }

  const airStart = detailStart + detailMaxRows + 4;
  sheet.mergeCells(airStart, 1, airStart, 14);
  sheet.getCell(airStart, 1).value = "2. Air Conditioning Energy Consumption - 4th Floor";
  sheet.getCell(airStart, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  dashboardTableHeader(sheet, airStart + 1, ["Meter", "Previous (GWh)", "Current (GWh)", "Difference (GWh)"]);
  const airSource = excelSheetRef(options.airDashboardSheetName);
  options.airFields.forEach((field, index) => {
    const row = airStart + 2 + index;
    const cached = airDashboardSelectedRows.find(item => String(item[1] ?? "").toLowerCase() === field.toLowerCase()) ?? [];
    const fieldCell = `$A${row}`;
    dashboardBodyRow(sheet, row, [field.toUpperCase(),
      cellFormula(`IFERROR(SUMIFS(${airSource}!$C$2:$C$${airDashboardEnd},${airSource}!$A$2:$A$${airDashboardEnd},$B$3,${airSource}!$B$2:$B$${airDashboardEnd},${fieldCell}),\"\")`, numberResult(cached[2])),
      cellFormula(`IFERROR(SUMIFS(${airSource}!$D$2:$D$${airDashboardEnd},${airSource}!$A$2:$A$${airDashboardEnd},$B$3,${airSource}!$B$2:$B$${airDashboardEnd},${fieldCell}),\"\")`, numberResult(cached[3])),
      cellFormula(`IFERROR(SUMIFS(${airSource}!$E$2:$E$${airDashboardEnd},${airSource}!$A$2:$A$${airDashboardEnd},$B$3,${airSource}!$B$2:$B$${airDashboardEnd},${fieldCell}),\"\")`, numberResult(cached[4]))
    ]);
    for (const col of [2, 3, 4]) sheet.getCell(row, col).numFmt = "0.000000";
  });
  const airNoteRow = airStart + options.airFields.length + 2;
  sheet.mergeCells(airNoteRow, 1, airNoteRow, 14);
  sheet.getCell(airNoteRow, 1).value = "Air-conditioning energy is the complete GWh meter difference x 1,000,000. Missing readings remain unavailable rather than zero.";
  sheet.getCell(airNoteRow, 1).font = { name: "Aptos", size: 9, italic: true, color: { argb: MUTED } };

  const dcStart = airNoteRow + 2;
  sheet.mergeCells(dcStart, 1, dcStart, 14);
  sheet.getCell(dcStart, 1).value = "3. DC Power Panel Load Status";
  sheet.getCell(dcStart, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  dashboardTableHeader(sheet, dcStart + 1, ["No.", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current @220V (A)", "AC Power (W)", "Monthly Energy (kWh)"]);
  for (let index = 0; index < dcMaxRows; index++) {
    const row = dcStart + 2 + index;
    const cached = dcSelectedRows[index] ?? [];
    const values: unknown[] = [
      cellFormula(`IF(B${row}=\"\",\"\",${index + 1})`, cached.length ? index + 1 : ""),
      nthMonthLookup(options.dcSheetName, "B", dcEnd, index + 1, textResult(cached[1])),
      nthMonthLookup(options.dcSheetName, "C", dcEnd, index + 1, numberResult(cached[2])),
      nthMonthLookup(options.dcSheetName, "D", dcEnd, index + 1, numberResult(cached[3])),
      nthMonthLookup(options.dcSheetName, "E", dcEnd, index + 1, numberResult(cached[4])),
      nthMonthLookup(options.dcSheetName, "F", dcEnd, index + 1, numberResult(cached[5])),
      nthMonthLookup(options.dcSheetName, "G", dcEnd, index + 1, numberResult(cached[6])),
      nthMonthLookup(options.dcSheetName, "H", dcEnd, index + 1, numberResult(cached[7]))
    ];
    dashboardBodyRow(sheet, row, values);
    for (const col of [3, 4, 5, 6, 7, 8]) sheet.getCell(row, col).numFmt = "#,##0.00";
  }

  const overallStart = dcStart + dcMaxRows + 4;
  sheet.mergeCells(overallStart, 1, overallStart, 14);
  sheet.getCell(overallStart, 1).value = "4. Overall Energy Consumption & Electricity Cost";
  sheet.getCell(overallStart, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  dashboardTableHeader(sheet, overallStart + 1, ["Reporting Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Avg Rate (THB/kWh)", "4th Floor Share (%)"]);
  dashboardBodyRow(sheet, overallStart + 2, [cellFormula('TEXT(DATE(LEFT($B$3,4),RIGHT($B$3,2),1),"mmm yyyy")', monthLabelShort(options.selectedMonth, "en")), lookup("C", "buildingEnergyKwh"), lookup("D", "buildingCostThb"), lookup("E", "floorEnergyKwh"), lookup("F", "floorCostThb"), lookup("G", "averageRateThbPerKwh"), lookup("H", "floorSharePercent")]);
  for (const col of [2, 3, 4, 5, 6, 7]) sheet.getCell(overallStart + 2, col).numFmt = "#,##0.00";

  const executiveRow = overallStart + 5;
  sectionHeading(sheet, executiveRow, "Executive View");
  const upsSource = excelSheetRef(options.upsSheetName);
  const maxUpsLoad = upsSelectedRows.reduce<number | null>((maximum, row) => {
    const value = numberResult(row[5]);
    return value === null ? maximum : maximum === null ? value : Math.max(maximum, value);
  }, null);
  const upsStatusResult = upsSelectedRows.length === 0 ? "No UPS status" : `${upsSelectedRows.length} group(s) - max ${(maxUpsLoad ?? 0).toFixed(2)}% load`;
  const upsStatusFormula = cellFormula(`IF(COUNTIFS(${upsSource}!$A$2:$A$${upsEnd},$B$3)=0,\"No UPS status\",COUNTIFS(${upsSource}!$A$2:$A$${upsEnd},$B$3)&\" group(s) - max \"&TEXT(MAXIFS(${upsSource}!$F$2:$F$${upsEnd},${upsSource}!$A$2:$A$${upsEnd},$B$3),\"0.00\")&\"% load\")`, upsStatusResult);
  addCard(sheet, 1, 4, executiveRow + 2, "Total Building Energy", lookup("C", "buildingEnergyKwh"), "#,##0.00", LIGHT_BLUE);
  addCard(sheet, 5, 8, executiveRow + 2, "Total 4th Floor Energy", lookup("E", "floorEnergyKwh"), "#,##0.00", LIGHT_TEAL);
  addCard(sheet, 9, 14, executiveRow + 2, "Total Building Cost", lookup("D", "buildingCostThb"), "#,##0.00", LIGHT_BLUE);
  addCard(sheet, 1, 4, executiveRow + 6, "Total 4th Floor Cost", lookup("F", "floorCostThb"), "#,##0.00", LIGHT_TEAL);
  addCard(sheet, 5, 8, executiveRow + 6, "4th Floor Energy Share", lookup("H", "floorSharePercent"), "0.00", LIGHT_AMBER);
  addCard(sheet, 9, 14, executiveRow + 6, "UPS Status", upsStatusFormula, "@", LIGHT_TEAL);

  const insightRow = executiveRow + 10;
  sheet.mergeCells(insightRow, 1, insightRow, 14);
  sheet.getCell(insightRow, 1).value = "Management insights";
  sheet.getCell(insightRow, 1).font = { name: "Aptos Display", size: 12, bold: true, color: { argb: NAVY } };
  const currentFloor = metricValue(selected, "floorEnergyKwh");
  const previousFloor = metricValue(previousMetric, "floorEnergyKwh");
  const floorDeltaResult = currentFloor === null || previousFloor === null ? "Month-over-month floor energy comparison is unavailable." : `Latest 4th Floor energy ${currentFloor >= previousFloor ? "increased" : "decreased"} by ${Math.abs(currentFloor - previousFloor).toFixed(2)} kWh versus the previous available report month.`;
  const match = `MATCH($B$3,${data}!$A$2:$A$${dataRowEnd},0)`;
  const currentFloorFormula = `INDEX(${data}!$E$2:$E$${dataRowEnd},${match})`;
  const previousFloorFormula = `INDEX(${data}!$E$2:$E$${dataRowEnd},${match}-1)`;
  const insightValues = [
    cellFormula(`IFERROR(\"Latest 4th Floor energy \"&IF(${currentFloorFormula}>=${previousFloorFormula},\"increased\",\"decreased\")&\" by \"&TEXT(ABS(${currentFloorFormula}-${previousFloorFormula}),\"#,##0.00\")&\" kWh versus the previous available report month.\",\"Month-over-month floor energy comparison is unavailable.\")`, floorDeltaResult),
    cellFormula(`IF(${currentFloorFormula}=\"\",\"Selected month is partial; review missing source readings before making operational decisions.\",\"Selected month passed the report completeness check.\")`, currentFloor === null ? "Selected month is partial; review missing source readings before making operational decisions." : "Selected month passed the report completeness check."),
    cellFormula(`IF(COUNTIFS(${upsSource}!$A$2:$A$${upsEnd},$B$3)=0,\"UPS group status is unavailable for the selected month.\",\"UPS status loaded from Dashboard-FAC group history for the selected month.\")`, upsSelectedRows.length === 0 ? "UPS group status is unavailable for the selected month." : "UPS status loaded from Dashboard-FAC group history for the selected month.")
  ];
  insightValues.forEach((value, index) => {
    const row = insightRow + 1 + index;
    sheet.mergeCells(row, 1, row, 14);
    sheet.getCell(row, 1).value = value;
    sheet.getCell(row, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    sheet.getCell(row, 1).font = { name: "Aptos", size: 10, color: { argb: TEXT } };
    sheet.getRow(row).height = 22;
  });

  const chartFirstRow = 2;
  const chartLastRow = Math.max(chartFirstRow, trendMetrics.length + 1);
  const chartsStart = executiveRow + 15;
  const rackRow = executiveRow + 68;
  sectionHeading(sheet, rackRow, "Rack Capacity");
  const rackSelected = options.rackRows.find(item => item.month === options.selectedMonth && item.zone.toLowerCase().includes("total")) ?? options.rackRows.find(item => item.month === options.selectedMonth);
  addCard(sheet, 1, 4, rackRow + 2, "Total Racks", currentLookup(options.rackSheetName, "D", rackEnd, rackSelected?.total ?? null), "#,##0", LIGHT_BLUE);
  addCard(sheet, 5, 8, rackRow + 2, "In Use", currentLookup(options.rackSheetName, "E", rackEnd, rackSelected?.inUse ?? null), "#,##0", LIGHT_BLUE);
  addCard(sheet, 9, 14, rackRow + 2, "Available", currentLookup(options.rackSheetName, "F", rackEnd, rackSelected?.available ?? null), "#,##0", LIGHT_TEAL);
  addCard(sheet, 1, 4, rackRow + 6, "Reserved", currentLookup(options.rackSheetName, "G", rackEnd, rackSelected?.reserved ?? null), "#,##0", LIGHT_AMBER);
  addCard(sheet, 5, 8, rackRow + 6, "Pending Decommission", currentLookup(options.rackSheetName, "H", rackEnd, rackSelected?.pending ?? null), "#,##0", LIGHT_AMBER);
  addCard(sheet, 9, 14, rackRow + 6, "Other", currentLookup(options.rackSheetName, "I", rackEnd, rackSelected?.other ?? null), "#,##0", LIGHT_BLUE);
  const zoneStart = rackRow + 11;
  dashboardTableHeader(sheet, zoneStart, ["Rack Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending", "Usage", "Availability"]);
  const zones = [...new Set(options.rackRows.filter(row => !row.zone.toLowerCase().includes("total")).map(row => row.zone))].sort();
  zones.forEach((zone, index) => {
    const row = zoneStart + 1 + index;
    sheet.getCell(row, 1).value = zone;
    const source = excelSheetRef(options.rackSheetName);
    const countFormula = "COUNTIFS(" + source + "!$A$2:$A$" + rackEnd + ",$B$3," + source + "!$C$2:$C$" + rackEnd + ",$A" + row + ")";
    const columns: Array<[number, string, keyof Pick<CurrentFacilityDashboardOptions["rackRows"][number], "total" | "inUse" | "available" | "reserved" | "pending">]> = [[2, "D", "total"], [3, "E", "inUse"], [4, "F", "available"], [5, "G", "reserved"], [6, "H", "pending"]];
    columns.forEach(([target, sourceColumn, key]) => {
      const result = options.rackRows.filter(item => item.month === options.selectedMonth && item.zone === zone).reduce((sum, item) => sum + item[key], 0);
      const formula = "IF(" + countFormula + "=0,\"\",SUMIFS(" + source + "!$" + sourceColumn + "$2:$" + sourceColumn + "$" + rackEnd + "," + source + "!$A$2:$A$" + rackEnd + ",$B$3," + source + "!$C$2:$C$" + rackEnd + ",$A" + row + "))";
      sheet.getCell(row, target).value = cellFormula(formula, result);
      sheet.getCell(row, target).numFmt = "#,##0";
    });
    const zoneSelected = options.rackRows.find(item => item.month === options.selectedMonth && item.zone === zone);
    sheet.getCell(row, 7).value = cellFormula("IFERROR(C" + row + "/B" + row + ",\"\")", zoneSelected?.usage ?? null);
    sheet.getCell(row, 8).value = cellFormula("IFERROR(D" + row + "/B" + row + ",\"\")", zoneSelected?.availability ?? null);
    sheet.getCell(row, 7).numFmt = "0.0%";
    sheet.getCell(row, 8).numFmt = "0.0%";
    for (let column = 1; column <= 8; column++) applyCellStyle(sheet.getCell(row, column), WHITE, { name: "Aptos", size: 9, color: { argb: TEXT } });
  });
  sheet.mergeCells(zoneStart, 10, zoneStart, 14);
  sheet.getCell(zoneStart, 10).value = "Capacity Health";
  sheet.getCell(zoneStart, 10).font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(zoneStart + 1, 10, zoneStart + 5, 14);
  const usageText = rackSelected?.usage == null ? "N/A" : `${(rackSelected.usage * 100).toFixed(1)}%`;
  const availabilityText = rackSelected?.availability == null ? "N/A" : `${(rackSelected.availability * 100).toFixed(1)}%`;
  sheet.getCell(zoneStart + 1, 10).value = `Selected-month Rack Capacity\nUsage: ${usageText}\nAvailability: ${availabilityText}\nZone table below follows the selected Reporting Month.`;
  sheet.getCell(zoneStart + 1, 10).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  sheet.getCell(zoneStart + 1, 10).font = { name: "Aptos", size: 10, color: { argb: MUTED } };

  const unitRow = rackRow + Math.max(26, zones.length + 19);
  sectionHeading(sheet, unitRow, "Rack Unit Capacity");
  const unitSelected = options.rackUnitRows.find(item => item.month === options.selectedMonth);
  const sortedUnitRows = options.rackUnitRows.slice().sort((a, b) => a.month.localeCompare(b.month));
  const unitIndex = sortedUnitRows.findIndex(item => item.month === options.selectedMonth);
  const previousUnit = unitIndex > 0 ? sortedUnitRows[unitIndex - 1] : undefined;
  const usageNow = unitSelected?.usage ?? null;
  const usagePrev = previousUnit?.usage ?? null;
  const deltaRatio = usageNow !== null && usagePrev !== null && usagePrev !== 0 ? (usageNow - usagePrev) / Math.abs(usagePrev) : null;
  const trendResult = deltaRatio === null ? "-" : `${deltaRatio > 0 ? "UP" : deltaRatio < 0 ? "DOWN" : "FLAT"} ${Math.abs(deltaRatio * 100).toFixed(1)}%`;
  const unitSource = excelSheetRef(options.rackUnitSheetName);
  const unitPos = `MATCH($B$3,${unitSource}!$A$2:$A$${unitEnd},0)`;
  const currentUsage = `(INDEX(${unitSource}!$C$2:$C$${unitEnd},${unitPos})/INDEX(${unitSource}!$B$2:$B$${unitEnd},${unitPos}))`;
  const previousUsage = `(INDEX(${unitSource}!$C$2:$C$${unitEnd},${unitPos}-1)/INDEX(${unitSource}!$B$2:$B$${unitEnd},${unitPos}-1))`;
  const unitDelta = `((${currentUsage})-(${previousUsage}))/ABS(${previousUsage})`;
  const trendFormula = cellFormula(`IFERROR(IF(${unitDelta}>0,\"UP \",IF(${unitDelta}<0,\"DOWN \",\"FLAT \"))&TEXT(ABS(${unitDelta}),\"0.0%\"),\"-\")`, trendResult);
  addCard(sheet, 1, 4, unitRow + 2, "Total (U)", currentLookup(options.rackUnitSheetName, "B", unitEnd, unitSelected?.total ?? null), "#,##0", LIGHT_BLUE);
  addCard(sheet, 5, 8, unitRow + 2, "Used (U)", currentLookup(options.rackUnitSheetName, "C", unitEnd, unitSelected?.used ?? null), "#,##0", LIGHT_BLUE);
  addCard(sheet, 9, 14, unitRow + 2, "Available (U)", currentLookup(options.rackUnitSheetName, "D", unitEnd, unitSelected?.available ?? null), "#,##0", LIGHT_TEAL);
  addCard(sheet, 1, 4, unitRow + 6, "Availability %", currentLookup(options.rackUnitSheetName, "F", unitEnd, unitSelected?.availability ?? null), "0.0%", LIGHT_TEAL);
  addCard(sheet, 5, 8, unitRow + 6, "Usage %", currentLookup(options.rackUnitSheetName, "E", unitEnd, unitSelected?.usage ?? null), "0.0%", LIGHT_AMBER);
  addCard(sheet, 9, 14, unitRow + 6, "Trend vs Previous Month", trendFormula, "@", LIGHT_BLUE);

  const unitSummaryRow = unitRow + 11;
  dashboardTableHeader(sheet, unitSummaryRow, ["Rack Unit Metric", "Selected Month", "Unit / Interpretation"]);
  const unitMetrics: Array<[string, string, string, number | null]> = [
    ["Total U Capacity", "B", "U", unitSelected?.total ?? null], ["Used U", "C", "U", unitSelected?.used ?? null], ["Available U", "D", "U", unitSelected?.available ?? null], ["Usage", "E", "%", unitSelected?.usage ?? null], ["Availability", "F", "%", unitSelected?.availability ?? null]
  ];
  unitMetrics.forEach(([label, column, unit, result], index) => {
    const row = unitSummaryRow + 1 + index;
    dashboardBodyRow(sheet, row, [label, currentLookup(options.rackUnitSheetName, column, unitEnd, result), unit]);
    sheet.getCell(row, 2).numFmt = unit === "%" ? "0.0%" : "#,##0";
    sheet.mergeCells(row, 3, row, 4);
  });
  addCurrentFacilityImage(workbook, sheet, options.rackImageDataUri, options.rackImageMeta, unitSummaryRow);

  const unitTableRow = unitSummaryRow + 10;
  dashboardTableHeader(sheet, unitTableRow, ["Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"]);
  sortedUnitRows.forEach((item, index) => {
    const row = unitTableRow + 1 + index;
    dashboardBodyRow(sheet, row, [item.month, item.total, item.used, item.available, item.usage, item.availability]);
    sheet.getCell(row, 5).numFmt = "0.0%";
    sheet.getCell(row, 6).numFmt = "0.0%";
  });

  const unitChartStart = unitTableRow + Math.max(4, sortedUnitRows.length + 3);
  sheet.columns = Array.from({ length: 14 }, (_, index) => ({ key: excelColumnName(index + 1).toLowerCase(), width: index === 0 ? 24 : index < 4 ? 17 : 15 }));
  for (const row of [5, executiveRow, rackRow, unitRow]) sheet.getRow(row).height = 26;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.pageSetup.rowBreaks = [{ id: executiveRow - 1 }, { id: rackRow - 1 }, { id: unitRow - 1 }];

  const categoryRange = chartRange(trendDataSheetName, "B", chartFirstRow, chartLastRow);
  const chartSeries = (name: string, column: string, key: keyof ExcelDashboardMetric, color: string): ExcelDashboardSeries => ({ name, range: chartRange(trendDataSheetName, column, chartFirstRow, chartLastRow), values: trendMetrics.map(metric => metricValue(metric, key)), color });
  const chart = (title: string, column: string, key: keyof ExcelDashboardMetric, color: string, fromCol: number, fromRow: number, toCol: number, toRow: number): ExcelDashboardChart => ({ title, kind: "line", categoryRange, categories: trendMetrics.map(metric => monthLabelShort(metric.month, "en")), series: [chartSeries(title.replace(" Trend", ""), column, key, color)], fromCol, fromRow, toCol, toRow });
  const charts: ExcelDashboardChart[] = trendMetrics.length === 0 ? [] : [
    chart("4th Floor Estimated Cost Trend (THB)", "F", "floorCostThb", "E4572E", 0, chartsStart, 6, chartsStart + 16),
    chart("4th Floor Total Energy Trend (kWh)", "E", "floorEnergyKwh", "007A75", 7, chartsStart, 14, chartsStart + 16),
    chart("4th Floor Average Electricity Rate Trend (THB/kWh)", "G", "averageRateThbPerKwh", "4472C4", 0, chartsStart + 17, 6, chartsStart + 33),
    chart("4th Floor UPS Energy Trend (kWh)", "I", "upsEnergyKwh", "ED9B40", 7, chartsStart + 17, 14, chartsStart + 33),
    chart("4th Floor Air Conditioning Energy Trend (kWh)", "J", "airEnergyKwh", "00A878", 0, chartsStart + 34, 6, chartsStart + 50),
    chart("4th Floor DC Power Energy Trend (kWh)", "K", "dcEnergyKwh", "6B7280", 7, chartsStart + 34, 14, chartsStart + 50),
    { title: "Rack Unit Capacity Trend", kind: "line", categoryRange, categories: trendMetrics.map(metric => monthLabelShort(metric.month, "en")), series: [chartSeries("Total (U)", "N", "rackTotalU", "1E3A5F"), chartSeries("Used (U)", "O", "rackUsedU", "E4572E"), chartSeries("Available (U)", "P", "rackAvailableU", "00A878")], fromCol: 0, fromRow: unitChartStart, toCol: 14, toRow: unitChartStart + 18 }
  ];
  return { dashboardSheetName: options.dashboardSheetName, charts };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function strCache(values: string[]): string {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(value)}</c:v></c:pt>`).join("")}</c:strCache>`;
}

function numCache(values: Array<number | null>): string {
  return `<c:numCache><c:formatCode>#,##0.00</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value === null ? "" : String(value)}</c:v></c:pt>`).join("")}</c:numCache>`;
}

function chartSeriesXml(series: ExcelDashboardSeries, categoryRange: string, categories: string[], index: number, kind: "line" | "bar"): string {
  const marker = kind === "line" ? `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr></c:marker>` : "";
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(series.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr><c:invertIfNegative val="0"/>${marker}<c:cat><c:strRef><c:f>${xmlEscape(categoryRange)}</c:f>${strCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEscape(series.range)}</c:f>${numCache(series.values)}</c:numRef></c:val></c:ser>`;
}

function chartDataLabels(showValues: boolean): string {
  // Excel defaults omitted label flags differently across versions. Set every
  // label flag explicitly so line charts never render a noisy
  // "Series, Month" label at every point.
  return `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="${showValues ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`;
}

function chartLegend(): string {
  return `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>`;
}

function chartXml(chart: ExcelDashboardChart): string {
  const axisCategory = 100000000 + chart.fromCol;
  const axisValue = 200000000 + chart.fromCol;
  const plot = chart.kind === "bar"
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${chart.series.map((series, index) => chartSeriesXml(series, chart.categoryRange, chart.categories, index, chart.kind)).join("")}${chartDataLabels(true)}<c:gapWidth val="80"/><c:axId val="${axisCategory}"/><c:axId val="${axisValue}"/></c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${chart.series.map((series, index) => chartSeriesXml(series, chart.categoryRange, chart.categories, index, chart.kind)).join("")}${chartDataLabels(false)}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${axisCategory}"/><c:axId val="${axisValue}"/></c:lineChart>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="0"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${xmlEscape(chart.title)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx><c:layout/></c:title><c:plotArea><c:layout/>${plot}<c:catAx><c:axId val="${axisCategory}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axisValue}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${axisValue}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/><c:crossAx val="${axisCategory}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx></c:plotArea>${chartLegend()}<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}

function drawingXml(charts: Array<{ relationshipId: string; chartId: number; anchor: ExcelDashboardChart }>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${charts.map(item => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${item.anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${item.anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${item.chartId}" name="Chart ${item.chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${item.relationshipId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("")}</xdr:wsDr>`;
}

function relationshipXml(relationships: Array<{ id: string; type: string; target: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map(item => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`).join("")}</Relationships>`;
}

function resolveRelationshipTarget(sourcePath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) + target).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function drawingAnchorsXml(charts: Array<{ relationshipId: string; chartId: number; anchor: ExcelDashboardChart }>): string {
  const full = drawingXml(charts);
  const rootStart = full.indexOf("<xdr:wsDr");
  const openEnd = full.indexOf(">", rootStart);
  const closeTag = "</xdr:wsDr>";
  return full.slice(openEnd + 1, full.lastIndexOf(closeTag));
}

function ensureDrawingNamespaces(xml: string): string {
  const rootStart = xml.indexOf("<xdr:wsDr");
  const openEnd = xml.indexOf(">", rootStart);
  if (rootStart < 0 || openEnd < 0) return xml;
  let opening = xml.slice(rootStart, openEnd);
  if (!opening.includes("xmlns:c=")) opening += ' xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
  if (!opening.includes("xmlns:r=")) opening += ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return xml.slice(0, rootStart) + opening + xml.slice(openEnd);
}

function relationshipTags(xml: string): Array<{ id: string; type: string; target: string }> {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => ({ id: xmlAttr(match[0], "Id") ?? "", type: xmlAttr(match[0], "Type") ?? "", target: xmlAttr(match[0], "Target") ?? "" }));
}

function nextRelationshipId(relationships: Array<{ id: string }>): string {
  const max = relationships.reduce((current, item) => Math.max(current, Number(item.id.replace(/^rId/, "")) || 0), 0);
  return `rId${max + 1}`;
}

function resolveWorksheetPath(workbookXml: string, workbookRelsXml: string, sheetName: string): string | null {
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>(?:<\/sheet>)?/g)].map(match => match[0]).find(tag => xmlAttr(tag, "name") === sheetName);
  const relationshipId = sheetTag ? xmlAttr(sheetTag, "r:id") : null;
  if (!relationshipId) return null;
  const relTag = [...workbookRelsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]).find(tag => xmlAttr(tag, "Id") === relationshipId);
  const target = relTag ? xmlAttr(relTag, "Target") : null;
  if (!target) return null;
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

function appendXmlBeforeClose(xml: string, closeTag: string, content: string): string {
  const index = xml.lastIndexOf(closeTag);
  return index < 0 ? xml : `${xml.slice(0, index)}${content}${xml.slice(index)}`;
}

/** Adds native OOXML charts after ExcelJS serializes the workbook. ExcelJS
 *  4.x deliberately has no chart writer, so keeping this small patcher here
 *  gives the exported file real, editable Excel charts rather than screenshots.
 */
export async function injectInteractiveDashboardCharts(buffer: ArrayBuffer | Uint8Array, plans: ExcelDashboardPlan[]): Promise<Uint8Array> {
  if (plans.length === 0) return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = await JSZip.loadAsync(buffer);
  const workbookFile = zip.file("xl/workbook.xml");
  const workbookRelsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !workbookRelsFile) return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const workbookXml = await workbookFile.async("string");
  const workbookRelsXml = await workbookRelsFile.async("string");
  const existingChartNumbers = Object.keys(zip.files).map(name => Number(name.match(/^xl\/charts\/chart(\d+)\.xml$/)?.[1] ?? 0)).filter(Boolean);
  const existingDrawingNumbers = Object.keys(zip.files).map(name => Number(name.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1] ?? 0)).filter(Boolean);
  let nextChart = (existingChartNumbers.length ? Math.max(...existingChartNumbers) : 0) + 1;
  let nextDrawing = (existingDrawingNumbers.length ? Math.max(...existingDrawingNumbers) : 0) + 1;
  let contentTypes = await zip.file("[Content_Types].xml")?.async("string") ?? "";
  for (const plan of plans) {
    if (plan.charts.length === 0) continue;
    const worksheetPath = resolveWorksheetPath(workbookXml, workbookRelsXml, plan.dashboardSheetName);
    if (!worksheetPath) continue;
    const worksheetFile = zip.file(worksheetPath);
    if (!worksheetFile) continue;
    let worksheetXml = await worksheetFile.async("string");
    const worksheetRelsPath = worksheetPath.slice(0, worksheetPath.lastIndexOf("/")) + "/_rels/" + worksheetPath.slice(worksheetPath.lastIndexOf("/") + 1) + ".rels";
    const worksheetRelsFile = zip.file(worksheetRelsPath);
    const existingRelationships = worksheetRelsFile ? relationshipTags(await worksheetRelsFile.async("string")) : [];
    const existingDrawingRelationship = existingRelationships.find(item => item.type === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing");
    let drawingPath: string | null = existingDrawingRelationship ? resolveRelationshipTarget(worksheetPath, existingDrawingRelationship.target) : null;
    let drawingRelsPath = "";
    let baseDrawingXml: string | null = null;
    let drawingRelationships: Array<{ id: string; type: string; target: string }> = [];
    let createDrawing = false;
    if (drawingPath) {
      drawingRelsPath = drawingPath.slice(0, drawingPath.lastIndexOf("/")) + "/_rels/" + drawingPath.slice(drawingPath.lastIndexOf("/") + 1) + ".rels";
      const drawingFile = zip.file(drawingPath);
      if (drawingFile) {
        baseDrawingXml = await drawingFile.async("string");
        const drawingRelsFile = zip.file(drawingRelsPath);
        drawingRelationships = drawingRelsFile ? relationshipTags(await drawingRelsFile.async("string")) : [];
      } else {
        drawingPath = null;
      }
    }
    if (!drawingPath) {
      const drawingNumber = nextDrawing++;
      drawingPath = "xl/drawings/drawing" + drawingNumber + ".xml";
      drawingRelsPath = "xl/drawings/_rels/drawing" + drawingNumber + ".xml.rels";
      createDrawing = true;
    }
    const finalDrawingPath = drawingPath;
    let nextDrawingRelationshipId = nextRelationshipId(drawingRelationships);
    const chartRelationships: Array<{ id: string; type: string; target: string }> = [];
    const drawingCharts = plan.charts.map(chart => {
      const chartId = nextChart++;
      const relationshipId = nextDrawingRelationshipId;
      nextDrawingRelationshipId = "rId" + (Number(nextDrawingRelationshipId.replace(/^rId/, "")) + 1);
      const chartPath = "xl/charts/chart" + chartId + ".xml";
      zip.file(chartPath, chartXml(chart));
      chartRelationships.push({ id: relationshipId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart", target: "../charts/chart" + chartId + ".xml" });
      contentTypes = appendXmlBeforeClose(contentTypes, "</Types>", "<Override PartName=\"/" + chartPath + "\" ContentType=\"application/vnd.openxmlformats-officedocument.drawingml.chart+xml\"/>");
      return { relationshipId, chartId, anchor: chart };
    });
    const drawingContent = drawingAnchorsXml(drawingCharts);
    zip.file(finalDrawingPath, baseDrawingXml ? ensureDrawingNamespaces(appendXmlBeforeClose(baseDrawingXml, "</xdr:wsDr>", drawingContent)) : drawingXml(drawingCharts));
    zip.file(drawingRelsPath, relationshipXml([...drawingRelationships, ...chartRelationships]));
    if (createDrawing) {
      contentTypes = appendXmlBeforeClose(contentTypes, "</Types>", "<Override PartName=\"/" + finalDrawingPath + "\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>");
      const drawingRelationshipId = nextRelationshipId(existingRelationships);
      const updatedWorksheetRels = relationshipXml([...existingRelationships, { id: drawingRelationshipId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", target: "../drawings/" + finalDrawingPath.slice(finalDrawingPath.lastIndexOf("/") + 1) }]);
      zip.file(worksheetRelsPath, updatedWorksheetRels);
      worksheetXml = appendXmlBeforeClose(worksheetXml, "</worksheet>", "<drawing r:id=\"" + drawingRelationshipId + "\"/>");
    }
    zip.file(worksheetPath, worksheetXml);
  }
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
