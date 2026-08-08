import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { saveWorkbook } from "../src/excel/WorkbookWriter";
import { listMissingFields } from "../src/utils/completion";
import { getAirValue } from "../src/utils/energyCost";
import type { MonthlyLog } from "../src/types";

const workDir = path.resolve("dist-electron/test-work/srinakarin-air-save");
const srinakarinSource = path.resolve("DC_Srinakarin.xlsm");
const rangsitSource = path.resolve("DC_Rangsit.xlsm");
const srinakarinTarget = path.join(workDir, "DC_Srinakarin.xlsm");
const rangsitTarget = path.join(workDir, "DC_Rangsit.xlsm");
const rangsitSaveAllTarget = path.join(workDir, "DC_Rangsit-save-all.xlsm");
const saveAllValidationTarget = path.join(workDir, "DC_Srinakarin-save-all-validation.xlsm");

const srinakarinDevices = {
  upsIds: ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"],
  dcIds: ["DC PDB41A", "DC PDB41B"],
  airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"]
};
const srinakarinAirFields = srinakarinDevices.airFields;
const rangsitDevices = {
  upsIds: ["UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A (PPC44A)", "UPS 15B (PPC44B)"],
  dcIds: ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"],
  airFields: ["eb41a", "eb41b", "eb42a", "eb42b"]
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function airValues(log: MonthlyLog): Array<number | null> {
  return srinakarinAirFields.map(field => getAirValue(log, field));
}

function requireMonth(logs: MonthlyLog[], month: string, label: string): MonthlyLog {
  const log = logs.find(item => item.month === month);
  if (!log) throw new Error(`${label}: month ${month} is missing.`);
  return log;
}

function assertAir(log: MonthlyLog, expected: number[], label: string): void {
  const actual = airValues(log);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function rangsitAirValues(log: MonthlyLog): Array<number | null> {
  return rangsitDevices.airFields.map(field => getAirValue(log, field));
}

function assertRangsitAir(log: MonthlyLog, expected: number[], label: string): void {
  const actual = rangsitAirValues(log);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

async function sha256(filePath: string): Promise<string> {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
const productionHashesBefore = {
  rangsit: await sha256(rangsitSource),
  srinakarin: await sha256(srinakarinSource)
};
await fs.copyFile(srinakarinSource, srinakarinTarget);

const srinakarinBefore = await readWorkbookFromFile(srinakarinTarget, srinakarinDevices);
const july = clone(requireMonth(srinakarinBefore.logs, "2026-07", "Srinakarin July fixture"));
july.air = {
  ...july.air,
  eb41a: 701,
  eb41b: 702,
  meters: { ...(july.air.meters ?? {}), eb43a: 705, eb43b: 706, eb44a: 707, eb44b: 708 }
};
const expectedJuly = [701, 702, 705, 706, 707, 708];

const firstSaveLogs = srinakarinBefore.logs
  .filter(log => log.month !== "2026-07")
  .concat(july)
  .sort((a, b) => a.month.localeCompare(b.month));
await saveWorkbook(srinakarinTarget, firstSaveLogs, {
  backupDir: null,
  backupKeep: 0,
  devices: srinakarinDevices,
  scope: "air"
});

const srinakarinAfter = await readWorkbookFromFile(srinakarinTarget, srinakarinDevices);
assertAir(requireMonth(srinakarinAfter.logs, "2026-07", "Srinakarin July readback"), expectedJuly, "Srinakarin July six Air values");

// A second Srinakarin month exercises the same section-scoped path on an
// existing month.
const juneAfterReload = clone(requireMonth(srinakarinAfter.logs, "2026-06", "Srinakarin June fixture"));
juneAfterReload.air.eb41a = 611;
juneAfterReload.air.eb41b = 612;
juneAfterReload.air.meters!.eb43a = 613;
juneAfterReload.air.meters!.eb43b = 614;
juneAfterReload.air.meters!.eb44a = 615;
juneAfterReload.air.meters!.eb44b = 616;
const juneSaveLogs = srinakarinAfter.logs
  .filter(log => log.month !== "2026-06")
  .concat(juneAfterReload)
  .sort((a, b) => a.month.localeCompare(b.month));
await saveWorkbook(srinakarinTarget, juneSaveLogs, {
  backupDir: null,
  backupKeep: 0,
  devices: srinakarinDevices,
  scope: "air"
});
const afterJuneSave = await readWorkbookFromFile(srinakarinTarget, srinakarinDevices);
assertAir(requireMonth(afterJuneSave.logs, "2026-06", "Srinakarin June readback"), [611, 612, 613, 614, 615, 616], "Srinakarin June six Air values");

// A second July save exercises the normal post-reload path.
const julyAfterReload = clone(requireMonth(afterJuneSave.logs, "2026-07", "Srinakarin July second-save fixture"));
julyAfterReload.air.meters!.eb44b = 708.5;
const secondSaveLogs = afterJuneSave.logs
  .filter(log => log.month !== "2026-07")
  .concat(julyAfterReload)
  .sort((a, b) => a.month.localeCompare(b.month));
await saveWorkbook(srinakarinTarget, secondSaveLogs, {
  backupDir: null,
  backupKeep: 0,
  devices: srinakarinDevices,
  scope: "air"
});
const srinakarinSecondRead = await readWorkbookFromFile(srinakarinTarget, srinakarinDevices);
assertAir(requireMonth(srinakarinSecondRead.logs, "2026-07", "Srinakarin July second readback"), [701, 702, 705, 706, 707, 708.5], "Srinakarin July second-save six Air values");

// Save All must retain the strict PPC43 dependency check. The production July
// Dashboard-FAC cache is stale in this fixture, so a full save is expected to
// stop during validation before any file replacement.
await fs.copyFile(srinakarinSource, saveAllValidationTarget);
let saveAllPpc43Rejected = false;
try {
  await saveWorkbook(saveAllValidationTarget, srinakarinBefore.logs, { backupDir: null, backupKeep: 0, devices: srinakarinDevices });
} catch (error) {
  saveAllPpc43Rejected = error instanceof Error && /Dashboard-FAC PPC 43A current is incomplete/.test(error.message);
}
if (!saveAllPpc43Rejected) throw new Error("Save All did not retain the strict PPC43 validation failure on the stale July workbook.");

// Rangsit regression guard: its profile-specific four-field Air path still
// validates, saves, and reloads. Include stale Srinakarin-only keys to prove
// the active profile controls required-field generation.
await fs.copyFile(rangsitSource, rangsitTarget);
const rangsitBefore = await readWorkbookFromFile(rangsitTarget, rangsitDevices);
const rangsitMonth = clone(requireMonth(rangsitBefore.logs, "2026-06", "Rangsit Air fixture"));
rangsitMonth.month = "2026-07";
const rangsitExpected = [
  (rangsitMonth.air.eb41a ?? 0) + 0.101,
  (rangsitMonth.air.eb41b ?? 0) + 0.202,
  (rangsitMonth.air.eb42a ?? 0) + 0.303,
  (rangsitMonth.air.eb42b ?? 0) + 0.404
];
rangsitMonth.air.eb41a = rangsitExpected[0];
rangsitMonth.air.eb41b = rangsitExpected[1];
rangsitMonth.air.eb42a = rangsitExpected[2];
rangsitMonth.air.eb42b = rangsitExpected[3];
rangsitMonth.air.meters = { eb43a: null, eb43b: null, eb44a: null, eb44b: null };
const rangsitAirMissing = listMissingFields(rangsitMonth, rangsitDevices.airFields)
  .filter(field => field.section === "air")
  .map(field => field.label);
if (rangsitAirMissing.length !== 0 || rangsitAirMissing.some(label => /EB43|EB44/.test(label))) {
  throw new Error(`Rangsit Air validation used the wrong profile: ${JSON.stringify(rangsitAirMissing)}`);
}
const rangsitLogs = rangsitBefore.logs
  .filter(log => log.month !== rangsitMonth.month)
  .concat(rangsitMonth)
  .sort((a, b) => a.month.localeCompare(b.month));
await saveWorkbook(rangsitTarget, rangsitLogs, { backupDir: null, backupKeep: 0, devices: rangsitDevices, scope: "air" });
const rangsitAfter = await readWorkbookFromFile(rangsitTarget, rangsitDevices);
assertRangsitAir(requireMonth(rangsitAfter.logs, rangsitMonth.month, "Rangsit Air readback"), rangsitExpected, "Rangsit Save AIR four values");

// The same complete four-meter record must also pass the full Save All writer
// path; this guards against a site profile being lost between section save and
// the toolbar batch save.
await fs.copyFile(rangsitSource, rangsitSaveAllTarget);
await saveWorkbook(rangsitSaveAllTarget, rangsitLogs, { backupDir: null, backupKeep: 0, devices: rangsitDevices });
const rangsitSaveAllRead = await readWorkbookFromFile(rangsitSaveAllTarget, rangsitDevices);
assertRangsitAir(requireMonth(rangsitSaveAllRead.logs, rangsitMonth.month, "Rangsit Save All readback"), rangsitExpected, "Rangsit Save All four values");

const productionHashesAfter = {
  rangsit: await sha256(rangsitSource),
  srinakarin: await sha256(srinakarinSource)
};
if (JSON.stringify(productionHashesBefore) !== JSON.stringify(productionHashesAfter)) {
  throw new Error("Production workbooks changed during the Air persistence test.");
}

console.log(JSON.stringify({
  srinakarinJuly: [701, 702, 705, 706, 707, 708.5],
  srinakarinJune: [611, 612, 613, 614, 615, 616],
  rangsitAir: rangsitExpected,
  rangsitSaveAllAir: rangsitExpected,
  saveAllPpc43Rejected,
  productionWorkbooksUnchanged: true
}));
