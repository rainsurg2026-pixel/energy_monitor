import { listMissingFields } from "../src/utils/completion";
import { readFileSync } from "node:fs";
import { createEmptyLog, logsToRows, parseSafeNumber, rowsToLogs } from "../src/excel/SheetMapper";
import { roundAirMeterReading } from "../src/domain/airMeterPrecision";
import { calculateEnergyCostForMonth } from "../src/domain/energyCost";
import { buildEngineeringDashboardSnapshot } from "../src/domain/engineeringDashboard";
import { parseMonthlyLog } from "../server/services/rawInputValidation";
import { exceedsDecimalPlaces } from "../src/utils/numericInputValidation";

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

// Air meter precision accepts source/user readings up to seven decimal places.
assert("7-decimal Air readings are preserved", roundAirMeterReading(9.2478576) === 9.2478576 && roundAirMeterReading(9.3251728) === 9.3251728);

const julySix = createEmptyLog("2026-07", { upsIds: [], dcIds: [], airFields: rangsitFields });
julySix.air = { eb41a: 19.678136, eb41b: 21.904596, eb42a: 10.287741, eb42b: 9.2478576, meters: {} };
julySix.lastSavedAir = null;
const augustSix = createEmptyLog("2026-08", { upsIds: [], dcIds: [], airFields: rangsitFields });
augustSix.air = { eb41a: 19.763672, eb41b: 21.993352, eb42a: 10.367957, eb42b: 9.325173, meters: {} };
augustSix.lastSavedAir = "2026-09-05T09:48:13.239Z";
const augustSeven = structuredClone(augustSix);
augustSeven.air.eb42b = 9.3251728;
const parsedSeven = parseMonthlyLog(augustSeven, "2026-08");
assert("API validation preserves a 7-decimal Air value", parsedSeven.air.eb42b === 9.3251728);
const parsedAugust = parseMonthlyLog(augustSix, "2026-08");
const roundedAirEnergy = calculateEnergyCostForMonth([julySix, parsedAugust], "2026-08").airEnergyKwh;
assert("Web Air calculation keeps historical source precision while allowing current 6-decimal entry", roundedAirEnergy !== null && Math.abs(roundedAirEnergy - 331823.4) < 1e-6);

// Overall KPI must be derived from the same selected-month Engineering snapshot values.
julySix.energyCalculation = { upsGroups: [], dcIds: [], airFields: rangsitFields };
augustSix.energyCalculation = { upsGroups: [], dcIds: [], airFields: rangsitFields };
augustSix.energyCost = { buildingEnergyKwh: 3_809_000, buildingElectricityCostThb: 14_383_474.32 };
const paritySnapshot = buildEngineeringDashboardSnapshot([julySix, augustSix], "2026-08", null);
assert("Engineering snapshot uses the displayed Air energy in Overall floor energy", paritySnapshot?.airEnergyKwh !== null && paritySnapshot?.floorEnergyKwh !== null && Math.abs((paritySnapshot?.floorEnergyKwh ?? 0) - (paritySnapshot?.airEnergyKwh ?? 0)) < 1e-6);

const correctionMigration = readFileSync(new URL("../db/migrations/013_rangsit_aug_2026_eb42b_correction.sql", import.meta.url), "utf8");
assert("Rangsit Aug-2026 EB42B correction is exact and guarded", correctionMigration.includes("9.3251728") && correctionMigration.includes("9.325173") && correctionMigration.includes("2026-08-01") && correctionMigration.includes("eb42b"));

assert("AC input allows 6 decimal places", !exceedsDecimalPlaces("9.325173", 7));
assert("AC input allows 7 decimal places", !exceedsDecimalPlaces("9.2478576", 7));
assert("AC input rejects an 8th decimal digit", exceedsDecimalPlaces("9.24785768", 7));
assert("AC input guard also rejects pasted values beyond 7 decimals", exceedsDecimalPlaces("19.76367291", 7));

const airTableSource = readFileSync(new URL("../src/components/AirTable.tsx", import.meta.url), "utf8");
assert("AirTable accepts six or seven decimals and blocks the eighth", airTableSource.includes("maxDecimalPlaces={7}") && airTableSource.includes("minimumPrecision={6}"));
assert("AirTable shows a precision warning popup when an 8th decimal is attempted", airTableSource.includes("onPrecisionViolation={() => setPrecisionWarning(true)}") && airTableSource.includes('role="dialog"') && airTableSource.includes("Maximum 7 decimal places"));
