import { strict as assert } from "node:assert";
import { formatRackCabinetSize } from "../src/domain/rackCapacity";
import { applyRackEditorPartialSave, applyRackEditorSaveFailure, applyRackEditorSaveSuccess, beginRackEditorSave, createRackEditorState, discardRackEditorChanges, stageRackEditorField } from "../src/web-clean-v1/rackEditorState";

const records = [{ rowNumber: 10, rackZone: "Zone A", rackId: "A-01", status: "In Use", cabinetSize: "60*100", detail: "Server", deviceType: "Compute", remarks: null }];
let state = createRackEditorState(1, "2026-07", 3, records);
assert.equal(state.dirtyRows.size, 0, "new editor is clean");

state = stageRackEditorField(state, 10, "status", "Available");
assert.deepEqual([...state.dirtyRows], [10], "one changed row is dirty");
state = stageRackEditorField(state, 10, "status", "In Use");
assert.equal(state.dirtyRows.size, 0, "change then revert clears the dirty row");
state = stageRackEditorField(state, 10, "cabinetSize", "60 × 100");
assert.equal(state.dirtyRows.size, 0, "cabinet typography-only change is clean");
assert.equal(formatRackCabinetSize("60*100"), "60 \u00d7 100", "cabinet size is display-formatted without rewriting storage");

state = stageRackEditorField(state, 10, "detail", "Updated");
const failed = applyRackEditorSaveFailure(beginRackEditorSave(state), "network failure");
assert.equal(failed.dirtyRows.size, 1, "failed save preserves the dirty row");
assert.equal(failed.current[0].detail, "Updated", "failed save preserves the edit");
assert.equal(failed.error, "network failure");

const conflictState = stageRackEditorField(createRackEditorState(1, "2026-07", 3, records), 10, "status", "Available");
const partial = applyRackEditorPartialSave(
  { ...conflictState, saving: true },
  [{ ...records[0], status: "Reserved", detail: "New server detail" }],
  4,
  new Set<number>()
);
assert.equal(partial.baseline[0].status, "Reserved", "partial save promotes the server row to baseline");
assert.equal(partial.current[0].status, "Available", "the conflicting local edit remains staged");
assert.equal(partial.current[0].detail, "New server detail", "an untouched field adopts the newer server value");
assert.equal(partial.dirtyRows.size, 1, "the conflicting row remains dirty");

const restored = discardRackEditorChanges(failed);
assert.equal(restored.dirtyRows.size, 0, "discard clears dirty rows");
assert.equal(restored.current[0].detail, "Server", "discard restores server baseline");

const saved = applyRackEditorSaveSuccess(state, [{ ...records[0], detail: "Updated" }], 4);
assert.equal(saved.dirtyRows.size, 0, "successful save clears dirty rows");
assert.equal(saved.baseline[0].detail, "Updated", "successful save promotes response to baseline");
assert.match(saved.sourceKey, /:2026-07:4$/);

const otherSite = createRackEditorState(2, "2026-07", 3, records);
const otherMonth = createRackEditorState(1, "2026-08", 3, records);
assert.notEqual(state.sourceKey, otherSite.sourceKey, "site state is isolated");
assert.notEqual(state.sourceKey, otherMonth.sourceKey, "month state is isolated");

console.log("ALL WEB RACK EDITOR STATE TESTS PASSED");
