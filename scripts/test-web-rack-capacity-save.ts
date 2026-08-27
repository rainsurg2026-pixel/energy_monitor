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

const siteTwo = await service.getRacks(2, "2026-02") as { snapshot: unknown };
assert.equal(siteTwo.snapshot, null, "facility two cannot see facility one Rack snapshot");
await assert.rejects(() => service.saveRacks(1, "2026-02", {
  expected_row_version: null,
  changes: [{ row_number: 1, rack_id: "A-01", status: { expected: "Available", next: "Reserved" } }]
}, "missing-month-test", 7), error => error instanceof Error && "code" in error && (error as { code?: string }).code === "RACK_CAPACITY_NOT_FOUND");

console.log("ALL WEB RACK CAPACITY SAVE TESTS PASSED");
