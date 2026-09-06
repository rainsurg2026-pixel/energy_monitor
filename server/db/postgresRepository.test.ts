import assert from "node:assert/strict";
import { PostgresRepository } from "./postgresRepository";

type QueryCall = { text: string; values?: readonly unknown[] };

const calls: QueryCall[] = [];
const client = {
  async query(text: string, values?: readonly unknown[]) {
    calls.push({ text, values });
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
    if (text.includes("SELECT id, code FROM sites")) return { rows: [{ id: "1", code: "rangsit" }] };
    if (text.includes("SELECT id, row_version FROM monthly_periods")) return { rows: [] };
    if (text.includes("INSERT INTO monthly_periods")) return { rows: [{ id: "7", row_version: 1 }] };
    if (text.includes("INSERT INTO devices") || text.includes("INSERT INTO air_meters") || text.includes("INSERT INTO dc_panels")) return { rows: [{ id: "9" }] };
    if (text.includes("FROM monthly_periods p LEFT JOIN energy_cost_inputs")) return { rows: [{ id: "7", period_month: "2026-07-01", building_energy_kwh: null, building_cost_thb: null, last_saved_ups: "2026-07-15T06:30:00.000Z", last_saved_air: "2026-07-15T06:30:00.000Z", last_saved_dc: "2026-07-15T06:30:00.000Z", last_saved_energy_cost: "2026-07-15T06:30:00.000Z" }] };
    if (text.includes("FROM air_meter_readings")) return { rows: [{ period_id: "7", code: "eb42b", reading: "9.2478576" }] };
    return { rows: [] };
  },
  release() {}
};

const pool = {
  async connect() { return client; },
  query: client.query.bind(client)
};

const repository = new PostgresRepository(pool as never);
await repository.saveMonthlyLog({
  siteId: 1,
  expectedRowVersion: null,
  correlationId: "timestamps-test",
  log: {
    month: "2026-07",
    ups: [],
    air: { eb41a: null, eb41b: null, eb42a: null, eb42b: 9.3251728, meters: {} },
    dc: [],
    energyCost: { buildingEnergyKwh: null, buildingElectricityCostThb: null },
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null
  }
});

const timestampUpdate = calls.find(call => call.text.includes("last_saved_ups = now()"));
assert.ok(timestampUpdate, "monthly save advances all Desktop section timestamps");
assert.match(timestampUpdate!.text, /last_saved_air = now\(\)/);
assert.match(timestampUpdate!.text, /last_saved_dc = now\(\)/);
assert.match(timestampUpdate!.text, /last_saved_energy_cost = now\(\)/);
const airInsert = calls.find(call => call.text.includes("INSERT INTO air_meter_readings") && (call.values?.[4] as { code?: string } | undefined)?.code === "eb42b");
assert.equal(airInsert?.values?.[3], 9.3251728, "repository preserves Air meter readings up to seven decimals");
assert.deepEqual(airInsert?.values?.[4], { code: "eb42b", reading: 9.3251728 }, "raw_inputs uses the same preserved seven-decimal Air value");

const readBack = await repository.getMonthlyLogs(1, ["2026-07"]);
assert.equal(readBack[0]?.lastSavedUps, "2026-07-15T06:30:00.000Z");
assert.equal(readBack[0]?.lastSavedEnergyCost, "2026-07-15T06:30:00.000Z");
assert.equal(readBack[0]?.air.eb42b, 9.2478576, "legacy imported Air readings preserve source precision on read");

const selectSource = await import("node:fs/promises").then(fs => fs.readFile(new URL("./postgresRepository.ts", import.meta.url), "utf8"));
assert.match(selectSource, /p\.last_saved_ups/);
assert.match(selectSource, /lastSavedEnergyCost: row\.last_saved_energy_cost/);

console.log("postgres repository: timestamps and max-seven-decimal Air precision are persisted/read back");
