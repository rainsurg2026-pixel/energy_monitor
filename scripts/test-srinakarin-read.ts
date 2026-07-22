import ExcelJS from "exceljs";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { calculateEnergyCostForMonth } from "../src/utils/energyCost";

const file = "DC_Srinakarin.xlsm";

function cached(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) {
    const result = (value as { result?: unknown }).result;
    return typeof result === "number" ? result : null;
  }
  return null;
}

const read = await readWorkbookFromFile(file);
if (!read.validation.ok) throw new Error(read.validation.errors.join("; "));
const may = read.logs.find(log => log.month === "2026-05");
if (!may) throw new Error("Srinakarin May-26 row was not read.");
for (const field of ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"] as const) {
  if (typeof may.air[field] !== "number") throw new Error(`Missing Air field ${field}.`);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const dashboard = workbook.getWorksheet("Dashboard-FAC");
if (!dashboard) throw new Error("Dashboard-FAC not found.");
const calculation = calculateEnergyCostForMonth(read.logs, "2026-05");
// Dashboard-FAC!D40 has a known, pre-existing formula bug in this workbook
// (=H15+H30+G37; H30 is a blank row - the real Air Conditioning monthly
// energy lives in H32, "Monthly Difference"), so D40 silently omits AC
// energy from its own cached total. That is a workbook authoring defect,
// not something this project's code changes - not fixed here. The floor
// energy cross-check instead sums the same three source cells Dashboard-FAC
// itself intends (H15 UPS+PPC, H32 AC, G37 DC), which is exactly what
// calculateEnergyCostForMonth independently computes: H15+H32+G37 =
// 639308.3347200028 = the app's calculation, to the last decimal.
const expectedFloor = [cached(dashboard.getCell("H15").value), cached(dashboard.getCell("H32").value), cached(dashboard.getCell("G37").value)]
  .reduce<number | null>((sum, v) => (sum === null || v === null ? null : sum + v), 0);
// E40 = (C40/B40)*D40 inherits D40's bug by multiplying the same
// under-counted floor energy by the building rate - re-derive the cost
// with the same rate against the corrected floor energy above instead.
const buildingEnergy = cached(dashboard.getCell("B40").value);
const buildingCost = cached(dashboard.getCell("C40").value);
const expectedCost = buildingEnergy && buildingCost && expectedFloor !== null ? (buildingCost / buildingEnergy) * expectedFloor : null;
if (expectedFloor === null || expectedCost === null) throw new Error("Dashboard-FAC cached results are missing.");
if (Math.abs(calculation.floorEnergyKwh! - expectedFloor) > 0.01) throw new Error("Floor energy differs from Dashboard-FAC.");
if (Math.abs(calculation.floorElectricityCostThb! - expectedCost) > 0.01) throw new Error("Floor cost differs from Dashboard-FAC.");

const rangsit = await readWorkbookFromFile("DC_Rangsit.xlsm");
if (!rangsit.validation.ok || rangsit.logs.length === 0) throw new Error("Rangsit regression read failed.");
console.log(JSON.stringify({ srinakarinMonths: read.logs.length, rangsitMonths: rangsit.logs.length, floorEnergy: calculation.floorEnergyKwh, floorCost: calculation.floorElectricityCostThb }));
