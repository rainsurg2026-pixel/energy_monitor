import ExcelJS from "exceljs";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import type { DeviceLists } from "../src/excel/SheetMapper";
import { calculateEnergyCostForMonth, normalizedMonth } from "../src/utils/energyCost";

const file = "DC_Srinakarin.xlsm";

function cached(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) {
    const result = (value as { result?: unknown }).result;
    return typeof result === "number" ? result : null;
  }
  return null;
}

function dashboardMonth(value: unknown): string | null {
  const raw = value && typeof value === "object" && "result" in value
    ? (value as { result?: unknown }).result
    : value;
  if (raw instanceof Date) return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, "0")}`;
  return typeof raw === "string" ? normalizedMonth(raw) : null;
}

const srinakarinDevices: DeviceLists = {
  upsIds: ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"],
  dcIds: ["DC PDB41A", "DC PDB41B"],
  airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"]
};
const read = await readWorkbookFromFile(file, srinakarinDevices);
if (!read.validation.ok) throw new Error(read.validation.errors.join("; "));
const may = read.logs.find(log => log.month === "2026-05");
if (!may) throw new Error("Srinakarin May-26 row was not read.");
for (const field of srinakarinDevices.airFields ?? []) {
  const value = may.air.meters?.[field] ?? may.air[field as keyof typeof may.air];
  if (typeof value !== "number") throw new Error(`Missing Air field ${field}.`);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const dashboard = workbook.getWorksheet("Dashboard-FAC");
if (!dashboard) throw new Error("Dashboard-FAC not found.");
const selectedDashboardMonth = dashboardMonth(dashboard.getCell("H1").value);
if (!selectedDashboardMonth) throw new Error("Dashboard-FAC selected month is missing.");
const calculation = calculateEnergyCostForMonth(read.logs, selectedDashboardMonth);
const expectedFloor = [cached(dashboard.getCell("H15").value), cached(dashboard.getCell("H32").value), cached(dashboard.getCell("G37").value)]
  .reduce<number | null>((sum, v) => (sum === null || v === null ? null : sum + v), 0);
const buildingEnergy = cached(dashboard.getCell("B40").value);
const buildingCost = cached(dashboard.getCell("C40").value);
const expectedCost = buildingEnergy && buildingCost && expectedFloor !== null ? (buildingCost / buildingEnergy) * expectedFloor : null;
if (expectedFloor === null || expectedCost === null) throw new Error("Dashboard-FAC cached results are missing.");
if (Math.abs(calculation.floorEnergyKwh! - expectedFloor) > 0.01) throw new Error("Floor energy differs from Dashboard-FAC.");
if (Math.abs(calculation.floorElectricityCostThb! - expectedCost) > 0.01) throw new Error("Floor cost differs from Dashboard-FAC.");

const rangsit = await readWorkbookFromFile("DC_Rangsit.xlsm");
if (!rangsit.validation.ok || rangsit.logs.length === 0) throw new Error("Rangsit regression read failed.");
console.log(JSON.stringify({ srinakarinMonths: read.logs.length, rangsitMonths: rangsit.logs.length, dashboardMonth: selectedDashboardMonth, floorEnergy: calculation.floorEnergyKwh, floorCost: calculation.floorElectricityCostThb }));
