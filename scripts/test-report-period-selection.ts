import assert from "node:assert/strict";
import { selectedDashboardMonth, selectedPeriodAnchorIndex, selectedPeriodMonths } from "../src/utils/reportPeriodSelection";

const logs = [{ month: "2026-01" }, { month: "2026-03" }, { month: "2026-06" }, { month: "2025-12" }];
assert.deepEqual(selectedPeriodMonths(logs, "2026", "Entire Year").map(item => item.month), ["2026-01", "2026-03", "2026-06"]);
assert.deepEqual(selectedPeriodMonths(logs, "2026", "Last Month").map(item => item.month), ["2026-03"]);
assert.deepEqual(selectedPeriodMonths(logs, "2026", "03").map(item => item.month), ["2026-03"]);
assert.equal(selectedDashboardMonth(logs, "2026", "Last Month", "2026-08"), "2026-03");
assert.equal(selectedDashboardMonth(logs, "2026", "06", "2026-08"), "2026-06");
assert.equal(selectedPeriodAnchorIndex(["2026-01", "2026-03", "2026-06"], "Last Month"), 1);
assert.equal(selectedPeriodAnchorIndex(["2026-01", "2026-03", "2026-06"], "03"), 1);
console.log("report period selection: Desktop/Web month semantics passed");
