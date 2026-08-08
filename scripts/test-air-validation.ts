import { listMissingFields } from "../src/utils/completion";
import { createEmptyLog, logsToRows, parseSafeNumber, rowsToLogs } from "../src/excel/SheetMapper";

function assert(name: string, condition: boolean): void {
  if (!condition) throw new Error(name);
  console.log(`PASS  ${name}`);
}

const devices = {
  upsIds: [],
  dcIds: [],
  airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"]
};
const log = createEmptyLog("2026-07", devices);
// EB41 values are canonical top-level fields; configured EB43/EB44 values
// are canonical meters. Stale legacy copies must not affect validation.
log.air = {
  eb41a: "1.25" as unknown as number,
  eb41b: "0" as unknown as number,
  eb42a: null,
  eb42b: null,
  eb43a: null,
  eb43b: null,
  eb44a: null,
  eb44b: null,
  meters: {
    eb41a: null,
    eb41b: null,
    eb43a: "2.5" as unknown as number,
    eb43b: "0" as unknown as number,
    eb44a: "3.75" as unknown as number,
    eb44b: "4" as unknown as number
  }
};

const missing = listMissingFields(log, devices.airFields).map(field => field.label);
assert("decimal EB41A is valid", !missing.includes("EB41A (GWh)"));
assert("zero EB41B is valid", !missing.includes("EB41B (GWh)"));
assert("decimal EB43A and EB44A are valid", !missing.includes("EB43A (GWh)") && !missing.includes("EB44A (GWh)"));
assert("zero EB43B is valid", !missing.includes("EB43B (GWh)"));
assert("numeric EB44B is valid", !missing.includes("EB44B (GWh)"));
assert("numeric strings parse", parseSafeNumber("1.25") === 1.25 && parseSafeNumber("0") === 0);
assert("blank and non-finite values remain invalid", parseSafeNumber(" ") === null && parseSafeNumber("Infinity") === null);

const rows = logsToRows([log], devices);
const exported = rows.AIR[0].values as Record<string, string | number | null>;
assert("Excel export uses canonical EB41A", rows.AIR[0].values.eb41a === "1.25");
assert("Excel export uses canonical EB41B", rows.AIR[0].values.eb41b === "0");
assert("Excel export maps EB43 and EB44 meters", exported.eb43a === "2.5" && exported.eb43b === "0" && exported.eb44a === "3.75" && exported.eb44b === "4");
const reloaded = rowsToLogs(rows, devices)[0];
assert("saved EB41A persists after reload", reloaded.air.eb41a === 1.25);
assert("saved EB41B persists after reload", reloaded.air.eb41b === 0);
assert("saved EB43 and EB44 meters persist after reload", reloaded.air.meters?.eb43a === 2.5 && reloaded.air.meters?.eb43b === 0 && reloaded.air.meters?.eb44a === 3.75 && reloaded.air.meters?.eb44b === 4);

// Site-aware regression guard: a Rangsit profile must ignore stale Srinakarin
// meter keys that may still be present on a reused in-memory record.
const rangsitFields = ["eb41a", "eb41b", "eb42a", "eb42b"];
const rangsitLog = createEmptyLog("2026-07", { upsIds: [], dcIds: [], airFields: rangsitFields });
rangsitLog.air.meters = { eb43a: null, eb43b: null, eb44a: null, eb44b: null };
rangsitLog.air.eb41a = 1;
rangsitLog.air.eb41b = 2;
rangsitLog.air.eb42a = 3;
rangsitLog.air.eb42b = 4;
const rangsitAirMissing = listMissingFields(rangsitLog, rangsitFields)
  .filter(field => field.section === "air")
  .map(field => field.label);
assert("Rangsit validation ignores stale EB43/EB44 keys", rangsitAirMissing.length === 0 && !rangsitAirMissing.some(label => /EB43|EB44/.test(label)));
