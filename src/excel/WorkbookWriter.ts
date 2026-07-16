/**
 * WorkbookWriter - saves MonthlyLog[] back into the workbook.
 *
 * RST_Dashboard.xlsm is a live Excel application: it contains VBA
 * (vbaProject.bin), pivot tables, charts, Excel Tables and calculated
 * columns. Rewriting it with ExcelJS would silently strip all of that.
 *
 * Instead, this module patches the workbook at the OPC/zip level:
 *   - only the <sheetData> of the four managed log sheets is regenerated;
 *   - every other zip entry is carried over byte-for-byte;
 *   - unmanaged columns in managed sheets (e.g. "4th Floor Electricity
 *     Cost") are carried across the rewrite keyed by row identity;
 *   - formula columns are re-emitted without cached values and the workbook
 *     is flagged fullCalcOnLoad so Excel recalculates on open;
 *   - Excel Table (`<table ref>`) and autofilter ranges are extended to the
 *     new data extent so dashboards, pivots and structured references keep
 *     seeing all rows;
 *   - calcChain.xml is dropped (Excel rebuilds it) so stale entries can
 *     never trigger a "repair" prompt;
 *   - pivot caches are flagged refreshOnLoad so the dashboard refreshes.
 *
 * Saves are atomic: patch in memory -> validate by re-reading the patched
 * buffer -> back up the original -> write temp file -> rename over the
 * original. A damaged result can never replace a good workbook.
 */

import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";
import { MonthlyLog } from "../types";
import {
  FieldId,
  SHEET_SCHEMAS,
  SheetSchema,
  TabKey,
  normalizeMonthCell,
  resolveColumns,
  resolveSheetNames,
  yyyyMmToExcelSerial
} from "./ExcelSchema";
import { SheetRow, logsToRows, rowKey } from "./SheetMapper";
import { readWorkbookFromBuffer } from "./WorkbookReader";
import { writeWorkbookMeta } from "./WorkbookVersion";

export type WorkbookErrorCode =
  | "NOT_FOUND"
  | "LOCKED"
  | "INVALID_WORKBOOK"
  | "VALIDATION_FAILED"
  | "WRITE_FAILED";

export class WorkbookError extends Error {
  code: WorkbookErrorCode;
  constructor(code: WorkbookErrorCode, message: string) {
    super(message);
    this.name = "WorkbookError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function indexToColLetter(index: number): string {
  let s = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getAttr(tagAttrs: string, name: string): string | null {
  const m = tagAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

interface ParsedCell {
  colLetter: string;
  attrs: string; // raw attribute string, e.g. ` r="A3" s="5"`
  inner: string | null; // inner XML, null for self-closing
  styleId: string | null;
  type: string | null;
  formula: string | null;
}

interface ParsedRow {
  rowNumber: number;
  raw: string; // full original <row .../> XML
  cells: ParsedCell[];
}

const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const ROW_RE = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

function parseRows(sheetDataInner: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const match of sheetDataInner.matchAll(ROW_RE)) {
    const raw = match[0];
    const rowNumber = parseInt(match[1], 10);
    const cells: ParsedCell[] = [];
    for (const cellMatch of raw.matchAll(CELL_RE)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] ?? null;
      const ref = getAttr(attrs, "r") ?? "";
      const colLetter = ref.replace(/\d+/g, "");
      const formulaMatch = inner ? inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>|<f\b[^>]*\/>/) : null;
      cells.push({
        colLetter,
        attrs,
        inner,
        styleId: getAttr(attrs, "s"),
        type: getAttr(attrs, "t"),
        formula: formulaMatch ? (formulaMatch[1] ?? "") : null
      });
    }
    rows.push({ rowNumber, raw, cells });
  }
  return rows;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    strings.push(xmlUnescape(text));
  }
  return strings;
}

function cellText(cell: ParsedCell, sharedStrings: string[]): string {
  if (!cell.inner) return "";
  if (cell.type === "inlineStr") {
    let text = "";
    for (const t of cell.inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    return xmlUnescape(text);
  }
  const v = cell.inner.match(/<v>([\s\S]*?)<\/v>/);
  if (!v) return "";
  if (cell.type === "s") {
    const idx = parseInt(v[1], 10);
    return sharedStrings[idx] ?? "";
  }
  return xmlUnescape(v[1]);
}

/** Shift relative A1-style row references in a formula by `delta` rows. */
function adjustFormulaRows(formula: string, delta: number): string {
  if (delta === 0) return formula;
  // Structured references and absolute rows are left alone; only bare A1
  // relative row numbers move. Skip anything inside quotes or brackets.
  let out = "";
  let inString = false;
  let inBrackets = 0;
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') inString = !inString;
    if (!inString) {
      if (ch === "[") inBrackets++;
      if (ch === "]") inBrackets = Math.max(0, inBrackets - 1);
    }
    if (!inString && inBrackets === 0) {
      const rest = formula.slice(i);
      const m = rest.match(/^(\$?[A-Z]{1,3})(\d+)/);
      if (m && !/[A-Za-z0-9_.]$/.test(out)) {
        const rowNum = parseInt(m[2], 10) + delta;
        out += m[1] + String(rowNum);
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zip plumbing
// ---------------------------------------------------------------------------

async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  if (!file) return null;
  return file.async("string");
}

function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (baseDir + "/" + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

interface SheetLocation {
  name: string;
  xmlPath: string; // e.g. xl/worksheets/sheet4.xml
}

async function locateSheets(zip: JSZip): Promise<SheetLocation[]> {
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const relsXml = await entryText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new WorkbookError("INVALID_WORKBOOK", "Not a valid Excel workbook (missing workbook.xml).");

  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = getAttr(m[1], "Id");
    const target = getAttr(m[1], "Target");
    if (id && target) relMap.set(id, target);
  }

  const sheets: SheetLocation[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = getAttr(m[1], "name");
    const rid = getAttr(m[1], "r:id");
    if (!name || !rid) continue;
    const target = relMap.get(rid);
    if (!target) continue;
    sheets.push({ name: xmlUnescape(name), xmlPath: resolveTarget("xl", target) });
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Sheet patching
// ---------------------------------------------------------------------------

interface PatchStats {
  tab: TabKey;
  sheetName: string;
  dataRows: number;
}

function buildCellXml(
  ref: string,
  styleId: string | null,
  kind: "month" | "text" | "number" | "timestamp",
  value: string | number | null
): string {
  const style = styleId ? ` s="${styleId}"` : "";
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}"${style}/>`;
  }
  if (kind === "number" || kind === "month") {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  // text / timestamp -> inline string (leaves sharedStrings.xml untouched)
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function patchSheetXml(
  xml: string,
  schema: SheetSchema,
  rows: SheetRow[],
  sharedStrings: string[]
): { xml: string; lastDataRow: number; headerRowNumber: number } {
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new WorkbookError("INVALID_WORKBOOK", `Sheet for ${schema.key} has no sheetData.`);
  const inner = sheetDataMatch[1] ?? "";
  const parsedRows = parseRows(inner);

  // --- Locate header row & columns ---
  let headerRow: ParsedRow | null = null;
  let byField: Map<FieldId, string> | null = null;
  for (const row of parsedRows.slice(0, 15)) {
    const headers = row.cells.map(c => ({ col: c.colLetter, text: cellText(c, sharedStrings) }));
    if (!headers.some(h => h.text.trim().toLowerCase() === "month")) continue;
    const resolved = resolveColumns(schema, headers);
    if (resolved.missingRequired.length === 0) {
      headerRow = row;
      byField = resolved.byField;
      break;
    }
  }
  if (!headerRow || !byField) {
    throw new WorkbookError(
      "INVALID_WORKBOOK",
      `Sheet for ${schema.key}: header row with required columns not found.`
    );
  }
  const headerRowNumber = headerRow.rowNumber;
  const managedCols = new Map<string, FieldId>();
  for (const [field, col] of byField) managedCols.set(col, field);

  const dataRows = parsedRows.filter(r => r.rowNumber > headerRowNumber);

  // --- Collect the full column universe (managed + extras) ---
  const allCols = new Set<string>();
  headerRow.cells.forEach(c => c.colLetter && allCols.add(c.colLetter));
  dataRows.forEach(r => r.cells.forEach(c => c.colLetter && allCols.add(c.colLetter)));
  const orderedCols = Array.from(allCols).sort((a, b) => colLetterToIndex(a) - colLetterToIndex(b));
  const extraCols = orderedCols.filter(c => !managedCols.has(c));

  // --- Style / formula templates from the last data row (fallback: first) ---
  const templateRow = dataRows[dataRows.length - 1] ?? null;
  const templateByCol = new Map<string, ParsedCell>();
  if (templateRow) for (const cell of templateRow.cells) templateByCol.set(cell.colLetter, cell);
  const templateRowNumber = templateRow?.rowNumber ?? headerRowNumber + 1;

  // --- Carry unmanaged cells across the rewrite, keyed by row identity ---
  const monthCol = byField.get("month")!;
  const deviceCol = byField.get("deviceId") ?? null;
  const extrasByKey = new Map<string, Map<string, ParsedCell>>();
  for (const row of dataRows) {
    const monthCell = row.cells.find(c => c.colLetter === monthCol);
    const monthText = monthCell ? cellText(monthCell, sharedStrings) : "";
    const month = normalizeMonthCell(monthText !== "" ? monthText : null);
    if (!month) continue;
    const deviceCell = deviceCol ? row.cells.find(c => c.colLetter === deviceCol) : null;
    const key = rowKey(schema.key, month, deviceCell ? cellText(deviceCell, sharedStrings) : null);
    const map = new Map<string, ParsedCell>();
    for (const cell of row.cells) {
      if (!managedCols.has(cell.colLetter)) map.set(cell.colLetter, cell);
    }
    extrasByKey.set(key, map);
  }

  // --- Generate new data rows ---
  const columnKind = new Map<FieldId, "month" | "text" | "number" | "timestamp">();
  for (const col of schema.columns) columnKind.set(col.field, col.kind);

  const newRowsXml: string[] = [];
  let rowNumber = headerRowNumber;
  for (const row of rows) {
    rowNumber++;
    const cellsXml: string[] = [];
    const key = rowKey(schema.key, row.month, (row.values.deviceId as string) ?? null);
    const extras = extrasByKey.get(key);

    for (const col of orderedCols) {
      const ref = `${col}${rowNumber}`;
      const field = managedCols.get(col);

      if (field) {
        const template = templateByCol.get(col);
        const styleId = template?.styleId ?? null;
        if (field === "month") {
          cellsXml.push(buildCellXml(ref, styleId, "month", yyyyMmToExcelSerial(row.month)));
        } else if (field === "deviceId") {
          cellsXml.push(buildCellXml(ref, styleId, "text", String(row.values.deviceId ?? "")));
        } else {
          const kind = columnKind.get(field) ?? "number";
          const value = row.values[field] ?? null;
          cellsXml.push(buildCellXml(ref, styleId, kind, value as string | number | null));
        }
        continue;
      }

      // Unmanaged column: carry the original cell, else derive from template.
      const carried = extras?.get(col);
      if (carried) {
        if (carried.formula !== null) {
          const template = templateByCol.get(col);
          const styleAttr = carried.styleId ? ` s="${carried.styleId}"` : "";
          const formula = carried.formula || template?.formula || "";
          cellsXml.push(`<c r="${ref}"${styleAttr}><f>${formula}</f></c>`);
        } else {
          // Rewrite the row part of the ref, keep everything else untouched.
          const attrs = carried.attrs.replace(/r="[A-Z]+\d+"/, `r="${ref}"`);
          cellsXml.push(carried.inner === null ? `<c${attrs}/>` : `<c${attrs}>${carried.inner}</c>`);
        }
        continue;
      }

      const template = templateByCol.get(col);
      if (template && template.formula !== null) {
        const styleAttr = template.styleId ? ` s="${template.styleId}"` : "";
        const formula = adjustFormulaRows(template.formula, rowNumber - templateRowNumber);
        cellsXml.push(`<c r="${ref}"${styleAttr}><f>${formula}</f></c>`);
      } else if (template?.styleId) {
        cellsXml.push(`<c r="${ref}" s="${template.styleId}"/>`);
      }
      // No template and no carried cell -> emit nothing for this column.
    }
    newRowsXml.push(`<row r="${rowNumber}">${cellsXml.join("")}</row>`);
  }

  const keptRows = parsedRows.filter(r => r.rowNumber <= headerRowNumber).map(r => r.raw);
  const newSheetData = `<sheetData>${keptRows.join("")}${newRowsXml.join("")}</sheetData>`;
  let patched = xml.replace(sheetDataMatch[0], () => newSheetData);

  // --- Update the dimension to the new extent ---
  const lastDataRow = Math.max(rowNumber, headerRowNumber);
  const lastCol = orderedCols[orderedCols.length - 1] ?? "A";
  patched = patched.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCol}${lastDataRow}"/>`);

  return { xml: patched, lastDataRow, headerRowNumber };
}

async function patchSheetTables(zip: JSZip, sheetXmlPath: string, sheetXml: string, lastDataRow: number): Promise<void> {
  const tablePartIds = [...sheetXml.matchAll(/<tablePart\b[^>]*r:id="(rId\d+)"[^>]*\/>/g)].map(m => m[1]);
  if (tablePartIds.length === 0) return;

  const dir = sheetXmlPath.substring(0, sheetXmlPath.lastIndexOf("/"));
  const base = sheetXmlPath.substring(sheetXmlPath.lastIndexOf("/") + 1);
  const relsPath = `${dir}/_rels/${base}.rels`;
  const relsXml = await entryText(zip, relsPath);
  if (!relsXml) return;

  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = getAttr(m[1], "Id");
    const target = getAttr(m[1], "Target");
    if (id && target) relMap.set(id, target);
  }

  for (const rid of tablePartIds) {
    const target = relMap.get(rid);
    if (!target || !target.includes("table")) continue;
    const tablePath = resolveTarget(dir, target);
    const tableXml = await entryText(zip, tablePath);
    if (!tableXml) continue;

    const updateRef = (refValue: string): string => {
      const m = refValue.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!m) return refValue;
      const startRow = parseInt(m[2], 10);
      // A table needs at least one data row below its header.
      const endRow = Math.max(lastDataRow, startRow + 1);
      return `${m[1]}${m[2]}:${m[3]}${endRow}`;
    };

    let patched = tableXml.replace(/(<table\b[^>]*\bref=")([^"]+)(")/, (_all, pre, ref, post) => pre + updateRef(ref) + post);
    patched = patched.replace(/(<autoFilter\b[^>]*\bref=")([^"]+)(")/, (_all, pre, ref, post) => pre + updateRef(ref) + post);
    zip.file(tablePath, patched);
  }
}

// ---------------------------------------------------------------------------
// Workbook-level patching
// ---------------------------------------------------------------------------

export async function patchWorkbookBuffer(original: Buffer, logs: MonthlyLog[]): Promise<{ buffer: Buffer; stats: PatchStats[] }> {
  const zip = await JSZip.loadAsync(original);
  const sheets = await locateSheets(zip);
  const resolved = resolveSheetNames(sheets.map(s => s.name));
  const sharedStrings = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const rowsByTab = logsToRows(logs);
  const stats: PatchStats[] = [];

  for (const schema of SHEET_SCHEMAS) {
    const sheetName = resolved[schema.key];
    if (!sheetName) {
      throw new WorkbookError("INVALID_WORKBOOK", `Required sheet for "${schema.canonicalName}" not found in workbook.`);
    }
    const location = sheets.find(s => s.name === sheetName)!;
    const xml = await entryText(zip, location.xmlPath);
    if (!xml) throw new WorkbookError("INVALID_WORKBOOK", `Missing sheet part ${location.xmlPath}.`);

    const { xml: patchedXml, lastDataRow } = patchSheetXml(xml, schema, rowsByTab[schema.key], sharedStrings);
    zip.file(location.xmlPath, patchedXml);
    await patchSheetTables(zip, location.xmlPath, patchedXml, lastDataRow);
    stats.push({ tab: schema.key, sheetName, dataRows: rowsByTab[schema.key].length });
  }

  // Force a full recalculation on next open (formula caches are stale now).
  const workbookXml = (await entryText(zip, "xl/workbook.xml"))!;
  let patchedWorkbook = workbookXml;
  if (/<calcPr\b[^>]*\/>/.test(patchedWorkbook)) {
    patchedWorkbook = patchedWorkbook.replace(/<calcPr\b([^>]*?)\s*\/>/, (_all, attrs: string) => {
      const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
    });
  } else {
    patchedWorkbook = patchedWorkbook.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
  }
  zip.file("xl/workbook.xml", patchedWorkbook);

  // Drop calcChain (Excel rebuilds it); stale entries cause repair prompts.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const contentTypes = await entryText(zip, "[Content_Types].xml");
    if (contentTypes) {
      zip.file("[Content_Types].xml", contentTypes.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    }
    const workbookRels = await entryText(zip, "xl/_rels/workbook.xml.rels");
    if (workbookRels) {
      zip.file("xl/_rels/workbook.xml.rels", workbookRels.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
    }
  }

  // Ask Excel to refresh pivot caches on open so the dashboard reflects edits.
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)) {
      const xml = await entryText(zip, name);
      if (xml && !/refreshOnLoad=/.test(xml)) {
        zip.file(name, xml.replace(/<pivotCacheDefinition\b/, `<pivotCacheDefinition refreshOnLoad="1"`));
      }
    }
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  return { buffer: buffer as Buffer, stats };
}

// ---------------------------------------------------------------------------
// Lock detection
// ---------------------------------------------------------------------------

export interface LockStatus {
  locked: boolean;
  /** True when an Excel owner file (~$Name.xlsm) exists next to the workbook. */
  excelOwnerFilePresent: boolean;
}

export async function checkWorkbookLock(filePath: string): Promise<LockStatus> {
  const ownerFile = path.join(path.dirname(filePath), `~$${path.basename(filePath)}`);
  let excelOwnerFilePresent = false;
  try {
    await fs.access(ownerFile);
    excelOwnerFilePresent = true;
  } catch {
    /* no owner file */
  }

  let locked = false;
  try {
    const handle = await fs.open(filePath, "r+");
    await handle.close();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") locked = true;
    if (code === "ENOENT") throw new WorkbookError("NOT_FOUND", `Workbook not found: ${filePath}`);
  }
  return { locked, excelOwnerFilePresent };
}

// ---------------------------------------------------------------------------
// Atomic save pipeline
// ---------------------------------------------------------------------------

export interface SaveWorkbookOptions {
  /** Directory for pre-save backups; null disables backups (used by Save As). */
  backupDir: string | null;
  /** How many backups to keep for this workbook name. */
  backupKeep: number;
  /** Target path; defaults to sourcePath (Save). Different path = Save As. */
  targetPath?: string;
}

export interface SaveWorkbookResult {
  path: string;
  backupPath: string | null;
  months: number;
}

function timestampSuffix(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(
    date.getMinutes()
  )}${p(date.getSeconds())}`;
}

export async function createBackup(sourcePath: string, backupDir: string, keep: number): Promise<string> {
  await fs.mkdir(backupDir, { recursive: true });
  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  // Timestamps have second resolution; suffix with a counter on collision so
  // rapid consecutive saves never overwrite an earlier backup.
  const base = `${stem}_${timestampSuffix(new Date())}`;
  let backupPath = path.join(backupDir, `${base}${ext}`);
  for (let n = 2; ; n++) {
    try {
      await fs.access(backupPath);
      backupPath = path.join(backupDir, `${base}-${n}${ext}`);
    } catch {
      break;
    }
  }
  await fs.copyFile(sourcePath, backupPath);

  // Rotate: keep the newest `keep` backups for this workbook stem.
  const entries = await fs.readdir(backupDir);
  const mine = entries
    .filter(e => e.startsWith(`${stem}_`) && e.endsWith(ext))
    .sort()
    .reverse();
  for (const stale of mine.slice(Math.max(1, keep))) {
    try {
      await fs.unlink(path.join(backupDir, stale));
    } catch {
      /* best effort */
    }
  }
  return backupPath;
}

function logsMatch(a: MonthlyLog[], b: MonthlyLog[]): boolean {
  // Both sides are canonicalized through the same writer expansion, so device
  // order/naming differences can never produce a false mismatch.
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : String(v);
  };
  const canon = (logs: MonthlyLog[]) => {
    const rows = logsToRows(logs);
    return JSON.stringify(
      (Object.keys(rows) as TabKey[]).map(tab =>
        rows[tab].map(r => [
          r.month,
          num(r.values.voltage),
          num(r.values.current),
          num(r.values.loadKw),
          num(r.values.loadKva),
          num(r.values.eb41a),
          num(r.values.eb41b),
          num(r.values.eb42a),
          num(r.values.eb42b),
          num(r.values.buildingEnergyKwh),
          num(r.values.buildingElectricityCostThb)
        ])
      )
    );
  };
  return canon(a) === canon(b);
}

export async function saveWorkbook(
  sourcePath: string,
  logs: MonthlyLog[],
  options: SaveWorkbookOptions
): Promise<SaveWorkbookResult> {
  const targetPath = options.targetPath ?? sourcePath;

  let original: Buffer;
  try {
    original = await fs.readFile(sourcePath);
  } catch {
    throw new WorkbookError("NOT_FOUND", `Workbook not found: ${sourcePath}`);
  }

  // 1. Patch in memory.
  const { buffer } = await patchWorkbookBuffer(original, logs);

  // 2. Validate the patched result by re-reading it. A workbook that cannot
  //    be re-read, or that does not round-trip the data, never hits disk.
  const reread = await readWorkbookFromBuffer(buffer);
  if (!reread.validation.ok) {
    throw new WorkbookError(
      "VALIDATION_FAILED",
      `Save aborted - patched workbook failed validation: ${reread.validation.errors.join("; ")}`
    );
  }
  if (!logsMatch(logs, reread.logs)) {
    throw new WorkbookError("VALIDATION_FAILED", "Save aborted - data did not round-trip identically.");
  }

  // 3. Lock check on the file we are about to replace.
  const overwritingExisting = await fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
  if (overwritingExisting) {
    const lock = await checkWorkbookLock(targetPath);
    if (lock.locked) {
      throw new WorkbookError(
        "LOCKED",
        `The workbook is currently open in Excel (or another program). Close it and retry, or use Save As.`
      );
    }
  }

  // 4. Backup the current file before replacing it.
  let backupPath: string | null = null;
  if (overwritingExisting && options.backupDir) {
    backupPath = await createBackup(targetPath, options.backupDir, options.backupKeep);
  }

  // 5. Atomic write: temp file in the same directory, then rename.
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.tmp-${process.pid}`);
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {
      /* already gone */
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new WorkbookError("LOCKED", "The workbook became locked while saving. Close it in Excel and retry.");
    }
    throw new WorkbookError("WRITE_FAILED", `Could not write workbook: ${(err as Error).message}`);
  }

  // 6. Sidecar metadata (last-saved timestamps per month/tab).
  try {
    await writeWorkbookMeta(targetPath, logs);
  } catch {
    /* metadata is best-effort; the workbook itself is already safe */
  }

  return { path: targetPath, backupPath, months: logs.length };
}
