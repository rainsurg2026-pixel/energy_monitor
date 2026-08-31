import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCurrentFacilityPdfHtml, buildReportHtml } from "../src/reports/pdf/reportHtml";
import { buildAllFacilitiesReportHtml, facilityReportData, rackReportFromSnapshot } from "../src/web-clean-v1/exports";
import type { MonthlyLog } from "../src/types";
import type { RackUnitCapacityRow } from "../src/excel/RackUnitCapacityWriter";

function log(month: string, index: number): MonthlyLog {
  return {
    month,
    ups: [
      { upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 11B", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 13A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 13B", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 14C", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 15A (PPC44A)", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 },
      { upsId: "UPS 15B (PPC44B)", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 }
    ],
    air: { eb41a: 1 + index * 0.01, eb41b: 2 + index * 0.01, eb42a: 3 + index * 0.01, eb42b: 4 + index * 0.01, meters: {} },
    dc: [
      { panelId: "DC PDB41A", voltage: 220, current: 10 },
      { panelId: "DC PDB41B", voltage: 220, current: 10 },
      { panelId: "DC PDB42A", voltage: 220, current: 10 },
      { panelId: "DC PDB42B", voltage: 220, current: 10 }
    ],
    energyCost: { buildingEnergyKwh: 500 + index * 10, buildingElectricityCostThb: 2500 + index * 50 },
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null
  };
}

const months = [
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  "2026-06", "2026-07", "2026-08", "2026-09"
];
const fullLogs = months.map((month, index) => log(month, index));
const visibleLogs = fullLogs.filter(item => item.month === "2026-06" || item.month === "2026-07");
const rack = rackReportFromSnapshot({
  siteId: 1,
  month: "2026-07",
  snapshot: {
    month: "2026-07",
    rowVersion: 3,
    records: [
      { rowNumber: 1, rackZone: "A", rackId: "R-A01", status: "In Use", cabinetSize: "42", detail: "Production", deviceType: "Server", remarks: null },
      { rowNumber: 2, rackZone: "A", rackId: "R-A02", status: "Available", cabinetSize: "42", detail: "Ready", deviceType: "Network", remarks: null }
    ]
  }
});
const rackUnitCapacity: RackUnitCapacityRow[] = months.map((month, index) => ({
  month,
  totalU: 120 + index,
  usedU: 50 + index,
  availableU: 70,
  availabilityPct: 70 / (120 + index)
}));
const data = facilityReportData(visibleLogs, "Rangsit", "2026-07", rack, [], rackUnitCapacity, fullLogs);
const html = buildCurrentFacilityPdfHtml(data);
const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
const headingIndex = (value: string): number => body.indexOf(value);

assert.equal(data.monthlyRows.length, 2);
assert.equal(data.executiveTrendRows?.length, 12);
assert.ok(headingIndex("Engineering View") < headingIndex("Executive View"));
assert.ok(headingIndex("Executive View") < headingIndex("Rack Capacity and Utilization"));
assert.ok(headingIndex("Rack Capacity and Utilization") < headingIndex("Rack Unit Capacity and Utilization"));

const trendTitles = [
  "4th Floor Estimated Cost Trend (THB)",
  "4th Floor Total Energy Trend (kWh)",
  "4th Floor Average Electricity Rate Trend (THB/kWh)",
  "4th Floor UPS Energy Trend (kWh)",
  "4th Floor Air Conditioning Energy Trend (kWh)",
  "4th Floor DC Power Energy Trend (kWh)"
];
let previous = -1;
for (const title of trendTitles) {
  const position = headingIndex(title);
  assert.ok(position > previous, "Current PDF trend order: " + title);
  assert.ok(body.split(title).length - 1 >= 1, "Current PDF renders trend title: " + title);
  previous = position;
}
assert.equal((body.match(/latest 12-month window ending at Jul 2026/g) ?? []).length, 6);
assert.match(body, /selected month only/);
assert.ok(body.includes("Rack Capacity Details"));
assert.ok(body.includes("Rack Positions"));
assert.ok(body.includes("Rack Unit Capacity and Utilization"));
assert.ok(!body.includes("Electricity Consumption Comparison"));
assert.ok(!body.includes("Electricity Cost Comparison"));
assert.ok(!body.includes("Monthly Energy Consumption Trend"));
assert.ok(!body.includes("UPS System Energy Trend"));
assert.ok(!body.includes("<h2>Air Conditioning Energy Trend</h2>"));
assert.ok(!body.includes("DC Power Panel Energy Trend"));

const executivePage = body.slice(body.indexOf('data-report-section="executive"'), body.indexOf('data-report-section="executive"') + 5000);
assert.ok(executivePage.includes("Building Energy · Selected Month"));
assert.ok(executivePage.includes("Selected reporting month only"));
assert.ok(!executivePage.includes("2,500.00"), "Executive summary must not sum the quick-range rows.");

const legacyHtml = buildReportHtml(data);
assert.ok(legacyHtml.includes("Monthly Energy Consumption Trend"));
assert.ok(!legacyHtml.includes("4th Floor Estimated Cost Trend (THB)"));
const allFacilitiesHtml = buildAllFacilitiesReportHtml([{
  siteName: "Rangsit",
  logs: visibleLogs,
  calculationLogs: fullLogs,
  rack,
  rackUnitCapacity
}], null, "2026-07");
assert.ok(allFacilitiesHtml.includes("Monthly Energy Consumption Trend"));
assert.ok(!allFacilitiesHtml.includes("4th Floor Estimated Cost Trend (THB)"));

const exportSource = readFileSync("src/web-clean-v1/exports.ts", "utf8");
assert.match(exportSource, /buildCurrentFacilityPdfHtml\(data, sections\)/);
assert.match(exportSource, /exportHtml[\s\S]*buildReportHtml\(facilityReportData/);

console.log("Current Facility PDF structure: 34 assertions passed");