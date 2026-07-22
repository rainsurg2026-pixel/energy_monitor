import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { readWorkbookFromBuffer, readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { patchSrinakarinWorkbookBuffer } from "../src/excel/WorkbookWriter";
import { calculateSrinakarinAggregate } from "../src/utils/srinakarinPower";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";

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
month.srinakarinInputs.ppc43Current["PPC 43A - R - Panel 1"] = 100;
month.srinakarinInputs.ppc43Panel["PPC 43A Panel 1"].loadKw = 55;
month.ups.find(row => row.upsId === "PPC 44A")!.loadKw = 16;
month.ups.find(row => row.upsId === "PPC 44A")!.loadKva = 17;

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

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(patched as unknown as ArrayBuffer);
const formulaCell = workbook.getWorksheet("1.4.1 AC PPC Log By Phase(43AB)")?.getCell("D3").value;
assert(formulaCell && typeof formulaCell === "object" && "formula" in formulaCell, "PPC43 SUMIFS formula was not preserved.");

const rack = await readRackCapacityFromBuffer(original);
assert(rack && rack.records.length === 237, `Rack Capacity expected 237 records, got ${rack?.records.length ?? 0}.`);
assert(rack.byStatus.find(item => item.status === "In Use")?.count === 218, "Rack In Use count mismatch.");
assert(hash(original) === beforeHash, "Source workbook changed during aggregate test.");
console.log(JSON.stringify({
  aggregateRows: actualMonth.ups.filter(row => ["UPS 41A", "PPC 43A", "PPC 44A"].includes(row.upsId)),
  appendedMonth: actualNewMonth.month,
  formulaPreserved: true,
  rackRecords: rack.records.length,
  rackInUse: rack.byStatus.find(item => item.status === "In Use")?.count ?? null,
  sourceUnchanged: true
}));

// Keep the direct file reader in this regression path as well; it exercises the
// same production entry point used by the Electron main process.
await readWorkbookFromFile(sourcePath);
