import assert from "node:assert/strict";
import { buildRackCapacitySavePayload } from "../src/web-clean-v1/rackCapacitySavePayload";

const existingSnapshotPayload = buildRackCapacitySavePayload({
  changes: [],
  expectedRowVersion: 7,
  initialize: false,
  carryForwardSourceMonth: null,
  carryForwardSourceRowVersion: undefined
});

assert.deepEqual(existingSnapshotPayload, {
  changes: [],
  expected_row_version: 7,
  initialize: false,
  force_snapshot: true
}, "an existing snapshot must omit absent carry-forward metadata instead of sending null");
assert.doesNotMatch(JSON.stringify(existingSnapshotPayload), /carry_forward_source_month/);

const carryForwardPayload = buildRackCapacitySavePayload({
  changes: [],
  expectedRowVersion: null,
  initialize: true,
  carryForwardSourceMonth: "2026-06",
  carryForwardSourceRowVersion: 4
});

assert.deepEqual(carryForwardPayload, {
  changes: [],
  expected_row_version: null,
  initialize: true,
  carry_forward_source_month: "2026-06",
  carry_forward_source_row_version: 4,
  force_snapshot: true
}, "an initialized snapshot must preserve canonical carry-forward metadata");

console.log("web-clean-v1 Rack Capacity save payload: optional carry-forward metadata is omitted when absent");
