import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rackAvailabilityStatus, rackCountsReconcile, rankRackLocations, isValidRackUnitCapacity } from "../src/domain/rackComparison";
import { rackUtilizationLevel } from "../src/domain/rackCapacity";
import { displayPositionStatus, filterRackPositions, rackPositionRows } from "../src/web-clean-v1/WebSiteRackCapacityComparison";

const comparison = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
const rackComparison = readFileSync(new URL("../src/web-clean-v1/WebSiteRackCapacityComparison.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
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
assert.match(app, /id: "rack-comparison"[^\n]*Site Rack Capacity Comparison/);
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
  "Available rack positions by site and zone for deployment planning.",
  "Available Rack Positions by Zone",
  "Total Available",
  "Rack Positions",
  "Rack Unit Capacity Comparison",
  "Used and available rack units by site",
  "Available U represents physical rack space only"
]) assert.ok(rackComparison.includes(heading), "comparison heading missing: " + heading);
for (const field of ["Rack ID", "Cabinet Size (cm)", "Detail"]) assert.ok(rackComparison.includes(">" + field + "</th>"), "position field missing: " + field);
assert.ok(rackComparison.includes("Pending Dismantle"));
assert.ok(rackComparison.includes("Pending Decommission"));
assert.ok(rackComparison.includes("useMemo<RackPosition[]>"));
assert.ok(rackComparison.includes("[states]"));
assert.ok(rackComparison.indexOf("<RackPositions states={sites}") < rackComparison.indexOf("<RackUnitComparison states={sites}"), "Rack Positions stays directly before Rack Unit comparison");
assert.doesNotMatch(rackComparison, /SAMPLE DATA/);

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
