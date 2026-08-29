import assert from "node:assert/strict";
import { ApiService } from "./apiService";
import { HttpError } from "../errors";
import { InMemoryRepository } from "../repositories/inMemoryRepository";
import type { RackUnitImageStorage } from "../storage/rackUnitImageStorage";
import { fixtureLog } from "../testFixtures";

const image = {
  objectKey: "rack-unit-capacity/srinakarin/2026-07/example.jpg",
  contentType: "image/jpeg" as const,
  byteSize: 1,
  sha256: null,
  width: 1,
  height: 1,
  savedAt: "2026-07-31T00:00:00.000Z",
  savedBy: "system"
};

function repository(): InMemoryRepository {
  return new InMemoryRepository({
    sites: [{ id: 2, code: "srinakarin", name: "Srinakarin", active: true }],
    settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
    rackUnitSnapshots: {
      "2:2026-07": { month: "2026-07", rowVersion: 1, totalU: 100, usedU: 50, image }
    }
  });
}

function storage(overrides: Partial<RackUnitImageStorage> = {}): RackUnitImageStorage {
  return {
    putObject: async () => undefined,
    getObject: async () => Buffer.from([0xff, 0xd8]),
    deleteObject: async () => undefined,
    ...overrides
  };
}

const now = () => new Date("2026-08-14T00:00:00.000Z");

const unavailable = await new ApiService(repository(), now, storage({ hasObject: async () => false })).getRackUnit(2, "2026-07") as { snapshot: { image: { available: boolean } } };
assert.equal(unavailable.snapshot.image.available, false, "metadata must not claim a missing storage object is available");

const available = await new ApiService(repository(), now, storage({ hasObject: async () => true })).getRackUnit(2, "2026-07") as { snapshot: { image: { available: boolean } } };
assert.equal(available.snapshot.image.available, true, "existing storage object remains available to the editor");

const storageFailure = new ApiService(repository(), now, storage({ getObject: async () => { throw new Error("storage unavailable"); } }));
await assert.rejects(
  () => storageFailure.getRackUnitImage(2, "2026-07"),
  (error: unknown) => error instanceof HttpError && error.status === 503 && error.code === "IMAGE_STORAGE_UNAVAILABLE"
);

const comparisonRepository = new InMemoryRepository({
  sites: [{ id: 2, code: "srinakarin", name: "Srinakarin", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
  logs: { 2: [fixtureLog("2025-12", 10, 90000, 450000), fixtureLog("2026-01", 14, 100000, 500000)] }
});
const comparison = await new ApiService(comparisonRepository, now).getSiteComparison() as { sites: Array<{ months: Array<{ month: string; metrics: { floorEnergy: number | null } | null }> }> };
assert.notEqual(comparison.sites[0]?.months.find(entry => entry.month === "2026-01")?.metrics?.floorEnergy, null, "site comparison keeps the prior calendar month as Air calculation context");

const invalidRackUnit = new ApiService(repository(), now);
await assert.rejects(
  () => invalidRackUnit.saveRackUnit(2, "2026-07", { total_u: 10, used_u: 11, expected_row_version: 1 }, "test-correlation"),
  (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_RACK_UNIT_VALUES"
);

console.log("api service: Rack Unit image availability is fail-closed and storage failures are sanitized");


const rackCarryForwardRecord = { rowNumber: 1, rackZone: "A", rackId: "R-001", status: "In Use", cabinetSize: "42U", detail: "May detail", deviceType: "Server", remarks: null };
const rackCarryForwardRepository = new InMemoryRepository({
  sites: [
    { id: 1, code: "rangsit", name: "Rangsit", active: true },
    { id: 2, code: "srinakarin", name: "Srinakarin", active: true }
  ],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
  rackSnapshots: {
    "1:2026-05": { month: "2026-05", rowVersion: 4, records: [rackCarryForwardRecord] }
  }
});
const rackCarryForwardApi = new ApiService(rackCarryForwardRepository, now);
const mayRack = await rackCarryForwardApi.getRacks(1, "2026-05") as { snapshot: { records: typeof rackCarryForwardRecord[] } | null };
assert.equal(mayRack.snapshot?.records[0]?.status, "In Use");
const juneRackDraft = await rackCarryForwardApi.getRacks(1, "2026-06") as { snapshot: unknown; carryForwardCandidate?: { sourceMonth: string; snapshot: { records: typeof rackCarryForwardRecord[] } } | null };
assert.equal(juneRackDraft.snapshot, null);
assert.equal(juneRackDraft.carryForwardCandidate?.sourceMonth, "2026-05", "missing June must expose the nearest prior raw snapshot as an unsaved candidate");

console.log("api service: Rack Capacity carry-forward candidate is side-effect-free and exact-month");

const juneCreated = await rackCarryForwardApi.saveRacks(1, "2026-06", {
  initialize: true,
  expected_row_version: null,
  carry_forward_source_month: "2026-05",
  carry_forward_source_row_version: 4,
  changes: [{ row_number: 1, rack_id: "R-001", status: { expected: "In Use", next: "Available" } }]
}, "carry-june");
assert.equal((juneCreated as { snapshot: { month: string; rowVersion: number; records: typeof rackCarryForwardRecord[] } }).snapshot.month, "2026-06");
assert.equal((juneCreated as { snapshot: { rowVersion: number } }).snapshot.rowVersion, 1, "a newly initialized snapshot starts at its own row version");
const savedJune = await rackCarryForwardApi.getRacks(1, "2026-06") as { snapshot: { month: string; records: typeof rackCarryForwardRecord[] } | null; carryForwardCandidate: unknown };
assert.equal(savedJune.snapshot?.month, "2026-06", "a persisted June snapshot reopens as June, never as May");
assert.equal(savedJune.snapshot?.records[0]?.status, "Available");
assert.equal(savedJune.carryForwardCandidate, null);
const unchangedMay = await rackCarryForwardApi.getRacks(1, "2026-05") as { snapshot: { records: typeof rackCarryForwardRecord[] } | null };
assert.equal(unchangedMay.snapshot?.records[0]?.status, "In Use", "editing June must not mutate May");
const julyRackDraft = await rackCarryForwardApi.getRacks(1, "2026-07") as { snapshot: unknown; carryForwardCandidate?: { sourceMonth: string; snapshot: { records: typeof rackCarryForwardRecord[] } } | null };
assert.equal(julyRackDraft.snapshot, null);
assert.equal(julyRackDraft.carryForwardCandidate?.sourceMonth, "2026-06", "July carries from the nearest persisted June snapshot");
assert.equal(julyRackDraft.carryForwardCandidate?.snapshot.records[0]?.status, "Available");
const rackHistoryAfterCarry = await rackCarryForwardRepository.listRackCapacityHistory(1);
assert.deepEqual([...new Set(rackHistoryAfterCarry.map(row => row.month))], ["2026-06"], "history contains persisted snapshots only");
await rackCarryForwardRepository.updateGlobalSettings({ startMonth: "2026-06", endMonth: "2026-12", expectedRowVersion: 1 }, "period-change");
const periodScopedJune = await rackCarryForwardApi.getRacks(1, "2026-06") as { snapshot: { month: string } | null };
assert.equal(periodScopedJune.snapshot?.month, "2026-06", "display period changes visibility, not snapshot identity");
await assert.rejects(
  () => rackCarryForwardApi.saveRacks(1, "2026-06", { initialize: true, expected_row_version: null, changes: [{ row_number: 1, rack_id: "R-001", status: { expected: "Available", next: "Reserved" } }] }, "already-initialized"),
  (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === "RACK_CAPACITY_ALREADY_INITIALIZED"
);
const siteTwoMissing = await rackCarryForwardApi.getRacks(2, "2026-06") as { snapshot: unknown; carryForwardCandidate: unknown };
assert.equal(siteTwoMissing.snapshot, null);
assert.equal(siteTwoMissing.carryForwardCandidate, null, "a different site cannot borrow a carry-forward source");
const concurrentRepository = new InMemoryRepository({
  sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
  rackSnapshots: { "1:2026-05": { month: "2026-05", rowVersion: 4, records: [rackCarryForwardRecord] } }
});
const concurrentApi = new ApiService(concurrentRepository, now);
const concurrentPayload = { initialize: true, expected_row_version: null, changes: [], carry_forward_source_month: "2026-05", carry_forward_source_row_version: 4 };
const concurrentResults = await Promise.all([
  concurrentApi.saveRacks(1, "2026-06", concurrentPayload, "concurrent-a"),
  concurrentApi.saveRacks(1, "2026-06", concurrentPayload, "concurrent-b")
]);
assert.equal(concurrentResults.length, 2, "concurrent initialization is idempotent");
assert.equal((await concurrentRepository.getRackSnapshot(1, "2026-06"))?.records.length, 1);
assert.equal((await concurrentRepository.listRackCapacityHistory(1)).filter(row => row.month === "2026-06").length, 2, "concurrent initialization writes one target history set");
const noPriorRepository = new InMemoryRepository({
  sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 }
});
const noPriorApi = new ApiService(noPriorRepository, now);
const noPrior = await noPriorApi.getRacks(1, "2026-06") as { snapshot: unknown; carryForwardCandidate: unknown };
assert.equal(noPrior.snapshot, null);
assert.equal(noPrior.carryForwardCandidate, null, "without a prior raw snapshot this remains true no-data");
await assert.rejects(
  () => noPriorApi.saveRacks(1, "2026-06", { initialize: true, expected_row_version: null, changes: [] }, "no-prior"),
  (error: unknown) => error instanceof HttpError && error.status === 404 && error.code === "RACK_CAPACITY_NOT_FOUND"
);
const staleSourceRepository = new InMemoryRepository({
  sites: [{ id: 1, code: "rangsit", name: "Rangsit", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
  rackSnapshots: { "1:2026-05": { month: "2026-05", rowVersion: 4, records: [rackCarryForwardRecord] } }
});
await assert.rejects(
  () => new ApiService(staleSourceRepository, now).saveRacks(1, "2026-06", { initialize: true, expected_row_version: null, carry_forward_source_month: "2026-05", carry_forward_source_row_version: 99, changes: [] }, "stale-source"),
  (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === "RACK_CAPACITY_SOURCE_CHANGED"
);

console.log("api service: Rack Capacity carry-forward candidate, first-save persistence, isolation, history, and concurrency passed");
