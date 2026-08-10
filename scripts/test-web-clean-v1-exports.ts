import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildAllFacilitiesCsv, buildSiteComparisonCsv, facilityReportData, workbookForFacilities, type SiteComparisonExport } from "../src/web-clean-v1/exports";
import { buildCombinedCsv } from "../src/utils/exportData";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
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

// Filename actually reaches every format, with the correct extension and
// no duplicate/missing extension, and the displayed preview matches what
// would actually be downloaded/printed.
const filename = defaultReportFilename("Rangsit", "2026-06");
check("default filename follows the Desktop convention", filename === "Energy_Report_Rangsit_2026-06");
check("Excel filename has exactly one .xlsx extension", withExtension(filename, "xlsx") === "Energy_Report_Rangsit_2026-06.xlsx" && !withExtension(filename, "xlsx").includes(".xlsx.xlsx"));
check("CSV filename has exactly one .csv extension", withExtension(filename, "csv") === "Energy_Report_Rangsit_2026-06.csv");
check("PDF filename has exactly one .pdf extension", withExtension(filename, "pdf") === "Energy_Report_Rangsit_2026-06.pdf");

console.log(`web-clean-v1 exports: 7 + ${checks} assertions passed`);
