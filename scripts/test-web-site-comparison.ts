import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rackAvailabilityStatus, rackCountsReconcile, rankRackLocations, isValidRackUnitCapacity } from "../src/domain/rackComparison";
import { rackUtilizationLevel } from "../src/domain/rackCapacity";

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

assert.match(rackComparison, /api<SiteRef\[]>\("\/sites"\)/);
assert.match(rackComparison, /\/racks\?siteId=\$\{site\.id\}&month=/);
assert.match(rackComparison, /\/rack-unit-capacity\?siteId=\$\{site\.id\}&month=/);
for (const heading of [
  "Site Rack Capacity (?:&|&amp;) Availability Comparison",
  "Available rack positions by site and zone for deployment planning\.",
  "Available Racks by Site",
  "Best Locations for New Rack Installation",
  "Rack Availability by Zone",
  "Rack Unit Capacity Comparison",
  "Used and available rack units by site",
  "Available U represents physical rack space only"
]) assert.match(rackComparison, new RegExp(heading));
assert.doesNotMatch(rackComparison, /SAMPLE DATA/);
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
