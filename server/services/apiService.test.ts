import assert from "node:assert/strict";
import { ApiService } from "./apiService";
import { HttpError } from "../errors";
import { InMemoryRepository } from "../repositories/inMemoryRepository";
import type { RackUnitImageStorage } from "../storage/rackUnitImageStorage";

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

console.log("api service: Rack Unit image availability is fail-closed and storage failures are sanitized");
