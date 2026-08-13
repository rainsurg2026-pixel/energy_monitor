import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildAllFacilitiesCsv, buildSiteComparisonCsv, facilityReportData, workbookForFacilities, rackReportFromSnapshot, type SiteComparisonExport, type RackSnapshotApiResponse } from "../src/web-clean-v1/exports";
import type { ReportData } from "../src/reports/reportTypes";
import { buildCombinedCsv } from "../src/utils/exportData";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import { calculateRackCapacityMetrics } from "../src/domain/rackCapacity";
import { defaultReportingPeriod, effectiveMonth, filterLogsByPeriod, type ReportingPeriodSelection } from "../src/web-clean-v1/reportPeriod";
import { defaultReportFilename, withExtension } from "../src/web-clean-v1/reportFilename";
import type { MonthlyLog } from "../src/types";

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
  const excelMonth = (value: unknown): string | null => value instanceof Date
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}` : null;
  const exportedMonths = Array.from({ length: energySheet!.rowCount - 1 }, (_, index) => excelMonth(energySheet!.getRow(index + 2).getCell(1).value)).filter((value): value is string => value !== null);
  check(`${monthLabel}: Excel stores the selected month as an Excel date`, exportedMonths.includes(monthLabel) && energySheet!.getRow(2).getCell(1).numFmt === "dd-mmm-yy");
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: Excel sheet does not contain ${other}`, !exportedMonths.includes(other));
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

const previousAir = { ...log("2026-06"), air: { eb41a: 1, eb41b: 1, eb42a: 1, eb42b: 1, meters: {} } };
const currentAir = { ...log("2026-07"), air: { eb41a: 2, eb41b: 2, eb42a: 2, eb42b: 2, meters: {} } };
const singleMonthPdfData = facilityReportData([currentAir], "Rangsit", "2026-07", null, [], [], [previousAir, currentAir]);
check("single-month PDF calculations retain the previous month from full history", singleMonthPdfData.currentRow?.airEnergyKwh === 4_000_000);

// Excel must retain entry values and saved timestamps as real typed cells,
// then append the exact Desktop calculation outputs.  This is deliberately
// richer than CSV: values remain usable in formulas/Power BI after download.
const typedExportLog: MonthlyLog = {
  ...log("2026-07"),
  ups: [{ upsId: "UPS 11A", voltage: 230.125, current: 10.5, loadKw: 12.345, loadKva: 15.678, phases: { R: { voltage: 229.5, current: 3.25, loadKw: 4.1, loadKva: 4.5 } } }],
  air: { eb41a: 2.25, eb41b: 3.5, eb42a: 4.75, eb42b: 5.25, meters: { eb43a: 6.5 } },
  dc: [{ panelId: "DC PDB41A", voltage: 48.5, current: 20.25 }],
  energyCost: { buildingEnergyKwh: 1000.125, buildingElectricityCostThb: 5000.5, floorElectricityCostThb: 4100.25, averageElectricityRateThbPerKwh: 4.1 },
  lastSavedUps: "2026-07-15T06:30:00.000Z",
  lastSavedAir: "2026-07-16T06:30:00.000Z",
  lastSavedDc: "2026-07-17T06:30:00.000Z",
  lastSavedEnergyCost: "2026-07-18T06:30:00.000Z",
  srinakarinInputs: { upsPhase: { "UPS 11A R": { voltage: 230.125, current: 10.5, loadKw: 4.115, loadKva: 5.226 } }, acPhase: { "AC-1": { voltage: 220.5, current: 8.25 } }, ppc43Current: { "PPC43-A": 12.75 }, ppc43Panel: { "PPC43-P": { loadKw: 5.5, loadKva: 6.6 } } }
};
const typedWorkbook = await workbookForFacilities([{ siteName: "Typed", logs: [typedExportLog], calculationLogs: [june, typedExportLog] }]);
const typedBuffer = await typedWorkbook.xlsx.writeBuffer();
const typedReread = new ExcelJS.Workbook();
await typedReread.xlsx.load(typedBuffer as unknown as ArrayBuffer);
const typedSummary = typedReread.worksheets.find(sheet => sheet.name.includes("Summary"));
const typedEnergy = typedReread.worksheets.find(sheet => sheet.name.includes("Energy_Cost"))!;
const typedUps = typedReread.worksheets.find(sheet => sheet.name.includes("UPS_Loads"))!;
const typedUpsPhases = typedReread.worksheets.find(sheet => sheet.name.includes("UPS_Phases"))!;
const typedPhase = typedReread.worksheets.find(sheet => sheet.name.includes("Srinakarin_Inputs"))!;
check("Excel includes a Desktop-style summary with inputs, saved values, and calculations", Boolean(typedSummary) && typedSummary!.columnCount === 17 && typedSummary!.getCell("B2").value === 1000.125 && typedSummary!.getCell("D2").value instanceof Date && typedSummary!.getCell("J2").value === null && typedSummary!.getCell("Q2").value === "Partial");
check("Excel includes raw UPS entry rows", typedUps.getCell("B2").value === "UPS 11A" && typedUps.getCell("C2").value === 230.125);
check("Excel includes section saved dates as typed dd-Mmm-yy dates", typedUps.getCell("G2").value instanceof Date && typedUps.getCell("G2").numFmt === "dd-mmm-yy");
check("Excel includes UPS phase entry rows", typedUpsPhases.getCell("B2").value === "UPS 11A" && typedUpsPhases.getCell("D2").value === 229.5);
check("Excel includes raw, saved, and calculated energy values", typedEnergy.columnCount === 13 && typedEnergy.getCell("B2").value === 1000.125 && typedEnergy.getCell("E2").value === 4100.25 && typedEnergy.getCell("F2").value === 4.1 && String(typedEnergy.getCell("M1").value).includes("Calculated"));
check("Excel includes every Srinakarin phase-level entry value", typedPhase.rowCount === 5 && typedPhase.getCell("D2").value === 230.125);
for (const sheet of typedReread.worksheets) {
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => { if (rowNumber > 1) row.eachCell({ includeEmpty: false }, cell => { if (typeof cell.value === "number") check(`${sheet.name} ${cell.address}: numeric values use two decimals`, cell.numFmt === "#,##0.00"); if (cell.value instanceof Date) check(`${sheet.name} ${cell.address}: dates use dd-Mmm-yy`, cell.numFmt === "dd-mmm-yy"); }); });
}

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

const rackExcelWorkbook = await workbookForFacilities([{
  siteName: "Racks",
  logs: [log("2026-06")],
  rack: rackReport,
  rackHistory: [{ snapshotMonth: "2026-06", facility: "Rangsit", rackZone: "Zone A", totalRacks: 2, inUse: 1, available: 1, reserved: 0, pendingDismantle: 0, other: 0, usagePct: 0.5, availabilityPct: 0.5, reservedPct: 0, pendingDismantlePct: 0, otherPct: 0, generatedAt: "2026-06-30T06:30:00.000Z", dataVersion: 1 }],
  rackUnitCapacity: [{ month: "2026-06", totalU: 100, usedU: 40, availableU: 60, availabilityPct: 0.6 }]
}]);
const rackExcelBuffer = await rackExcelWorkbook.xlsx.writeBuffer();
const rackExcelReread = new ExcelJS.Workbook();
await rackExcelReread.xlsx.load(rackExcelBuffer as unknown as ArrayBuffer);
const rackSnapshotSheet = rackExcelReread.worksheets.find(sheet => sheet.name.includes("Rack_Capacity_Snapshot"));
const rackHistorySheet = rackExcelReread.worksheets.find(sheet => sheet.name.includes("Rack_Capacity_History"));
const rackUnitSheet = rackExcelReread.worksheets.find(sheet => sheet.name.includes("Rack_Unit_Capacity"));
check("Excel includes the current Rack Capacity snapshot values", Boolean(rackSnapshotSheet) && rackSnapshotSheet!.getCell("C2").value === "Zone A" && rackSnapshotSheet!.getCell("D2").value === "A-01");
check("Excel includes Rack Capacity history with typed month/date values", Boolean(rackHistorySheet) && rackHistorySheet!.getCell("A2").value instanceof Date && rackHistorySheet!.getCell("A2").numFmt === "dd-mmm-yy" && rackHistorySheet!.getCell("O2").value instanceof Date && rackHistorySheet!.getCell("O2").numFmt === "dd-mmm-yy");
check("Excel includes Rack Unit Capacity entry and calculated values", Boolean(rackUnitSheet) && rackUnitSheet!.getCell("B2").value === 100 && rackUnitSheet!.getCell("C2").value === 40 && rackUnitSheet!.getCell("D2").value === 60 && rackUnitSheet!.getCell("E2").value === 0.6);

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

console.log(`web-clean-v1 exports: 7 + ${checks} assertions passed`);
