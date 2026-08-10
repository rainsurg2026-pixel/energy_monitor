import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { InMemoryObjectStorage } from "../server/storage/objectStorage";
import { ReportService } from "../server/services/reportService";
import type { MonthlyLog } from "../src/types";

function log(month: string, buildingEnergyKwh: number, buildingElectricityCostThb: number): MonthlyLog {
  return {
    month,
    ups: [
      { upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 10, loadKva: 12 },
      { upsId: "UPS 11B", voltage: 220, current: 20, loadKw: 20, loadKva: 22 }
    ],
    air: { eb41a: month === "2026-02" ? 100 : 101, eb41b: month === "2026-02" ? 200 : 202, eb42a: month === "2026-02" ? 300 : 303, eb42b: month === "2026-02" ? 400 : 404 },
    dc: [{ panelId: "DC PDB41A", voltage: 48, current: 10 }],
    energyCost: { buildingEnergyKwh, buildingElectricityCostThb },
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null,
    energyCalculation: { upsGroups: [["UPS 11A", "UPS 11B"]], dcIds: ["DC PDB41A"], airFields: ["eb41a", "eb41b", "eb42a", "eb42b"] }
  };
}

const repository = new InMemoryRepository({
  sites: [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }, { id: 2, code: "SNK", name: "Srinakarin Data Center", active: true }],
  settings: { startMonth: "2025-01", endMonth: "2026-03", rowVersion: 1 },
  logs: { 1: ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].map((month, index) => log(month, 90000 + index * 1000, 450000 + index * 5000)), 2: [log("2026-03", 200000, 800000)] }
});
const reports = new ReportService(repository, () => new Date("2026-03-20T00:00:00Z"));
const result = await reports.buildAllReport(1, "2026-03");

assert.equal(result.filename, "DC_Status_MonthlyReport of RST_202603");
assert.equal(result.formulaVersion, "desktop-v2.3.1");
assert.equal(result.status, "Complete");
assert.equal(result.historicalStart, "2025-04");
assert.equal(result.historicalEnd, "2026-03");
assert.match(result.html, /Monthly Energy &amp; Cost Table/);
assert.match(result.html, /UPS System Energy Trend/);
assert.match(result.html, /Site Comparison/);
assert.match(result.html, /Rangsit Data Center/);
assert.match(result.html, /Srinakarin/);

await assert.rejects(() => reports.buildAllReport(1, "2026-04"), /outside the Global Display Period|not available/);
const rangeDashboard = await reports.buildAllReport(1, "2026-03", { period: "range", from: "2026-01", to: "2026-03", sections: ["dashboard"] });
assert.equal(rangeDashboard.historicalStart, "2026-01");
assert.equal(rangeDashboard.historicalEnd, "2026-03");
assert.match(rangeDashboard.html, /Building Energy Dashboard/);
assert.doesNotMatch(rangeDashboard.html, /Monthly Energy &amp; Cost Table/);

const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const imageKey = "sites/1/rack-unit-images/report-test/2026-03.png";
const imageHash = createHash("sha256").update(imageBytes).digest("hex");
const imageRepository = new InMemoryRepository({
  sites: [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }],
  settings: { startMonth: "2025-01", endMonth: "2026-03", rowVersion: 1 },
  logs: { 1: [log("2026-03", 90000, 450000)] },
  rackUnitSnapshots: { "1:2026-03": { month: "2026-03", rowVersion: 1, totalU: 100, usedU: 40 } },
  rackUnitImages: { "1:2026-03": { siteId: 1, month: "2026-03", objectKey: imageKey, contentType: "image/png", byteSize: imageBytes.length, sha256: imageHash, width: 1, height: 1, savedAt: "2026-03-20T00:00:00.000Z", savedBy: "web-test" } }
});
const imageStorage = new InMemoryObjectStorage();
await imageStorage.put(imageKey, imageBytes, "image/png");
const imageReport = await new ReportService(imageRepository, () => new Date("2026-03-20T00:00:00Z"), imageStorage).buildAllReport(1, "2026-03");
assert.match(imageReport.html, /Rack Unit Capacity and Utilization/);
assert.match(imageReport.html, /data:image\/png;base64,/);
assert.match(imageReport.html, /Captured By: web-test/);
console.log("web reporting: 18 assertions passed; Desktop renderer, selected sections, period range, 12-row historical window and verified Rack Unit image embedding covered");
