import assert from "node:assert/strict";
import { createEmptyLog } from "../src/utils";
import { mergeEntryDraft } from "../src/web-clean-v1/WebEntryWorkspace";

const base = createEmptyLog("2026-08", ["UPS-1"], ["DC-1"]);
base.energyCalculation = { airFields: ["eb41a"], upsGroups: [], dcIds: [] };
const merged = mergeEntryDraft(base, {
  ups: [{ ...base.ups[0], loadKw: 12.5 }],
  air: { ...base.air, eb41a: 4.5 },
  dc: [{ ...base.dc[0], current: 31 }],
  energy: { buildingEnergyKwh: 1200, buildingElectricityCostThb: 5100 }
});

assert.equal(merged.month, "2026-08");
assert.equal(merged.ups[0].loadKw, 12.5);
assert.equal(merged.air.eb41a, 4.5);
assert.equal(merged.dc[0].current, 31);
assert.equal(merged.energyCost.buildingEnergyKwh, 1200);
assert.deepEqual(merged.energyCalculation?.airFields, ["eb41a"]);
assert.equal(merged.srinakarinInputs, base.srinakarinInputs);
assert.notEqual(merged, base);

console.log("web entry workspace: Save All merges every live section while preserving untouched log data");
