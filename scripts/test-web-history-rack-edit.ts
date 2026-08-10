import assert from "node:assert/strict";
import { InMemoryObjectStorage } from "../server/storage/objectStorage";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { ApiService } from "../server/services/apiService";
import { HttpError } from "../server/errors";
import type { MonthlyLog } from "../src/types";

const log = (month: string): MonthlyLog => ({
  month,
  ups: [{ upsId: "UPS-1", voltage: 230, current: 10, loadKw: 2, loadKva: 2.5 }],
  air: { eb41a: 1, eb41b: 2, eb42a: 3, eb42b: 4, meters: {} },
  dc: [{ panelId: "DC-1", voltage: 400, current: 5 }],
  energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 400 },
  lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
});

const repository = new InMemoryRepository({
  sites: [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
  logs: { 1: [log("2026-07"), log("2026-08")] }
});
const storage = new InMemoryObjectStorage();
const service = new ApiService(repository, () => new Date("2026-08-10T00:00:00.000Z"), storage);

const savedRack = await service.saveRackSnapshot(1, "2026-08", { expected_row_version: null, records: [{ row_number: 2, rack_zone: "A", rack_id: "A-01", status: "In Use", cabinet_size: "42U", detail: "Production", device_type: "Server", remarks: null }] }, "rack-edit-1", 7);
assert.equal(savedRack.rowVersion, 1);
assert.equal(savedRack.records[0].rackId, "A-01");
assert.equal((await repository.getRackCapacityHistory(1)).some(row => row.snapshotMonth === "2026-08" && row.rackZone === "(Total)"), true);

await assert.rejects(() => service.saveRackSnapshot(1, "2026-08", { expected_row_version: null, records: [] }, "rack-edit-stale"), (error: unknown) => error instanceof HttpError && error.code === "STALE_VERSION");
const savedUnits = await service.saveRackUnitSnapshot(1, "2026-08", { total_u: 100, used_u: 40, expected_row_version: null }, "rack-unit-1", 7);
assert.deepEqual(savedUnits, { month: "2026-08", rowVersion: 1, totalU: 100, usedU: 40 });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const image = await service.saveRackUnitImage(1, "2026-08", { content_base64: png.toString("base64") }, "rack-image-1", 7) as { contentType: string; width: number; height: number; sha256: string; objectKey: string };
assert.equal(image.contentType, "image/png");
assert.equal(image.width, 1);
assert.equal(image.height, 1);
assert.equal((await storage.get(image.objectKey)).equals(png), true);

await repository.saveUpsGroupHistory({
  siteId: 1,
  sourceSheet: "2. UPS Group History",
  rows: [{ facility: "RST", month: "2026-08", group: "UPS 11", totalLoadKw: 2, totalLoadKva: 2.5, capacity: 400, loadPercent: 0.625, availablePercent: 99.375, monthlyEnergyKwh: 1488, generatedAt: "2026-08-10T00:00:00.000Z", dataVersion: 1 }],
  correlationId: "ups-history-1",
  actorUserId: 7
});

const historical = await service.getHistorical(1) as { logs: MonthlyLog[]; upsGroupHistory: { sourceSheet: string; rows: unknown[] }; rackCapacityHistory: unknown[]; rackUnitCapacity: Array<{ availableU: number; availabilityPct: number }> };
assert.equal(historical.logs.length, 2);
assert.equal(historical.upsGroupHistory.sourceSheet, "2. UPS Group History");
assert.equal(historical.upsGroupHistory.rows.length, 1);
assert.equal(historical.rackCapacityHistory.length > 0, true);
assert.deepEqual(historical.rackUnitCapacity[0], { month: "2026-08", rowVersion: 1, totalU: 100, usedU: 40, availableU: 60, availabilityPct: 0.6 });

console.log("web history/rack edit parity: PASS (historical route data, rack optimistic save/history, rack-unit save and image validation/storage)");
