/**
 * Cross-facility save regression: a real workbook save must synchronize every
 * mapped sheet while retaining Excel-native values and all non-number styles.
 *
 * This intentionally works on copies of the two production fixtures.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { saveWorkbook } from "../src/excel/WorkbookWriter";
import { normalizeMonthCell } from "../src/excel/ExcelSchema";
import { entryText, locateSheetXmlPathByName, workbookMonthSerial, workbookUsesDate1904 } from "../src/excel/ExcelZipUtils";
import { calculateAverageElectricityRate, calculateEnergyCostForMonth } from "../src/utils/energyCost";

const root = process.cwd();
const workDir = path.join(root, "dist-electron", "test-work", "save-formatting-regression");
const MONTH = "2026-05";
const RANGSIT_SHEETS = [
  "1. UPS Data Log",
  "2. Air Energy Consumption Log",
  "3. DC Data Log",
  "4. Electricity Cost Log"
];
const SRINAKARIN_SHEETS = [
  "1. UPS Data Log",
  "1.1 UPS Data Log By Phase",
  "1.4 AC PPC Log By Phase",
  "1.4.1 AC PPC Log By Phase(43AB)",
  "1.6 AC PPC43 (A)",
  "1.7 AC PPC43 Panel (A)",
  "2. Air Energy Consumption Log",
  "3. DC Data Log",
  "4. Electricity Cost Log"
];

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = ""): void {
  checks++;
  if (!condition) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function plain(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}

function headerAndMonthRows(ws: ExcelJS.Worksheet, month: string): { header: ExcelJS.Row; monthColumn: number; rows: ExcelJS.Row[] } | null {
  let header: ExcelJS.Row | null = null;
  let monthColumn = 0;
  for (let n = 1; n <= Math.min(ws.rowCount, 20); n++) {
    const row = ws.getRow(n);
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      if (String(plain(cell.value) ?? "").trim().toLowerCase() === "month") {
        header = row;
        monthColumn = column;
      }
    });
    if (header) break;
  }
  if (!header || !monthColumn) return null;
  const rows: ExcelJS.Row[] = [];
  for (let n = header.number + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    if (normalizeMonthCell(plain(row.getCell(monthColumn).value)) === month) rows.push(row);
  }
  return { header, monthColumn, rows };
}

function visualStyle(cell: ExcelJS.Cell): string {
  // Number format and horizontal/vertical alignment are required writer
  // mutations. All other visual attributes must remain byte-for-byte alike.
  const stable = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(stable);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  };
  const { horizontal: _horizontal, vertical: _vertical, ...otherAlignment } = cell.alignment ?? {};
  return JSON.stringify(stable({ font: cell.font, fill: cell.fill, border: cell.border, alignment: otherAlignment }));
}

function hasExplicitVisualStyle(cell: ExcelJS.Cell): boolean {
  const { font, fill, border, alignment } = cell;
  return Boolean(
    font?.name || font?.size || font?.bold || font?.italic || font?.underline || font?.color ||
    (fill && fill.type !== "pattern") ||
    (fill && "pattern" in fill && fill.pattern !== "none") ||
    Object.values(border ?? {}).some(side => typeof side === "object" && side !== null && ("style" in side || "color" in side)) ||
    alignment?.horizontal || alignment?.vertical || alignment?.wrapText || alignment?.textRotation
  );
}

async function vbaHash(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const vba = await zip.file("xl/vbaProject.bin")?.async("nodebuffer");
  if (!vba) throw new Error("Workbook has no xl/vbaProject.bin");
  return crypto.createHash("sha256").update(vba).digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The Srinakarin fixture may be left on a different active dashboard month
 * than this regression test's input month.  Patch only the disposable copy
 * so WorkbookWriter validates the same month that the test edits, while the
 * production fixture and its cached formulas remain untouched.
 */
function ppc43Average(
  log: NonNullable<Awaited<ReturnType<typeof readWorkbookFromFile>>["logs"]>[number],
  id: "PPC 43A" | "PPC 43B",
  field: "voltage" | "current"
): number {
  const values = Object.entries(log.srinakarinInputs?.acPhase ?? {})
    .filter(([phaseId]) => phaseId.startsWith(`${id} - `))
    .map(([, value]) => value[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) throw new Error(`${id} has no finite ${field} values`);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function replaceNumericCellValue(sheetXml: string, address: string, value: number): string {
  const marker = `<c r="${address}"`;
  const start = sheetXml.indexOf(marker);
  if (start < 0) throw new Error(`Cell ${address} is missing`);
  const end = sheetXml.indexOf("</c>", start);
  if (end < 0) throw new Error(`Cell ${address} is not closed`);
  const cell = sheetXml.slice(start, end + 4);
  const patched = /<v>[^<]*<\/v>/.test(cell)
    ? cell.replace(/<v>[^<]*<\/v>/, `<v>${value}</v>`)
    : cell.replace("</c>", `<v>${value}</v></c>`);
  return `${sheetXml.slice(0, start)}${patched}${sheetXml.slice(end + 4)}`;
}

async function setDashboardActiveMonth(
  file: string,
  month: string,
  values: { a: { voltage: number; current: number }; b: { voltage: number; current: number } }
): Promise<void> {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const sheetPath = await locateSheetXmlPathByName(zip, "Dashboard-FAC");
  if (!workbookXml || !sheetPath) throw new Error("Dashboard-FAC worksheet could not be located");
  const sheetXml = await entryText(zip, sheetPath);
  if (!sheetXml) throw new Error(`Dashboard-FAC worksheet XML is missing: ${sheetPath}`);
  const serial = workbookMonthSerial(month, workbookUsesDate1904(workbookXml));
  if (serial === null) throw new Error(`Invalid test month: ${month}`);
  const cellMatch = sheetXml.match(/<c\b[^>]*\br="H1"[^>]*>[\s\S]*?<\/c>/);
  if (!cellMatch) throw new Error("Dashboard-FAC active month cell H1 is missing");
  const patchedCell = cellMatch[0]
    .replace(/\s+t="[^"]*"/, "")
    .replace(/(<v>)[^<]*(<\/v>)/, `$1${serial}$2`);
  if (patchedCell === cellMatch[0]) throw new Error("Dashboard-FAC active month cell H1 has no numeric value");
  let patchedSheet = sheetXml.replace(cellMatch[0], patchedCell);
  // Dashboard-FAC stores formula results as cached values.  The source
  // fixture can have H1 and those cached results on different months, so
  // synchronize only this disposable copy before exercising saveWorkbook.
  patchedSheet = replaceNumericCellValue(patchedSheet, "G24", values.a.voltage);
  patchedSheet = replaceNumericCellValue(patchedSheet, "H24", values.a.current);
  patchedSheet = replaceNumericCellValue(patchedSheet, "G25", values.b.voltage);
  patchedSheet = replaceNumericCellValue(patchedSheet, "H25", values.b.current);
  zip.file(sheetPath, patchedSheet);
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
}

async function runFacility(name: "Rangsit" | "Srinakarin", sourceName: string, sheets: string[]): Promise<void> {
  console.log(`\n${name}`);
  const target = path.join(workDir, `${name}.xlsm`);
  await fs.copyFile(path.join(root, sourceName), target);
  if (name === "Srinakarin") {
    const source = await readWorkbookFromFile(target);
    const sourceLog = source.logs.find(item => item.month === MONTH);
    if (!sourceLog) throw new Error(`${name} is missing ${MONTH}`);
    await setDashboardActiveMonth(target, MONTH, {
      a: { voltage: ppc43Average(sourceLog, "PPC 43A", "voltage"), current: ppc43Average(sourceLog, "PPC 43A", "current") },
      b: { voltage: ppc43Average(sourceLog, "PPC 43B", "voltage"), current: ppc43Average(sourceLog, "PPC 43B", "current") }
    });
  }
  const sourceVba = await vbaHash(target);
  const before = await readWorkbookFromFile(target);
  check(`${name}: source workbook validates`, before.validation.ok, before.validation.errors.join("; "));
  const logs = clone(before.logs);
  const log = logs.find(item => item.month === MONTH);
  if (!log) throw new Error(`${name} is missing ${MONTH}`);

  // Change one input from each save section.  This exercises the exact Save
  // All data set without introducing a new mapping or calculation.
  const ups = log.ups[0];
  if (!ups) throw new Error(`${name} has no UPS row for ${MONTH}`);
  ups.voltage = 401.5;
  ups.current = 29.2;
  ups.loadKw = 1234;
  ups.loadKva = 1356.68;
  log.air.eb41a = 29.2;
  const dc = log.dc[0];
  if (!dc) throw new Error(`${name} has no DC row for ${MONTH}`);
  dc.voltage = 53.9;
  dc.current = 66.1;
  log.energyCost.buildingEnergyKwh = 2999999.5;
  log.energyCost.buildingElectricityCostThb = 13566668.81;
  let savedSrinakarinPhase: string | undefined;
  if (name === "Srinakarin") {
    const phase = Object.keys(log.srinakarinInputs?.upsPhase ?? {})[0];
    if (!phase || !log.srinakarinInputs) throw new Error("Srinakarin UPS phase inputs are missing");
    log.srinakarinInputs.upsPhase[phase].voltage = 401.5;
    log.srinakarinInputs.upsPhase[phase].current = 29.2;
    log.srinakarinInputs.upsPhase[phase].loadKw = 1234;
    log.srinakarinInputs.upsPhase[phase].loadKva = 1356.68;
    savedSrinakarinPhase = phase;
  }

  const beforeExcel = new ExcelJS.Workbook();
  await beforeExcel.xlsx.readFile(target);
  const styleBefore = new Map<string, string>();
  const idBefore = new Map<string, string>();
  const numericBefore = new Map<string, number>();
  for (const sheetName of sheets) {
    const ws = beforeExcel.getWorksheet(sheetName);
    if (!ws) throw new Error(`${name} mapped sheet is missing: ${sheetName}`);
    const found = headerAndMonthRows(ws, MONTH);
    if (!found?.rows.length) throw new Error(`${name} ${sheetName} has no ${MONTH} rows`);
    for (const row of found.rows) {
      row.eachCell({ includeEmpty: false }, cell => {
        const header = String(plain(found.header.getCell(cell.col).value) ?? "").trim().toLowerCase();
        styleBefore.set(`${sheetName}!${cell.address}`, visualStyle(cell));
        const numeric = plain(cell.value);
        if (typeof numeric === "number") numericBefore.set(`${sheetName}!${cell.address}`, numeric);
        if (/(ups|panel|name|\bid\b)/.test(header) && cell.col !== String(found.monthColumn)) {
          idBefore.set(`${sheetName}!${cell.address}`, String(plain(cell.value) ?? ""));
        }
      });
    }
  }

  await saveWorkbook(target, logs, {
    backupDir: null,
    backupKeep: 1,
    ...(name === "Srinakarin" ? {
      devices: {
        upsIds: ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"],
        dcIds: ["DC PDB41A", "DC PDB41B"],
        airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"]
      }
    } : {})
  });

  const after = await readWorkbookFromFile(target);
  check(`${name}: saved workbook validates`, after.validation.ok, after.validation.errors.join("; "));
  const saved = after.logs.find(item => item.month === MONTH);
  check(`${name}: UPS input synchronized`, name === "Srinakarin"
    ? saved?.srinakarinInputs?.upsPhase[savedSrinakarinPhase!]?.voltage === 401.5
    : saved?.ups.some(item => item.voltage === 401.5 && item.current === 29.2) === true);
  if (name === "Srinakarin") {
    const phase = saved?.srinakarinInputs?.upsPhase[savedSrinakarinPhase!];
    check("Srinakarin: UPS phase V/A/kW/kVA synchronized", phase?.current === 29.2 && phase.loadKw === 1234 && phase.loadKva === 1356.68);
  }
  check(`${name}: AIR input synchronized`, saved?.air.eb41a === 29.2);
  check(`${name}: DC input synchronized`, saved?.dc.some(item => item.voltage === 53.9 && item.current === 66.1) === true);
  check(`${name}: Energy input synchronized`, saved?.energyCost.buildingEnergyKwh === 2999999.5 && saved.energyCost.buildingElectricityCostThb === 13566668.81);
  const expectedEnergy = calculateEnergyCostForMonth(logs, MONTH);
  check(`${name}: calculated rate remains shared-helper result`, calculateAverageElectricityRate(saved?.energyCost.buildingEnergyKwh ?? null, saved?.energyCost.buildingElectricityCostThb ?? null) === expectedEnergy.averageElectricityRateThbPerKwh);

  const afterExcel = new ExcelJS.Workbook();
  await afterExcel.xlsx.readFile(target);
  for (const sheetName of sheets) {
    const ws = afterExcel.getWorksheet(sheetName)!;
    const found = headerAndMonthRows(ws, MONTH);
    check(`${name}: ${sheetName} has synchronized month rows`, Boolean(found?.rows.length));
    if (!found) continue;
    found.header.eachCell({ includeEmpty: false }, cell => {
      check(`${name}: ${sheetName}!${cell.address} header is centered`, cell.alignment.horizontal === "center" && cell.alignment.vertical === "middle");
    });
    for (const row of found.rows) {
      const monthCell = row.getCell(found.monthColumn);
      const monthValue = plain(monthCell.value);
      const isFirstDay = monthValue instanceof Date && monthValue.getUTCFullYear() === 2026 && monthValue.getUTCMonth() === 4 && monthValue.getUTCDate() === 1;
      check(`${name}: ${sheetName} Month is a first-day Excel Date`, isFirstDay, `${String(monthValue)}`);
      check(`${name}: ${sheetName} Month format is mmm-yy`, monthCell.numFmt === "mmm-yy", String(monthCell.numFmt));
      row.eachCell({ includeEmpty: false }, cell => {
        check(`${name}: ${sheetName}!${cell.address} data is centered`, cell.alignment.horizontal === "center" && cell.alignment.vertical === "middle");
        const header = String(plain(found.header.getCell(cell.col).value) ?? "").trim().toLowerCase();
        const value = plain(cell.value);
        const isFormula = Boolean(cell.value && typeof cell.value === "object" && "formula" in cell.value);
        const beforeStyle = styleBefore.get(`${sheetName}!${cell.address}`);
        const beforeCell = beforeExcel.getWorksheet(sheetName)?.getCell(cell.address);
        if (beforeStyle !== undefined && beforeCell && hasExplicitVisualStyle(beforeCell)) {
          check(`${name}: ${sheetName}!${cell.address} visual style preserved`, visualStyle(cell) === beforeStyle);
        }
        const originalId = idBefore.get(`${sheetName}!${cell.address}`);
        if (originalId !== undefined) check(`${name}: ${sheetName}!${cell.address} ID text preserved`, String(value ?? "") === originalId);
        if (!isFormula && numericBefore.get(`${sheetName}!${cell.address}`) !== value && cell.col !== String(found.monthColumn) && header !== "" && !/(month|timestamp|id|ups|panel|name)/.test(header) && typeof value === "number") {
          check(`${name}: ${sheetName}!${cell.address} numeric value and #,##0.00 format`, cell.numFmt === "#,##0.00", String(cell.numFmt));
        }
      });
    }
  }
  const energySheet = afterExcel.getWorksheet("4. Electricity Cost Log")!;
  const energyRows = headerAndMonthRows(energySheet, MONTH);
  const energyRow = energyRows?.rows[0];
  if (!energyRows || !energyRow) {
    check(`${name}: Energy calculated outputs written`, false, "target energy row missing");
  } else {
    let floorCost: unknown = null;
    let averageRate: unknown = null;
    energyRows.header.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = String(plain(cell.value) ?? "").toLowerCase();
      if (header.includes("4th floor") && header.includes("cost")) floorCost = plain(energyRow.getCell(column).value);
      if (header.includes("average") && header.includes("rate")) averageRate = plain(energyRow.getCell(column).value);
    });
    check(`${name}: calculated Energy outputs written`, floorCost === expectedEnergy.floorElectricityCostThb && averageRate === expectedEnergy.averageElectricityRateThbPerKwh);
  }
  check(`${name}: VBA macro bytes preserved`, await vbaHash(target) === sourceVba);
}

async function main(): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  await runFacility("Rangsit", "DC_Rangsit.xlsm", RANGSIT_SHEETS);
  await runFacility("Srinakarin", "DC_Srinakarin.xlsm", SRINAKARIN_SHEETS);
  console.log(failures === 0 ? `\nSAVE FORMATTING REGRESSION PASSED (${checks} checks)` : `\n${failures} SAVE FORMATTING REGRESSION FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
