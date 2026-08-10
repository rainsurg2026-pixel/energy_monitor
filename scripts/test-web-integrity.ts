import assert from "node:assert/strict";
import { IntegrityService } from "../server/services/integrityService";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";

const repository = new InMemoryRepository({
  sites: [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }],
  settings: { startMonth: "2026-01", endMonth: "2026-03", rowVersion: 1 },
  logs: {
    1: [{ month: "2026-01", ups: [], air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} }, dc: [], energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 200 } } as any]
  }
});
const service = new IntegrityService(repository, () => new Date("2026-03-20T00:00:00Z"));
const report = await service.buildReport(1);
assert.equal(report.structureOk, true);
assert.equal(report.monthCount, 1);
assert.deepEqual(report.missingMonths, ["2026-02", "2026-03"]);
assert.deepEqual(report.missingSections[0]?.sections, ["UPS", "AIR", "DC"]);
assert.equal(report.scope, "postgres-monthly-log-projection");
console.log("web integrity: 5 assertions passed; missing months and empty source sections are reported with explicit scope");
