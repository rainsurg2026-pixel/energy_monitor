/**
 * WorkbookWriter - saves MonthlyLog[] back into the workbook.
 *
 * DC_Rangsit.xlsm is a live Excel application: it contains VBA
 * (vbaProject.bin), pivot tables, charts, Excel Tables and calculated
 * columns. Rewriting it with ExcelJS would silently strip all of that.
 *
 * Instead, this module patches the workbook at the OPC/zip level:
 *   - only the <sheetData> of the four managed log sheets is regenerated;
 *   - every other zip entry is carried over byte-for-byte;
 *   - unmanaged columns in managed sheets (e.g. "4th Floor Electricity
 *     Cost") are carried across the rewrite keyed by row identity;
 *   - formula columns are re-emitted with the shared calculation's cached
 *     result where available and the workbook is flagged fullCalcOnLoad so
 *     Excel recalculates on open;
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
import ExcelJS from "exceljs";
import { promises as fs } from "fs";
import path from "path";
import { MonthlyLog } from "../types";
import type { SrinakarinInputSnapshot } from "../types";
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
import { DEFAULT_DEVICE_LISTS, DeviceLists, SheetRow, logsToRows, rowKey } from "./SheetMapper";
import { readWorkbookFromBuffer } from "./WorkbookReader";
import { isSrinakarinWorkbook } from "./SrinakarinWorkbookAdapter";
import { writeWorkbookMeta } from "./WorkbookVersion";
import { calculateAverageElectricityRate, calculateEnergyCostForMonth } from "../utils/energyCost";
import { calculateSrinakarinAggregate } from "../utils/srinakarinPower";
import { patchUpsGroupHistoryBuffer } from "./UpsGroupHistoryWriter";
import type { UpsGroupConfig } from "../utils/upsGroupAggregation";

export type WorkbookErrorCode =
  | "NOT_FOUND"
  | "LOCKED"
  | "INVALID_WORKBOOK"
  | "VALIDATION_FAILED"
  | "WRITE_FAILED";

/**
 * Which step of saveWorkbook actually failed, in save-pipeline order. Set
 * only by saveWorkbook's own throw sites - open/read errors elsewhere in
 * this file leave it undefined. Lets the renderer's save-progress UI report
 * the real point of failure instead of guessing from the last stage it
 * optimistically marked as "in progress" (proven wrong: a LOCKED failure at
 * the pre-backup lock check was displayed with "Creating Backup" checked
 * off, even though zero backup was ever written).
 */
export type SaveFailureStage = "read" | "validate" | "lock" | "backup" | "write";

export class WorkbookError extends Error {
  code: WorkbookErrorCode;
  stage?: SaveFailureStage;
  constructor(code: WorkbookErrorCode, message: string, stage?: SaveFailureStage) {
    super(message);
    this.name = "WorkbookError";
    this.code = code;
    this.stage = stage;
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

interface EnergyStyleOverrides {
  numberStyleId: string;
  formulaStyleId: string;
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

async function ensureExactEnergyNumberStyles(zip: JSZip): Promise<EnergyStyleOverrides> {
  const stylesXml = await entryText(zip, "xl/styles.xml");
  if (!stylesXml) throw new WorkbookError("INVALID_WORKBOOK", "Workbook is missing styles.xml.");

  const numFmtMatches = [...stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)];
  const formatMatch = numFmtMatches.find(match => getAttr(match[1], "formatCode") === "#,##0.00");
  let patchedStyles = stylesXml;
  let numFmtId = formatMatch ? getAttr(formatMatch[1], "numFmtId") : null;
  if (!numFmtId) {
    const ids = numFmtMatches
      .map(match => Number(getAttr(match[1], "numFmtId")))
      .filter(Number.isFinite);
    numFmtId = String(Math.max(163, ...ids) + 1);
    const numFmt = `<numFmt numFmtId="${numFmtId}" formatCode="#,##0.00"/>`;
    if (/<numFmts\b[^>]*>/.test(patchedStyles)) {
      patchedStyles = patchedStyles.replace(/(<numFmts\b[^>]*>)/, `$1${numFmt}`);
      patchedStyles = patchedStyles.replace(/(<numFmts\b[^>]*\bcount=")\d+("[^>]*>)/, (_all, pre, post) => {
        const current = Number((_all.match(/count="(\d+)"/) ?? ["", "0"])[1]);
        return `${pre}${current + 1}${post}`;
      });
    } else {
      patchedStyles = patchedStyles.replace(/(<fonts\b)/, `<numFmts count="1">${numFmt}</numFmts>$1`);
    }
  }

  const cellXfsMatch = patchedStyles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsMatch) throw new WorkbookError("INVALID_WORKBOOK", "Workbook styles.xml is missing cellXfs.");
  const xfXml = cellXfsMatch[1];
  const xfNodes = [...xfXml.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(match => match[0]);
  const makeStyle = (sourceIndex: number): string => {
    const source = xfNodes[sourceIndex] ?? `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
    const openingTagMatch = source.match(/^<xf\b[^>]*(?:\/>|>)/);
    if (!openingTagMatch) return source;
    const openingTag = openingTagMatch[0];
    const patchedOpening = openingTag
      .replace(/\bnumFmtId="[^"]*"/, `numFmtId="${numFmtId}"`)
      .replace(/\bapplyNumberFormat="[^"]*"/, "applyNumberFormat=\"1\"");
    const withApply = /\bapplyNumberFormat="1"/.test(patchedOpening)
      ? patchedOpening
      : patchedOpening.replace(/\/?>(?:$)/, ` applyNumberFormat="1"$&`);
    return withApply + source.slice(openingTag.length);
  };
  const numberStyleId = String(xfNodes.length);
  const formulaStyleId = String(xfNodes.length + 1);
  // DC_Rangsit.xlsm's verified Overall_Energy source styles: D uses xf 7 and
  // E uses xf 62. Only the number format is replaced; borders/alignment remain.
  const numberStyle = makeStyle(7);
  const formulaStyle = makeStyle(62);
  const updatedXfs = `${xfXml}${numberStyle}${formulaStyle}`;
  patchedStyles = patchedStyles.replace(cellXfsMatch[0], cellXfsMatch[0].replace(cellXfsMatch[1], updatedXfs).replace(/(<cellXfs\b[^>]*\bcount=")\d+("[^>]*>)/, `$1${xfNodes.length + 2}$2`));
  zip.file("xl/styles.xml", patchedStyles);
  return { numberStyleId, formulaStyleId };
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

function buildFormulaCellXml(
  ref: string,
  styleId: string | null,
  formula: string,
  cachedValue: number | null = null
): string {
  const style = styleId ? ` s="${styleId}"` : "";
  const cached = cachedValue !== null && Number.isFinite(cachedValue) ? `<v>${cachedValue}</v>` : "";
  return `<c r="${ref}"${style}><f>${formula}</f>${cached}</c>`;
}

interface InputPatch {
  month: string;
  id?: string;
  values: Record<string, number | null>;
}

interface InputPatchOptions {
  /** Some legacy sheets contain duplicate visual headers outside the table. */
  firstMatchingColumnOnly?: boolean;
  /** Final aggregate rows may contain placeholder formulas such as `14+0`. */
  replaceFormulaCells?: boolean;
}

function inputKey(month: string, id?: string): string {
  return `${normalizeMonthCell(month) ?? month}|${String(id ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

interface InputPatchResult {
  xml: string;
  lastDataRow: number;
}

function patchInputSheetXmlWithStats(
  sheetXml: string,
  patches: InputPatch[],
  idRequired: boolean,
  sharedStrings: string[],
  options: InputPatchOptions = {}
): InputPatchResult {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return { xml: sheetXml, lastDataRow: 0 };
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };
  const headers = new Map<string, string>();
  const headerColumns: Array<[string, string]> = [];
  for (const cell of header.cells) {
    const key = cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, "");
    headerColumns.push([key, cell.colLetter]);
    if (!headers.has(key)) headers.set(key, cell.colLetter);
  }
  const monthCol = headers.get("month");
  const idCol = idRequired
    ? [...headers.entries()].find(([key]) => key.includes("ups") || key.includes("panel") || key.includes("acpower"))?.[1]
    : undefined;
  if (!monthCol || (idRequired && !idCol)) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };
  const byKey = new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch]));
  const existingKeys = new Set<string>();
  const patchedRows = rows.map(row => {
    if (row.rowNumber <= header.rowNumber) return row.raw;
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = idCol ? row.cells.find(cell => cell.colLetter === idCol) : undefined;
    const key = inputKey(monthCell ? cellText(monthCell, sharedStrings) : "", idCell ? cellText(idCell, sharedStrings) : undefined);
    const patch = byKey.get(key);
    if (patch && (monthCell || !idRequired)) existingKeys.add(key);
    if (!patch) return row.raw;
    let raw = row.raw;
    for (const [field, value] of Object.entries(patch.values)) {
      const normalizedField = field.toLowerCase().replace(/[^a-z0-9]/g, "");
      // includes(), not startsWith(): some sheets prefix the field name in
      // the header text itself (Srinakarin's "3. DC Data Log" columns are
      // literally "DC Voltage (V)" / "DC Current (A)", normalizing to
      // "dcvoltagev"/"dccurrenta" - a startsWith("voltage") check can never
      // match a key that starts with "dc", so those updates silently
      // no-opped on every save that touched a DC panel value).
      const matchingColumns = headerColumns.filter(([key]) => key === normalizedField || key.includes(normalizedField)).map(([, col]) => col);
      const columns = options.firstMatchingColumnOnly ? matchingColumns.slice(0, 1) : matchingColumns;
      for (const col of columns) {
        const cell = row.cells.find(candidate => candidate.colLetter === col);
        if (!cell || (cell.formula !== null && !options.replaceFormulaCells)) continue;
        const replacement = buildCellXml(`${col}${row.rowNumber}`, cell.styleId, "number", value);
        const escapedRef = `${col}${row.rowNumber}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), replacement);
      }
    }
    return raw;
  });

  const template = [...rows]
    .filter(row => row.rowNumber > header.rowNumber)
    .find(row => {
      const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
      const idCell = idCol ? row.cells.find(cell => cell.colLetter === idCol) : undefined;
      return Boolean(monthCell && cellText(monthCell, sharedStrings) && (!idRequired || (idCell && cellText(idCell, sharedStrings))));
    });
  let lastDataRow = rows.reduce((max, row) => Math.max(max, row.rowNumber), header.rowNumber);
  const missingPatches = [...new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch])).values()]
    .filter(patch => !existingKeys.has(inputKey(patch.month, patch.id)));
  if (template && missingPatches.length > 0) {
    const templateAttrs = template.raw.match(/^<row\b([^>]*)>/)?.[1] ?? `r="${template.rowNumber}"`;
    for (const patch of missingPatches) {
      const rowNumber = ++lastDataRow;
      const rowAttrs = templateAttrs.replace(/\br="\d+"/, `r="${rowNumber}"`);
      const rowCells = template.cells.map(cell => {
        const ref = `${cell.colLetter}${rowNumber}`;
        if (cell.colLetter === monthCol) {
          return buildCellXml(ref, cell.styleId, "month", yyyyMmToExcelSerial(patch.month));
        }
        if (idCol && cell.colLetter === idCol) {
          return buildCellXml(ref, cell.styleId, "text", patch.id ?? null);
        }
        const fieldEntry = headerColumns.find(([key, col]) => col === cell.colLetter &&
          Object.keys(patch.values).some(field => {
            const normalizedField = field.toLowerCase().replace(/[^a-z0-9]/g, "");
            return key === normalizedField || key.includes(normalizedField);
          }));
        if (fieldEntry) {
          const field = Object.keys(patch.values).find(candidate => {
            const normalizedField = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
            return fieldEntry[0] === normalizedField || fieldEntry[0].includes(normalizedField);
          });
          return buildCellXml(ref, cell.styleId, "number", field ? patch.values[field] : null);
        }
        if (cell.formula !== null) {
          const cached = cell.inner?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const cachedValue = cached !== undefined && Number.isFinite(Number(cached)) ? Number(cached) : null;
          return buildFormulaCellXml(ref, cell.styleId, adjustFormulaRows(cell.formula, rowNumber - template.rowNumber), cachedValue);
        }
        return `<c r="${ref}"${cell.styleId ? ` s="${cell.styleId}"` : ""}/>`;
      }).join("");
      patchedRows.push(`<row ${rowAttrs}>${rowCells}</row>`);
    }
  }

  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${lastDataRow}"/>`);
  return { xml, lastDataRow };
}

export function patchInputSheetXml(
  sheetXml: string,
  patches: InputPatch[],
  idRequired: boolean,
  sharedStrings: string[],
  options: InputPatchOptions = {}
): string {
  return patchInputSheetXmlWithStats(sheetXml, patches, idRequired, sharedStrings, options).xml;
}

function srinakarinInputPatches(logs: MonthlyLog[]): Record<string, InputPatch[]> {
  const result: Record<string, InputPatch[]> = {
    "1. UPS Data Log": [],
    "1.1 UPS Data Log By Phase": [],
    "1.4 AC PPC Log By Phase": [],
    "1.4.1 AC PPC Log By Phase(43AB)": [],
    "1.6 AC PPC43 (A)": [],
    "1.7 AC PPC43 Panel (A)": [],
    "2. Air Energy Consumption Log": [],
    "3. DC Data Log": [],
    "4. Electricity Cost Log": []
  };
  for (const log of logs) {
    for (const aggregate of calculateSrinakarinAggregate(log)) {
      result["1. UPS Data Log"].push({
        month: log.month,
        id: aggregate.upsId,
        values: {
          voltage: aggregate.voltage,
          current: aggregate.current,
          loadKw: aggregate.loadKw,
          loadKva: aggregate.loadKva
        }
      });
    }
    const input: SrinakarinInputSnapshot | undefined = log.srinakarinInputs;
    for (const [id, values] of Object.entries(input?.upsPhase ?? {})) result["1.1 UPS Data Log By Phase"].push({ month: log.month, id, values });
    for (const ups of log.ups) {
      for (const [phase, values] of Object.entries(ups.phases ?? {})) {
        result["1.1 UPS Data Log By Phase"].push({ month: log.month, id: `${ups.upsId} - ${phase}`, values: { ...values } });
      }
    }
    for (const [id, values] of Object.entries(input?.acPhase ?? {})) {
      const target = id.includes("43") ? "1.4.1 AC PPC Log By Phase(43AB)" : "1.4 AC PPC Log By Phase";
      result[target].push({ month: log.month, id, values });
    }
    for (const [id, value] of Object.entries(input?.ppc43Current ?? {})) result["1.6 AC PPC43 (A)"].push({ month: log.month, id, values: { panelcurrenta: value } });
    for (const [id, values] of Object.entries(input?.ppc43Panel ?? {})) result["1.7 AC PPC43 Panel (A)"].push({ month: log.month, id, values });
    const airValues: Record<string, number | null> = {};
    for (const field of log.energyCalculation?.airFields ?? ["eb41a", "eb41b", "eb42a", "eb42b"]) {
      airValues[field] = log.air.meters?.[field] ?? (log.air as unknown as Record<string, number | null | undefined>)[field] ?? null;
    }
    result["2. Air Energy Consumption Log"].push({ month: log.month, values: airValues });
    for (const dc of log.dc) result["3. DC Data Log"].push({ month: log.month, id: dc.panelId, values: { voltage: dc.voltage, current: dc.current } });
    result["4. Electricity Cost Log"].push({ month: log.month, values: { buildingenergyconsumptionkwh: log.energyCost.buildingEnergyKwh, buildingelectricitycostthb: log.energyCost.buildingElectricityCostThb } });
  }
  return result;
}

function cachedAverageRate(row: SheetRow): number | null {
  const buildingEnergy = row.values.buildingEnergyKwh;
  const buildingCost = row.values.buildingElectricityCostThb;
  return typeof buildingEnergy === "number" && typeof buildingCost === "number"
    ? calculateAverageElectricityRate(buildingEnergy, buildingCost)
    : null;
}

function patchSheetXml(
  xml: string,
  schema: SheetSchema,
  rows: SheetRow[],
  sharedStrings: string[],
  energyStyles?: EnergyStyleOverrides
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
  for (const [field, col] of byField) {
    const column = schema.columns.find(candidate => candidate.field === field);
    if (!column?.readOnly) managedCols.set(col, field);
  }

  if (schema.key === "ENERGY" &&
      (!byField.has("floorElectricityCostThb") || !byField.has("averageElectricityRateThbPerKwh"))) {
    throw new WorkbookError(
      "INVALID_WORKBOOK",
      "Energy sheet is missing the required calculated columns for 4th Floor Electricity Cost or Average Electricity Rate."
    );
  }

  const dataRows = parsedRows.filter(r => r.rowNumber > headerRowNumber);

  if (schema.key === "ENERGY") {
    for (const field of ["floorElectricityCostThb", "averageElectricityRateThbPerKwh"] as const) {
      const columnLetter = byField.get(field);
      if (!columnLetter) continue;
      const cells = dataRows
        .map(row => row.cells.find(cell => cell.colLetter === columnLetter))
        .filter((cell): cell is ParsedCell => cell !== undefined);
      const hasFormula = cells.some(cell => cell.formula !== null);
      const hasStoredValue = cells.some(cell => cell.formula === null && cellText(cell, sharedStrings).trim() !== "");
      if (field === "floorElectricityCostThb" && hasFormula) {
        throw new WorkbookError(
          "INVALID_WORKBOOK",
          "Energy 4th Floor Electricity Cost must be a stored-value column, not a formula column."
        );
      }
      if (field === "averageElectricityRateThbPerKwh" && hasStoredValue) {
        throw new WorkbookError(
          "INVALID_WORKBOOK",
          "Energy Average Electricity Rate must remain a formula-managed column."
        );
      }
      if (field === "averageElectricityRateThbPerKwh" && cells.length > 0 && !hasFormula) {
        throw new WorkbookError(
          "INVALID_WORKBOOK",
          "Energy Average Electricity Rate has no formula template to preserve."
        );
      }
      if (hasFormula && hasStoredValue) {
        throw new WorkbookError(
          "INVALID_WORKBOOK",
          `Energy calculated column ${field} mixes formulas and stored values.`
        );
      }
    }
  }

  if (schema.key === "ENERGY") {
    const monthRows = new Map<string, number[]>();
    const monthColumn = byField.get("month")!;
    for (const row of dataRows) {
      const monthCell = row.cells.find(cell => cell.colLetter === monthColumn);
      const month = normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null);
      if (!month) continue;
      const rowsForMonth = monthRows.get(month) ?? [];
      rowsForMonth.push(row.rowNumber);
      monthRows.set(month, rowsForMonth);
    }
    const duplicate = Array.from(monthRows.entries()).find(([, rowNumbers]) => rowNumbers.length > 1);
    if (duplicate) {
      throw new WorkbookError(
        "INVALID_WORKBOOK",
        `Energy sheet contains duplicate reporting month ${duplicate[0]} in rows ${duplicate[1].join(", ")}.`
      );
    }
  }

  // --- Collect the full column universe (managed + extras) ---
  const allCols = new Set<string>();
  headerRow.cells.forEach(c => c.colLetter && allCols.add(c.colLetter));
  dataRows.forEach(r => r.cells.forEach(c => c.colLetter && allCols.add(c.colLetter)));
  const orderedCols = Array.from(allCols).sort((a, b) => colLetterToIndex(a) - colLetterToIndex(b));
  const extraCols = orderedCols.filter(c => !managedCols.has(c));

  // --- Style / formula templates from the last data row (fallback: first) ---
  const rowsWithMonth = schema.key === "ENERGY"
    ? dataRows.filter(row => {
        const monthCell = row.cells.find(cell => cell.colLetter === byField!.get("month"));
        return normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null) !== null;
      })
    : dataRows;
  const templateRow = rowsWithMonth[rowsWithMonth.length - 1] ?? dataRows[dataRows.length - 1] ?? null;
  const templateByCol = new Map<string, ParsedCell>();
  if (templateRow) for (const cell of templateRow.cells) templateByCol.set(cell.colLetter, cell);
  const templateRowNumber = templateRow?.rowNumber ?? headerRowNumber + 1;
  let formulaTemplateRowNumber = templateRowNumber;
  if (schema.key === "ENERGY") {
    const averageRateColumn = byField.get("averageElectricityRateThbPerKwh");
    const formulaTemplateRow = averageRateColumn
      ? [...rowsWithMonth].reverse().find(row => row.cells.some(cell => cell.colLetter === averageRateColumn && cell.formula !== null))
      : undefined;
    const formulaTemplateCell = averageRateColumn && formulaTemplateRow
      ? formulaTemplateRow.cells.find(cell => cell.colLetter === averageRateColumn)
      : undefined;
    if (averageRateColumn && formulaTemplateCell && formulaTemplateCell.formula !== null) {
      templateByCol.set(averageRateColumn, formulaTemplateCell);
      formulaTemplateRowNumber = formulaTemplateRow!.rowNumber;
    }
  }
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
      const resolvedField = Array.from(byField.entries()).find(([, fieldCol]) => fieldCol === col)?.[0];

      if (field) {
        const template = templateByCol.get(col);
        const styleId = schema.key === "ENERGY" && energyStyles &&
          (field === "buildingEnergyKwh" || field === "buildingElectricityCostThb")
          ? energyStyles.numberStyleId
          : template?.styleId ?? null;
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

      // Calculated floor cost is stored as a numeric value, while the rate
      // column remains a workbook-managed formula. A null calculation clears
      // any stale stored value but retains the exact numeric-cell format.
      if (schema.key === "ENERGY" && resolvedField === "floorElectricityCostThb") {
        const value = row.values.floorElectricityCostThb;
        if (value !== null && value !== undefined) {
          cellsXml.push(buildCellXml(ref, energyStyles?.numberStyleId ?? templateByCol.get(col)?.styleId ?? null, "number", value as number));
        } else {
          cellsXml.push(buildCellXml(ref, energyStyles?.numberStyleId ?? templateByCol.get(col)?.styleId ?? null, "number", null));
        }
        continue;
      }

      // Unmanaged column: carry the original cell, else derive from template.
      const carried = extras?.get(col);
      if (carried) {
        if (schema.key === "ENERGY" && resolvedField === "averageElectricityRateThbPerKwh" && carried.formula === null) {
          const template = templateByCol.get(col);
          if (!template || template.formula === null) {
            throw new WorkbookError("INVALID_WORKBOOK", "Energy Average Electricity Rate is missing its formula template.");
          }
          const styleId = energyStyles?.formulaStyleId ?? template.styleId;
          const formula = adjustFormulaRows(template.formula, rowNumber - formulaTemplateRowNumber);
          cellsXml.push(buildFormulaCellXml(
            ref,
            styleId,
            formula,
            cachedAverageRate(row)
          ));
          continue;
        }
        if (carried.formula !== null) {
          const template = templateByCol.get(col);
          const styleId = schema.key === "ENERGY" && resolvedField === "averageElectricityRateThbPerKwh"
            ? energyStyles?.formulaStyleId ?? carried.styleId
            : carried.styleId;
          const formula = carried.formula || template?.formula || "";
          cellsXml.push(buildFormulaCellXml(
            ref,
            styleId,
            formula,
            resolvedField === "averageElectricityRateThbPerKwh" ? cachedAverageRate(row) : null
          ));
        } else {
          // Rewrite the row part of the ref, keep everything else untouched.
          const attrs = carried.attrs.replace(/r="[A-Z]+\d+"/, `r="${ref}"`);
          cellsXml.push(carried.inner === null ? `<c${attrs}/>` : `<c${attrs}>${carried.inner}</c>`);
        }
        continue;
      }

      const template = templateByCol.get(col);
      if (template && template.formula !== null) {
        const styleId = schema.key === "ENERGY" && resolvedField === "averageElectricityRateThbPerKwh"
          ? energyStyles?.formulaStyleId ?? template.styleId
          : template.styleId;
        const formula = adjustFormulaRows(template.formula, rowNumber - formulaTemplateRowNumber);
        cellsXml.push(buildFormulaCellXml(
          ref,
          styleId,
          formula,
          resolvedField === "averageElectricityRateThbPerKwh" ? cachedAverageRate(row) : null
        ));
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

export async function patchWorkbookBuffer(
  original: Buffer,
  logs: MonthlyLog[],
  devices: DeviceLists = DEFAULT_DEVICE_LISTS
): Promise<{ buffer: Buffer; stats: PatchStats[] }> {
  const zip = await JSZip.loadAsync(original);
  const sheets = await locateSheets(zip);
  const resolved = resolveSheetNames(sheets.map(s => s.name));
  const energyStyles = await ensureExactEnergyNumberStyles(zip);
  const sharedStrings = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const rowsByTab = logsToRows(logs, devices);
  const calculatedEnergyCosts = new Map(
    logs.map(log => [log.month, calculateEnergyCostForMonth(logs, log.month).floorElectricityCostThb] as const)
  );
  for (const row of rowsByTab.ENERGY) {
    row.values.floorElectricityCostThb = calculatedEnergyCosts.get(row.month) ?? null;
  }
  const energyTables = await Promise.all(
    Object.keys(zip.files)
      .filter(name => /^xl\/tables\/table\d+\.xml$/.test(name))
      .map(async name => await entryText(zip, name))
  );
  if (!energyTables.some(xml => xml?.match(/<table\b[^>]*\bname="Overall_Energy"/))) {
    throw new WorkbookError("INVALID_WORKBOOK", "Workbook is missing the Overall_Energy table.");
  }
  const stats: PatchStats[] = [];

  for (const schema of SHEET_SCHEMAS) {
    const sheetName = resolved[schema.key];
    if (!sheetName) {
      throw new WorkbookError("INVALID_WORKBOOK", `Required sheet for "${schema.canonicalName}" not found in workbook.`);
    }
    const location = sheets.find(s => s.name === sheetName)!;
    const xml = await entryText(zip, location.xmlPath);
    if (!xml) throw new WorkbookError("INVALID_WORKBOOK", `Missing sheet part ${location.xmlPath}.`);

    const { xml: patchedXml, lastDataRow } = patchSheetXml(
      xml,
      schema,
      rowsByTab[schema.key],
      sharedStrings,
      schema.key === "ENERGY" ? energyStyles : undefined
    );
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

export async function patchSrinakarinWorkbookBuffer(original: Buffer, logs: MonthlyLog[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const sheets = await locateSheets(zip);
  const sharedStrings = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const patches = srinakarinInputPatches(logs);
  for (const [sheetName, sheetPatches] of Object.entries(patches)) {
    if (sheetPatches.length === 0) continue;
    const location = sheets.find(sheet => sheet.name === sheetName);
    if (!location) continue;
    const xml = await entryText(zip, location.xmlPath);
    if (!xml) continue;
    const idRequired = !["2. Air Energy Consumption Log", "4. Electricity Cost Log"].includes(sheetName);
    const isMonthlyAggregate = sheetName === "1. UPS Data Log";
    const patchedInput = patchInputSheetXmlWithStats(xml, sheetPatches, idRequired, sharedStrings, {
      firstMatchingColumnOnly: isMonthlyAggregate,
      replaceFormulaCells: isMonthlyAggregate
    });
    zip.file(location.xmlPath, patchedInput.xml);
    await patchSheetTables(zip, location.xmlPath, patchedInput.xml, patchedInput.lastDataRow);
  }

  const workbookXml = await entryText(zip, "xl/workbook.xml");
  if (workbookXml) {
    const patched = /<calcPr\b[^>]*\/>/.test(workbookXml)
      ? workbookXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (_all, attrs: string) => `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`)
      : workbookXml.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
    zip.file("xl/workbook.xml", patched);
  }
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}

/** Validate stored calculated values without depending on Excel formula caches. */
async function validatePersistedEnergyValues(buffer: Buffer, logs: MonthlyLog[]): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = await locateSheets(zip);
  const energySheetName = resolveSheetNames(sheets.map(sheet => sheet.name)).ENERGY;
  const energySheet = energySheetName ? sheets.find(sheet => sheet.name === energySheetName) : undefined;
  if (!energySheet) throw new WorkbookError("VALIDATION_FAILED", "Saved workbook is missing the Energy sheet.", "validate");
  const xml = await entryText(zip, energySheet.xmlPath);
  if (!xml) throw new WorkbookError("VALIDATION_FAILED", "Saved workbook is missing the Energy sheet XML.", "validate");
  const sharedStrings = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const rows = parseRows((xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/) ?? ["", ""])[1]);
  const schema = SHEET_SCHEMAS.find(candidate => candidate.key === "ENERGY")!;
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) throw new WorkbookError("VALIDATION_FAILED", "Saved workbook is missing the Energy header row.", "validate");
  const headers = header.cells.map(cell => ({ col: cell.colLetter, text: cellText(cell, sharedStrings) }));
  const columns = resolveColumns(schema, headers).byField;
  const monthColumn = columns.get("month");
  const floorCostColumn = columns.get("floorElectricityCostThb");
  const averageRateColumn = columns.get("averageElectricityRateThbPerKwh");
  if (!monthColumn || !floorCostColumn || !averageRateColumn) {
    throw new WorkbookError("VALIDATION_FAILED", "Saved workbook is missing calculated Energy columns.", "validate");
  }
  const rowsByMonth = new Map<string, ParsedRow>();
  for (const row of rows.filter(candidate => candidate.rowNumber > header.rowNumber)) {
    const monthCell = row.cells.find(cell => cell.colLetter === monthColumn);
    const month = normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null);
    if (month) rowsByMonth.set(month, row);
  }
  for (const log of logs) {
    const month = normalizeMonthCell(log.month);
    const expected = calculateEnergyCostForMonth(logs, log.month).floorElectricityCostThb;
    if (!month) continue;
    const row = rowsByMonth.get(month);
    if (expected !== null) {
      const cell = row?.cells.find(candidate => candidate.colLetter === floorCostColumn);
      const stored = cell ? Number(cellText(cell, sharedStrings)) : NaN;
      if (!Number.isFinite(stored) || Math.abs(stored - expected) > 0.01) {
        throw new WorkbookError(
          "VALIDATION_FAILED",
          `Saved workbook floor cost for ${month} does not match the shared calculation.`,
          "validate"
        );
      }
    }
    const expectedRate = calculateAverageElectricityRate(
      log.energyCost.buildingEnergyKwh,
      log.energyCost.buildingElectricityCostThb
    );
    if (expectedRate !== null) {
      const rateCell = row?.cells.find(candidate => candidate.colLetter === averageRateColumn);
      const storedRate = rateCell ? Number(cellText(rateCell, sharedStrings)) : NaN;
      if (!Number.isFinite(storedRate) || Math.abs(storedRate - expectedRate) > 1e-12) {
        throw new WorkbookError(
          "VALIDATION_FAILED",
          `Saved workbook average electricity rate for ${month} does not match the shared calculation.`,
          "validate"
        );
      }
    }
  }
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
  /** Facility device lists (canonical order); defaults to the RST lists. */
  devices?: DeviceLists;
  /** UPS Group History persistence (see UpsGroupHistoryWriter.ts). Omitted ->
   *  no History sheet is created/updated by this save. `onlyMonths` unset ->
   *  backfill semantics (insert only where missing); set -> incremental
   *  upsert for exactly those months. */
  upsGroupHistory?: {
    facilityId: string;
    upsGroups: UpsGroupConfig[];
    onlyMonths?: string[];
  };
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

/** First mismatching (tab, month, field, intended, actual), or null if every compared field matches. */
function findLogsMismatch(a: MonthlyLog[], b: MonthlyLog[], devices: DeviceLists): string | null {
  // Both sides are canonicalized through the same writer expansion, so device
  // order/naming differences can never produce a false mismatch.
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : String(v);
  };
  const fields = ["voltage", "current", "loadKw", "loadKva", "eb41a", "eb41b", "eb42a", "eb42b", "buildingEnergyKwh", "buildingElectricityCostThb"] as const;
  const rowsA = logsToRows(a, devices);
  const rowsB = logsToRows(b, devices);
  for (const tab of Object.keys(rowsA) as TabKey[]) {
    const listA = rowsA[tab];
    const listB = rowsB[tab];
    if (listA.length !== listB.length) return `${tab}: row count ${listA.length} (intended) vs ${listB.length} (reread)`;
    for (let i = 0; i < listA.length; i++) {
      const ra = listA[i];
      const rb = listB[i];
      if (ra.month !== rb.month) return `${tab}[${i}]: month ${ra.month} (intended) vs ${rb.month} (reread)`;
      for (const field of fields) {
        const va = num(ra.values[field]);
        const vb = num(rb.values[field]);
        if (va !== vb) return `${tab} ${ra.month} row ${i}: ${field} intended=${JSON.stringify(va)} reread=${JSON.stringify(vb)}`;
      }
    }
  }
  return null;
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
    throw new WorkbookError("NOT_FOUND", `Workbook not found: ${sourcePath}`, "read");
  }

  // Detect the multi-stage Srinakarin layout before selecting a writer.
  const workbookProbe = new ExcelJS.Workbook();
  await workbookProbe.xlsx.load(original as unknown as ArrayBuffer);
  const srinakarin = isSrinakarinWorkbook(workbookProbe.worksheets.map(ws => ws.name));

  const devices = options.devices ?? DEFAULT_DEVICE_LISTS;

  // 1. Patch in memory. Srinakarin uses a whitelist writer for purple input
  // sheets; Rangsit continues through the historical four-tab patcher.
  const patchedBuffer = srinakarin
    ? await patchSrinakarinWorkbookBuffer(original, logs)
    : (await patchWorkbookBuffer(original, logs, devices)).buffer;

  // 1b. UPS Group History (optional): additive-only zip surgery on top of
  // the already-patched buffer - never touches the four managed log sheets,
  // VBA, pivots or charts (see UpsGroupHistoryWriter.ts).
  const buffer = options.upsGroupHistory
    ? await patchUpsGroupHistoryBuffer(
        patchedBuffer,
        options.upsGroupHistory.facilityId,
        options.upsGroupHistory.upsGroups,
        logs,
        options.upsGroupHistory.onlyMonths
      )
    : patchedBuffer;

  // 2. Validate the patched result by re-reading it. A workbook that cannot
  //    be re-read, or that does not round-trip the data, never hits disk.
  const reread = await readWorkbookFromBuffer(buffer, devices);
  if (!reread.validation.ok) {
    throw new WorkbookError(
      "VALIDATION_FAILED",
      `Save aborted - patched workbook failed validation: ${reread.validation.errors.join("; ")}`,
      "validate"
    );
  }
  const logsToValidate = srinakarin
    ? logs.map(log => ({ ...log, ups: calculateSrinakarinAggregate(log) }))
    : logs;
  const mismatch = findLogsMismatch(logsToValidate, reread.logs, devices);
  if (mismatch) {
    throw new WorkbookError("VALIDATION_FAILED", `Save aborted - data did not round-trip identically. (${mismatch})`, "validate");
  }
  if (!srinakarin) await validatePersistedEnergyValues(buffer, logs);

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
        `The workbook is currently open in Excel (or another program). Close it and retry, or use Save As.`,
        "lock"
      );
    }
  }

  // 4. Backup the current file before replacing it.
  let backupPath: string | null = null;
  if (overwritingExisting && options.backupDir) {
    try {
      backupPath = await createBackup(targetPath, options.backupDir, options.backupKeep);
    } catch (err) {
      throw new WorkbookError(
        "WRITE_FAILED",
        `Could not create a backup before saving: ${(err as Error).message}`,
        "backup"
      );
    }
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
      throw new WorkbookError("LOCKED", "The workbook became locked while saving. Close it in Excel and retry.", "write");
    }
    throw new WorkbookError("WRITE_FAILED", `Could not write workbook: ${(err as Error).message}`, "write");
  }

  // 6. Sidecar metadata (last-saved timestamps per month/tab).
  try {
    await writeWorkbookMeta(targetPath, logs);
  } catch {
    /* metadata is best-effort; the workbook itself is already safe */
  }

  return { path: targetPath, backupPath, months: logs.length };
}
