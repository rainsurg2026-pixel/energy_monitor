import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readWorkbookFromBuffer, readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { patchSrinakarinWorkbookBuffer } from "../src/excel/WorkbookWriter";
import { calculateSrinakarinAggregate } from "../src/utils/srinakarinPower";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";
import { normalizeMonthCell } from "../src/excel/ExcelSchema";

const sourcePath = "DC_Srinakarin.xlsm";

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function closeEnough(actual: number | null, expected: number | null): boolean {
  return actual === null || expected === null ? actual === expected : Math.abs(actual - expected) < 1e-9;
}

const original = await readFile(sourcePath);
const beforeHash = hash(original);
const parsed = await readWorkbookFromBuffer(original);
const sourceMonth = parsed.logs.find(log => log.month === "2026-05");
assert(sourceMonth, "May-26 Srinakarin fixture row is missing.");

const logs = structuredClone(parsed.logs);
const month = logs.find(log => log.month === "2026-05");
assert(month?.srinakarinInputs, "May-26 phase input snapshot is missing.");
month.srinakarinInputs.upsPhase["UPS 41A - R"].loadKw = 11;
month.srinakarinInputs.upsPhase["UPS 41A - R"].loadKva = 12;
month.srinakarinInputs.acPhase["PPC 41A - R"].voltage = 222;
month.srinakarinInputs.acPhase["PPC 41A - R"].current = 133;
month.srinakarinInputs.ppc43Current["PPC 43A - R - Panel 1"] = 100;
month.srinakarinInputs.ppc43Panel["PPC 43A Panel 1"].loadKw = 55;
month.ups.find(row => row.upsId === "PPC 44A")!.loadKw = 16;
month.ups.find(row => row.upsId === "PPC 44A")!.loadKva = 17;
month.ups.find(row => row.upsId === "PPC 41A")!.loadKw = 79;
month.ups.find(row => row.upsId === "PPC 41A")!.loadKva = 81;

const expected = new Map(calculateSrinakarinAggregate(month).map(row => [row.upsId, row]));
const newMonth = structuredClone(month);
newMonth.month = "2026-06";
newMonth.srinakarinInputs!.upsPhase["UPS 41A - R"].voltage = 396;
newMonth.srinakarinInputs!.ppc43Current["PPC 43A - R - Panel 1"] = 101;
newMonth.ups.find(row => row.upsId === "PPC 44A")!.loadKw = 17;
newMonth.ups.find(row => row.upsId === "PPC 44A")!.loadKva = 18;
logs.push(newMonth);
const expectedNewMonth = new Map(calculateSrinakarinAggregate(newMonth).map(row => [row.upsId, row]));
const patched = await patchSrinakarinWorkbookBuffer(original, logs);
const reread = await readWorkbookFromBuffer(patched);
const actualMonth = reread.logs.find(log => log.month === "2026-05");
assert(actualMonth, "Patched workbook lost May-26.");

for (const id of ["UPS 41A", "PPC 43A", "PPC 44A"]) {
  const actual = actualMonth.ups.find(row => row.upsId === id);
  const wanted = expected.get(id);
  assert(actual && wanted, `${id} aggregate row is missing after patch.`);
  for (const field of ["voltage", "current", "loadKw", "loadKva"] as const) {
    assert(closeEnough(actual[field], wanted[field]), `${id}.${field}: ${actual[field]} != ${wanted[field]}`);
  }
}
const actualNewMonth = reread.logs.find(log => log.month === "2026-06");
assert(actualNewMonth, "New monthly rows were not appended to the workbook.");
for (const id of ["UPS 41A", "PPC 43A", "PPC 44A"]) {
  const actual = actualNewMonth.ups.find(row => row.upsId === id);
  const wanted = expectedNewMonth.get(id);
  assert(actual && wanted, `${id} new-month aggregate row is missing.`);
  for (const field of ["voltage", "current", "loadKw", "loadKva"] as const) {
    assert(closeEnough(actual[field], wanted[field]), `New ${id}.${field}: ${actual[field]} != ${wanted[field]}`);
  }
}

// Simulate the reported workbook damage: an existing PPC43A row with a
// missing Voltage formula and a stale/wrong Current formula. The writer must
// restore only C/D from the verified structured-reference pattern.
const corruptedZip = await JSZip.loadAsync(original);
const ppc43SheetPath = "xl/worksheets/sheet8.xml";
const ppc43Xml = await corruptedZip.file(ppc43SheetPath)?.async("string");
assert(ppc43Xml, "Srinakarin fixture PPC43 average sheet XML is missing.");
const replaceCell = (xml: string, ref: string, inner: string): string => {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = xml.replace(new RegExp(`(<c\\b(?=[^>]*\\br=\"${escaped}\")[^>]*>)[\\s\\S]*?(<\\/c>)`), `$1${inner}$2`);
  assert(result !== xml, `Could not corrupt fixture cell ${ref}.`);
  return result;
};
corruptedZip.file(
  ppc43SheetPath,
  replaceCell(replaceCell(ppc43Xml, "C11", "<v>0</v>"), "D11", "<f>1+1</f><v>2</v>")
);
const repaired = await patchSrinakarinWorkbookBuffer(await corruptedZip.generateAsync({ type: "nodebuffer" }), logs);
const repairedWorkbook = new ExcelJS.Workbook();
await repairedWorkbook.xlsx.load(repaired as unknown as ArrayBuffer);
const repairedPpc43Sheet = repairedWorkbook.getWorksheet("1.5.1 AC PPC Log_Average(43AB)");
const repairedMayPpc43A = repairedPpc43Sheet?.getRows(3, Math.max((repairedPpc43Sheet?.rowCount ?? 0) - 2, 0))
  ?.find(row => normalizeMonthCell(row.getCell(1).value) === "2026-05" && String(row.getCell(2).value) === "PPC 43A");
assert(repairedMayPpc43A, "Repaired PPC43A May row is missing.");
for (const [column, source] of [[3, "l43ab[voltage(v)]"], [4, "l43ab[current(a)]"]] as const) {
  const value = repairedMayPpc43A.getCell(column).value as ExcelJS.CellFormulaValue;
  assert(value && typeof value === "object" && "formula" in value && value.formula.replace(/\s+/g, "").toLowerCase().includes(source), `Sheet 1.5.1 C/D formula restoration failed at ${repairedMayPpc43A.getCell(column).address}.`);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(patched as unknown as ArrayBuffer);
const formulaCell = workbook.getWorksheet("1.4.1 AC PPC Log By Phase(43AB)")?.getCell("D3").value;
assert(formulaCell && typeof formulaCell === "object" && "formula" in formulaCell, "PPC43 SUMIFS formula was not preserved.");

const averageSheet = workbook.getWorksheet("1.2 UPS Data Log_Average");
const sumSheet = workbook.getWorksheet("1.3 UPS Data Log_Average SUM");
const ppcAverageSheet = workbook.getWorksheet("1.5 AC PPC Log_Average");
assert(averageSheet && sumSheet && ppcAverageSheet, "Srinakarin UPS helper sheets are missing after patch.");
const juneAverageRows = averageSheet.getRows(3, Math.max(averageSheet.rowCount - 2, 0))
  ?.filter(row => normalizeMonthCell(row.getCell(1).value) === "2026-06") ?? [];
assert(juneAverageRows.length === 8, `Sheet 1.2 expected eight June rows, got ${juneAverageRows.length}.`);
assert(new Set(juneAverageRows.map(row => String(row.getCell(2).value))).size === 8, "Sheet 1.2 added duplicate UPS rows.");
for (const row of juneAverageRows) {
  for (const column of [3, 4, 5, 6]) {
    const value = row.getCell(column).value;
    assert(value && typeof value === "object" && "formula" in value && typeof value.result === "number", `Sheet 1.2 ${row.getCell(2).value} column ${column} formula/cache was not preserved.`);
    assert(row.getCell(column).numFmt === "#,##0.00", `Sheet 1.2 ${row.getCell(2).value} column ${column} format is not #,##0.00.`);
  }
  const month = row.getCell(1).value;
  assert(month instanceof Date && month.getUTCDate() === 1 && row.getCell(1).numFmt === "mmm-yy", "Sheet 1.2 Month is not a first-day mmm-yy Excel Date.");
}
const juneSumRows = sumSheet.getRows(3, Math.max(sumSheet.rowCount - 2, 0))
  ?.filter(row => normalizeMonthCell(row.getCell(1).value) === "2026-06") ?? [];
assert(juneSumRows.length === 4, `Sheet 1.3 expected four June rows, got ${juneSumRows.length}.`);
const averageById = new Map(juneAverageRows.map(row => [String(row.getCell(2).value), row]));
for (const row of juneSumRows) {
  const id = String(row.getCell(2).value);
  const first = averageById.get(`${id}A`);
  const second = averageById.get(`${id}B`);
  assert(first && second, `Sheet 1.3 ${id} has no matching Sheet 1.2 A/B source rows.`);
  for (const [sumColumn, averageColumn] of [[3, 5], [4, 6]] as const) {
    const firstValue = (first.getCell(averageColumn).value as ExcelJS.CellFormulaValue).result;
    const secondValue = (second.getCell(averageColumn).value as ExcelJS.CellFormulaValue).result;
    assert(closeEnough(row.getCell(sumColumn).value as number, Number(firstValue) + Number(secondValue)), `Sheet 1.3 ${id} does not match Sheet 1.2.`);
    assert(row.getCell(sumColumn).numFmt === "#,##0.00", `Sheet 1.3 ${id} format is not #,##0.00.`);
  }
}

const ppcAverageIds = ["PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B", "PPC 44A", "PPC 44B"];
const junePpcAverageRows = ppcAverageSheet.getRows(3, Math.max(ppcAverageSheet.rowCount - 2, 0))
  ?.filter(row => normalizeMonthCell(row.getCell(1).value) === "2026-06") ?? [];
assert(junePpcAverageRows.length === ppcAverageIds.length, `Sheet 1.5 expected six June rows, got ${junePpcAverageRows.length}.`);
assert(JSON.stringify(junePpcAverageRows.map(row => String(row.getCell(2).value))) === JSON.stringify(ppcAverageIds), "Sheet 1.5 added unexpected PPC rows.");
const expectedPpcAverage = (id: string, field: "voltage" | "current"): number => {
  const values = Object.entries(newMonth.srinakarinInputs!.acPhase)
    .filter(([phaseId]) => phaseId.startsWith(`${id} - `))
    .map(([, reading]) => reading[field])
    .filter((value): value is number => typeof value === "number");
  return values.reduce((total, value) => total + value, 0) / values.length;
};
const mayPpc41a = ppcAverageSheet.getRows(3, Math.max(ppcAverageSheet.rowCount - 2, 0))
  ?.find(row => normalizeMonthCell(row.getCell(1).value) === "2026-05" && String(row.getCell(2).value) === "PPC 41A");
assert(mayPpc41a, "Sheet 1.5 PPC 41A May row is missing.");
assert(closeEnough(Number((mayPpc41a.getCell(3).value as ExcelJS.CellFormulaValue).result), expectedPpcAverage("PPC 41A", "voltage")), "Sheet 1.5 PPC 41A May voltage cache was not refreshed from Sheet 1.4.");
assert(closeEnough(Number((mayPpc41a.getCell(4).value as ExcelJS.CellFormulaValue).result), expectedPpcAverage("PPC 41A", "current")), "Sheet 1.5 PPC 41A May current cache was not refreshed from Sheet 1.4.");
assert(closeEnough(Number(mayPpc41a.getCell(5).value), month.ups.find(row => row.upsId === "PPC 41A")!.loadKw), "Sheet 1.5 PPC 41A May kW was not refreshed from its PPC record.");
assert(closeEnough(Number(mayPpc41a.getCell(6).value), month.ups.find(row => row.upsId === "PPC 41A")!.loadKva), "Sheet 1.5 PPC 41A May kVA was not refreshed from its PPC record.");
for (const row of junePpcAverageRows) {
  const id = String(row.getCell(2).value);
  const source = newMonth.ups.find(record => record.upsId === id);
  assert(source, `Missing ${id} PPC source record.`);
  for (const [column, field] of [[3, "voltage"], [4, "current"]] as const) {
    const value = row.getCell(column).value as ExcelJS.CellFormulaValue;
    assert(value && typeof value === "object" && "formula" in value && closeEnough(Number(value.result), expectedPpcAverage(id, field)), `Sheet 1.5 ${id}.${field} formula/cache does not match Sheet 1.4.`);
  }
  for (const [column, field] of [[5, "loadKw"], [6, "loadKva"]] as const) {
    const value = row.getCell(column).value;
    const actual = value && typeof value === "object" && "formula" in value ? Number(value.result) : Number(value);
    assert(closeEnough(actual, source[field]), `Sheet 1.5 ${id}.${field} does not match its PPC source.`);
    assert(row.getCell(column).numFmt === "#,##0.00", `Sheet 1.5 ${id}.${field} format is not #,##0.00.`);
  }
}
for (const column of [5, 6]) {
  const ppc44b = junePpcAverageRows.find(row => String(row.getCell(2).value) === "PPC 44B")!.getCell(column).value;
  assert(ppc44b && typeof ppc44b === "object" && "formula" in ppc44b && ppc44b.formula === "14+0", `Sheet 1.5 PPC 44B column ${column} formula was not preserved.`);
}

const ppc43AverageSheet = workbook.getWorksheet("1.5.1 AC PPC Log_Average(43AB)");
assert(ppc43AverageSheet, "Sheet 1.5.1 is missing after patch.");
const ppc43PhaseSheet = workbook.getWorksheet("1.4.1 AC PPC Log By Phase(43AB)");
assert(ppc43PhaseSheet, "Sheet 1.4.1 is missing after patch.");
for (const sourceLog of [month, newMonth]) {
  const phaseRows = ppc43PhaseSheet.getRows(3, Math.max(ppc43PhaseSheet.rowCount - 2, 0))
    ?.filter(row => normalizeMonthCell(row.getCell(1).value) === sourceLog.month) ?? [];
  assert(phaseRows.length === 6, `Sheet 1.4.1 expected six PPC43 phase rows for ${sourceLog.month}, got ${phaseRows.length}.`);
  for (const row of phaseRows) {
    const id = String(row.getCell(2).value);
    assert(/^PPC 43[AB] - [RST]$/.test(id), `Sheet 1.4.1 contains an unexpected PPC43 phase ${id}.`);
    const expectedCurrent = [1, 2].reduce((total, panel) => {
      const source = sourceLog.srinakarinInputs!.ppc43Current[`${id} - Panel ${panel}`];
      assert(typeof source === "number", `Missing source current for ${sourceLog.month} ${id} Panel ${panel}.`);
      return total + source;
    }, 0);
    const value = row.getCell(4).value;
    const actualCurrent = value && typeof value === "object" && "formula" in value ? Number(value.result) : Number(value);
    assert(closeEnough(actualCurrent, expectedCurrent), `Sheet 1.4.1 ${sourceLog.month} ${id} Current (A) does not equal Panel 1 + Panel 2.`);
  }
}
const junePpc43Rows = ppc43AverageSheet.getRows(3, Math.max(ppc43AverageSheet.rowCount - 2, 0))
  ?.filter(row => normalizeMonthCell(row.getCell(1).value) === "2026-06") ?? [];
assert(junePpc43Rows.length === 2, `Sheet 1.5.1 expected two June rows, got ${junePpc43Rows.length}.`);
for (const row of junePpc43Rows) {
  const id = String(row.getCell(2).value);
  assert(["PPC 43A", "PPC 43B"].includes(id), `Sheet 1.5.1 contains unexpected PPC ${id}.`);
  const phaseValues = Object.entries(newMonth.srinakarinInputs!.acPhase)
    .filter(([phaseId]) => phaseId.startsWith(`${id} - `));
  const expectedVoltage = phaseValues.map(([, values]) => values.voltage).filter((value): value is number => typeof value === "number");
  const expectedCurrent = ["R", "S", "T"].map(phase => Object.entries(newMonth.srinakarinInputs!.ppc43Current)
    .filter(([currentId]) => currentId.startsWith(`${id} - ${phase} - `))
    .map(([, value]) => value)
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0));
  const panels = Object.entries(newMonth.srinakarinInputs!.ppc43Panel)
    .filter(([panelId]) => panelId.startsWith(`${id} Panel `));
  const expected = [
    expectedVoltage.reduce((sum, value) => sum + value, 0) / expectedVoltage.length,
    expectedCurrent.reduce((sum, value) => sum + value, 0) / expectedCurrent.length,
    panels.map(([, values]) => values.loadKw).filter((value): value is number => typeof value === "number").reduce((sum, value) => sum + value, 0),
    panels.map(([, values]) => values.loadKva).filter((value): value is number => typeof value === "number").reduce((sum, value) => sum + value, 0)
  ];
  for (const [column, expectedValue] of [3, 4, 5, 6].map((column, index) => [column, expected[index]] as const)) {
    const value = row.getCell(column).value;
    assert(value && typeof value === "object" && "formula" in value && closeEnough(Number(value.result), expectedValue), `Sheet 1.5.1 ${id} column ${column} formula/cache does not match its source.`);
    assert(row.getCell(column).numFmt === "#,##0.00", `Sheet 1.5.1 ${id} column ${column} format is not #,##0.00.`);
  }
  const month = row.getCell(1).value;
  assert(month instanceof Date && month.getUTCDate() === 1 && row.getCell(1).numFmt === "mmm-yy", `Sheet 1.5.1 ${id} Month is not a first-day mmm-yy Excel Date.`);
}

const missingPanelLogs = structuredClone(logs);
delete missingPanelLogs.find(log => log.month === "2026-05")!.srinakarinInputs!.ppc43Current["PPC 43A - R - Panel 2"];
await patchSrinakarinWorkbookBuffer(original, missingPanelLogs)
  .then(() => { throw new Error("Missing PPC43 panel source did not fail the save."); })
  .catch(error => assert(
    error instanceof Error && error.message.includes("2026-05, PPC 43A, phase R"),
    "Missing PPC43 source error does not identify the Month, PPC and phase."
  ));

const missingPhaseLogs = structuredClone(logs);
delete missingPhaseLogs.find(log => log.month === "2026-05")!.srinakarinInputs!.acPhase["PPC 43A - T"];
await patchSrinakarinWorkbookBuffer(original, missingPhaseLogs)
  .then(() => { throw new Error("Incomplete PPC43 phase source did not fail the save."); })
  .catch(error => assert(
    error instanceof Error && error.message.includes("2026-05, PPC 43A, Voltage (V), C"),
    "Incomplete PPC43 phase error does not identify the Month, PPC, column and reason."
  ));

const rack = await readRackCapacityFromBuffer(original);
assert(rack && rack.records.length === 237, `Rack Capacity expected 237 records, got ${rack?.records.length ?? 0}.`);
assert(rack.byStatus.find(item => item.status === "In Use")?.count === 218, "Rack In Use count mismatch.");
assert(hash(original) === beforeHash, "Source workbook changed during aggregate test.");
console.log(JSON.stringify({
  aggregateRows: actualMonth.ups.filter(row => ["UPS 41A", "PPC 43A", "PPC 44A"].includes(row.upsId)),
  appendedMonth: actualNewMonth.month,
  formulaPreserved: true,
  upsAverageAndSumSynchronized: true,
  rackRecords: rack.records.length,
  rackInUse: rack.byStatus.find(item => item.status === "In Use")?.count ?? null,
  sourceUnchanged: true
}));

// Keep the direct file reader in this regression path as well; it exercises the
// same production entry point used by the Electron main process.
await readWorkbookFromFile(sourcePath);
