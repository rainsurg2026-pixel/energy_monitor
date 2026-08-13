import assert from "node:assert/strict";
import { buildDashboardUpsMapping } from "../src/web-clean-v1/dashboardUpsMapping";
import type { UpsGroupHistoryReport } from "../src/reports/reportTypes";

// Regression test for a real gap: DashboardSummary's UPS Groups section
// (Engineering View) needs either a Desktop file-based topology or an
// upsMapping.summary report - CleanWebApp supplied neither, so the section
// silently rendered empty regardless of real data. The dashboard-facility-
// isolation suite never caught this because it greps Desktop's src/App.tsx,
// not CleanWebApp.tsx.

assert.equal(buildDashboardUpsMapping(null, "2026-01"), null, "no history at all returns null, not a crash");

const history: UpsGroupHistoryReport = {
  sourceSheet: "2. UPS Group History",
  rows: [
    { facility: "rangsit", month: "2025-12", group: "UPS 11", totalLoadKw: 25, totalLoadKva: 28, capacity: 400, loadPercent: 6.25, availablePercent: 93.75, monthlyEnergyKwh: 18000, generatedAt: "2025-12-31T00:00:00.000Z", dataVersion: 1 },
    { facility: "rangsit", month: "2026-01", group: "UPS 11", totalLoadKw: 30, totalLoadKva: 34, capacity: 400, loadPercent: 7.5, availablePercent: 92.5, monthlyEnergyKwh: 21600, generatedAt: "2026-01-31T00:00:00.000Z", dataVersion: 1 },
    { facility: "rangsit", month: "2026-01", group: "UPS 13", totalLoadKw: 20, totalLoadKva: 22, capacity: 400, loadPercent: 5, availablePercent: 95, monthlyEnergyKwh: 14400, generatedAt: "2026-01-31T00:00:00.000Z", dataVersion: 1 }
  ]
};

assert.equal(buildDashboardUpsMapping(history, "2026-06"), null, "a month with no rows returns null, not an empty-but-truthy report");

const january = buildDashboardUpsMapping(history, "2026-01");
assert.ok(january, "a month with rows returns a report");
assert.equal(january!.sourceSheet, "2. UPS Group History");
assert.equal(january!.mapping.length, 0, "the hardware mapping table is deliberately empty - no Web/DB equivalent exists, never fabricated");
assert.equal(january!.summary.length, 2, "only the selected month's rows are included");
assert.deepEqual(january!.summary.map(row => row.name), ["UPS 11", "UPS 13"], "group names carry through in source order");
assert.deepEqual(january!.summary.map(row => row.no), [1, 2], "row numbers are sequential starting at 1");
assert.equal(january!.summary[0]?.totalLoadKw, 30);
assert.equal(january!.summary[0]?.totalLoadKva, 34);
assert.equal(january!.summary[0]?.capacity, 400);
assert.equal(january!.summary[0]?.loadPercent, 7.5);
assert.ok(!january!.summary.some(row => row.totalLoadKw === 25), "the prior month's (2025-12) UPS 11 row is excluded, not merged in");

console.log("web-clean-v1 dashboard UPS mapping: 13 assertions passed");
