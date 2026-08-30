import JSZip from "jszip";
import { monthLabelShort } from "../utils/monthUtils";

export interface ExcelDashboardMetric {
  month: string;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
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

function addCard(sheet: any, fromCol: number, toCol: number, topRow: number, label: string, formula: { formula: string; result: number | string }, numberFormat: string, fill: string): void {
  sheet.mergeCells(topRow, fromCol, topRow, toCol);
  sheet.mergeCells(topRow + 1, fromCol, topRow + 2, toCol);
  styleRange(sheet, topRow, topRow, fromCol, toCol, fill, { name: "Aptos", size: 9, bold: true, color: { argb: MUTED } }, { vertical: "middle", horizontal: "left" });
  styleRange(sheet, topRow + 1, topRow + 2, fromCol, toCol, fill, { name: "Aptos Display", size: 18, bold: true, color: { argb: NAVY } }, { vertical: "middle", horizontal: "left" });
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
  sheet.addRow(["Month", "Label", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "4th Floor Share (%)", "UPS Energy (kWh)", "Air Energy (kWh)", "DC Energy (kWh)", "UPS Load (kW)", "UPS Load (%)", "Rack Total (U)", "Rack Used (U)", "Rack Available (U)", "Rack Usage (%)"]);
  for (const metric of metrics) {
    sheet.addRow([
      metric.month,
      monthLabelShort(metric.month, "en"),
      metric.buildingEnergyKwh,
      metric.buildingCostThb,
      metric.floorEnergyKwh,
      metric.floorCostThb,
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
    for (const column of [3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15]) sheet.getCell(row, column).numFmt = "#,##0.00";
    for (const column of [7, 12, 16]) sheet.getCell(row, column).numFmt = "0.00";
  }
}

export function addInteractiveDashboard(workbook: any, prefix: string, siteName: string, metrics: ExcelDashboardMetric[], options: { dashboardSheetName?: string; dataSheetName?: string; includeDataSheet?: boolean } = {}): ExcelDashboardPlan {
  const dashboardSheetName = options.dashboardSheetName ?? safeSheetName(prefix, "Dashboard");
  const dataSheetName = options.dataSheetName ?? safeSheetName(prefix, "Dashboard_Data");
  const dashboard = workbook.addWorksheet(dashboardSheetName);
  if (options.includeDataSheet !== false) addDashboardDataSheet(workbook, dataSheetName, metrics);
  const dataRowEnd = Math.max(2, metrics.length + 1);
  const selectedMetric = metrics.at(-1);
  const data = excelSheetRef(dataSheetName);
  const lookup = (column: string, key: keyof ExcelDashboardMetric) => lookupFormula(dataSheetName, column, dataRowEnd, metricValue(selectedMetric, key));

  dashboard.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  dashboard.properties.tabColor = TEAL;
  dashboard.mergeCells("A1:N1");
  dashboard.getCell("A1").value = "Data Center Energy & Facility Monitor — Interactive Dashboard";
  dashboard.getCell("A1").font = { name: "Aptos Display", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  dashboard.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
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
  dashboard.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
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

  const percentFormat = "0.00";
  const numberFormat = "#,##0.00";
  addCard(dashboard, 1, 3, 5, "Building Energy (kWh)", lookup("C", "buildingEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 4, 6, 5, "Building Cost (THB)", lookup("D", "buildingCostThb"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 7, 9, 5, "4th Floor Energy (kWh)", lookup("E", "floorEnergyKwh"), numberFormat, LIGHT_TEAL);
  addCard(dashboard, 10, 12, 5, "4th Floor Cost (THB)", lookup("F", "floorCostThb"), numberFormat, LIGHT_TEAL);
  addCard(dashboard, 13, 14, 5, "Floor Share (%)", lookup("G", "floorSharePercent"), percentFormat, LIGHT_AMBER);
  const upsStatus = selectedMetric?.upsLoadPercent === null || selectedMetric?.upsLoadPercent === undefined
    ? "No data"
    : selectedMetric.upsLoadPercent >= 90 ? "Critical" : selectedMetric.upsLoadPercent >= 80 ? "Warning" : "Normal";
  addCard(dashboard, 1, 3, 9, "UPS Status", cellFormula('IF(Q9="","No data",IF(Q9>=90,"Critical",IF(Q9>=80,"Warning","Normal")))', upsStatus), "@", upsStatus === "Critical" ? LIGHT_RED : upsStatus === "Warning" ? LIGHT_AMBER : LIGHT_TEAL);
  addCard(dashboard, 4, 6, 9, "UPS Energy (kWh)", lookup("H", "upsEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 7, 9, 9, "Air Energy (kWh)", lookup("I", "airEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 10, 12, 9, "DC Energy (kWh)", lookup("J", "dcEnergyKwh"), numberFormat, LIGHT_BLUE);
  addCard(dashboard, 13, 14, 9, "Rack Usage (%)", lookup("P", "rackUsagePercent"), percentFormat, LIGHT_AMBER);

  dashboard.mergeCells("A13:N13");
  dashboard.getCell("A13").value = "Selected-month Engineering Analysis";
  dashboard.getCell("A13").font = { name: "Aptos Display", size: 13, bold: true, color: { argb: NAVY } };
  dashboard.getCell("A13").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F9" } };
  dashboard.getCell("A13").alignment = { vertical: "middle", horizontal: "left" };
  dashboard.getRow(13).height = 24;
  dashboard.getCell("A14").value = "Metric";
  dashboard.getCell("B14").value = "Value";
  dashboard.getCell("C14").value = "Unit / Interpretation";
  dashboard.mergeCells("C14:D14");
  for (const address of ["A14", "B14", "C14"]) applyCellStyle(dashboard.getCell(address), DARK_BLUE, { name: "Aptos", size: 9, bold: true, color: { argb: "FFFFFFFF" } }, { vertical: "middle", horizontal: "left" });
  const selectedRows: Array<[string, { formula: string; result: number | string }, string]> = [
    ["UPS Load", lookup("K", "upsLoadKw"), "kW"],
    ["UPS Load", lookup("L", "upsLoadPercent"), "%"],
    ["Rack Used", lookup("N", "rackUsedU"), "U"],
    ["Rack Available", lookup("O", "rackAvailableU"), "U"],
    ["Rack Total", lookup("M", "rackTotalU"), "U"]
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
  setFormulaCell(dashboard, "Q2", lookup("H", "upsEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q3", lookup("I", "airEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q4", lookup("J", "dcEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q5", lookup("E", "floorEnergyKwh"), numberFormat);
  setFormulaCell(dashboard, "Q6", lookup("N", "rackUsedU"), numberFormat);
  setFormulaCell(dashboard, "Q7", lookup("O", "rackAvailableU"), numberFormat);
  setFormulaCell(dashboard, "Q8", lookup("M", "rackTotalU"), numberFormat);
  setFormulaCell(dashboard, "Q9", lookup("L", "upsLoadPercent"), percentFormat);
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
  const lastDataRow = Math.max(firstDataRow, metrics.length + 1);
  const categoryRange = chartRange(dataSheetName, "B", firstDataRow, lastDataRow);
  const categories = metrics.map(metric => monthLabelShort(metric.month, "en"));
  const series = (name: string, column: string, key: keyof ExcelDashboardMetric, color: string): ExcelDashboardSeries => ({ name, range: chartRange(dataSheetName, column, firstDataRow, lastDataRow), values: metrics.map(metric => metricValue(metric, key)), color });
  return {
    dashboardSheetName,
    charts: metrics.length === 0 ? [] : [
      { title: "Monthly Energy Consumption Trend", kind: "line", categoryRange, categories, series: [series("Building Energy", "C", "buildingEnergyKwh", "E4572E"), series("4th Floor Energy", "E", "floorEnergyKwh", "007A75"), series("UPS Energy", "H", "upsEnergyKwh", "4472C4"), series("Air Energy", "I", "airEnergyKwh", "ED9B40"), series("DC Energy", "J", "dcEnergyKwh", "6B7280")], fromCol: 0, fromRow: 19, toCol: 7, toRow: 35 },
      { title: "Monthly Energy Cost Trend", kind: "line", categoryRange, categories, series: [series("Building Cost", "D", "buildingCostThb", "E4572E"), series("4th Floor Cost", "F", "floorCostThb", "007A75")], fromCol: 7, fromRow: 19, toCol: 14, toRow: 35 },
      { title: "Rack Unit Capacity and Utilization Trend", kind: "line", categoryRange, categories, series: [series("Total (U)", "M", "rackTotalU", "1E3A5F"), series("Used (U)", "N", "rackUsedU", "E4572E"), series("Available (U)", "O", "rackAvailableU", "00A878")], fromCol: 0, fromRow: 36, toCol: 7, toRow: 52 },
      { title: "Selected Month Energy Breakdown", kind: "bar", categoryRange: `${excelSheetRef(dashboardSheetName)}!$P$2:$P$5`, categories: ["UPS Energy", "Air Energy", "DC Energy", "4th Floor Energy"], series: [{ name: "Energy (kWh)", range: `${excelSheetRef(dashboardSheetName)}!$Q$2:$Q$5`, values: [metricValue(selectedMetric, "upsEnergyKwh"), metricValue(selectedMetric, "airEnergyKwh"), metricValue(selectedMetric, "dcEnergyKwh"), metricValue(selectedMetric, "floorEnergyKwh")], color: "007A75" }], fromCol: 7, fromRow: 36, toCol: 14, toRow: 52 }
    ]
  };
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
    const worksheetXml = await worksheetFile.async("string");
    const worksheetRelsPath = `${worksheetPath.slice(0, worksheetPath.lastIndexOf("/"))}/_rels/${worksheetPath.slice(worksheetPath.lastIndexOf("/") + 1)}.rels`;
    const worksheetRelsFile = zip.file(worksheetRelsPath);
    const existingRelationships = worksheetRelsFile ? relationshipTags(await worksheetRelsFile.async("string")) : [];
    const drawingRelationshipId = nextRelationshipId(existingRelationships);
    const drawingPath = `xl/drawings/drawing${nextDrawing++}.xml`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${nextDrawing - 1}.xml.rels`;
    const chartRelationships: Array<{ id: string; type: string; target: string }> = [];
    const drawingCharts = plan.charts.map((chart, index) => {
      const chartId = nextChart++;
      const relationshipId = `rId${index + 1}`;
      const chartPath = `xl/charts/chart${chartId}.xml`;
      zip.file(chartPath, chartXml(chart));
      chartRelationships.push({ id: relationshipId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart", target: `../charts/chart${chartId}.xml` });
      contentTypes = appendXmlBeforeClose(contentTypes, "</Types>", `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      return { relationshipId, chartId, anchor: chart };
    });
    zip.file(drawingPath, drawingXml(drawingCharts));
    zip.file(drawingRelsPath, relationshipXml(chartRelationships));
    contentTypes = appendXmlBeforeClose(contentTypes, "</Types>", `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const updatedWorksheetRels = relationshipXml([...existingRelationships, { id: drawingRelationshipId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", target: `../drawings/drawing${nextDrawing - 1}.xml` }]);
    zip.file(worksheetRelsPath, updatedWorksheetRels);
    const worksheetWithDrawing = worksheetXml.includes("<drawing ") ? worksheetXml : appendXmlBeforeClose(worksheetXml, "</worksheet>", `<drawing r:id="${drawingRelationshipId}"/>`);
    zip.file(worksheetPath, worksheetWithDrawing);
  }
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "uint8array" });
}
