/**
 * Site Comparison regression suite.
 * Reads real source workbooks only. Source hashes must match before and after.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { calculateEnergyCostForMonth, normalizedMonth } from "../src/utils/energyCost";
import {
  buildFacilityComparisonMetrics,
  getComparisonDisplayMonths,
  getComparisonMonths,
  getDefaultComparisonReferenceMonth,
  type ComparisonDisplayRange,
} from "../src/utils/facilityComparison";
import { formatCompactLabel, formatNumber } from "../src/utils/numberFormat";
import type { MonthlyLog } from "../src/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tolerance = 1e-8;
let checks = 0;

type Profile = {
  devices: { ups: string[]; dc: string[] };
  air: { fields: string[] };
};

function check(name: string, condition: unknown, detail = ""): void {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ""}`);
  checks++;
  console.log(`  PASS  ${name}`);
}

function equal(left: number | null, right: number | null): boolean {
  return left === null || right === null ? left === right : Math.abs(left - right) <= tolerance;
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function calendarStart(referenceMonth: string, range: ComparisonDisplayRange): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - range, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function loadProfile(id: string): Promise<Profile> {
  return JSON.parse(await fs.readFile(path.join(root, "config", id, "profile.json"), "utf8")) as Profile;
}

async function main(): Promise<void> {
  console.log("Site Comparison real-workbook regression checks");
  const rangsitPath = path.join(root, "DC_Rangsit.xlsm");
  const srinakarinPath = path.join(root, "DC_Srinakarin.xlsm");
  const hashesBefore = await Promise.all([sha256(rangsitPath), sha256(srinakarinPath)]);

  const [rangsitProfile, srinakarinProfile] = await Promise.all([
    loadProfile("rangsit"),
    loadProfile("srinakarin"),
  ]);
  const [rangsit, srinakarin] = await Promise.all([
    readWorkbookFromFile(rangsitPath, {
      upsIds: rangsitProfile.devices.ups,
      dcIds: rangsitProfile.devices.dc,
      airFields: rangsitProfile.air.fields,
    }),
    readWorkbookFromFile(srinakarinPath, {
      upsIds: srinakarinProfile.devices.ups,
      dcIds: srinakarinProfile.devices.dc,
      airFields: srinakarinProfile.air.fields,
    }),
  ]);

  check("Rangsit source workbook parsed", rangsit.validation.ok && rangsit.logs.length > 0);
  check("Srinakarin source workbook parsed", srinakarin.validation.ok && srinakarin.logs.length > 0);
  check("facility histories are distinct arrays", rangsit.logs !== srinakarin.logs);
  check("Rangsit has no Srinakarin-only air meters", rangsit.logs.every(log => log.air.meters?.eb43a === undefined && log.air.meters?.eb44a === undefined));
  check("Srinakarin retains configured EB43/EB44 meters", srinakarin.logs.some(log => log.air.meters?.eb43a !== undefined || log.air.meters?.eb44a !== undefined));

  const histories = [
    { id: "rangsit", logs: rangsit.logs },
    { id: "srinakarin", logs: srinakarin.logs },
  ];
  const months = getComparisonMonths(histories);
  const referenceMonth = getDefaultComparisonReferenceMonth(histories);
  check("month selector uses real workbook records", months.length > 0 && months.every(month =>
    rangsit.logs.some(log => normalizedMonth(log.month) === month) || srinakarin.logs.some(log => normalizedMonth(log.month) === month)
  ));
  check("reference month is an actual common reporting month", referenceMonth !== null &&
    rangsit.logs.some(log => normalizedMonth(log.month) === referenceMonth) &&
    srinakarin.logs.some(log => normalizedMonth(log.month) === referenceMonth));
  if (!referenceMonth) throw new Error("No reference month available.");

  for (const range of [3, 6, 12] as const) {
    const actual = getComparisonDisplayMonths(months, referenceMonth, range);
    check(`${range}-month range ends at reference month`, actual.at(-1) === referenceMonth);
    check(`${range}-month range contains every calendar month`, actual.length === range && actual[0] === calendarStart(referenceMonth, range));
    check(`${range}-month range has no future month`, actual.every(month => month <= referenceMonth));
  }
  check(
    "missing calendar month remains an explicit chart position",
    JSON.stringify(getComparisonDisplayMonths(["2026-04", "2026-06"], "2026-06", 3)) === JSON.stringify(["2026-04", "2026-05", "2026-06"])
  );

  const withFuture: MonthlyLog[] = [...rangsit.logs, { ...rangsit.logs[0], month: "2099-01" }];
  check("future workbook record is excluded", !getComparisonMonths([{ id: "future", logs: withFuture }]).includes("2099-01"));

  const rangsitMetrics = buildFacilityComparisonMetrics(rangsit.logs);
  const srinakarinMetrics = buildFacilityComparisonMetrics(srinakarin.logs);
  const rangsitExpected = calculateEnergyCostForMonth(rangsit.logs, referenceMonth);
  const srinakarinExpected = calculateEnergyCostForMonth(srinakarin.logs, referenceMonth);
  const rangsitValues = rangsitMetrics.get(referenceMonth);
  const srinakarinValues = srinakarinMetrics.get(referenceMonth);
  check("Rangsit reference record exists", rangsitValues !== undefined);
  check("Srinakarin reference record exists", srinakarinValues !== undefined);
  if (!rangsitValues || !srinakarinValues) throw new Error("Reference metrics are missing.");

  const rangsitLog = rangsit.logs.find(log => normalizedMonth(log.month) === referenceMonth);
  const srinakarinLog = srinakarin.logs.find(log => normalizedMonth(log.month) === referenceMonth);
  if (!rangsitLog || !srinakarinLog) throw new Error("Reference logs are missing.");

  for (const [site, values, expected, log] of [
    ["Rangsit", rangsitValues, rangsitExpected, rangsitLog],
    ["Srinakarin", srinakarinValues, srinakarinExpected, srinakarinLog],
  ] as const) {
    check(`${site} whole-building energy maps from its own workbook`, values.buildingEnergy === log.energyCost.buildingEnergyKwh);
    check(`${site} whole-building cost maps from its own workbook`, values.buildingCost === log.energyCost.buildingElectricityCostThb);
    check(`${site} Floor 4 energy maps from configured calculation`, equal(values.floorEnergy, expected.floorEnergyKwh));
    check(`${site} Floor 4 cost maps from authoritative workbook value or configured calculation`, equal(values.floorCost, log.energyCost.floorElectricityCostThb ?? expected.floorElectricityCostThb));
    check(`${site} average rate maps from authoritative workbook value or building cost / energy`, equal(values.avgRate, log.energyCost.averageElectricityRateThbPerKwh ?? expected.averageElectricityRateThbPerKwh));
    check(`${site} Floor 4 share uses Floor 4 / whole-building energy`, equal(values.floorShare, expected.energySharePercent));
    if (values.buildingEnergy !== null && values.buildingCost !== null && values.buildingEnergy !== 0) {
      check(`${site} average-rate formula`, equal(values.avgRate, values.buildingCost / values.buildingEnergy));
    }
    if (values.floorEnergy !== null && values.buildingEnergy !== null && values.buildingEnergy !== 0) {
      check(`${site} Floor 4 share formula`, equal(values.floorShare, values.floorEnergy / values.buildingEnergy * 100));
    }
  }

  check("chart energy series remains Rangsit-specific", equal(rangsitMetrics.get(referenceMonth)?.buildingEnergy ?? null, rangsitExpected.buildingEnergyKwh));
  check("chart energy series remains Srinakarin-specific", equal(srinakarinMetrics.get(referenceMonth)?.buildingEnergy ?? null, srinakarinExpected.buildingEnergyKwh));
  check("chart Floor 4 cost series remains Rangsit-specific", equal(rangsitMetrics.get(referenceMonth)?.floorCost ?? null, rangsitLog.energyCost.floorElectricityCostThb ?? rangsitExpected.floorElectricityCostThb));
  check("chart Floor 4 cost series remains Srinakarin-specific", equal(srinakarinMetrics.get(referenceMonth)?.floorCost ?? null, srinakarinLog.energyCost.floorElectricityCostThb ?? srinakarinExpected.floorElectricityCostThb));

  const missingRangsit = buildFacilityComparisonMetrics(rangsit.logs.filter(log => normalizedMonth(log.month) !== referenceMonth));
  check("missing month has no comparison metric", missingRangsit.get(referenceMonth) === undefined);
  check("missing month is not converted to false zero", missingRangsit.get(referenceMonth)?.buildingEnergy !== 0);

  const compactCases: Array<[number, string]> = [
    [950, "950"],
    [1250, "1.25K"],
    [12500, "12.5K"],
    [609434.96, "609.43K"],
    [900330.23, "900.33K"],
    [1050000, "1.05M"],
    [2329240.75, "2.33M"],
    [11343600.26, "11.34M"],
    [1000000000, "1B"],
  ];
  for (const [value, expected] of compactCases) {
    check(`compact label ${value}`, formatCompactLabel(value) === expected, `${formatCompactLabel(value)} !== ${expected}`);
  }
  check("tooltip formatter retains full grouped precision", formatNumber(2329240.75) === "2,329,240.75");

  const hashesAfter = await Promise.all([sha256(rangsitPath), sha256(srinakarinPath)]);
  check("DC_Rangsit.xlsm unchanged", hashesBefore[0] === hashesAfter[0], `${hashesBefore[0]} != ${hashesAfter[0]}`);
  check("DC_Srinakarin.xlsm unchanged", hashesBefore[1] === hashesAfter[1], `${hashesBefore[1]} != ${hashesAfter[1]}`);
  console.log(`\n${checks} Site Comparison checks passed.`);
}

void main();
