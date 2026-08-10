import assert from "node:assert/strict";
import type { MonthlyLog } from "../src/types";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { ApiService } from "../server/services/apiService";
import { HttpError } from "../server/errors";

const site = { id: 1, code: "SITE-1", name: "Site 1", active: true };
const baseLog = (month = "2026-07"): MonthlyLog => ({
  month,
  ups: [{ upsId: "UPS-1", voltage: 230, current: 10, loadKw: 2, loadKva: 2.5 }],
  air: { eb41a: 1, eb41b: 2, eb42a: 3, eb42b: 4, meters: {} },
  dc: [{ panelId: "DC-1", voltage: 400, current: 5 }],
  energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 400 },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
});

const repository = new InMemoryRepository({ sites: [site], settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 } });
const first = await repository.saveMonthlyLog({
  siteId: 1,
  log: baseLog(),
  expectedRowVersion: null,
  correlationId: "section-save-1",
  savedSections: ["ups"],
  savedAt: "2026-08-10T01:02:03.000Z"
});
assert.equal(first.lastSavedUps, "2026-08-10T01:02:03.000Z");
assert.equal(first.lastSavedAir, null);
assert.equal(first.lastSavedDc, null);
assert.equal(first.lastSavedEnergyCost, null);

const secondLog = baseLog();
secondLog.air.eb41a = 9;
secondLog.lastSavedAir = "2000-01-01T00:00:00.000Z";
const second = await repository.saveMonthlyLog({
  siteId: 1,
  log: secondLog,
  expectedRowVersion: first.rowVersion,
  correlationId: "section-save-2",
  savedSections: ["air"],
  savedAt: "2026-08-10T02:03:04.000Z"
});
assert.equal(second.lastSavedUps, "2026-08-10T01:02:03.000Z");
assert.equal(second.lastSavedAir, "2026-08-10T02:03:04.000Z");
assert.equal(second.lastSavedDc, null);
assert.equal(second.lastSavedEnergyCost, null);

const importedLog = baseLog("2026-06");
importedLog.lastSavedUps = "2026-06-30T10:00:00.000Z";
importedLog.lastSavedAir = "2026-06-30T10:01:00.000Z";
importedLog.lastSavedDc = "2026-06-30T10:02:00.000Z";
importedLog.lastSavedEnergyCost = "2026-06-30T10:03:00.000Z";
const imported = await repository.saveMonthlyLog({ siteId: 1, log: importedLog, expectedRowVersion: null, correlationId: "section-save-import" });
assert.deepEqual(
  [imported.lastSavedUps, imported.lastSavedAir, imported.lastSavedDc, imported.lastSavedEnergyCost],
  [importedLog.lastSavedUps, importedLog.lastSavedAir, importedLog.lastSavedDc, importedLog.lastSavedEnergyCost]
);

const service = new ApiService(repository, () => new Date("2026-08-10T03:00:00.000Z"));
const apiLogInput = baseLog();
apiLogInput.lastSavedDc = "2000-01-01T00:00:00.000Z";
const apiSave = await service.saveMonthlyLog(1, "2026-07", {
  log: apiLogInput,
  expected_row_version: second.rowVersion,
  changed_sections: ["dc"],
  provenance: { source_type: "web-structured-entry" }
}, "section-save-api");
assert.equal((apiSave as { lastSavedDc: string }).lastSavedDc, "2026-08-10T03:00:00.000Z");
const apiLog = (await repository.getMonthlyLogs(1, ["2026-07"]))[0];
assert.equal(apiLog.lastSavedUps, "2026-08-10T01:02:03.000Z");
assert.equal(apiLog.lastSavedAir, "2026-08-10T02:03:04.000Z");
assert.equal(apiLog.lastSavedDc, (apiSave as { lastSavedDc: string }).lastSavedDc);
assert.equal(apiLog.lastSavedEnergyCost, null);

await assert.rejects(
  () => service.saveMonthlyLog(1, "2026-07", { log: baseLog(), expected_row_version: (apiSave as { rowVersion: number }).rowVersion, changed_sections: ["not-a-section"] }, "section-save-invalid"),
  (error: unknown) => error instanceof HttpError && error.status === 400
);

console.log("web section-save parity: PASS (per-section timestamps, import preservation, API validation, optimistic versioning)");
