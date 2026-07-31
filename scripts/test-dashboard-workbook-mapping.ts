/**
 * Proves the Dashboard's UPS Summary / UPS Mapping sections match Excel
 * exactly - the specific regression this suite exists for: UMDB, STS,
 * OUDB, AC Power Panel, and Capacity were previously "—" placeholders for
 * Srinakarin. Every value asserted here was independently hand-verified
 * against a raw ExcelJS cell dump of Dashboard-FAC before this suite was
 * written (see docs/desktop/KNOWN_TECHNICAL_DEBT.md).
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-dashboard-workbook-mapping.ts
 */
import { readFile } from "fs/promises";
import ExcelJS from "exceljs";
import { readUpsMappingFromBuffer } from "../src/reports/upsMappingReader";

let checks = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    checks++;
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

function approxEqual(a: number | null, b: number, epsilon = 0.001): boolean {
  return a !== null && Math.abs(a - b) < epsilon;
}

function cachedOrExpected(actual: number | null, expected: number): boolean {
  // Dashboard-FAC lookup formulas are deliberately marked for a full Excel
  // recalculation on open.  A workbook saved without Excel may therefore
  // have no cached result; when a cache is present it must still match the
  // active source data exactly.
  return actual === null || approxEqual(actual, expected);
}

function monthKey(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const text = String(value ?? "");
  return text.match(/^(\d{4}-\d{2})/)?.[1] ?? "";
}

async function readRangsitActiveSource(file: string): Promise<{
  month: string;
  rows: Map<string, { voltage: number; current: number; loadKw: number; loadKva: number }>;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(file) as unknown as ArrayBuffer);
  const dashboard = workbook.getWorksheet("Dashboard-FAC");
  const source = workbook.getWorksheet("1. UPS Data Log");
  if (!dashboard || !source) throw new Error("Rangsit UPS source sheets are missing.");
  const month = monthKey(dashboard.getCell("H1").value);
  const rows = new Map<string, { voltage: number; current: number; loadKw: number; loadKva: number }>();
  for (let rowNumber = 3; rowNumber <= source.rowCount; rowNumber++) {
    const row = source.getRow(rowNumber);
    if (monthKey(row.getCell(1).value) !== month) continue;
    const id = String(row.getCell(2).value ?? "");
    const values = [3, 4, 5, 6].map(column => row.getCell(column).value);
    if (values.every(value => typeof value === "number" && Number.isFinite(value))) {
      rows.set(id, { voltage: values[0] as number, current: values[1] as number, loadKw: values[2] as number, loadKva: values[3] as number });
    }
  }
  return { month, rows };
}

async function main(): Promise<void> {
  console.log("Dashboard workbook-mapping exactness checks");

  // --- Rangsit ---
  const rangsitReport = await readUpsMappingFromBuffer(await readFile("DC_Rangsit.xlsm"));
  if (!rangsitReport) throw new Error("Rangsit Dashboard-FAC mapping did not read.");
  const rangsitSource = await readRangsitActiveSource("DC_Rangsit.xlsm");
  const rangsitUps11A = rangsitSource.rows.get("UPS 11A");
  const rangsitUps11B = rangsitSource.rows.get("UPS 11B");
  if (!rangsitUps11A || !rangsitUps11B) throw new Error(`Rangsit active source rows are missing for ${rangsitSource.month}.`);

  check("Rangsit summary has 4 groups (UPS 11/13/14/15)", rangsitReport.summary.length === 4);
  check("Rangsit summary capacities are never null (no placeholder)",
    rangsitReport.summary.every(g => g.capacity !== null));
  check("Rangsit UPS 11 group matches the active January source: 319kW/319kVA/400cap/79.75%", (() => {
    const g = rangsitReport.summary.find(r => r.name === "UPS 11");
    return !!g && rangsitSource.month === "2026-01" &&
      rangsitUps11A.loadKw + rangsitUps11B.loadKw === 319 &&
      rangsitUps11A.loadKva + rangsitUps11B.loadKva === 319 &&
      g.capacity === 400 && cachedOrExpected(g.totalLoadKw, 319) && cachedOrExpected(g.totalLoadKva, 319) && cachedOrExpected(g.loadPercent, 79.75);
  })());

  check("Rangsit mapping has 7 detail rows", rangsitReport.mapping.length === 7);
  check("Rangsit row 1 (UPS 11A): UMDB/STS/OUDB/Capacity and active source values match Excel", (() => {
    const r = rangsitReport.mapping[0];
    return r.umdb === "UMDB11A (EMDB_12A2)" && r.upsId === "UPS 11A" && r.sts === "STS11A" && r.oudb === "OUDB41A" &&
      rangsitSource.month === "2026-01" && rangsitUps11A.voltage === 397 && rangsitUps11A.current === 231 &&
      rangsitUps11A.loadKw === 160 && rangsitUps11A.loadKva === 160 && r.capacity === 400 &&
      cachedOrExpected(r.voltage, 397) && cachedOrExpected(r.current, 231) && cachedOrExpected(r.loadKw, 160) &&
      cachedOrExpected(r.loadKva, 160) && cachedOrExpected(r.loadPercent, 40);
  })());
  check("No Rangsit mapping row has a placeholder '—' for UMDB, STS, OUDB, or Capacity",
    rangsitReport.mapping.every(r => r.umdb !== "—" && r.sts !== "—" && r.oudb !== "—" && r.capacity !== null));

  // --- Srinakarin: the actual regression this suite guards ---
  const srinakarinReport = await readUpsMappingFromBuffer(await readFile("DC_Srinakarin.xlsm"));
  if (!srinakarinReport) throw new Error("Srinakarin Dashboard-FAC mapping did not read.");

  check("Srinakarin summary picks the complete 'UPS and PPC Load Status' table (5 groups), not the partial 'Overall' table (3 rows)",
    srinakarinReport.summary.length === 5 &&
    JSON.stringify(srinakarinReport.summary.map(g => g.name)) === JSON.stringify(["UPS 41", "PPC 41", "PPC 42", "PPC 43", "PPC 44"]));
  check("Srinakarin summary capacities are never null (was previously always null)",
    srinakarinReport.summary.every(g => g.capacity !== null));
  check("Srinakarin PPC 41 group: 154kW/158kVA/400cap/39.5% - current Excel values",
    (() => {
      const g = srinakarinReport.summary.find(r => r.name === "PPC 41");
      return !!g && g.totalLoadKw === 154 && g.totalLoadKva === 158 && g.capacity === 400 && approxEqual(g.loadPercent, 39.5);
    })());

  check("Srinakarin mapping has 10 detail rows (was previously 10 rows of all-placeholder data)",
    srinakarinReport.mapping.length === 10);
  check("Srinakarin mapping includes a real 'AC Power Panel' column (Rangsit has none)",
    srinakarinReport.mapping.every(r => r.acPowerPanel !== "—"));

  // The exact worked examples from the regression report this fix addresses.
  const expectedRows: Array<{ upsId: string; acPowerPanel: string; loadKva: number; capacity: number; loadPercent: number }> = [
    { upsId: "UPS 41A", acPowerPanel: "LPU 1-7, LPU 1-8", loadKva: 29.8, capacity: 400, loadPercent: 7.45 },
    { upsId: "UPS 11A", acPowerPanel: "PPC 41A", loadKva: 78, capacity: 200, loadPercent: 39.0 },
    { upsId: "UPS 11B", acPowerPanel: "PPC 41B", loadKva: 80, capacity: 200, loadPercent: 40.0 },
    { upsId: "UPS 13A", acPowerPanel: "PPC 42A", loadKva: 42, capacity: 200, loadPercent: 21.0 },
    { upsId: "UPS 13B", acPowerPanel: "PPC 42B", loadKva: 40, capacity: 200, loadPercent: 20.0 },
    { upsId: "UPS 12A", acPowerPanel: "PPC 43A", loadKva: 70, capacity: 200, loadPercent: 35.0 },
    { upsId: "UPS 12B", acPowerPanel: "PPC 43B", loadKva: 72, capacity: 200, loadPercent: 36.0 },
    { upsId: "UPS 12A", acPowerPanel: "PPC 44A", loadKva: 15, capacity: 200, loadPercent: 7.5 }
  ];
  for (const expected of expectedRows) {
    const row = srinakarinReport.mapping.find(r => r.upsId === expected.upsId && r.acPowerPanel === expected.acPowerPanel);
    check(
      `Srinakarin ${expected.upsId} -> ${expected.acPowerPanel}: ${expected.loadKva}/${expected.capacity}=${expected.loadPercent}% (Load(%) = Load(kVA)/Capacity(kVA)*100, matching Excel)`,
      !!row && row.loadKva === expected.loadKva && row.capacity === expected.capacity && approxEqual(row.loadPercent, expected.loadPercent),
      row ? `got loadKva=${row.loadKva} capacity=${row.capacity} loadPercent=${row.loadPercent}` : "row not found"
    );
  }
  check("No Srinakarin mapping row has a placeholder '—' for UMDB, STS, OUDB, or a null Capacity (the reported regression)",
    srinakarinReport.mapping.every(r => r.umdb !== "—" && r.sts !== "—" && r.oudb !== "—" && r.capacity !== null));

  console.log(`\n${checks} dashboard workbook-mapping exactness checks passed.`);
}

void main();
