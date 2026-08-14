/**
 * Regression suite for the UPS History pipeline: GET /history may compute
 * missing derived rows for compatibility with older imports, but it must not
 * write to the database. Durable rows are produced by the transactional save
 * path. This suite exercises the real behavior through ApiService +
 * InMemoryRepository (the same classes the HTTP layer uses), not a
 * reimplementation of the calculation.
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-ups-group-history-sync.ts
 */
import assert from "node:assert/strict";
import { ApiService } from "../server/services/apiService";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import type { MonthlyLog, UpsRecord } from "../src/types";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

function ups(id: string, loadKw: number, loadKva: number): UpsRecord {
  return { upsId: id, voltage: 220, current: loadKw, loadKw, loadKva };
}

function rangsitLog(month: string, scale = 1): MonthlyLog {
  return {
    month,
    ups: [
      ups("UPS 11A", 50 * scale, 52 * scale), ups("UPS 11B", 50 * scale, 52 * scale),
      ups("UPS 13A", 30 * scale, 31 * scale), ups("UPS 13B", 30 * scale, 31 * scale),
      ups("UPS 14C", 10 * scale, 11 * scale),
      ups("UPS 15A (PPC44A)", 20 * scale, 21 * scale), ups("UPS 15B (PPC44B)", 20 * scale, 21 * scale)
    ],
    air: { eb41a: 100, eb41b: 200, eb42a: 300, eb42b: 400 },
    dc: [],
    energyCost: { buildingEnergyKwh: 1000, buildingElectricityCostThb: 5000 },
    lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
  };
}

function srinakarinLog(month: string): MonthlyLog {
  return {
    month,
    ups: [
      ups("UPS41A", 25, 26), ups("UPS41B", 25, 26),
      ups("PPC41A", 40, 41), ups("PPC41B", 40, 41),
      ups("PPC42A", 15, 16), ups("PPC42B", 15, 16),
      ups("PPC43A", 35, 35), ups("PPC43B", 35, 35),
      ups("PPC44A", 7, 7), ups("PPC44B", 7, 7)
    ],
    air: { eb41a: 10, eb41b: 20, eb42a: null, eb42b: null, eb43a: 30, eb43b: 40, eb44a: 50, eb44b: 60 },
    dc: [],
    energyCost: { buildingEnergyKwh: 500, buildingElectricityCostThb: 2500 },
    lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
  };
}

function buildRepository(): InMemoryRepository {
  return new InMemoryRepository({
    sites: [
      { id: 8, code: "rangsit", name: "Rangsit", active: true },
      { id: 9, code: "srinakarin", name: "Srinakarin", active: true },
      { id: 99, code: "unmapped-facility", name: "Unmapped Facility", active: true }
    ],
    logs: {
      // Simulates real pre-existing data: months already saved (e.g. via a
      // prior import or an earlier version of the app) with NO
      // ups_group_history rows at all - the exact bug state confirmed live
      // in Preview (ups_group_history had zero rows while monthly_periods
      // had 134).
      8: [rangsitLog("2026-03"), rangsitLog("2026-04", 1.1)],
      9: [srinakarinLog("2026-03")],
      99: [rangsitLog("2026-03")]
    },
    settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 },
    upsGroupHistory: {}
  });
}

async function main(): Promise<void> {
  console.log("UPS Group History sync (read-only compatibility + incremental save) checks");

  // 1. Read-only compatibility: months already saved before the writer existed
  // must still surface real computed UPS Group History on the next History
  // read, without turning that GET into a database write.
  {
    const repository = buildRepository();
    const api = new ApiService(repository, () => new Date("2026-05-15T00:00:00.000Z"));
    const history = await api.getHistory(8) as { upsGroupHistory: { rows: Array<{ facility: string; month: string; group: string; totalLoadKw: number; totalLoadKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }> } };
    const rows = history.upsGroupHistory.rows;
    check("Rangsit March 2026 backfill produces all 4 configured UPS groups", rows.filter(r => r.month === "2026-03").length === 4);
    const ups11 = rows.find(r => r.month === "2026-03" && r.group === "UPS 11");
    check("UPS 11 (11A+11B) totals 100 kW / 104 kVA - matches Rangsit's real profile.json topology", ups11?.totalLoadKw === 100 && ups11?.totalLoadKva === 104);
    check("UPS 11 load% is computed against its real 400 kVA capacity (26%)", Math.abs((ups11?.loadPercent ?? 0) - 26) < 0.001);
    check("UPS 11 monthly energy uses the real days-in-March (31) - 100kW*24*31", ups11?.monthlyEnergyKwh === 100 * 24 * 31);
    const ups14 = rows.find(r => r.month === "2026-03" && r.group === "UPS 14");
    check("UPS 14 (single-device group, 14C only) totals 10 kW / 11 kVA against its 120 kVA capacity", ups14?.totalLoadKw === 10 && ups14?.totalLoadKva === 11 && ups14?.capacity === 120);
    check("every backfilled row is tagged with the real facility code (rangsit), never fabricated", rows.every(r => r.facility === "rangsit"));
    check("the second available month (April) is backfilled too, not just the first", rows.some(r => r.month === "2026-04"));

    const persistedAfterRead = await repository.getUpsGroupHistory(8);
    check("GET /history does not persist computed UPS Group History rows", persistedAfterRead.length === 0);
    const historyAgain = await api.getHistory(8) as typeof history;
    check("a second read deterministically returns the same computed rows", historyAgain.upsGroupHistory.rows.length === rows.length);
  }

  // 2. Facility isolation: Srinakarin's real (different) topology - do not
  // assume it shares Rangsit's groups.
  {
    const repository = buildRepository();
    const api = new ApiService(repository, () => new Date("2026-05-15T00:00:00.000Z"));
    const rangsitHistory = await api.getHistory(8) as { upsGroupHistory: { rows: Array<{ facility: string; group: string }> } };
    const srinakarinHistory = await api.getHistory(9) as { upsGroupHistory: { rows: Array<{ facility: string; group: string; totalLoadKw: number; totalLoadKva: number }> } };
    check("Srinakarin computed response produces its own 5 configured groups (UPS41 + PPC41-44), not Rangsit's 4", srinakarinHistory.upsGroupHistory.rows.length === 5);
    check("Srinakarin rows are all tagged facility=srinakarin, never rangsit", srinakarinHistory.upsGroupHistory.rows.every(r => r.facility === "srinakarin"));
    check("Rangsit's getHistory response contains zero srinakarin-facility rows", rangsitHistory.upsGroupHistory.rows.every(r => r.facility === "rangsit"));
    check("Rangsit's getHistory response contains no PPC-named groups (Srinakarin-only naming)", rangsitHistory.upsGroupHistory.rows.every(r => !r.group.startsWith("PPC")));
    const ppc41 = srinakarinHistory.upsGroupHistory.rows.find(r => r.group === "PPC 41");
    check("PPC 41 (41A no-space device codes normalized) totals 80 kW / 82 kVA", ppc41?.totalLoadKw === 80 && ppc41?.totalLoadKva === 82);
  }

  // 3. A facility with no known UPS group topology must never fabricate
  // rows - History stays genuinely empty, not a guessed/borrowed topology.
  {
    const repository = buildRepository();
    const api = new ApiService(repository, () => new Date("2026-05-15T00:00:00.000Z"));
    const history = await api.getHistory(99) as { upsGroupHistory: { rows: unknown[] } };
    check("a facility with no configured UPS group topology gets zero fabricated rows", history.upsGroupHistory.rows.length === 0);
  }

  // 4. Computed compatibility rows never overwrite a pre-existing row (same
  // guarantee Desktop gives via its overwriteExisting=false path).
  {
    const repository = buildRepository();
    await repository.saveUpsGroupHistoryRows(8, "rangsit", [{ month: "2026-03", group: "UPS 11", totalLoadKw: -1, totalLoadKva: -1, capacity: 1, loadPercent: 0, availablePercent: 100, monthlyEnergyKwh: 0 }], true);
    const api = new ApiService(repository, () => new Date("2026-05-15T00:00:00.000Z"));
    const history = await api.getHistory(8) as { upsGroupHistory: { rows: Array<{ month: string; group: string; totalLoadKw: number }> } };
    const ups11March = history.upsGroupHistory.rows.find(r => r.month === "2026-03" && r.group === "UPS 11");
    check("computed compatibility never overwrites a row for that (site, month, group) key", ups11March?.totalLoadKw === -1);
  }

  // 5. Incremental save: editing and re-saving a month's UPS readings must
  // update that month's UPS Group History immediately (Desktop parity:
  // UpsGroupHistoryWriter.ts's overwriteExisting=true on-save path), while
  // leaving every other month's history untouched.
  {
    const repository = buildRepository();
    const api = new ApiService(repository, () => new Date("2026-05-15T00:00:00.000Z"));
    await api.getHistory(8); // compute March + April for the response only

    // Establish April through the durable save path so the test proves that
    // saved derived rows remain independent from the later March edit.
    await api.saveMonthlyLog(8, "2026-04", { log: { ...rangsitLog("2026-04", 1.1), energyCalculation: undefined }, expected_row_version: 1 }, "test-correlation-setup");

    const edited = rangsitLog("2026-03", 2); // double every UPS reading
    const saveBody = { log: { ...edited, energyCalculation: undefined }, expected_row_version: null };
    // The fixture month already has data with rowVersion 1 (backfilled via
    // direct log seeding, not through saveMonthlyLog) - InMemoryRepository
    // tracks period versions lazily, so read the live version first via a
    // conflict-free re-save using expected_row_version: null is rejected
    // once a period exists; discover the true version the same way a real
    // client would (a prior successful read/save).
    let saveError: unknown = null;
    try {
      await api.saveMonthlyLog(8, "2026-03", saveBody, "test-correlation-1");
    } catch (error) {
      saveError = error;
    }
    check("saving with a stale/unknown row version is rejected (STALE_VERSION), proving the save path is real, not bypassed", (saveError as { status?: number } | null)?.status === 409);

    // Perform a correctly-versioned save (version 1, since the fixture log
    // was seeded directly rather than through a prior save).
    await api.saveMonthlyLog(8, "2026-03", { log: { ...edited, energyCalculation: undefined }, expected_row_version: 1 }, "test-correlation-2");
    const historyAfterEdit = await api.getHistory(8) as { upsGroupHistory: { rows: Array<{ month: string; group: string; totalLoadKw: number; totalLoadKva: number }> } };
    const ups11AfterEdit = historyAfterEdit.upsGroupHistory.rows.find(r => r.month === "2026-03" && r.group === "UPS 11");
    check("re-saving March with doubled readings immediately doubles UPS 11's UPS Group History totals (200 kW / 208 kVA)", ups11AfterEdit?.totalLoadKw === 200 && ups11AfterEdit?.totalLoadKva === 208);
    const aprilUnaffected = historyAfterEdit.upsGroupHistory.rows.find(r => r.month === "2026-04" && r.group === "UPS 11");
    check("editing March leaves April's already-saved UPS Group History untouched", Math.abs((aprilUnaffected?.totalLoadKw ?? 0) - 110) < 1e-9);
  }

  console.log(`\n${checks} UPS Group History sync checks passed.`);
}

void main();
