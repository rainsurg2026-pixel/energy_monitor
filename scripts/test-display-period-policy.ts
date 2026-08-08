import assert from "node:assert/strict";
import { allowedMonths, assertDisplayPeriod, enumerateMonths, isAllowedMonth, latestAvailableMonth, previousCalculationMonth, visibleMonths } from "../server/policies/displayPeriod";

let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void { assert.deepEqual(actual, expected, name); checks++; }

const period = assertDisplayPeriod("2026-01", "2026-03");
check("contiguous allowed months", allowedMonths(period), ["2026-01", "2026-02", "2026-03"]);
check("range enumeration", enumerateMonths("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
check("allowed month", isAllowedMonth("2026-02", period), true);
check("hidden month excluded", isAllowedMonth("2025-12", period), false);
check("available months filtered", visibleMonths(period, ["2025-12", "2026-01", "2026-03", "2026-04"]), ["2026-01", "2026-03"]);
check("latest available month", latestAvailableMonth(period, ["2025-12", "2026-01", "2026-03"]), "2026-03");
check("no available month", latestAvailableMonth(period, ["2025-12"]), null);
check("hidden previous dependency", previousCalculationMonth("2026-01"), "2025-12");
assert.throws(() => assertDisplayPeriod("2026-03", "2026-01")); checks++;
assert.throws(() => assertDisplayPeriod("2026/01", "2026-03")); checks++;
console.log(`display period policy: ${checks} assertions passed`);
