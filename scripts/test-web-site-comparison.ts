import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rackAvailabilityStatus, rackCountsReconcile, rankRackLocations, isValidRackUnitCapacity } from "../src/domain/rackComparison";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../src/domain/rackCapacity";
import { displayPositionStatus, filterRackPositions, rackPositionRows, zoneAvailableTotalLabel } from "../src/web-clean-v1/WebSiteRackCapacityComparison";
import { rackStatusHex } from "../src/utils/rackStatusConfig";

const comparison = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
const rackComparison = readFileSync(new URL("../src/web-clean-v1/WebSiteRackCapacityComparison.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const unitView = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityViews.tsx", import.meta.url), "utf8");
const apiService = readFileSync(new URL("../server/services/apiService.ts", import.meta.url), "utf8");

assert.match(comparison, /api<SiteComparisonExport>\("\/site-comparison"\)/);
assert.match(comparison, /Site Energy & Cost Comparison/);
assert.match(comparison, /Compare facilities using the same reporting period and calculation method\./);
for (const title of [
  "Total Building Energy Consumption Trend",
  "4th Floor Energy Consumption Trend",
  "Total Building Electricity Cost Trend",
  "Estimated 4th Floor Electricity Cost Trend"
]) assert.match(comparison, new RegExp(title));
for (const axis of ["Energy \\(kWh\\)", "Cost \\(THB\\)", "Estimated Cost \\(THB\\)"]) assert.match(comparison, new RegExp(axis));
for (const heading of [
  "Building Energy \\(kWh\\)",
  "Building Cost \\(THB\\)",
  "4th Floor Energy \\(kWh\\)",
  "Estimated 4th Floor Cost \\(THB\\)",
  "Average Unit Rate \\(THB/kWh\\)",
  "4th Floor Share \\(\\%\\)"
]) assert.match(comparison, new RegExp(heading));
assert.match(comparison, /getComparisonDisplayMonths/);
assert.match(comparison, /function chartLabel/);
assert.doesNotMatch(comparison, /Rack Unit Utilization Trend|Rack Capacity and Utilization|Rack Unit Capacity and Utilization|\/racks\?siteId|\/rack-unit-capacity\?siteId/);

assert.match(app, /const WebSiteRackCapacityComparison = lazy\(\(\) => import\("\.\/WebSiteRackCapacityComparison"\)\)/);
assert.match(app, /id: "comparison"[^\n]*Site Energy & Cost Comparison/);
assert.match(app, /id: "rack-comparison"[^\n]*Site Rack Capacity & Availability Comparison/);
assert.ok(app.includes('view === "comparison" && <WebSiteComparison lang={lang} />'), "comparison view is not scoped by the Reports-local Quick Range");
assert.ok(app.includes('view === "rack-comparison" && <WebSiteRackCapacityComparison month={displayMonth} />'), "rack comparison uses the global Selected Reporting Month");
// The "Create Monthly Record" prompt is entry-only, so rack-comparison (and
// every other read view) never triggers it.
assert.match(app, /if \(!exists && view === "entry"\)/);

assert.ok(rackComparison.includes('api<SiteRef[]>("/sites")'), "comparison loads the active site list");
assert.ok(rackComparison.includes("loadRackCapacitySnapshot(site.id, month)"), "comparison uses the shared site/month Rack snapshot cache");
assert.ok(rackComparison.includes("rackResult.value.persisted"), "comparison excludes unconfirmed carry-forward candidates");
assert.ok(rackComparison.includes("if (generation !== requestGeneration.current) return;"), "stale comparison responses cannot commit");
assert.ok(rackComparison.includes("rack-unit-capacity?siteId="), "Rack Unit comparison still uses its existing endpoint");
assert.doesNotMatch(rackComparison, /api<RackSnapshotApiResponse>/);
for (const heading of [
  "Site Rack Capacity &amp; Availability Comparison",
  "Compare site rack capacity by zone and status for deployment planning.",
  "Rack Capacity by Zone",
  "Rack Capacity Details",
  "Rack Positions",
  "Rack Unit Capacity Comparison",
  "Used and available rack units by site"
]) assert.ok(rackComparison.includes(heading), "comparison heading missing: " + heading);
assert.ok(rackComparison.includes("const SiteSummaryCard:"), "site summary card is present");
assert.ok(rackComparison.includes("Available Now"), "site summary highlights available racks");
assert.ok(rackComparison.includes("Total Racks"), "site summary includes total racks");
assert.ok(rackComparison.indexOf("<SiteSummaryCard key=") < rackComparison.indexOf("<RackCapacityByZone states={sites}"), "site summary precedes zone chart");
for (const field of ["Rack ID", "Cabinet Size (cm)", "Detail"]) assert.ok(rackComparison.includes(">" + field + "</th>"), "position field missing: " + field);
assert.ok(rackComparison.includes("Pending Dismantle"));
assert.ok(rackComparison.includes("Pending Decommission"));
assert.match(rackComparison, /\{state\.site\.name\} Rack Capacity Details/);
for (const status of ["In Use", "Available", "Reserved", "Pending Dismantle"]) assert.ok(rackComparison.includes(`rackStatusHex("${status}")`), "shared semantic color missing: " + status);
const zoneStatusColors = ["In Use", "Available", "Reserved", "Pending Dismantle"].map(rackStatusHex);
assert.equal(new Set(zoneStatusColors).size, zoneStatusColors.length, "Rack zone status colors must remain distinct");
assert.deepEqual(zoneStatusColors, ["#f59e0b", "#22c55e", "#3b82f6", "#ef4444"], "Rack zone status palette should preserve high-contrast semantic colors");
assert.ok(rackComparison.includes("zone.total"));
assert.ok(rackComparison.includes("Available / Total"), "zone capacity column header missing");
assert.match(rackComparison, /formatFixedNumber\(zone\.available\.count, 0\)[\s\S]{0,260}formatFixedNumber\(zone\.total, 0\)/, "zone label uses available and total counts");
assert.ok(rackComparison.includes("zoneAvailableTotalLabel(zone)"), "zone label has an accessible available/total value");
assert.ok(rackComparison.includes("scaleMax"), "zone bars use a shared scale");
assert.ok(rackComparison.includes("Shared scale: 0 to"), "shared scale is visible");
assert.ok(rackComparison.includes("Available <span"), "site-level available summary is present");
assert.ok(rackComparison.includes("title={tooltip}"));
assert.doesNotMatch(rackComparison, /<details[^>]*\bopen\b/);
assert.ok(rackComparison.includes("<RackCapacityByZone states={sites}"));
assert.ok(rackComparison.includes("<RackCapacityDetails states={sites}"));
assert.ok(rackComparison.includes("useMemo<RackPosition[]>"));
assert.ok(rackComparison.includes("[states]"));
assert.ok(rackComparison.indexOf("<RackCapacityByZone states={sites}") < rackComparison.indexOf("<RackCapacityDetails states={sites}"), "Zone chart precedes split details");
assert.ok(rackComparison.indexOf("<RackCapacityDetails states={sites}") < rackComparison.indexOf("<RackPositions states={sites}"), "Split details precede Rack Positions");
assert.ok(rackComparison.indexOf("<RackPositions states={sites}") < rackComparison.indexOf("<RackUnitComparison states={sites}"), "Rack Positions precedes Rack Unit comparison");
assert.ok(rackComparison.includes("lg:grid-cols-2"), "Rack Unit comparison uses two columns only at desktop width");
assert.ok(rackComparison.includes("lg:grid-cols-3"), "Rack position status groups stack below desktop width");
assert.doesNotMatch(rackComparison, /h-\[330px\]/, "Rack Unit comparison no longer uses the oversized chart height");
assert.doesNotMatch(rackComparison, /SAMPLE DATA/);
assert.match(unitView, /formatFixedNumber\(unitCapacityRow \? total : null, 0\)/);
assert.match(unitView, /formatFixedNumber\(unitCapacityRow \? used : null, 0\)/);
assert.match(unitView, /formatFixedNumber\(unitCapacityRow \? available : null, 0\)/);
assert.match(unitView, /formatFixedNumber\(row\.totalU, 0\)/);
assert.match(unitView, /formatFixedNumber\(row\.usedU, 0\)/);
assert.match(unitView, /formatFixedNumber\(row\.availableU, 0\)/);
assert.match(unitView, /formatFixedNumber\(item\.count, 0\)/, "Rack Unit Capacity Mix counts are whole numbers");
assert.match(unitView, /function safePercent\(value: number \| null\): string \{ return formatFixedPercentage\(value, 1\); \}/);
assert.ok(unitView.indexOf("Six-month Rack Unit Capacity Trend") < unitView.indexOf("rack-unit-capacity-trend-note"), "Trend note follows the trend section");
assert.ok(unitView.includes("Rack Unit Capacity Trend Note: Available U represents physical rack space only; actual deployment capacity depends on power, cooling, weight, and contiguous space availability."));
assert.ok(unitView.includes("หมายเหตุแนวโน้มความจุ Rack Unit"));
assert.ok(app.includes("rackUnitCapacity={historyRackUnitCapacity} lang={lang}"), "Rack Unit page receives the selected language");

const zoneFixture = calculateRackCapacityMetrics([
  { rackZone: "Zone A", rackId: "A01", status: "In Use", cabinetSize: null, detail: null, deviceType: null, remarks: null },
  { rackZone: "Zone A", rackId: "A02", status: "Available", cabinetSize: null, detail: null, deviceType: null, remarks: null },
  { rackZone: "Zone A", rackId: "A03", status: "Reserved", cabinetSize: null, detail: null, deviceType: null, remarks: null },
  { rackZone: "Zone A", rackId: "A04", status: "Pending Dismantle", cabinetSize: null, detail: null, deviceType: null, remarks: null }
]);
const zoneA = zoneFixture.zoneMetrics[0];
assert.equal(zoneA.inUse.count + zoneA.available.count + zoneA.reserved.count + zoneA.pendingDismantle.count, zoneA.total, "stacked status counts sum to zone total");
assert.equal(zoneAvailableTotalLabel({ available: { count: 3 }, total: 98 }), "3 / 98");
assert.equal(zoneAvailableTotalLabel({ available: { count: 0 }, total: 75 }), "0 / 75");

// Regression model: the same mounted view can rebind A -> B -> A without a
// remount, while each site's rows remain isolated and delayed results stay
// associated with the site that owns them.
const siteA = { id: 1, code: "R", name: "Rangsit" };
const siteB = { id: 2, code: "S", name: "Srinakarin" };
const snapshotA = { rowVersion: 1, month: "2026-06", records: [
  { rowNumber: 1, rackZone: "Zone A", rackId: "A01", status: "Available", cabinetSize: "60*100", detail: "Network", deviceType: null, remarks: null },
  { rowNumber: 2, rackZone: "Zone B", rackId: "A02", status: "Pending Dismantle", cabinetSize: "60*110", detail: "Server", deviceType: null, remarks: null }
] };
const snapshotB = { rowVersion: 2, month: "2026-06", records: [
  { rowNumber: 1, rackZone: "Zone C", rackId: "B01", status: "Reserved", cabinetSize: "80*120", detail: "Storage", deviceType: null, remarks: null }
] };
assert.equal(displayPositionStatus("Pending Dismantle"), "Pending Decommission");
assert.equal(displayPositionStatus("In Use"), null);
const rowsA = rackPositionRows(siteA, snapshotA);
const rowsB = rackPositionRows(siteB, snapshotB);
assert.equal(rowsA.length, 2);
assert.equal(rowsB.length, 1);
assert.deepEqual(filterRackPositions(rowsA, "", "", ""), rowsA);
assert.deepEqual(filterRackPositions(rowsB, "B01", "", "Reserved"), rowsB);
assert.equal(filterRackPositions(rowsA, "B01", "", "").length, 0);
let mountedSite = siteA;
let mountedSnapshot = snapshotA;
assert.equal(rackPositionRows(mountedSite, mountedSnapshot)[0].siteName, "Rangsit");
mountedSite = siteB;
mountedSnapshot = snapshotB;
assert.equal(rackPositionRows(mountedSite, mountedSnapshot)[0].siteName, "Srinakarin");
assert.equal(rackPositionRows(mountedSite, mountedSnapshot)[0].rackId, "B01");
mountedSite = siteA;
mountedSnapshot = snapshotA;
assert.equal(rackPositionRows(mountedSite, mountedSnapshot)[0].rackId, "A01");
assert.equal(rackPositionRows(mountedSite, mountedSnapshot)[1].status, "Pending Decommission");

// Simulate delayed responses resolving in either order. Results remain keyed
// to their own site, so a late A response cannot overwrite B.
const delayedBySite = new Map();
await Promise.all([
  Promise.resolve().then(() => delayedBySite.set(siteB.id, rowsB)),
  Promise.resolve().then(() => delayedBySite.set(siteA.id, rowsA))
]);
assert.equal(delayedBySite.get(siteB.id)[0].rackId, "B01");
assert.equal(delayedBySite.get(siteA.id)[0].rackId, "A01");
assert.match(apiService, /previousCalculationMonth/);
assert.match(apiService, /usedU > totalU/);

assert.equal(rackUtilizationLevel(79.99), "Normal");
assert.equal(rackUtilizationLevel(80), "Attention");
assert.equal(rackUtilizationLevel(84.9), "Attention");
assert.equal(rackUtilizationLevel(85), "High");
assert.equal(rackAvailabilityStatus(0, 100), "Full");
assert.equal(rackAvailabilityStatus(19, 100), "Limited");
assert.equal(rackAvailabilityStatus(20, 100), "Ready");
assert.equal(rackAvailabilityStatus(0, 0), "Full");
assert.equal(isValidRackUnitCapacity(100, 100), true);
assert.equal(isValidRackUnitCapacity(100, 101), false);

const reconciliationMetrics = {
  total: 10,
  inUse: { count: 4, ratio: 0.4 },
  available: { count: 3, ratio: 0.3 },
  reserved: { count: 1, ratio: 0.1 },
  pendingDismantle: { count: 1, ratio: 0.1 },
  other: { count: 1, ratio: 0.1 }
};
assert.equal(rackCountsReconcile(reconciliationMetrics), true);
assert.equal(rackCountsReconcile({ ...reconciliationMetrics, other: { count: 0, ratio: 0 } }), false);

const ranked = rankRackLocations([
  { siteId: 2, siteName: "Srinakarin", siteOrder: 1, zone: "B", available: 4 },
  { siteId: 1, siteName: "Rangsit", siteOrder: 0, zone: "C", available: 4 },
  { siteId: 1, siteName: "Rangsit", siteOrder: 0, zone: "A", available: 1 }
]);
assert.deepEqual(ranked.map(row => `${row.rank}:${row.siteName}:${row.zone}`), ["1:Rangsit:C", "2:Srinakarin:B", "3:Rangsit:A"]);

console.log("Production Site Energy/Cost and Rack comparison checks passed.");
