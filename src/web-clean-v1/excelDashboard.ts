import JSZip from "jszip";
import { monthLabelShort, shiftMonth } from "../utils/monthUtils";
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
  rackTotalPositions: number | null;
  rackInUsePositions: number | null;
  rackAvailablePositions: number | null;
  rackPositionUsagePercent: number | null;
  rackPositionAvailabilityPercent: number | null;
}

interface ExcelDashboardSeries {
  name: string;
  range: string;
  values: Array<number | null>;
  color: string;
  labelFormat?: string;
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

function excelCompactChartFormat(values: Array<number | null>, percent = false): string {
  if (percent) return '0.0"%"';
  const maximum = Math.max(0, ...values.filter((value): value is number => value !== null && Number.isFinite(value)).map(value => Math.abs(value)));
  if (maximum >= 1_000_000_000) return '0.00,,,"B"';
  if (maximum >= 1_000_000) return '0.00,,"M"';
  if (maximum >= 1_000) return '0.00,"K"';
  return '0.00';
}

function chartLabelFormat(key: keyof ExcelDashboardMetric, values: Array<number | null>): string {
  if (key === "rackPositionUsagePercent" || key === "rackPositionAvailabilityPercent" || key === "rackUsagePercent" || key === "upsLoadPercent" || key === "floorSharePercent") return excelCompactChartFormat(values, true);
  if (key === "averageRateThbPerKwh") return "0.00";
  return excelCompactChartFormat(values);
}

function chartRange(sheetName: string, column: string, firstRow: number, lastRow: number): string {
  return `${excelSheetRef(sheetName)}!$${column}$${firstRow}:$${column}$${lastRow}`;
}

export function addDashboardDataSheet(workbook: any, dataSheetName: string, metrics: ExcelDashboardMetric[]): void {
  const sheet = workbook.addWorksheet(dataSheetName);
  sheet.state = "hidden";
  sheet.properties.tabColor = { argb: "FF7C3AED" };
  sheet.addRow(["Month", "Label", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "UPS Load (kW)", "UPS Load (%)", "Rack Total (U)", "Rack Used (U)", "Rack Available (U)", "Rack Usage (%)", "Rack Total Positions", "Rack In Use Positions", "Rack Available Positions", "Rack Position Usage (%)", "Rack Position Availability (%)"]);
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
      metric.rackUsagePercent,
      metric.rackTotalPositions,
      metric.rackInUsePositions,
      metric.rackAvailablePositions,
      metric.rackPositionUsagePercent,
      metric.rackPositionAvailabilityPercent
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
  dashboard.properties.tabColor = { argb: TEAL };
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
  const series = (name: string, column: string, key: keyof ExcelDashboardMetric, color: string): ExcelDashboardSeries => {
    const values = trendMetrics.map(metric => metricValue(metric, key));
    return { name, range: chartRange(trendDataSheetName, column, firstDataRow, lastDataRow), values, color, labelFormat: chartLabelFormat(key, values) };
  };
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
  upsOverallSheetName: string;
  detailSheetName: string;
  dcSheetName: string;
  totalsSheetName: string;
  airFields: string[];
  airRows: Array<{ month: string; values: Array<number | null> }>;
  airDashboardRows: unknown[][];
  upsRows: unknown[][];
  upsOverallRows: unknown[][];
  detailRows: unknown[][];
  dcRows: unknown[][];
  totalsRows: unknown[][];
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
  // Dashboard source rows are emitted month-by-month, so each month's rows are
  // contiguous. Use a simple MATCH + row offset instead of AGGREGATE's array
  // expression: Excel's FullCalcOnLoad can recalculate that legacy array form
  // to #VALUE! (hidden by IFERROR), leaving otherwise-valid UPS/DC rows blank.
  const first = `MATCH($B$3,${data}!$A$2:$A${rowEnd},0)`;
  const position = nth === 1 ? first : `${first}+${nth - 1}`;
  const monthAtPosition = `INDEX(${data}!$A$2:$A${rowEnd},${position})`;
  const valueAtPosition = `INDEX(${data}!${column}$2:${column}${rowEnd},${position})`;
  return cellFormula(`IFERROR(IF(${monthAtPosition}=$B$3,${valueAtPosition},\"\"),\"\")`, result);
}

function rowsForMonth(rows: unknown[][], month: string): unknown[][] {
  return rows.filter(row => String(row[0] ?? "") === month);
}

function maxRowsPerMonth(rows: unknown[][]): number {
  const counts = new Map<string, number>();
  rows.forEach(row => { const month = String(row[0] ?? ""); counts.set(month, (counts.get(month) ?? 0) + 1); });
  return Math.max(1, ...counts.values());
}
function upsStatusForMonth(rows: unknown[][], month: string): { status: string; groupCount: number; maxLoadPercent: number | null } {
  const selected = rowsForMonth(rows, month);
  const maxLoadPercent = selected.reduce<number | null>((maximum, row) => {
    const value = numberResult(row[5]);
    return value === null ? maximum : maximum === null ? value : Math.max(maximum, value);
  }, null);
  return {
    status: selected.length === 0 ? "No UPS status" : selected.length + " group(s) - max " + (maxLoadPercent ?? 0).toFixed(2) + "% load",
    groupCount: selected.length,
    maxLoadPercent
  };
}

function addUpsStatusDataSheet(workbook: any, dashboardSheetName: string, months: readonly string[], upsRows: unknown[][]): { sheetName: string; rowEnd: number } {
  const sheetName = safeSheetName(dashboardSheetName, "UPS_Status");
  const sheet = workbook.addWorksheet(sheetName);
  sheet.state = "hidden";
  sheet.properties.tabColor = { argb: "FF7C3AED" };
  sheet.addRow(["Month", "UPS Status", "Group Count", "Max Load (%)"]);
  months.forEach(month => {
    const summary = upsStatusForMonth(upsRows, month);
    sheet.addRow([month, summary.status, summary.groupCount, summary.maxLoadPercent]);
  });
  sheet.getRow(1).font = { name: "Aptos", bold: true, color: { argb: WHITE } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
  sheet.getColumn(4).numFmt = "0.00";
  return { sheetName, rowEnd: Math.max(2, months.length + 1) };
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
  const trendMetrics = options.trendMetrics ?? metrics;
  const trendDataSheetName = options.trendDataSheetName ?? options.dataSheetName;
  const chartFirstRow = 2;
  const chartLastRow = Math.max(chartFirstRow, trendMetrics.length + 1);
  const selected = metrics.find(metric => metric.month === options.selectedMonth);
  const previousMonth = shiftMonth(options.selectedMonth, -1);
  const previous = metrics.find(metric => metric.month === previousMonth);
  const data = excelSheetRef(options.dataSheetName);
  const lookup = (column: string, key: keyof ExcelDashboardMetric) => currentLookup(options.dataSheetName, column, dataRowEnd, metricValue(selected, key));
  const rackEnd = Math.max(2, options.rackRows.length + 1);
  const unitEnd = Math.max(2, options.rackUnitRows.length + 1);
  const rackSource = excelSheetRef(options.rackSheetName);
  const rackSelected = options.rackRows.find(item => item.month === options.selectedMonth && item.zone.toLowerCase().includes("total")) ?? null;
  const unitSelected = options.rackUnitRows.find(item => item.month === options.selectedMonth) ?? null;
  const upsStatusData = addUpsStatusDataSheet(workbook, options.dashboardSheetName, metrics.map(metric => metric.month), options.upsRows);
  const upsStatusCached = upsStatusForMonth(options.upsRows, options.selectedMonth).status;

  const previousLookupFormula = (column: string, currentResult: number | null, previousResult: number | null) => {
    const currentRange = `${data}!$${column}$2:$${column}$${dataRowEnd}`;
    const months = `${data}!$A$2:$A$${dataRowEnd}`;
    const currentExpr = `INDEX(${currentRange},MATCH($B$3,${months},0))`;
    const previousMonthExpr = `TEXT(EDATE(DATE(LEFT($B$3,4),RIGHT($B$3,2),1),-1),"yyyy-mm")`;
    const previousExpr = `INDEX(${currentRange},MATCH(${previousMonthExpr},${months},0))`;
    const cached = currentResult === null || previousResult === null || previousResult === 0
      ? "No prior-month comparison"
      : `${currentResult > previousResult ? "▲" : currentResult < previousResult ? "▼" : "•"} ${(Math.abs((currentResult - previousResult) / Math.abs(previousResult)) * 100).toFixed(1)}% vs ${monthLabelShort(previousMonth, "en").split("-")[0]}`;
    return cellFormula(`IFERROR(IF(${currentExpr}>${previousExpr},"▲ ",IF(${currentExpr}<${previousExpr},"▼ ","• "))&TEXT(ABS((${currentExpr}-${previousExpr})/ABS(${previousExpr})),"0.0%")&" vs "&TEXT(EDATE(DATE(LEFT($B$3,4),RIGHT($B$3,2),1),-1),"mmm"),"No prior-month comparison")`, cached);
  };
  const rackLookup = (column: string, result: number | null) => cellFormula(`IFERROR(SUMIFS(${rackSource}!$${column}$2:$${column}$${rackEnd},${rackSource}!$A$2:$A$${rackEnd},$B$3,${rackSource}!$C$2:$C$${rackEnd},"(Total)"),"")`, result);
  const statusText = (cellAddress: string, value: number | null) => cellFormula(`IF(${cellAddress}="","No data",IF(${cellAddress}>=0.85,"High",IF(${cellAddress}>=0.8,"Attention","Normal")))`, value === null ? "No data" : value >= 0.85 ? "High" : value >= 0.8 ? "Attention" : "Normal");
  const addNote = (fromCol: number, toCol: number, row: number, value: any) => {
    sheet.mergeCells(row, fromCol, row, toCol);
    const cell = sheet.getCell(row, fromCol);
    cell.value = value;
    cell.font = { name: "Aptos", size: 8, bold: true, color: { argb: MUTED } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  };

  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.properties.tabColor = { argb: TEAL };
  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = "Data Center Energy & Facility Monitor — Executive Dashboard V2";
  sheet.getCell("A1").font = { name: "Aptos Display", size: 22, bold: true, color: { argb: NAVY } };
  sheet.getCell("A1").border = { bottom: { style: "medium", color: { argb: TEAL } } };
  sheet.getRow(1).height = 38;
  sheet.mergeCells("A2:N2");
  sheet.getCell("A2").value = `${siteName} | Production API | Interactive month selector and native Excel charts`;
  sheet.getCell("A2").font = { name: "Aptos", size: 10, italic: true, color: { argb: MUTED } };
  sheet.getRow(2).height = 22;
  sheet.getCell("A3").value = "Reporting Month";
  sheet.getCell("B3").value = options.selectedMonth;
  sheet.getCell("B3").font = { name: "Aptos", size: 11, bold: true, color: { argb: TEAL } };
  sheet.getCell("B3").border = { top: { style: "thin", color: { argb: TEAL } }, left: { style: "thin", color: { argb: TEAL } }, bottom: { style: "thin", color: { argb: TEAL } }, right: { style: "thin", color: { argb: TEAL } } };
  sheet.getCell("B3").dataValidation = { type: "list", allowBlank: false, formulae: ["AvailableReportingMonths"] };
  sheet.getCell("D3").value = "Facility";
  sheet.mergeCells("E3:F3");
  sheet.getCell("E3").value = siteName;
  sheet.getCell("G3").value = "Generated By";
  sheet.mergeCells("H3:I3");
  sheet.getCell("H3").value = options.exportedBy?.trim() || "N/A";
  sheet.getCell("J3").value = "Generated At";
  sheet.mergeCells("K3:N3");
  sheet.getCell("K3").value = formatBangkokReportTimestamp(options.exportedAt);
  for (const address of ["A3", "D3", "G3", "J3"]) sheet.getCell(address).font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  for (const address of ["E3", "H3", "K3"]) sheet.getCell(address).font = { name: "Aptos", size: 9, color: { argb: MUTED } };
  sheet.getRow(3).height = 26;
  sheet.getCell("A4").value = "Trend Period";
  sheet.mergeCells("B4:D4");
  sheet.getCell("B4").value = trendMetrics.length ? `${monthLabelShort(trendMetrics[0].month, "en")} - ${monthLabelShort(trendMetrics.at(-1)!.month, "en")}` : "N/A";
  sheet.getCell("F4").value = "Layout";
  sheet.mergeCells("G4:N4");
  sheet.getCell("G4").value = "Executive KPI -> Capacity Overview -> Energy Trends -> Rack Trends";
  sheet.getCell("A4").font = sheet.getCell("F4").font = { name: "Aptos", size: 9, bold: true, color: { argb: NAVY } };
  sheet.getCell("B4").font = sheet.getCell("G4").font = { name: "Aptos", size: 9, color: { argb: MUTED } };

  sectionHeading(sheet, 5, "Executive View");
  addCard(sheet, 1, 3, 7, "4th Floor Energy", lookup("E", "floorEnergyKwh"), "#,##0.00", LIGHT_BLUE);
  addCard(sheet, 4, 6, 7, "Estimated 4th Floor Cost", lookup("F", "floorCostThb"), "#,##0.00", LIGHT_TEAL);
  addCard(sheet, 7, 10, 7, "4th Floor Energy Share", lookup("H", "floorSharePercent"), "0.00", LIGHT_TEAL);
  addCard(sheet, 11, 14, 7, "Average Electricity Rate", lookup("G", "averageRateThbPerKwh"), "#,##0.00", LIGHT_BLUE);
  addNote(1, 3, 10, previousLookupFormula("E", metricValue(selected, "floorEnergyKwh"), metricValue(previous, "floorEnergyKwh")));
  addNote(4, 6, 10, previousLookupFormula("F", metricValue(selected, "floorCostThb"), metricValue(previous, "floorCostThb")));
  addNote(7, 10, 10, previousLookupFormula("H", metricValue(selected, "floorSharePercent"), metricValue(previous, "floorSharePercent")));
  addNote(11, 14, 10, previousLookupFormula("G", metricValue(selected, "averageRateThbPerKwh"), metricValue(previous, "averageRateThbPerKwh")));

  sectionHeading(sheet, 12, "Capacity Overview");
  const rackUsage = rackSelected?.usage ?? null;
  const unitUsage = unitSelected?.usage ?? null;
  addCard(sheet, 1, 3, 14, "Rack Usage", rackLookup("J", rackUsage), "0.0%", LIGHT_AMBER);
  addCard(sheet, 4, 6, 14, "Available Racks", rackLookup("F", rackSelected?.available ?? null), "#,##0", LIGHT_TEAL);
  addCard(sheet, 7, 10, 14, "Rack Unit Usage", currentLookup(options.rackUnitSheetName, "E", unitEnd, unitUsage), "0.0%", LIGHT_AMBER);
  addCard(sheet, 11, 14, 14, "Available U", currentLookup(options.rackUnitSheetName, "D", unitEnd, unitSelected?.available ?? null), "#,##0.00", LIGHT_TEAL);
  addNote(1, 3, 17, statusText("A15", rackUsage));
  addNote(4, 6, 17, "Persisted selected-month Rack snapshot");
  addNote(7, 10, 17, statusText("G15", unitUsage));
  addNote(11, 14, 17, "Physical rack space only");
  sheet.mergeCells("A18:N18");
  sheet.getCell("A18").value = "Capacity thresholds: Normal <80% · Attention 80–84.9% · High ≥85%. Missing snapshots remain blank and are not treated as zero.";
  sheet.getCell("A18").font = { name: "Aptos", size: 8, italic: true, color: { argb: MUTED } };

  const energyHeadingRow = 20;
  sectionHeading(sheet, energyHeadingRow, "Energy & Cost Trends");
  const energyChartRow = energyHeadingRow + 2;
  const fullWidthChartHeight = 18;
  const fullWidthChartStep = fullWidthChartHeight + 2;
  const rackHeadingRow = energyChartRow + fullWidthChartStep * 6 + 1;
  sectionHeading(sheet, rackHeadingRow, "Rack Capacity Trends");
  const rackChartRow = rackHeadingRow + 2;

  sheet.columns = Array.from({ length: 14 }, (_, index) => ({ key: excelColumnName(index + 1).toLowerCase(), width: index === 0 ? 22 : 16 }));
  for (const row of [1, 3, 5, 12, energyHeadingRow, rackHeadingRow]) sheet.getRow(row).height = row === 1 ? 38 : 25;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.pageSetup.rowBreaks = [{ id: energyHeadingRow - 1 }, { id: rackHeadingRow - 1 }];

  const categoryRange = chartRange(trendDataSheetName, "B", chartFirstRow, chartLastRow);
  const categories = trendMetrics.map(metric => monthLabelShort(metric.month, "en"));
  const chartSeries = (name: string, column: string, key: keyof ExcelDashboardMetric, color: string): ExcelDashboardSeries => {
    const values = trendMetrics.map(metric => metricValue(metric, key));
    return { name, range: chartRange(trendDataSheetName, column, chartFirstRow, chartLastRow), values, color, labelFormat: chartLabelFormat(key, values) };
  };
  const chart = (title: string, column: string, key: keyof ExcelDashboardMetric, color: string, fromCol: number, fromRow: number, toCol: number, toRow: number): ExcelDashboardChart => ({ title, kind: "line", categoryRange, categories, series: [chartSeries(title.replace(" Trend", ""), column, key, color)], fromCol, fromRow, toCol, toRow });
  const charts: ExcelDashboardChart[] = trendMetrics.length === 0 ? [] : [
    chart("4th Floor Estimated Cost Trend (THB)", "F", "floorCostThb", "10B981", 0, energyChartRow, 14, energyChartRow + fullWidthChartHeight),
    chart("4th Floor Total Energy Trend (kWh)", "E", "floorEnergyKwh", "2563EB", 0, energyChartRow + fullWidthChartStep, 14, energyChartRow + fullWidthChartStep + fullWidthChartHeight),
    chart("4th Floor Average Electricity Rate Trend (THB/kWh)", "G", "averageRateThbPerKwh", "F59E0B", 0, energyChartRow + fullWidthChartStep * 2, 14, energyChartRow + fullWidthChartStep * 2 + fullWidthChartHeight),
    chart("4th Floor UPS Energy Trend (kWh)", "I", "upsEnergyKwh", "4F46E5", 0, energyChartRow + fullWidthChartStep * 3, 14, energyChartRow + fullWidthChartStep * 3 + fullWidthChartHeight),
    chart("4th Floor Air Conditioning Energy Trend (kWh)", "J", "airEnergyKwh", "06B6D4", 0, energyChartRow + fullWidthChartStep * 4, 14, energyChartRow + fullWidthChartStep * 4 + fullWidthChartHeight),
    chart("4th Floor DC Power Energy Trend (kWh)", "K", "dcEnergyKwh", "8B5CF6", 0, energyChartRow + fullWidthChartStep * 5, 14, energyChartRow + fullWidthChartStep * 5 + fullWidthChartHeight),
    { title: "Rack Capacity Trend", kind: "line", categoryRange, categories, series: [chartSeries("Usage %", "U", "rackPositionUsagePercent", "6366F1"), chartSeries("Availability %", "V", "rackPositionAvailabilityPercent", "14B8A6")], fromCol: 0, fromRow: rackChartRow, toCol: 14, toRow: rackChartRow + fullWidthChartHeight },
    { title: "Rack Unit Capacity Trend", kind: "line", categoryRange, categories, series: [chartSeries("Total U", "N", "rackTotalU", "64748B"), chartSeries("Used U", "O", "rackUsedU", "6366F1"), chartSeries("Available U", "P", "rackAvailableU", "14B8A6")], fromCol: 0, fromRow: rackChartRow + fullWidthChartStep, toCol: 14, toRow: rackChartRow + fullWidthChartStep + fullWidthChartHeight }
  ];
  setFormulaCell(sheet, "Z2", currentLookup(upsStatusData.sheetName, "B", upsStatusData.rowEnd, upsStatusCached), "@");
  sheet.getColumn(26).hidden = true;
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
  const marker = kind === "line" ? `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="28575"><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr></c:marker>` : "";
  const position = index % 2 === 0 ? "t" : "b";
  const dataLabels = kind === "line" ? chartDataLabels(true, series.labelFormat ?? excelCompactChartFormat(series.values), position) : "";
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(series.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr><c:invertIfNegative val="0"/>${marker}${dataLabels}<c:cat><c:strRef><c:f>${xmlEscape(categoryRange)}</c:f>${strCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEscape(series.range)}</c:f>${numCache(series.values)}</c:numRef></c:val></c:ser>`;
}

function chartDataLabels(showValues: boolean, formatCode = "#,##0.00", position?: "t" | "b" | "outEnd"): string {
  const positionXml = position ? `<c:dLblPos val="${position}"/>` : "";
  return `<c:dLbls><c:numFmt formatCode="${xmlEscape(formatCode)}" sourceLinked="0"/>${positionXml}<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="950" b="1"/></a:pPr><a:endParaRPr lang="en-US" sz="950" b="1"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="${showValues ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`;
}

function chartLegend(): string {
  return `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>`;
}

function chartXml(chart: ExcelDashboardChart): string {
  const axisCategory = 100000000 + chart.fromCol;
  const axisValue = 200000000 + chart.fromCol;
  const plot = chart.kind === "bar"
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${chart.series.map((series, index) => chartSeriesXml(series, chart.categoryRange, chart.categories, index, chart.kind)).join("")}${chartDataLabels(true, excelCompactChartFormat(chart.series.flatMap(series => series.values)), "outEnd")}<c:gapWidth val="80"/><c:axId val="${axisCategory}"/><c:axId val="${axisValue}"/></c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${chart.series.map((series, index) => chartSeriesXml(series, chart.categoryRange, chart.categories, index, chart.kind)).join("")}<c:marker val="1"/><c:smooth val="0"/><c:axId val="${axisCategory}"/><c:axId val="${axisValue}"/></c:lineChart>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="0"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US" sz="1500" b="1"/><a:t>${xmlEscape(chart.title)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx><c:layout/></c:title><c:plotArea><c:layout/>${plot}<c:catAx><c:axId val="${axisCategory}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axisValue}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US" sz="1000"/></a:p></c:txPr></c:catAx><c:valAx><c:axId val="${axisValue}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:numFmt formatCode="${xmlEscape(excelCompactChartFormat(chart.series.flatMap(series => series.values), chart.series.every(series => (series.labelFormat ?? "").includes("%"))))}" sourceLinked="0"/><c:crossAx val="${axisCategory}"/><c:crosses val="autoZero"/><c:crossBetween val="${chart.kind === "line" ? "between" : "midCat"}"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US" sz="1000"/></a:p></c:txPr></c:valAx></c:plotArea>${chartLegend()}<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
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
