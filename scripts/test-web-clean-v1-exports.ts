import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildAllFacilitiesCsv, buildSiteComparisonCsv, facilityReportData, fitPdfImageToPage, workbookForFacilities, writeInteractiveExcelWorkbook, rackReportFromSnapshot, type SiteComparisonExport, type RackSnapshotApiResponse } from "../src/web-clean-v1/exports";
import type { ReportData } from "../src/reports/reportTypes";
import { buildCombinedCsv } from "../src/utils/exportData";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import { trendChartXPosition } from "../src/reports/pdf/reportHtml";
import { calculateRackCapacityMetrics } from "../src/domain/rackCapacity";
import { defaultReportingPeriod, effectiveMonth, filterLogsByPeriod, type ReportingPeriodSelection } from "../src/web-clean-v1/reportPeriod";
import { defaultReportFilename, withExtension } from "../src/web-clean-v1/reportFilename";
import type { MonthlyLog } from "../src/types";
import { readWorkbookSource } from "../server/migration/workbookSource";
import { readUpsGroupHistoryFromBuffer } from "../src/reports/upsGroupHistoryReader";
import { readUpsMappingFromBuffer } from "../src/reports/upsMappingReader";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";
import { readRackCapacityHistoryFromBuffer } from "../src/excel/RackCapacityHistoryWriter";


const log = (month: string): MonthlyLog => ({
  month,
  ups: [],
  air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
  dc: [],
  energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 500 },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
});

const comparison: SiteComparisonExport = {
  displayPeriod: { startMonth: "2025-12", endMonth: "2026-01" },
  months: ["2025-12", "2026-01"],
  sites: [
    { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 50, floorCost: 250, avgRate: 5, floorShare: 50 } }] },
    { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 200, buildingCost: 900, floorEnergy: 80, floorCost: 360, avgRate: 4.5, floorShare: 40 } }] }
  ]
};

const allFacilities = buildAllFacilitiesCsv([{ siteName: "Rangsit", logs: [log("2026-01")] }, { siteName: "Srinakarin", logs: [log("2026-01")] }]);
assert.match(allFacilities, /# Facility: Rangsit/);
assert.match(allFacilities, /# Facility: Srinakarin/);
assert.match(allFacilities, /# Energy_Cost/);

const csv = buildSiteComparisonCsv(comparison, "2026-01");
assert.match(csv, /Rangsit,rangsit,2026-01,100.00,500.00/);
assert.match(csv, /Srinakarin,srinakarin,2026-01,200.00,900.00/);
assert.doesNotMatch(csv, /undefined|NaN/);

// ============================================================
// Critical stale-data test: Excel, CSV, and PDF must all reflect the
// currently-selected Reporting Period/Month, never a previously-selected
// one. Verifies ACTUAL generated content (real XLSX bytes via ExcelJS,
// the real CSV string, the real PDF HTML string) - not just "a file was
// produced". Distinct, easily-distinguished energy values per month
// (611111 / 722222 / 833333) rule out accidental substring collisions.
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// Excel completeness gate: every facility export must keep the entered facts,
// save/audit state, calculated values, Dashboard-FAC tables, and persisted
// history tables in separate, inspectable worksheets. Existence alone is not
// enough - read the generated XLSX back and verify representative values too.
const completeExportWorkbook = await workbookForFacilities([{
  siteName: "Rangsit",
  logs: [{
    ...log("2026-06"),
    ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 }],
    dc: [{ panelId: "DC PDB41A", voltage: 220, current: 5 }],
    energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 500 },
    lastSavedUps: "2026-06-30T01:00:00.000Z",
    lastSavedAir: "2026-06-30T01:01:00.000Z",
    lastSavedDc: "2026-06-30T01:02:00.000Z",
    lastSavedEnergyCost: "2026-06-30T01:03:00.000Z"
  }],
  rackUnitCapacity: [{ month: "2026-06", totalU: 100, usedU: 40, availableU: 60, availabilityPct: 0.6, imageAttached: true, imageContentType: "image/png", imageSavedAt: "2026-06-30T01:04:00.000Z" }],
  rackHistory: [{ snapshotMonth: "2026-06", facility: "Rangsit", rackZone: "(Total)", totalRacks: 10, inUse: 4, available: 6, reserved: 0, pendingDismantle: 0, other: 0, usagePct: 0.4, availabilityPct: 0.6, reservedPct: 0, pendingDismantlePct: 0, otherPct: 0, generatedAt: "2026-06-30T01:00:00.000Z", dataVersion: 1 }],
  upsGroupHistory: { sourceSheet: "2. UPS Group History", rows: [{ facility: "Rangsit", month: "2026-06", group: "UPS 11", totalLoadKw: 2, totalLoadKva: 2.5, capacity: 400, loadPercent: 0.625, availablePercent: 99.375, monthlyEnergyKwh: 1440, generatedAt: "2026-06-30T01:00:00.000Z", dataVersion: 1 }] },
  dashboardMapping: { sourceSheet: "Dashboard-FAC", summary: [], mapping: [{ no: 1, umdb: "UMDB11A", upsId: "UPS 11A", acPowerPanel: "—", sts: "STS11A", oudb: "OUDB41A", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null }] }
}]);
const completeSheetNames = completeExportWorkbook.worksheets.map(sheet => sheet.name);
for (const fragment of ["UPS_Loads", "Air_Inputs", "DC_Inputs", "Energy_Cost", "Saved_Records", "Saved_Values", "Raw_Inputs", "Calculated_Energy", "Dashboard-FAC", "Dashboard-FAC UPS", "Dashboard-FAC Air", "Dashboard-FAC DC", "Rack Unit Capacity", "Rack Capacity History", "UPS Group History", "Rack Capacity Raw"]) {
  check(`complete Excel export has ${fragment} table`, completeSheetNames.some(name => name.includes(fragment)));
}
const dashboardSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Dashboard-FAC") && !sheet.name.includes("UPS") && !sheet.name.includes("Air") && !sheet.name.includes("DC"));
const dashboardText = dashboardSheet?.getSheetValues().flat().map(String).join("|") ?? "";
check("Dashboard-FAC export contains the selected facility's calculated value", dashboardText.includes("100"));
const dashboardDetailSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Dashboard-FAC Detail"));
check("Dashboard-FAC Details export contains the Desktop mapping row", (dashboardDetailSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("UPS 11A"));
const rackUnitSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Rack Unit Capacity"));
check("Rack Unit Capacity export contains persisted Total (U)", (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("100"));
check("Rack Unit Capacity export exposes image attachment status without exposing storage keys", (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Image Attached") && (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Yes") && !(rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("objectKey"));
const savedValuesSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Saved_Values"));
check("Saved Values export contains Rack Unit image metadata column", (savedValuesSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Rack Unit Image JSON"));
const interactiveXlsx = await writeInteractiveExcelWorkbook(completeExportWorkbook);
const interactiveZip = await JSZip.loadAsync(interactiveXlsx);
const interactiveParts = Object.keys(interactiveZip.files);
const chartParts = interactiveParts.filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name));
check("Interactive Excel export contains native editable charts", chartParts.length >= 4);
const dashboardXmlParts: string[] = [];
for (const name of interactiveParts.filter(item => /^xl\/worksheets\/sheet\d+\.xml$/.test(item))) {
  const file = interactiveZip.file(name);
  if (file) dashboardXmlParts.push(await file.async("string"));
}
const dashboardSheetXml = dashboardXmlParts.find(xml => xml.includes("MATCH($B$3")) ?? "";
check("Interactive Dashboard has a reporting-month dropdown", dashboardSheetXml.includes("dataValidations") && dashboardSheetXml.includes("$Z$2:$Z$2"));
check("Interactive Dashboard cards use the selected month", dashboardSheetXml.includes("MATCH($B$3"));
const chartFile = chartParts.length > 0 ? interactiveZip.file(chartParts[0]) : null;
const chartXml = chartFile ? await chartFile.async("string") : "";
check("Interactive Dashboard chart references the hidden dashboard data sheet", chartXml.includes("Dashboard_Data") && chartXml.includes("Monthly Energy Consumption Trend"));
check("Interactive Excel export contains a worksheet drawing relationship", interactiveParts.some(name => /xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) && interactiveParts.some(name => /xl\/drawings\/drawing\d+\.xml$/.test(name)));
const rackOnlyExport = await workbookForFacilities([{
  siteName: "Rangsit",
  logs: [],
  reportingMonths: ["2026-08"],
  rackUnitCapacity: [{ month: "2026-08", totalU: 200, usedU: 50, availableU: 150, availabilityPct: 0.75 }]
}]);
const rackOnlySheet = rackOnlyExport.worksheets.find(sheet => sheet.name.includes("Rack Unit Capacity"));
check("Rack Unit-only historical month is exported even when no MonthlyLog exists", (rackOnlySheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("2026-08") && (rackOnlySheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("200"));

const june = { ...log("2026-06"), energyCost: { buildingEnergyKwh: 611111, buildingElectricityCostThb: 3055555 } };
const july = { ...log("2026-07"), energyCost: { buildingEnergyKwh: 722222, buildingElectricityCostThb: 3611110 } };
const august = { ...log("2026-08"), energyCost: { buildingEnergyKwh: 833333, buildingElectricityCostThb: 4166665 } };
const threeMonthLogs = [june, july, august];

/** Mirrors reportHtml.ts's internal (unexported) formatMonth: the PDF
 *  renders a human-readable "Mon YYYY" label, not the raw ISO month
 *  string - matching Desktop's report convention, not a defect. */
function humanMonthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

async function assertExportsShowOnlyMonth(monthLabel: string, selection: ReportingPeriodSelection, appMonth: string): Promise<void> {
  const scoped = filterLogsByPeriod(threeMonthLogs, selection, appMonth);
  check(`${monthLabel}: scoped log set contains exactly one month`, scoped.length === 1 && scoped[0].month === monthLabel);

  // CSV
  const csvContent = buildCombinedCsv(scoped);
  check(`${monthLabel}: CSV contains the selected month`, csvContent.includes(monthLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: CSV does not contain ${other}`, !csvContent.includes(other));
  }

  // Excel - real workbook bytes, read back with ExcelJS.
  const workbook = await workbookForFacilities([{ siteName: "Rangsit", logs: scoped }]);
  const buffer = await workbook.xlsx.writeBuffer();
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(buffer as unknown as ArrayBuffer);
  const energySheet = reread.worksheets.find(sheet => sheet.name.includes("Energy_Cost"));
  check(`${monthLabel}: Excel has an Energy_Cost sheet`, Boolean(energySheet));
  const sheetText = energySheet!.getSheetValues().flat().map(String).join("|");
  check(`${monthLabel}: Excel sheet contains the selected month`, sheetText.includes(monthLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: Excel sheet does not contain ${other}`, !sheetText.includes(other));
  }

  // PDF - real generated HTML string. Reports render a human-readable
  // "Mon YYYY" month label (e.g. "Jun 2026"), not the raw ISO string.
  const reportData = facilityReportData(scoped, "Rangsit", monthLabel);
  const html = buildReportHtml(reportData);
  const humanLabel = humanMonthLabel(monthLabel);
  check(`${monthLabel}: PDF HTML contains the selected reporting month (as "${humanLabel}")`, html.includes(humanLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: PDF HTML does not contain ${humanMonthLabel(other)}`, !html.includes(humanMonthLabel(other)));
  }
}

// Simulates: app starts on 2026-08 (today), user selects Single Month =
// 2026-06 in the Reports view, generates all three formats, then switches
// to 2026-07 and regenerates - each pass must show only its own month.
await assertExportsShowOnlyMonth("2026-06", { mode: "single", singleMonth: "2026-06", rangeStart: "2026-06", rangeEnd: "2026-06" }, "2026-08");
await assertExportsShowOnlyMonth("2026-07", { mode: "single", singleMonth: "2026-07", rangeStart: "2026-07", rangeEnd: "2026-07" }, "2026-08");

// "Current Month" mode follows the app's live reporting month directly,
// with no separate stored selection to go stale.
const currentModeJune = defaultReportingPeriod("2026-06");
check("Current Month mode resolves to the app's live month", effectiveMonth(currentModeJune, "2026-06") === "2026-06");
check("Current Month mode filters to exactly that month", filterLogsByPeriod(threeMonthLogs, currentModeJune, "2026-06").length === 1);

// Full History mode is unchanged (existing behavior) - all months included.
const fullHistory: ReportingPeriodSelection = { mode: "full", singleMonth: "2026-08", rangeStart: "2026-06", rangeEnd: "2026-08" };
check("Full History mode includes every fetched month", filterLogsByPeriod(threeMonthLogs, fullHistory, "2026-08").length === 3);

// Month Range mode: inclusive boundaries, excludes months outside the range.
const juneToJuly: ReportingPeriodSelection = { mode: "range", singleMonth: "2026-06", rangeStart: "2026-06", rangeEnd: "2026-07" };
const rangeScoped = filterLogsByPeriod(threeMonthLogs, juneToJuly, "2026-08");
check("Month Range includes both boundary months", rangeScoped.some(l => l.month === "2026-06") && rangeScoped.some(l => l.month === "2026-07"));
check("Month Range excludes a month outside the range", !rangeScoped.some(l => l.month === "2026-08"));
const rangeReport = facilityReportData(rangeScoped, "Rangsit", "2026-07", null, [], [], threeMonthLogs);
const rangeReportHtml = buildReportHtml(rangeReport);
check("Month Range changes the actual PDF report scope, not only the UI label", rangeReport.monthlyRows.map(row => row.month).join(",") === "2026-06,2026-07" && !rangeReportHtml.includes(humanMonthLabel("2026-08")));
check("PDF cover omits the internal source workbook label", !rangeReportHtml.includes("Source workbook:"));
check("PDF cover omits the application version label", !rangeReportHtml.includes("Application version:"));

const upsReportLog: MonthlyLog = {
  ...log("2026-07"),
  ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 }]
};
const reportWithDashboardData = facilityReportData(
  [upsReportLog],
  "Rangsit",
  "2026-07",
  null,
  [],
  [],
  [upsReportLog],
  {
    upsGroupHistory: {
      sourceSheet: "2. UPS Group History",
      rows: [{ facility: "Rangsit", month: "2026-07", group: "UPS 11", totalLoadKw: 2, totalLoadKva: 2.5, capacity: 400, loadPercent: 0.625, availablePercent: 99.375, monthlyEnergyKwh: 1488, generatedAt: null, dataVersion: 1 }]
    }
  }
);
const reportWithDashboardHtml = buildReportHtml(reportWithDashboardData);
check("PDF engineering analysis receives the persisted UPS status", reportWithDashboardData.engineeringDashboard?.upsGroups.some(group => group.name === "UPS 11") === true && reportWithDashboardHtml.includes("UPS Load Status"));
check("PDF includes the executive dashboard card page", reportWithDashboardHtml.includes("Executive Dashboard") && reportWithDashboardHtml.includes("Total Building Energy"));
check("Executive report selection includes the dashboard trend charts", buildReportHtml(reportWithDashboardData, ["executive"]).includes("Monthly Energy Consumption Trend"));

const reportWithRackUnitImage = facilityReportData(
  [log("2026-07")],
  "Srinakarin",
  "2026-07",
  null,
  [],
  [{ month: "2026-07", totalU: 9963, usedU: 7445, availableU: 2518, availabilityPct: 25.27 }],
  [log("2026-07")],
  {
    rackUnitCapacityImageDataUri: "data:image/png;base64,TEST_RACK_UNIT_IMAGE",
    rackUnitCapacityImageMeta: { savedAt: "2026-08-14T16:57:50.000Z", savedBy: "admin", width: 2048, height: 1536 }
  }
);
const reportWithRackUnitImageHtml = buildReportHtml(reportWithRackUnitImage);
check("Rack Unit Capacity PDF embeds the loaded image data URI", reportWithRackUnitImageHtml.includes("data:image/png;base64,TEST_RACK_UNIT_IMAGE"));
check("Rack Unit Capacity PDF includes image metadata when an image is available", reportWithRackUnitImageHtml.includes("2048×1536px") && reportWithRackUnitImageHtml.includes("Captured By: admin"));

const landscapePlacement = fitPdfImageToPage(1123, 794);
check("PDF page fit leaves a 10mm minimum outer margin", landscapePlacement.xMm >= 10 && landscapePlacement.yMm >= 10);
check("PDF page fit preserves the rendered page aspect ratio", Math.abs(landscapePlacement.widthMm / landscapePlacement.heightMm - 1123 / 794) < 0.000001);
const tallPlacement = fitPdfImageToPage(800, 1200);
check("Tall PDF content is contained without cropping or distortion", tallPlacement.widthMm <= 277 && tallPlacement.heightMm <= 190 && Math.abs(tallPlacement.widthMm / tallPlacement.heightMm - 800 / 1200) < 0.000001);
const firstTrendX = trendChartXPosition(0, 7);
const secondTrendX = trendChartXPosition(1, 7);
const lastTrendX = trendChartXPosition(6, 7);
const categorySlot = (1600 - 140 - 80) / 8;
check("Trend charts reserve one category slot before the first point", firstTrendX > 140 && Math.abs(firstTrendX - 140 - categorySlot) < 0.000001);
check("Trend charts reserve one category slot after the final point", Math.abs(1600 - 80 - lastTrendX - categorySlot) < 0.000001);
check("Trend chart category spacing remains uniform after the edge offsets", Math.abs((secondTrendX - firstTrendX) - categorySlot) < 0.000001);

// Filename actually reaches every format, with the correct extension and
// no duplicate/missing extension, and the displayed preview matches what
// would actually be downloaded/printed.
const filename = defaultReportFilename("Rangsit", "2026-06");
check("default filename follows the Desktop convention", filename === "Energy_Report_Rangsit_2026-06");
check("Excel filename has exactly one .xlsx extension", withExtension(filename, "xlsx") === "Energy_Report_Rangsit_2026-06.xlsx" && !withExtension(filename, "xlsx").includes(".xlsx.xlsx"));
check("CSV filename has exactly one .csv extension", withExtension(filename, "csv") === "Energy_Report_Rangsit_2026-06.csv");
check("PDF filename has exactly one .pdf extension", withExtension(filename, "pdf") === "Energy_Report_Rangsit_2026-06.pdf");

// ============================================================
// Rack Report: was previously always `rack: null` in every generated
// report regardless of real data (facilityReportData never fetched or
// received rack data at all). rackReportFromSnapshot() bridges the
// existing GET /racks API response into the same RackCapacityReport shape
// Desktop's Excel-based reader produces, reusing deriveRackCapacityReport
// (extracted from rackCapacityReader.ts) - the same grouping/validation
// rules, never a second calculation engine.
// ============================================================

check("rackReportFromSnapshot(null) returns null, not a crash", rackReportFromSnapshot(null) === null);
check("a genuinely empty snapshot returns null", rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: null }) === null);
check("a snapshot with zero records returns null", rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [] } }) === null);

const rackSnapshot: RackSnapshotApiResponse = {
  siteId: 1,
  month: "2026-06",
  snapshot: {
    month: "2026-06",
    rowVersion: 3,
    records: [
      { rowNumber: 1, rackZone: "Zone A", rackId: "A-01", status: "In Use", cabinetSize: "42U", detail: "Web servers", deviceType: "Server", remarks: null },
      { rowNumber: 2, rackZone: "Zone A", rackId: "A-02", status: "Available", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
      { rowNumber: null, rackZone: "Zone B", rackId: "B-01", status: "Reserved", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
      { rowNumber: 4, rackZone: "Zone B", rackId: "A-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null } // duplicate rack ID (A-01) on purpose
    ]
  }
};
const rackReport = rackReportFromSnapshot(rackSnapshot);
check("a real snapshot maps to a non-null RackCapacityReport", rackReport !== null);
check("records carry through unchanged (count)", rackReport!.records.length === 4);
check("a null source rowNumber falls back to its 1-based position, not fabricated data mistaken for a real row number", rackReport!.records[2].rowNumber === 3);
check("an already-present rowNumber is preserved exactly, not overwritten by the fallback", rackReport!.records[0].rowNumber === 1 && rackReport!.records[3].rowNumber === 4);
check("byZone grouping reuses Desktop's exact rule (2 zones, 2 records each)", rackReport!.byZone.length === 2 && rackReport!.byZone.every((z: { count: number }) => z.count === 2));
check("duplicate rack IDs are detected using the same rule the Excel reader uses", rackReport!.validation.duplicateIds.includes("A-01"));
check("sourceSheet/sourceTable match Desktop's Rack Capacity sheet/table naming", rackReport!.sourceSheet === "Rack Capacity" && rackReport!.sourceTable === "Table7");

// PDF content: the "Rack Capacity and Utilization" page must show real,
// non-fabricated numbers computed by the exact same calculateRackCapacityMetrics
// the live Rack Capacity view uses - not a second, Web-only calculation.
const noRackData = facilityReportData([log("2026-06")], "Rangsit", "2026-06", null);
const noRackHtml = buildReportHtml(noRackData);
check("with no rack data, the PDF honestly says so rather than showing a fabricated empty table", noRackHtml.includes("Rack capacity data is unavailable in this workbook."));

const withRackData = facilityReportData([log("2026-06")], "Rangsit", "2026-06", rackReport);
const withRackHtml = buildReportHtml(withRackData);
const expectedMetrics = calculateRackCapacityMetrics(rackReport!.records);
check("with real rack data, the PDF renders the Rack Capacity and Utilization page", withRackHtml.includes("Rack Capacity and Utilization") && !withRackHtml.includes("Rack capacity data is unavailable in this workbook."));
check("the PDF's Total Racks KPI matches calculateRackCapacityMetrics exactly (reused, not recomputed)", withRackHtml.includes(`<div class="kpi-label">Total Racks</div><div class="kpi-value">${expectedMetrics.total}</div>`));
check("the PDF shows the real zone name from the snapshot", withRackHtml.includes("Zone A") && withRackHtml.includes("Zone B"));

// Facility isolation: printAllFacilitiesPdf builds one facilityReportData
// per facility (see src/web-clean-v1/exports.ts) - verify a second
// facility's distinctly-named rack zone never leaks into the first
// facility's report, mirroring every other facility-isolation test in
// this codebase.
const rangsitOnlyRack = rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [{ rowNumber: 1, rackZone: "Rangsit-Only-Zone", rackId: "R-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null }] } });
const srinakarinOnlyRack = rackReportFromSnapshot({ siteId: 2, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [{ rowNumber: 1, rackZone: "Srinakarin-Only-Zone", rackId: "S-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null }] } });
const rangsitReportHtml = buildReportHtml(facilityReportData([log("2026-06")], "Rangsit", "2026-06", rangsitOnlyRack));
const srinakarinReportHtml = buildReportHtml(facilityReportData([log("2026-06")], "Srinakarin", "2026-06", srinakarinOnlyRack));
check("Rangsit's report shows its own rack zone", rangsitReportHtml.includes("Rangsit-Only-Zone"));
check("Rangsit's report never shows Srinakarin's rack zone (no cross-facility leak)", !rangsitReportHtml.includes("Srinakarin-Only-Zone"));
check("Srinakarin's report shows its own rack zone", srinakarinReportHtml.includes("Srinakarin-Only-Zone"));
check("Srinakarin's report never shows Rangsit's rack zone (no cross-facility leak)", !srinakarinReportHtml.includes("Rangsit-Only-Zone"));

// Site Comparison's "Rack Capacity Site Comparison" page (printSiteComparisonPdf
// builds this same rackComparison shape from two loadRack() results - not
// directly callable here since it uses window.open, so this exercises the
// shared renderer with the exact object shape that function assembles).
const comparisonBase = facilityReportData([log("2026-06")], "Site Comparison Base", "2026-06");
const withRackComparison: ReportData = { ...comparisonBase, rackComparison: { self: { label: "Rangsit", records: rangsitOnlyRack!.records }, other: { label: "Srinakarin", records: srinakarinOnlyRack!.records } } };
const rackComparisonHtml = buildReportHtml(withRackComparison);
check("Rack Capacity Site Comparison page renders when rackComparison is populated", rackComparisonHtml.includes("Rack Capacity Site Comparison"));
check("the comparison page shows both facility labels", rackComparisonHtml.includes("Rangsit") && rackComparisonHtml.includes("Srinakarin"));
const withoutRackComparison: ReportData = { ...comparisonBase, rackComparison: null };
check("Rack Capacity Site Comparison page is absent (not an empty section) when rackComparison is null", !buildReportHtml(withoutRackComparison).includes("Rack Capacity Site Comparison"));

// ============================================================
// Desktop-source acceptance gate: build the actual Web Excel export from the
// two Desktop workbooks and their external Rack Unit image stores. This is a
// stronger check than fixture-only sheet-name assertions: every required
// table must contain the source's real rows, including Dashboard-FAC detail
// mapping, UPS Group History, Rack Unit history, and image attachment status.
for (const sourceCase of [
  { site: "Rangsit", workbookPath: "DC_Rangsit.xlsm", imagesRoot: "release\\Energy Monitor-v2.3.0\\data\\rack-unit-images" },
  { site: "Srinakarin", workbookPath: "DC_Srinakarin.xlsm", imagesRoot: "release\\Energy Monitor-v2.2.7\\data\\rack-unit-images" }
]) {
  const buffer = await readFile(sourceCase.workbookPath);
  const source = await readWorkbookSource(sourceCase.workbookPath, undefined, { imagesRootDir: sourceCase.imagesRoot, siteCode: sourceCase.site });
  const upsGroupHistory = await readUpsGroupHistoryFromBuffer(buffer);
  const dashboardMapping = source.dashboardMapping ?? await readUpsMappingFromBuffer(buffer);
  const rack = await readRackCapacityFromBuffer(buffer);
  const rackHistory = await readRackCapacityHistoryFromBuffer(buffer);
  const imageByMonth = new Map((source.rackUnitCapacityImages ?? []).map(image => [image.reportingMonth, image]));
  const rackUnitCapacity = source.rackUnitCapacityRows.map(row => {
    const image = imageByMonth.get(row.month);
    return { ...row, imageAttached: Boolean(image), imageContentType: image?.contentType ?? null, imageSavedAt: null };
  });
  const reportingMonths = [...new Set([
    ...source.logs.map(row => row.month),
    ...rackUnitCapacity.map(row => row.month),
    ...(upsGroupHistory?.rows ?? []).map(row => row.month),
    ...(rackHistory ?? []).map(row => row.snapshotMonth)
  ])].sort();
  const workbook = await workbookForFacilities([{ siteName: sourceCase.site, logs: source.logs, rack, rackHistory: rackHistory ?? [], rackUnitCapacity, upsGroupHistory, dashboardMapping, reportingMonths }]);
  const sheet = (fragment: string) => workbook.worksheets.find(item => item.name.includes(fragment));
  const arraySheetValues = (worksheet: ExcelJS.Worksheet | undefined): unknown[][] =>
    (worksheet?.getSheetValues() ?? []).map(row => Array.isArray(row) ? row : []);
  const requiredTables: Array<[string, number]> = [
    ["UPS_Loads", source.logs.reduce((count, log) => count + log.ups.length, 0) + 1],
    ["Air_Inputs", source.logs.length + 1],
    ["DC_Inputs", source.logs.reduce((count, log) => count + log.dc.length, 0) + 1],
    ["Energy_Cost_Inputs", source.logs.length + 1],
    ["Saved_Records", reportingMonths.length + 1],
    ["Saved_Values", reportingMonths.length + 1],
    ["Raw_Inputs", source.logs.filter(log => Boolean(log.srinakarinInputs)).length + 1],
    ["Calculated_Energy", source.logs.length + 1],
    ["Dashboard-FAC", source.logs.length + 1],
    ["Dashboard-FAC UPS", (upsGroupHistory?.rows.length ?? 0) + 1],
    ["Dashboard-FAC Details", source.logs.length * (dashboardMapping?.mapping.length ?? 0) + 1],
    ["Dashboard-FAC Air", 2],
    ["Dashboard-FAC DC", 2],
    ["Rack Unit Capacity", source.rackUnitCapacityRows.length + 1],
    ["Rack Capacity History", (rackHistory?.length ?? 0) + 1],
    ["UPS Group History", (upsGroupHistory?.rows.length ?? 0) + 1],
    ["Rack Capacity Raw", (rack?.records.length ?? 0) + 1]
  ];
  for (const [tableName, minimumRows] of requiredTables) {
    check(`${sourceCase.site}: export contains ${tableName} with its expected row count`, (sheet(tableName)?.rowCount ?? 0) >= minimumRows);
  }
  const serializedExport = await workbook.xlsx.writeBuffer();
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(serializedExport as unknown as ArrayBuffer);
  check(`${sourceCase.site}: serialized XLSX reopens with all required worksheets`, requiredTables.every(([tableName]) => roundTrip.worksheets.some(item => item.name.includes(tableName))));
  check(`${sourceCase.site}: Desktop workbook has no validation errors`, source.validation.errors.length === 0);
  check(`${sourceCase.site}: migration source retains Dashboard-FAC mapping from the workbook`, Boolean(source.dashboardMapping) && source.dashboardMapping?.mapping.length === dashboardMapping?.mapping.length);
  check(`${sourceCase.site}: migration source retains every persisted UPS Group History row`, source.upsGroupHistoryRows.length === (upsGroupHistory?.rows.length ?? 0));
  check(`${sourceCase.site}: migration source retains every Desktop Rack Capacity History row`, source.rackCapacityHistoryRows.length === (rackHistory?.length ?? 0));
  check(`${sourceCase.site}: Desktop Rack Unit image sources are discovered`, (source.rackUnitCapacityImages ?? []).length === 2);
  check(`${sourceCase.site}: UPS input rows are exported from Desktop logs`, (sheet("UPS_Loads")?.rowCount ?? 1) > 1);
  check(`${sourceCase.site}: saved values table contains all source months`, (sheet("Saved_Values")?.rowCount ?? 0) >= source.logs.length + 1);
  check(`${sourceCase.site}: calculated energy table contains all source log months`, (sheet("Calculated_Energy")?.rowCount ?? 0) === source.logs.length + 1);
  check(`${sourceCase.site}: Dashboard-FAC contains all source log months`, (sheet("Dashboard-FAC")?.rowCount ?? 0) === source.logs.length + 1);
  check(`${sourceCase.site}: Dashboard-FAC Details contains Desktop mapping rows`, (sheet("Dashboard-FAC Details")?.rowCount ?? 1) > 1 && (sheet("Dashboard-FAC Details")?.getSheetValues().flat().map(String).join("|") ?? "").includes(dashboardMapping?.mapping[0]?.upsId ?? "__missing__"));
  check(`${sourceCase.site}: every Desktop Dashboard-FAC mapping ID is retained in the export`, (dashboardMapping?.mapping ?? []).every(row => (sheet("Dashboard-FAC Details")?.getSheetValues().flat().map(String).join("|") ?? "").includes(row.upsId)));
  if (sourceCase.site === "Rangsit") {
    const firstMonth = source.logs[0]?.month;
    const historicalDetails = arraySheetValues(sheet("Dashboard-FAC Details")).filter(row => row[1] === firstMonth);
    check("Rangsit historical Dashboard-FAC missing UPS readings remain blank, not fabricated zeros", historicalDetails.length > 0 && historicalDetails.every(row => row.slice(8, 12).every(value => value === null || value === undefined)));
  }
  check(`${sourceCase.site}: Dashboard-FAC UPS contains persisted group history`, (sheet("Dashboard-FAC UPS")?.rowCount ?? 1) >= (upsGroupHistory?.rows.length ?? 0) + 1);
  check(`${sourceCase.site}: UPS Group History export contains every persisted source row`, (sheet("UPS Group History")?.rowCount ?? 1) === (upsGroupHistory?.rows.length ?? 0) + 1);
  check(`${sourceCase.site}: Dashboard-FAC Air table contains source rows`, (sheet("Dashboard-FAC Air")?.rowCount ?? 1) > 1);
  check(`${sourceCase.site}: Dashboard-FAC DC table contains source rows`, (sheet("Dashboard-FAC DC")?.rowCount ?? 1) > 1);
  check(`${sourceCase.site}: Rack Unit Capacity contains every Desktop row`, (sheet("Rack Unit Capacity")?.rowCount ?? 0) === source.rackUnitCapacityRows.length + 1);
  check(`${sourceCase.site}: Rack Unit export marks discovered images`, (sheet("Rack Unit Capacity")?.getSheetValues().flat().map(String).join("|") ?? "").includes("Yes"));
  check(`${sourceCase.site}: Rack Capacity Raw contains the Desktop snapshot rows`, (sheet("Rack Capacity Raw")?.rowCount ?? 1) === (rack?.records.length ?? 0) + 1);
  check(`${sourceCase.site}: Rack Capacity History preserves source rows when present`, (sheet("Rack Capacity History")?.rowCount ?? 1) === (rackHistory?.length ?? 0) + 1);
}

console.log(`web-clean-v1 exports: 7 + ${checks} assertions passed`);
