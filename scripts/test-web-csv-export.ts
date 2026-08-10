import assert from "node:assert/strict";
import { buildCombinedCsv } from "../src/utils/exportData";
import { fixtureLog } from "../server/testFixtures";

const csv = buildCombinedCsv([
  fixtureLog("2026-02", 20, 200_000, 1_000_000),
  fixtureLog("2026-01", 10, 100_000, 500_000)
]);

assert.match(csv, /^# UPS_Loads\nMonth,UPS ID/);
assert.match(csv, /# Air_Conditioning\nMonth,EB41A \(GWh\)/);
assert.match(csv, /# DC_Panels\nMonth,DC Panel/);
assert.match(csv, /# Energy_Cost\nMonth,Building Energy Consumption \(kWh\)/);
assert.ok(csv.indexOf("2026-01") < csv.indexOf("2026-02"), "CSV rows are sorted by month");
assert.match(csv, /"100,000\.00"/);
assert.match(csv, /"500,000\.00"/);

console.log("web CSV export: 7 assertions passed");
