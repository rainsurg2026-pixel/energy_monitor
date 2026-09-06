/**
 * Verifies the application and persisted Energy sheet use Dashboard-FAC's
 * electricity-cost equations: F32 = C32/B32 and E32 = F32*D32.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import { roundAirMeterReading } from "../src/domain/airMeterPrecision";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { patchWorkbookBuffer } from "../src/excel/WorkbookWriter";
import {
  calculateAverageElectricityRate,
  calculateEnergyCostForMonth,
  calculateFloorElectricityCost,
  normalizedMonth
} from "../src/utils/energyCost";

const workbookPath = "DC_Rangsit.xlsm";
const srinakarinWorkbookPath = "DC_Srinakarin.xlsm";
const month = "2026-01";
const tolerance = 1e-8;

function assert(name: string, condition: boolean): void {
  if (!condition) throw new Error(name);
  console.log(`PASS  ${name}`);
}

function equal(left: number | null, right: number | null): boolean {
  return left === null || right === null ? left === right : Math.abs(left - right) <= tolerance;
}

function formulaResult(value: ExcelJS.CellValue): number | null {
  if (typeof value === "object" && value !== null && "result" in value) {
    return typeof value.result === "number" ? value.result : null;
  }
  return null;
}

function formulaText(value: ExcelJS.CellValue): string {
  return typeof value === "object" && value !== null && "formula" in value ? value.formula : "";
}

function monthValue(value: ExcelJS.CellValue): string | null {
  const resolved = typeof value === "object" && value !== null && "result" in value ? value.result : value;
  if (resolved instanceof Date) {
    return `${resolved.getUTCFullYear()}-${String(resolved.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return normalizedMonth(String(resolved ?? ""));
}

const parsed = await readWorkbookFromFile(workbookPath);
const calculation = calculateEnergyCostForMonth(parsed.logs, month);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const dashboard = workbook.getWorksheet("Dashboard-FAC");
if (!dashboard) throw new Error("Dashboard-FAC is missing.");

assert("Dashboard-FAC active month is the regression month", monthValue(dashboard.getCell("A32").value) === month);
const dashboardAverageRate = formulaResult(dashboard.getCell("F32").value);
const dashboardFloorEnergy = formulaResult(dashboard.getCell("D32").value);
const dashboardFloorCost = formulaResult(dashboard.getCell("E32").value);
if (dashboardAverageRate !== null && dashboardFloorEnergy !== null && dashboardFloorCost !== null) {
  assert("Average rate matches Dashboard-FAC F32", equal(calculation.averageElectricityRateThbPerKwh, dashboardAverageRate));

  // Legacy Desktop workbooks can contain Air meter values beyond six decimals
  // even though the user-facing entry contract is six decimals. Rebuild the Air
  // energy independently from the visible six-decimal values; Web/PDF/Excel must
  // follow this normalized result rather than the old cached Dashboard-FAC residue.
  const currentLog = parsed.logs.find(log => log.month === month);
  const previousLog = parsed.logs.find(log => log.month === "2025-12");
  if (!currentLog || !previousLog) throw new Error("Missing Air precision regression logs.");
  const airFields = currentLog.energyCalculation?.airFields?.length
    ? currentLog.energyCalculation.airFields
    : ["eb41a", "eb41b", "eb42a", "eb42b"];
  const rawAir = (log: typeof currentLog, field: string): number | null => {
    const fixed = log.air as unknown as Record<string, number | null | undefined>;
    return fixed[field] ?? log.air.meters?.[field] ?? null;
  };
  const normalizedDeltas = airFields.map(field => {
    const current = rawAir(currentLog, field);
    const previous = rawAir(previousLog, field);
    if (current === null || previous === null) throw new Error("Missing Air reading " + field + ".");
    return roundAirMeterReading(roundAirMeterReading(current) - roundAirMeterReading(previous));
  });
  const expectedAirEnergy = roundAirMeterReading(normalizedDeltas.reduce((sum, value) => sum + value, 0)) * 1_000_000;
  assert("Air Energy uses the six-decimal entry contract instead of legacy hidden precision", equal(calculation.airEnergyKwh, expectedAirEnergy));
  const expectedFloorEnergy = (calculation.upsEnergyKwh ?? 0) + expectedAirEnergy + (calculation.dcEnergyKwh ?? 0);
  assert("4th Floor Energy is rebuilt from normalized six-decimal Air readings", equal(calculation.floorEnergyKwh, expectedFloorEnergy));
  assert("4th Floor Electricity Cost uses the normalized 4th Floor Energy", equal(calculation.floorElectricityCostThb, calculateFloorElectricityCost(calculation.buildingEnergyKwh, calculation.buildingElectricityCostThb, expectedFloorEnergy)));
  assert("Legacy cached Dashboard-FAC floor energy differs because it predates the six-decimal Air contract", !equal(dashboardFloorEnergy, calculation.floorEnergyKwh));
} else {
  console.log("SKIP  Dashboard-FAC cached results are #VALUE! in the source workbook");
}

const srinakarinWorkbook = new ExcelJS.Workbook();
await srinakarinWorkbook.xlsx.readFile(srinakarinWorkbookPath);
const srinakarinDashboard = srinakarinWorkbook.getWorksheet("Dashboard-FAC");
if (!srinakarinDashboard) throw new Error("Srinakarin Dashboard-FAC is missing.");
const formula = (value: ExcelJS.CellValue) => typeof value === "object" && value !== null && "formula" in value
  ? value.formula.replace(/\s+/g, "")
  : "";
assert("Srinakarin Dashboard-FAC F40 is building cost / building energy", formula(srinakarinDashboard.getCell("F40").value) === "C40/B40");
assert("Srinakarin Dashboard-FAC E40 is average rate × 4th-floor energy", formula(srinakarinDashboard.getCell("E40").value) === "(C40/B40)*D40");

const changedLogs = structuredClone(parsed.logs);
const target = changedLogs.find(log => log.month === month);
if (!target) throw new Error(`Missing ${month} log.`);
target.energyCost.buildingEnergyKwh = 4_000_000;
target.energyCost.buildingElectricityCostThb = 16_000_000;
const expected = calculateEnergyCostForMonth(changedLogs, month);
const patched = await patchWorkbookBuffer(await fs.readFile(workbookPath), changedLogs);
const savedWorkbook = new ExcelJS.Workbook();
await savedWorkbook.xlsx.load(patched.buffer);
const energySheet = savedWorkbook.getWorksheet("4. Electricity Cost Log");
if (!energySheet) throw new Error("Energy worksheet is missing.");
const savedRow = energySheet.getRows(3, energySheet.rowCount - 2)
  ?.find(row => monthValue(row.getCell(1).value) === month);
if (!savedRow) throw new Error("Saved Energy row is missing.");

assert("Saved Average Electricity Rate equals cost / building consumption", equal(savedRow.getCell(5).value as number | null, expected.averageElectricityRateThbPerKwh));
assert("Saved Average Electricity Rate is a value", formulaText(savedRow.getCell(5).value) === "");
assert("Saved 4th Floor Electricity Cost equals rate × 4th-floor energy", equal(savedRow.getCell(4).value as number | null, expected.floorElectricityCostThb));
const savedZip = await JSZip.loadAsync(patched.buffer);
const savedRateCell = (await Promise.all(Object.keys(savedZip.files)
  .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  .map(async name => await savedZip.file(name)?.async("string"))))
  .map(xml => xml?.match(new RegExp(`<c\\b[^>]*\\br="F${savedRow.number}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? "")
  .find(Boolean) ?? "";
assert("Saved Average Electricity Rate keeps numeric two-decimal style without a formula", /\bs="/.test(savedRateCell) && !savedRateCell.includes("<f>"));
const noTemplateZip = await JSZip.loadAsync(patched.buffer);
for (const name of Object.keys(noTemplateZip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
  const entry = noTemplateZip.file(name);
  const xml = entry ? await entry.async("string") : "";
  noTemplateZip.file(name, xml.replace(/<f[^>]*>[\s\S]*?<\/f>/g, ""));
}
const noTemplateWorkbook = new ExcelJS.Workbook();
await noTemplateWorkbook.xlsx.load((await patchWorkbookBuffer(await noTemplateZip.generateAsync({ type: "nodebuffer" }), changedLogs)).buffer);
const noTemplateRow = noTemplateWorkbook.getWorksheet("4. Electricity Cost Log")!.getRows(3, energySheet.rowCount - 2)
  ?.find(row => monthValue(row.getCell(1).value) === month);
assert("Saved Average Electricity Rate works without a formula template", equal(noTemplateRow?.getCell(5).value as number | null, expected.averageElectricityRateThbPerKwh));
const zeroLogs = structuredClone(changedLogs);
const zeroTarget = zeroLogs.find(log => log.month === month)!;
zeroTarget.energyCost.buildingEnergyKwh = 0;
const zeroWorkbook = new ExcelJS.Workbook();
await zeroWorkbook.xlsx.load((await patchWorkbookBuffer(await fs.readFile(workbookPath), zeroLogs)).buffer);
const zeroRow = zeroWorkbook.getWorksheet("4. Electricity Cost Log")!.getRows(3, energySheet.rowCount - 2)
  ?.find(row => monthValue(row.getCell(1).value) === month);
assert("Zero building consumption leaves the saved average rate blank", formulaResult(zeroRow?.getCell(5).value ?? null) === null);
assert("Zero building consumption writes no rate formula", formulaText(zeroRow?.getCell(5).value ?? null) === "");
assert("Zero building consumption leaves the average rate blank", calculateAverageElectricityRate(0, 100) === null);
assert("Zero building consumption leaves 4th Floor Electricity Cost blank", calculateFloorElectricityCost(0, 100, 10) === null);
