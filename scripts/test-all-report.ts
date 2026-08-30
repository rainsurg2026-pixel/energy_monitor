import { promises as fs } from "fs";
import path from "path";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import { validateReportHtml } from "../src/reports/pdf/reportSafety";
import { rackPositionExportRows } from "../src/utils/rackCapacity";

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
validateReportHtml(html);

if (!html.includes("Export All Report") && !html.includes("Monthly Power")) throw new Error("Combined report title is missing.");
if ((html.match(/<h2>Monthly Energy &amp; Cost Table<\/h2>/g) ?? []).length !== 1) throw new Error("Monthly table was duplicated or omitted.");
// v2.2.3: the Rack Unit Capacity Image is a deliberate, expected <img> - any
// OTHER <img> tag remains forbidden.
const htmlWithoutRackUnitCapacityImage = html.replace(/<img[^>]*class="rack-unit-capacity-image"[^>]*\/>/g, "");
validateReportHtml(htmlWithoutRackUnitCapacityImage);
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
  for (const required of ["1. UPS Load Status", "1.1 UPS Load Status - Overall", "1.2 UPS and PPC Load Status â€“ DCM 4th Floor", "UPS Loads Comparison (%) - Overall", "UPS and PPC Loads Comparison (%) â€“ DCM 4th Floor"]) {
    if (!html.includes(required)) throw new Error(`Srinakarin UPS dashboard section is missing: ${required}`);
  }
  if (report.engineeringDashboard?.upsOverallGroups.length !== 3) throw new Error("Srinakarin UPS Load Status - Overall is missing.");
} else if (html.includes("AC Panel")) {
  throw new Error("Rangsit All Report must omit the AC Power Panel column.");
}
for (const dashboardSection of ["UPS Load Status", "Air Conditioning Energy Consumption", "DC Power Panel Load Status", "Overall Energy Consumption"]) {
  if (!html.includes(dashboardSection)) throw new Error(`Engineering Dashboard section is missing: ${dashboardSection}`);
}
for (const removed of [
  "Table of Contents", "Executive Summary", "Historical Operations Summary", "Smart Insights and Data-quality Warnings",
  "Forecast Information", "Forecast Summary", "Benchmark Information", "Benchmark Summary", "Trend Analytics & Historical Charts",
  // v2.2.6 Feature 5: obsolete pages removed.
  "Capacity Trend and Forecast", "Rack Capacity Monthly Trend", "Rack Unit Capacity Monthly Trend",
  "Rack Unit Capacity Availability % Trend", "Report Information and Data Source"
]) {
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
  if (!html.includes("<h2>Rack Capacity Site Comparison</h2>")) throw new Error("Rack Capacity Site Comparison page is missing.");
  if (!report.rackComparison?.self) throw new Error("Rack Capacity Site Comparison data was not built even though Rack Capacity records exist.");
  if (!report.rackComparison.other && !html.includes("the sibling facility's Rack Capacity data was unavailable")) throw new Error("Missing-sibling note is absent from Rack Capacity Site Comparison.");
  // v2.2.6 Feature 6: Rack Capacity Site Comparison redesigned with a pie
  // per facility (positioned above the table) instead of a table-only page.
  const rackComparisonSectionStart = html.indexOf("<h2>Rack Capacity Site Comparison</h2>");
  const rackComparisonDonutsIndex = html.indexOf("rack-comparison-donuts", rackComparisonSectionStart);
  const rackComparisonTableIndex = html.indexOf("<table>", rackComparisonSectionStart);
  if (rackComparisonDonutsIndex === -1) throw new Error("Rack Capacity Site Comparison pies are missing.");
  if (rackComparisonDonutsIndex >= rackComparisonTableIndex) throw new Error("Rack Capacity Site Comparison pies must appear above the comparison table.");
  const expectedDonutCount = report.rackComparison.other ? 2 : 1;
  if ((html.match(/class="rack-comparison-donut"/g) ?? []).length !== expectedDonutCount) throw new Error(`Expected ${expectedDonutCount} Rack Capacity Site Comparison pie(s).`);
} else {
  throw new Error(`${facilityId} workbook unexpectedly has no Rack Capacity / Table7 records - cannot verify the PDF renders real data.`);
}
// v2.2.3: Rack Unit Capacity block + trend page. Real production workbooks
// may or may not have Rack Unit Capacity data (only ever created by an
// actual app Save), and if they do, it may or may not cover the current
// Reporting Month - this asserts whichever of the three states is actually
// true renders the correct message/content; scripts/test-rack-unit-capacity.ts
// separately covers the "data present, matches Reporting Month" rendering
// path in full (KPIs/donut/image) against seeded synthetic data.
const rowForReportingMonth = report.rackUnitCapacity.find(row => row.month === report.reportingMonth);
if (report.rackUnitCapacity.length === 0) {
  if (!html.includes("Rack Unit Capacity data is not yet available in this workbook.")) throw new Error("Rack Unit Capacity 'not yet available' note is missing.");
} else if (!rowForReportingMonth) {
  if (!html.includes("No Rack Unit Capacity data is available for the selected reporting month")) throw new Error("Rack Unit Capacity 'no data for this month' note is missing.");
} else {
  if (!new RegExp(`Total \\(U\\)[\\s\\S]{0,80}${rowForReportingMonth.totalU}`).test(html)) throw new Error("Rack Unit Capacity Total (U) does not match the Reporting Month's real data.");
  if (!new RegExp(`Used \\(U\\)[\\s\\S]{0,80}${rowForReportingMonth.usedU}`).test(html)) throw new Error("Rack Unit Capacity Used (U) does not match the Reporting Month's real data.");
}
// v2.2.6 hotfix: the Rack Unit Capacity executive page is now a full
// standalone page (was previously only a stripped-down block on the Rack
// Capacity page) - scripts/test-rack-unit-capacity.ts covers its "data
// present" content (KPIs/donut/image); this asserts its existence, page
// order, and facility/reporting-month subtitle against the real workbook.
if (!html.includes("<h2>Rack Unit Capacity and Utilization</h2>")) throw new Error("Rack Unit Capacity and Utilization page is missing from Export All Report.");
{
  const rackHeadingIndex = html.indexOf("<h2>Rack Capacity and Utilization</h2>");
  const unitHeadingIndex = html.indexOf("<h2>Rack Unit Capacity and Utilization</h2>");
  const healthHeadingIndex = html.indexOf("<h2>Capacity Health and Zone Heatmap</h2>");
  if (rackHeadingIndex === -1 || unitHeadingIndex <= rackHeadingIndex) throw new Error("Rack Unit Capacity and Utilization page must appear after Rack Capacity and Utilization.");
  if (healthHeadingIndex !== -1 && unitHeadingIndex >= healthHeadingIndex) throw new Error("Rack Unit Capacity and Utilization page must appear before Capacity Health and Zone Heatmap.");
  const subtitlePattern = new RegExp(`<h2>Rack Unit Capacity and Utilization</h2><p class="note">${report.facility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (!subtitlePattern.test(html)) throw new Error("Rack Unit Capacity and Utilization page subtitle does not show the correct Facility.");
}
if (!html.includes("<h2>Site Comparison</h2>")) throw new Error("Site Comparison page is missing from Export All Report.");
if (report.comparison?.self && !html.includes("Whole Building Energy (kWh)")) throw new Error("Site Comparison table headers are missing.");
if (/Rack Inventory|Rack Validation/i.test(html)) throw new Error("Unexpected legacy rack-report naming leaked into Export All Report.");
if (/Page 0 of 0/i.test(html)) throw new Error("Invalid page numbering placeholder was included.");
for (const section of ["Monthly Energy &amp; Cost Table"]) {
  if (!html.includes(`<h2>${section}</h2>`)) throw new Error(`Required section is missing: ${section}`);
}
for (const chart of ["Total 4th Floor Energy Trend", "UPS System Energy Trend", "Air Conditioning Energy Trend", "DC Power Panel Energy Trend", "Estimated 4th Floor Cost Trend", "Building Average Electricity Rate Trend"]) {
  if (!html.includes(chart)) throw new Error(`Required chart series is missing: ${chart}`);
}
// v2.2.6 Feature 3: the 6 facility energy/cost trend pages are grouped under
// "Facility Trend Analytics" (matching HistoricalCharts.tsx's dashboard
// naming) and must appear BEFORE the Monthly Energy & Cost Table.
const trendAnalyticsIndex = html.indexOf("FACILITY TREND ANALYTICS");
const monthlyTableIndex = html.indexOf("<h2>Monthly Energy &amp; Cost Table</h2>");
if (trendAnalyticsIndex === -1) throw new Error("'Facility Trend Analytics' label is missing from the trend pages.");
if (trendAnalyticsIndex >= monthlyTableIndex) throw new Error("Facility Trend Analytics must appear above the Monthly Energy & Cost Table.");
if ((html.match(/FACILITY TREND ANALYTICS/g) ?? []).length !== 3) throw new Error("The 6 facility trend charts must be paired across exactly 3 Facility Trend Analytics pages.");
if ((html.match(/class="page facility-trends-page"/g) ?? []).length !== 3) throw new Error("Facility trends must render as exactly 3 compact pages.");
if ((html.match(/class="mini-trend"/g) ?? []).length !== 6) throw new Error("All 6 facility trend charts must remain present after compact pairing.");
if (!html.includes('class="page appendix-page"')) throw new Error("Monthly Energy & Cost appendix must use the readable appendix layout.");
if (report.rack) {
  const deployablePositions = rackPositionExportRows(report.rack.records).length;
  const expectedPositionPages = Math.max(1, Math.ceil(deployablePositions / 24));
  if ((html.match(/class="page rack-position-page"/g) ?? []).length !== expectedPositionPages) throw new Error(`Rack Positions must paginate at 24 rows per page (expected ${expectedPositionPages}).`);
  if (!html.includes("Zone Capacity Breakdown")) throw new Error("Capacity Health page must include Zone Capacity Breakdown.");
}
// v2.2.6 Feature 4: Monthly Energy Consumption Trend + Floor 4 Electricity
// Cost Trend render above the Site Comparison table whenever self has >=2
// months of trend data (comparisonTrendPages' own gate).
const comparisonEligible = (report.comparison?.selfTrend.length ?? 0) >= 2;
if (comparisonEligible) {
  for (const chart of ["Monthly Energy Consumption Trend", "Floor 4 Electricity Cost Trend"]) {
    if (!html.includes(chart)) throw new Error(`Required Site Comparison chart is missing: ${chart}`);
  }
  const siteComparisonLabelIndex = html.indexOf("SITE COMPARISON");
  const siteComparisonTableIndex = html.indexOf("<h2>Site Comparison</h2>");
  if (siteComparisonLabelIndex === -1) throw new Error("'Site Comparison' trend label is missing.");
  if (siteComparisonLabelIndex >= siteComparisonTableIndex) throw new Error("Site Comparison trend charts must appear above the Site Comparison table.");
}
// Full-page trend charts are limited to the executive trend plus optional Site Comparison trends.
// The 6 facility analytical trends render as 3 compact two-chart pages.
const expectedTrendPages = 1 + (comparisonEligible ? 2 : 0);
if ((html.match(/class="page trend-page"/g) ?? []).length !== expectedTrendPages) throw new Error(`Unexpected number of full-page trend charts (expected ${expectedTrendPages}).`);
const expectedPointLabels = [
  ...report.monthlyRows.map(row => row.buildingEnergyKwh),
  ...report.monthlyRows.map(row => row.floorEnergyKwh),
  ...report.monthlyRows.map(row => row.floorEnergyKwh),
  ...report.monthlyRows.map(row => row.upsEnergyKwh),
  ...report.monthlyRows.map(row => row.airEnergyKwh),
  ...report.monthlyRows.map(row => row.dcEnergyKwh),
  ...report.monthlyRows.map(row => row.floorCostThb),
  ...report.monthlyRows.map(row => row.averageRateThbPerKwh)
].filter(value => value !== null && Number.isFinite(value)).length;
let expectedComparisonPointLabels = 0;
if (comparisonEligible && report.comparison) {
  const { selfTrend, otherTrend, other } = report.comparison;
  const otherByMonth = new Map(otherTrend.map(row => [row.month, row] as const));
  const energyValues = [...selfTrend.map(row => row.buildingEnergyKwh), ...(other ? selfTrend.map(row => otherByMonth.get(row.month)?.buildingEnergyKwh ?? null) : [])];
  const costValues = [...selfTrend.map(row => row.floorCostThb), ...(other ? selfTrend.map(row => otherByMonth.get(row.month)?.floorCostThb ?? null) : [])];
  expectedComparisonPointLabels = [...energyValues, ...costValues].filter(value => value !== null && Number.isFinite(value)).length;
}
if ((html.match(/class="point-value"/g) ?? []).length !== expectedPointLabels + expectedComparisonPointLabels) throw new Error("Every valid trend point must receive a numeric label.");
if (!html.includes('"TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif')) throw new Error("Report font stack is missing.");

const after = await fs.stat(workbookPath);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The source workbook changed during the report test.");
const totalPageCount = (html.match(/<section class="page/g) ?? []).length;
console.log(`All-report data test passed: ${report.monthlyRows.length} selected-range month(s). Total report pages: ${totalPageCount}.`);
