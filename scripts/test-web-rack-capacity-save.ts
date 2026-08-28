import { strict as assert } from "node:assert";
import { ApiService } from "../server/services/apiService";
import { apiTestRepository } from "../server/testFixtures";

const repository = apiTestRepository();
const service = new ApiService(repository, () => new Date("2026-08-27T00:00:00.000Z"));
const beforeHistory = await repository.listRackCapacityHistory(1);
const result = await service.saveRacks(1, "2026-01", {
  expected_row_version: 1,
  changes: [{ row_number: 1, rack_id: "A-01", status: { expected: "In Use", next: "Available" } }]
}, "rack-save-test", 7) as { snapshot: { rowVersion: number; records: Array<{ rackId: string | null; status: string | null }> }; changedCount: number };
assert.equal(result.changedCount, 1);
assert.equal(result.snapshot.rowVersion, 2);
assert.equal(result.snapshot.records[0].status, "Available");

const afterHistory = await repository.listRackCapacityHistory(1);
assert.ok(afterHistory.filter(row => row.month === "2026-01").length >= beforeHistory.filter(row => row.month === "2026-01").length);
assert.equal(afterHistory.find(row => row.month === "2026-01" && row.rackZone === "(Total)")?.available, 2, "current-month history reflects the saved Rack snapshot");
assert.equal(afterHistory.find(row => row.month === "2025-12")?.inUse, beforeHistory.find(row => row.month === "2025-12")?.inUse, "saving one month does not rewrite another month");

await assert.rejects(() => service.saveRacks(1, "2026-01", {
  expected_row_version: 1,
  changes: [{ row_number: 1, rack_id: "A-01", status: { expected: "Available", next: "Reserved" } }]
}, "stale-rack-save-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "STALE_VERSION");
const afterConflict = await repository.getRackSnapshot(1, "2026-01");
assert.equal(afterConflict?.records[0].status, "Available", "stale save does not overwrite current data");

const atomicRepository = apiTestRepository();
const atomicBefore = await atomicRepository.getRackSnapshot(1, "2026-01");
const atomicAuditCount = atomicRepository.auditEvents.length;
await assert.rejects(() => new ApiService(atomicRepository, () => new Date("2026-08-27T00:00:00.000Z")).saveRacks(1, "2026-01", {
  expected_row_version: 1,
  changes: [
    { row_number: 1, rack_id: "A-01", status: { expected: "In Use", next: "Reserved" } },
    { row_number: 2, rack_id: "A-02", status: { expected: "In Use", next: "Reserved" } }
  ]
}, "atomic-conflict-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "RACK_CAPACITY_CONFLICT");
assert.deepEqual(await atomicRepository.getRackSnapshot(1, "2026-01"), atomicBefore, "a conflicting row rolls back the entire Rack batch");
assert.equal(atomicRepository.auditEvents.length, atomicAuditCount, "a conflicting Rack batch writes no audit event");

const rollbackRepository = apiTestRepository();
const rollbackBefore = await rollbackRepository.getRackSnapshot(1, "2026-01");
const rollbackAuditCount = rollbackRepository.auditEvents.length;
await assert.rejects(() => rollbackRepository.withTransaction(async transaction => {
  await transaction.saveRackCapacity({
    siteId: 1,
    facility: "site-a",
    month: "2026-01",
    expectedRowVersion: 1,
    changes: [{ rowNumber: 1, rackId: "A-01", status: { expected: "In Use", next: "Reserved" } }],
    correlationId: "outer-rollback-test"
  });
  throw new Error("force transaction rollback");
}), /force transaction rollback/);
assert.deepEqual(await rollbackRepository.getRackSnapshot(1, "2026-01"), rollbackBefore, "an outer transaction failure restores Rack data");
assert.equal(rollbackRepository.auditEvents.length, rollbackAuditCount, "an outer transaction failure restores Rack audit data");

const serializedRepository = apiTestRepository();
let firstTransactionReady!: () => void;
const firstTransactionStarted = new Promise<void>(resolve => { firstTransactionReady = resolve; });
let releaseFirstTransaction!: () => void;
const firstTransactionRelease = new Promise<void>(resolve => { releaseFirstTransaction = resolve; });
const firstTransaction = serializedRepository.withTransaction(async transaction => {
  await transaction.saveRackCapacity({
    siteId: 1,
    facility: "site-a",
    month: "2026-01",
    expectedRowVersion: 1,
    changes: [{ rowNumber: 1, rackId: "A-01", status: { expected: "In Use", next: "Reserved" } }],
    correlationId: "serialized-first-test"
  });
  firstTransactionReady();
  await firstTransactionRelease;
});
await firstTransactionStarted;
let secondTransactionCompleted = false;
const secondTransaction = serializedRepository.withTransaction(async transaction => {
  await transaction.saveRackCapacity({
    siteId: 1,
    facility: "site-a",
    month: "2026-01",
    expectedRowVersion: 2,
    changes: [{ rowNumber: 2, rackId: "A-02", status: { expected: "Available", next: "Reserved" } }],
    correlationId: "serialized-second-test"
  });
  secondTransactionCompleted = true;
});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(secondTransactionCompleted, false, "in-memory transactions serialize instead of overlapping");
releaseFirstTransaction();
await Promise.all([firstTransaction, secondTransaction]);
const serializedSnapshot = await serializedRepository.getRackSnapshot(1, "2026-01");
assert.equal(serializedSnapshot?.records[0].status, "Reserved", "the first serialized transaction commits");
assert.equal(serializedSnapshot?.records[1].status, "Reserved", "the second serialized transaction commits after the first");

const nestedRepository = apiTestRepository();
await nestedRepository.withTransaction(async outerTransaction => {
  await outerTransaction.withTransaction(async innerTransaction => {
    await innerTransaction.saveRackCapacity({
      siteId: 1,
      facility: "site-a",
      month: "2026-01",
      expectedRowVersion: 1,
      changes: [{ rowNumber: 1, rackId: "A-01", status: { expected: "In Use", next: "Reserved" } }],
      correlationId: "nested-transaction-test"
    });
  });
});
assert.equal((await nestedRepository.getRackSnapshot(1, "2026-01"))?.records[0].status, "Reserved", "nested in-memory transactions reuse the outer transaction");

await assert.rejects(() => service.saveRacks(1, "2026-01", {
  expected_row_version: 2,
  changes: [
    { row_number: 1, rack_id: "A-01", status: { expected: "Available", next: "Reserved" } },
    { row_number: 1, rack_id: "A-01", detail: { expected: null, next: "duplicate" } }
  ]
}, "duplicate-row-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "INVALID_RACK_CHANGES");
await assert.rejects(() => service.saveRacks(1, "2026-01", { expected_row_version: 2, changes: [] }, "empty-batch-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "INVALID_RACK_CHANGES");

const siteTwo = await service.getRacks(2, "2026-02") as { snapshot: unknown };
assert.equal(siteTwo.snapshot, null, "facility two cannot see facility one Rack snapshot");
await assert.rejects(() => service.saveRacks(1, "2026-02", {
  expected_row_version: null,
  changes: [{ row_number: 1, rack_id: "A-01", status: { expected: "Available", next: "Reserved" } }]
}, "missing-month-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "RACK_CAPACITY_NOT_FOUND");

console.log("ALL WEB RACK CAPACITY SAVE TESTS PASSED");
