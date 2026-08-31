import assert from "node:assert/strict";
import { buildAllFacilitiesReportHtml, buildSiteComparisonReportModel, facilityReportData } from "../src/web-clean-v1/exports";
import { buildCrossSiteComparisonPages, buildReportBodyPages, buildReportHtml } from "../src/reports/pdf/reportHtml";
import { createEmptyLog } from "../src/utils";

let checks = 0;
const check = (n: string, c: boolean) => { assert.ok(c, n); checks++; };
const log = (m: string) => createEmptyLog(m);
const data = facilityReportData([log("2026-05"), log("2026-06")], "Rangsit", "2026-06");

const body = buildReportBodyPages(data);
const sectionMatches = [...body.matchAll(/<section class="page[^"]*" data-report-section="([a-z-]+)"/g)].map(m => m[1]);
check("every page has a data-report-section", (body.match(/<section class="page/g)?.length ?? 0) === sectionMatches.length);

const order = sectionMatches.filter((v, i) => i === 0 || sectionMatches[i - 1] !== v);
check("current-facility order matches spec 7.1",
  JSON.stringify(order) === JSON.stringify(["executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity"]) ||
  JSON.stringify(order) === JSON.stringify(["executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity", "rack-capacity"]));
check("current facility has NO cross-site pages", !body.includes('data-report-section="site-energy-comparison"') && !body.includes('data-report-section="site-rack-comparison"'));

const onlyRack = buildReportBodyPages(data, ["rack-capacity"]);
check("filter keeps rack-capacity pages", onlyRack.includes('data-report-section="rack-capacity"'));
check("filter drops executive when not selected", !onlyRack.includes('data-report-section="executive"'));

{
  const facilities = [
    { siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] },
    { siteName: "Srinakarin", siteCode: "srinakarin", logs: [log("2026-06")] },
  ] as any;
  const html = buildAllFacilitiesReportHtml(facilities, null, "2026-06");
  check("exactly one cover for All Facilities", (html.match(/<main class="cover">/g) ?? []).length === 1);
  check("cover names All Facilities", /<main class="cover">[\s\S]*Facility: All Facilities/.test(html));
  check("one facility band per site", (html.match(/data-report-section="facility-header"/g) ?? []).length === 2);
  check("bands name each site", html.includes("Facility: Rangsit") && html.includes("Facility: Srinakarin"));
  check("single <head>/<style>", (html.match(/<style>/g) ?? []).length === 1);
}


{
  const model = buildSiteComparisonReportModel({
    displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
    months: ["2026-05", "2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [
        { month: "2026-05", metrics: { buildingEnergy: 95, buildingCost: 475, floorEnergy: 38, floorCost: 190, avgRate: 5, floorShare: 40 } },
        { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } }], rackUnitCapacity: [] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [
        { month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } }], rackUnitCapacity: [] },
    ],
  } as any, "2026-06");
  const pages = buildCrossSiteComparisonPages(model);
  check("energy pages tagged site-energy-comparison", pages.includes('data-report-section="site-energy-comparison"'));
  check("has all 4 energy chart titles", pages.includes("Total Building Energy Consumption Trend") && pages.includes("4th Floor Energy Consumption Trend") && pages.includes("Total Building Electricity Cost Trend") && pages.includes("Estimated 4th Floor Electricity Cost Trend"));
  check("no Average Rate / Floor Share chart", !pages.includes("Average Unit Rate Trend") && !pages.includes("4th Floor Share Trend"));
  check("N-site energy table has both sites", pages.includes("Rangsit") && pages.includes("Srinakarin"));
}

{
  const rangsitRecords = [
    { rowNumber: 1, rackZone: "A", rackId: "A-01", status: "In Use", cabinetSize: "60x100", detail: null, deviceType: null, remarks: null },
    { rowNumber: 2, rackZone: "A", rackId: "A-02", status: "Available", cabinetSize: "60x100", detail: "spare", deviceType: null, remarks: null },
    { rowNumber: 3, rackZone: "B", rackId: "B-01", status: "Reserved", cabinetSize: "60x120", detail: "held", deviceType: null, remarks: null },
    { rowNumber: 4, rackZone: "B", rackId: "B-02", status: "Pending Dismantle", cabinetSize: "60x120", detail: "EOL", deviceType: null, remarks: null },
  ];
  const model = {
    referenceMonth: "2026-06", months: ["2026-06"],
    sites: [
      { label: "Rangsit", siteCode: "rangsit", metrics: null, metricsByMonth: { "2026-06": null },
        rack: { sourceSheet: "Rack Capacity", sourceTable: "Table7", sourceSnapshot: "2026-06", records: rangsitRecords, byZone: [], byStatus: [], byCabinetSize: [], byDeviceType: [], validation: { duplicateIds: [], missingRequiredFields: [], invalidStatuses: [], invalidDataTypes: [], unsupportedUMetrics: [] } },
        rackUnit: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, usagePercent: 75, availabilityPct: 0.25 }] },
      { label: "Srinakarin", siteCode: "srinakarin", metrics: null, metricsByMonth: { "2026-06": null }, rack: null, rackUnit: [] },
    ],
  } as any;
  const pages = buildCrossSiteComparisonPages(model);
  check("rack pages tagged site-rack-comparison", pages.includes('data-report-section="site-rack-comparison"'));
  check("heading uses the full renamed term", pages.includes("Site Rack Capacity &amp; Availability Comparison"));
  check("per-site summary shows Pending Decommission", pages.includes("Pending Decommission"));
  const rackPositions = pages.slice(pages.indexOf("Rack Positions"));
  check("Rack Positions never lists an In Use row", !rackPositions.includes("A-01"));
  check("Rack Positions lists deployable statuses", pages.includes("A-02") && pages.includes("B-01") && pages.includes("B-02"));
  check("site with no snapshot shows Unavailable", pages.includes("Unavailable") && !pages.includes("Rack Capacity Details — Srinakarin"));
  check("rack-unit comparison shows 1-dp percentages", pages.includes("75.0%") && pages.includes("25.0%"));
  check("trend note verbatim", pages.includes("Available U represents physical rack space only"));
}

{
  const cf = buildReportHtml(facilityReportData([log("2026-06")], "Rangsit", "2026-06"));
  check("Current Facility PDF has no cross-site pages", !cf.includes('data-report-section="site-energy-comparison"') && !cf.includes('data-report-section="site-rack-comparison"'));
  check("Current Facility PDF has exactly one cover", (cf.match(/<main class="cover">/g) ?? []).length === 1);
}

console.log(`report-structure: ${checks} checks passed`);