import { promises as fs } from "fs";
import path from "path";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";

const workbookPath = path.resolve(process.env.ENERGY_MONITOR_WORKBOOK ?? "DC_Rangsit.xlsm");
const before = await fs.stat(workbookPath);
const facilityId = workbookPath.toLowerCase().includes("srinakarin") ? "srinakarin" : "rangsit";
const dashboard = JSON.parse(await fs.readFile(path.resolve(`config/${facilityId}/profile.json`), "utf8")).dashboard;
const report = await buildReportData({
  workbookPath,
  facility: "Test Facility",
  selectedMonth: null,
  appVersion: "test",
  dashboard
});
const earlyReport = await buildReportData({
  workbookPath,
  facility: "Test Facility",
  selectedMonth: "2021-06",
  appVersion: "test",
  dashboard
});
const html = buildReportHtml(report);

if (!html.includes("Export All Report") && !html.includes("Monthly Power")) throw new Error("Combined report title is missing.");
if ((html.match(/<h2>Monthly Energy &amp; Cost Table<\/h2>/g) ?? []).length !== 1) throw new Error("Monthly table was duplicated or omitted.");
// v2.2.3: the Rack Unit Capacity Image is a deliberate, expected <img> - any
// OTHER <img> tag remains forbidden.
const htmlWithoutRackUnitCapacityImage = html.replace(/<img[^>]*class="rack-unit-capacity-image"[^>]*\/>/g, "");
if (/\bPUE\b|\bCO2\b|<img\b/i.test(htmlWithoutRackUnitCapacityImage)) throw new Error("Forbidden report content was found.");
if (report.monthlyRows.length > 0 && !html.includes("Building Energy")) throw new Error("Energy report data is missing.");
if (report.monthlyRows.length > 12) throw new Error("Report trends are not limited to the latest 12 months.");
if (report.currentRow && report.monthlyRows.at(-1)?.month !== report.currentRow.month) throw new Error("Selected reporting month is not the final report month.");
if (earlyReport.monthlyRows.length > 12 || earlyReport.monthlyRows.at(-1)?.month !== "2021-06" || earlyReport.monthlyRows.some(row => row.month > "2021-06")) {
  throw new Error("Selected-month range included future months or failed to handle fewer than 12 records.");
}
if (!html.includes("Building Energy Dashboard")) throw new Error("Full selected-month Engineering Dashboard is missing.");
if (html.includes("Selected-Month Building Energy Dashboard Summary")) throw new Error("The old simplified dashboard page is still present.");
if (!html.includes("UPS Loads Comparison (%)")) throw new Error("UPS load comparison is missing from the printable dashboard.");
if (facilityId === "rangsit" && !report.engineeringDashboard?.upsGroups.every(group => group.totalKw > 0 && group.totalKva > 0 && group.monthlyEnergyKwh > 0 && group.loadPercent !== null)) {
  throw new Error("Rangsit selected-month UPS groups were not calculated from the loaded UPS records.");
}
if (facilityId === "srinakarin") {
  const expectedIds = ["UPS 41A", "UPS 41B", "UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 12A", "UPS 12B", "UPS 12A", "UPS 12B"];
  if (JSON.stringify(report.engineeringDashboard?.upsDetails.map(row => row.upsId)) !== JSON.stringify(expectedIds)) throw new Error("Srinakarin dashboard UPS IDs do not match the workbook mapping sequence.");
  for (const required of ["1. UPS Load Status", "1.1 UPS Load Status - Overall", "1.2 UPS and PPC Load Status – DCM 4th Floor", "UPS Loads Comparison (%) - Overall", "UPS and PPC Loads Comparison (%) – DCM 4th Floor"]) {
    if (!html.includes(required)) throw new Error(`Srinakarin UPS dashboard section is missing: ${required}`);
  }
  if (report.engineeringDashboard?.upsOverallGroups.length !== 3) throw new Error("Srinakarin UPS Load Status - Overall is missing.");
} else if (html.includes("AC Panel")) {
  throw new Error("Rangsit All Report must omit the AC Power Panel column.");
}
for (const dashboardSection of ["UPS Load Status", "Air Conditioning Energy Consumption", "DC Power Panel Load Status", "Overall Energy Consumption"]) {
  if (!html.includes(dashboardSection)) throw new Error(`Engineering Dashboard section is missing: ${dashboardSection}`);
}
for (const removed of ["Table of Contents", "Executive Summary", "Historical Operations Summary", "Smart Insights and Data-quality Warnings", "Forecast Information", "Forecast Summary", "Benchmark Information", "Benchmark Summary", "Trend Analytics & Historical Charts"]) {
  if (html.includes(removed)) throw new Error(`Removed All Report section is still present: ${removed}`);
}
// v2.2.2: Rack Capacity Overview + Site Comparison are now deliberately part
// of Export All Report (was previously explicitly excluded pre-v2.2.2).
// v2.2.3: renamed "Rack Capacity Overview" -> "Rack Capacity and Utilization".
if (!html.includes("<h2>Rack Capacity and Utilization</h2>")) throw new Error("Rack Capacity and Utilization page is missing from Export All Report.");
if (html.includes("Rack Capacity Overview")) throw new Error("Old 'Rack Capacity Overview' heading is still present.");
if (/\bTable7\b/.test(html)) throw new Error("Internal workbook table name 'Table7' leaked into the report.");
if (report.rack && report.rack.records.length > 0) {
  if (!/Total Racks/.test(html)) throw new Error("Rack Capacity KPI cards are missing.");
  if (!/rack-donut-row/.test(html)) throw new Error("Rack Capacity donut chart is missing.");
  if (/Rack Capacity and Utilization<\/h2><p class="note">Rack capacity data is unavailable/.test(html)) throw new Error("Rack Capacity data exists but the PDF shows the unavailable-data fallback.");
  // v2.2.5 round 3: Gauge, Forecast, Zone Heatmap, and Rack Capacity Site
  // Comparison were added to close the PDF/dashboard parity gap.
  if (!html.includes("<h2>Capacity Health and Zone Heatmap</h2>")) throw new Error("Capacity Health and Zone Heatmap page is missing.");
  if (!html.includes("Capacity Health Gauge")) throw new Error("Capacity Health Gauge block is missing.");
  if (!html.includes("Zone Heatmap")) throw new Error("Zone Heatmap block is missing.");
  if (!html.includes("<h2>Capacity Trend and Forecast</h2>")) throw new Error("Capacity Trend and Forecast page is missing.");
  if (!html.includes("<h2>Rack Capacity Site Comparison</h2>")) throw new Error("Rack Capacity Site Comparison page is missing.");
  if (!report.rackComparison?.self) throw new Error("Rack Capacity Site Comparison data was not built even though Rack Capacity records exist.");
  if (!report.rackComparison.other && !html.includes("the sibling facility's Rack Capacity data was unavailable")) throw new Error("Missing-sibling note is absent from Rack Capacity Site Comparison.");
} else {
  throw new Error(`${facilityId} workbook unexpectedly has no Rack Capacity / Table7 records - cannot verify the PDF renders real data.`);
}
// v2.2.3: Rack Unit Capacity block + trend page. The real production
// workbook has no Rack Unit Capacity data yet (only ever created by an
// actual app Save), so this asserts the "not yet available" path renders
// correctly; scripts/test-rack-unit-capacity.ts covers the "data present"
// rendering path against a saved copy.
if (report.rackUnitCapacity.length === 0) {
  if (!html.includes("Rack Unit Capacity data is not yet available in this workbook.")) throw new Error("Rack Unit Capacity 'not yet available' note is missing.");
  if (!html.includes("Rack Unit Capacity Monthly Trend")) throw new Error("Rack Unit Capacity trend page is missing.");
} else {
  throw new Error(`${facilityId} workbook unexpectedly already has Rack Unit Capacity data - update this test to verify the real-data rendering path instead.`);
}
if (!html.includes("<h2>Site Comparison</h2>")) throw new Error("Site Comparison page is missing from Export All Report.");
if (report.comparison?.self && !html.includes("Whole Building Energy (kWh)")) throw new Error("Site Comparison table headers are missing.");
if (/Rack Inventory|Rack Validation/i.test(html)) throw new Error("Unexpected legacy rack-report naming leaked into Export All Report.");
if (/Page 0 of 0/i.test(html)) throw new Error("Invalid page numbering placeholder was included.");
for (const section of ["Monthly Energy &amp; Cost Table", "Report Information and Data Source"]) {
  if (!html.includes(`<h2>${section}</h2>`)) throw new Error(`Required section is missing: ${section}`);
}
for (const chart of ["Total 4th Floor Energy Trend", "UPS System Energy Trend", "Air Conditioning Energy Trend", "DC Power Panel Energy Trend", "Estimated 4th Floor Cost Trend", "Building Average Electricity Rate Trend"]) {
  if (!html.includes(chart)) throw new Error(`Required chart series is missing: ${chart}`);
}
const rackTotalHistoryAll = report.rackHistory.filter(r => r.rackZone === "(Total)");
const rackTotalHistoryMonths = new Set(rackTotalHistoryAll.map(r => r.snapshotMonth)).size;
// v2.2.5 round 3: Capacity Trend and Forecast reuses the shared trendPage()
// renderer (so it counts as one more "page trend-page") once at least
// MIN_FORECAST_HISTORY_MONTHS (6) real history months exist; below that it
// shows "Insufficient History" as a plain page instead.
const forecastEligible = rackTotalHistoryAll.length >= 6;
const expectedTrendPages = 6 + (rackTotalHistoryMonths >= 2 ? 2 : 0) + (forecastEligible ? 1 : 0); // + Rack Capacity Usage%/Availability% once >=2 months of history exist, + Forecast once >=6
if ((html.match(/class="page trend-page"/g) ?? []).length !== expectedTrendPages) throw new Error(`Each trend must occupy one full report page (expected ${expectedTrendPages}).`);
if (!forecastEligible && !html.includes("Insufficient History")) throw new Error("Capacity Trend and Forecast should show 'Insufficient History' with fewer than 6 real history months.");
const expectedPointLabels = [
  ...report.monthlyRows.map(row => row.floorEnergyKwh),
  ...report.monthlyRows.map(row => row.upsEnergyKwh),
  ...report.monthlyRows.map(row => row.airEnergyKwh),
  ...report.monthlyRows.map(row => row.dcEnergyKwh),
  ...report.monthlyRows.map(row => row.floorCostThb),
  ...report.monthlyRows.map(row => row.averageRateThbPerKwh)
].filter(value => value !== null && Number.isFinite(value)).length;
const rackTrendTotalRows = report.rackHistory.filter(r => r.rackZone === "(Total)").slice(-12);
const expectedRackPointLabels = rackTotalHistoryMonths >= 2
  ? [...rackTrendTotalRows.map(r => r.usagePct), ...rackTrendTotalRows.map(r => r.availabilityPct)].filter(value => value !== null && Number.isFinite(value)).length
  : 0;
// Forecast points are always numeric (history values, or a regression
// projection) - every one gets a point-value label, unlike the sparse
// energy/rack trends above which can have real gaps.
const expectedForecastPointLabels = forecastEligible ? rackTotalHistoryAll.length + 12 : 0;
if ((html.match(/class="point-value"/g) ?? []).length !== expectedPointLabels + expectedRackPointLabels + expectedForecastPointLabels) throw new Error("Every valid trend point must receive a numeric label.");
if (!html.includes('"TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif')) throw new Error("Report font stack is missing.");

const after = await fs.stat(workbookPath);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The source workbook changed during the report test.");
console.log(`All-report data test passed: ${report.monthlyRows.length} selected-range month(s).`);
