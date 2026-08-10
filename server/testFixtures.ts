import type { MonthlyLog, UpsRecord } from "../src/types";
import { InMemoryRepository } from "./repositories/inMemoryRepository";

function upsRecords(): UpsRecord[] {
  return [
    ["UPS 11A", 10], ["UPS 11B", 20], ["UPS 13A", 5], ["UPS 13B", 15], ["UPS 14C", 4], ["UPS 15A (PPC44A)", 8], ["UPS 15B (PPC44B)", 12]
  ].map(([upsId, loadKw]) => ({ upsId: String(upsId), voltage: 220, current: Number(loadKw), loadKw: Number(loadKw), loadKva: Number(loadKw) + 2 }));
}

export function fixtureLog(month: string, airOffset: number, buildingEnergyKwh: number, buildingCostThb: number): MonthlyLog {
  return {
    month,
    ups: upsRecords(),
    air: { eb41a: 100 + airOffset, eb41b: 200 + airOffset, eb42a: 300 + airOffset, eb42b: 400 + airOffset },
    dc: [
      { panelId: "DC PDB41A", voltage: 48, current: 10 },
      { panelId: "DC PDB41B", voltage: 48, current: 20 },
      { panelId: "DC PDB42A", voltage: 48, current: 30 },
      { panelId: "DC PDB42B", voltage: 48, current: 40 }
    ],
    energyCost: { buildingEnergyKwh, buildingElectricityCostThb: buildingCostThb },
    lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
  };
}

export function apiTestRepository(readOnly = false): InMemoryRepository {
  void readOnly;
  return new InMemoryRepository({
    sites: [
      { id: 1, code: "site-a", name: "Site A", active: true },
      { id: 2, code: "site-b", name: "Site B", active: true }
    ],
    logs: {
      1: [fixtureLog("2025-12", 10, 90000, 450000), fixtureLog("2026-01", 14, 100000, 500000), fixtureLog("2026-12", 99, 999999, 999999)],
      2: [fixtureLog("2026-02", 20, 120000, 600000)]
    },
    settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
    rackUnitSnapshots: { "1:2026-01": { month: "2026-01", rowVersion: 1, totalU: 400, usedU: 350 } },
    upsGroupHistory: {
      1: [
        // Outside the configured Display Period (starts 2026-01) - must be
        // filtered out of the API response, not treated as missing data.
        { facility: "site-a", month: "2025-12", group: "UPS 11", totalLoadKw: 25, totalLoadKva: 28, capacity: 400, loadPercent: 6.25, availablePercent: 93.75, monthlyEnergyKwh: 18000, generatedAt: "2025-12-31T00:00:00.000Z", dataVersion: 1 },
        { facility: "site-a", month: "2026-01", group: "UPS 11", totalLoadKw: 30, totalLoadKva: 34, capacity: 400, loadPercent: 7.5, availablePercent: 92.5, monthlyEnergyKwh: 21600, generatedAt: "2026-01-31T00:00:00.000Z", dataVersion: 1 }
      ]
      // Site 2 deliberately has no UPS Group History rows - covers the
      // genuinely-empty-history case and (combined with site 1's rows)
      // facility isolation.
    }
  });
}
