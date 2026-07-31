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
  resolveSheetNames
} from "./ExcelSchema";
import { DEFAULT_DEVICE_LISTS, DeviceLists, SheetRow, logsToRows, rowKey } from "./SheetMapper";
import { readWorkbookFromBuffer } from "./WorkbookReader";
import { isSrinakarinWorkbook } from "./SrinakarinWorkbookAdapter";
import { writeWorkbookMeta } from "./WorkbookVersion";
import { calculateAverageElectricityRate, calculateEnergyCostForMonth, getAirValue } from "../utils/energyCost";
import { calculateSrinakarinAggregate } from "../utils/srinakarinPower";
import { patchUpsGroupHistoryBuffer } from "./UpsGroupHistoryWriter";
import type { UpsGroupConfig } from "../utils/upsGroupAggregation";
import {
  WorkbookError,
  entryText,
  ensureExactCellFormatStyles,
  getAttr,
  workbookMonthSerial,
  workbookUsesDate1904
} from "./ExcelZipUtils";
import type { SaveFailureStage, WorkbookErrorCode } from "./ExcelZipUtils";

// Re-exported for existing external consumers (src/electron/ipc/excel.ts,
// src/electron/sync/BackupManager.ts, src/excel/RackCapacityWriter.ts) that
// import these by name from "./WorkbookWriter" - their definitions now live
// in ExcelZipUtils.ts so RackCapacityHistoryWriter.ts (which is reachable
// from the renderer bundle via reportDataBuilder.ts) never has to import
// this file's fs/path/ExcelJS dependencies just for pure XML/date helpers.
export { WorkbookError };
export type { SaveFailureStage, WorkbookErrorCode };

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

/**
 * Clone the supplied styles with centered alignment only.  Fonts, fills,
 * borders, number formats and all existing alignment settings are retained.
 */
async function ensureCenteredCellStyles(
  zip: JSZip,
  sourceStyleIds: Iterable<string>
): Promise<Map<string, string>> {
  const stylesXml = await entryText(zip, "xl/styles.xml");
  if (!stylesXml) throw new WorkbookError("INVALID_WORKBOOK", "Workbook is missing styles.xml.");
  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsMatch) throw new WorkbookError("INVALID_WORKBOOK", "Workbook styles.xml is missing cellXfs.");
  const xfXml = cellXfsMatch[1];
  const xfNodes = [...xfXml.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(match => match[0]);
  const makeCentered = (sourceIndex: number): string => {
    const source = xfNodes[sourceIndex] ?? `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
    const openingMatch = source.match(/^<xf\b[^>]*(?:\/>|>)/);
    if (!openingMatch) return source;
    const opening = openingMatch[0];
    const withApply = /\bapplyAlignment="1"/.test(opening)
      ? opening
      : /\bapplyAlignment=/.test(opening)
        ? opening.replace(/\bapplyAlignment="[^"]*"/, "applyAlignment=\"1\"")
        : opening.replace(/\/?>(?:$)/, ` applyAlignment="1"$&`);
    const body = source.slice(opening.length);
    const centeredAlignment = (alignment: string): string => {
      const horizontal = /\bhorizontal=/.test(alignment)
        ? alignment.replace(/\bhorizontal="[^"]*"/, "horizontal=\"center\"")
        : alignment.replace(/\/?>(?:$)/, ` horizontal="center"$&`);
      return /\bvertical=/.test(horizontal)
        ? horizontal.replace(/\bvertical="[^"]*"/, "vertical=\"center\"")
        : horizontal.replace(/\/?>(?:$)/, ` vertical="center"$&`);
    };
    if (/^<xf\b[^>]*\/>$/.test(opening)) {
      return `${withApply.replace(/\/>$/, ">")}<alignment horizontal="center" vertical="center"/></xf>`;
    }
    if (/<alignment\b[^>]*(?:\/>|>[\s\S]*?<\/alignment>)/.test(body)) {
      return withApply + body.replace(/<alignment\b[^>]*(?:\/>|>[\s\S]*?<\/alignment>)/, centeredAlignment);
    }
    return `${withApply}${body.replace(/<\/xf>$/, '<alignment horizontal="center" vertical="center"/></xf>')}`;
  };

  const overrides = new Map<string, string>();
  const added: string[] = [];
  const styleIndexes = new Map(xfNodes.map((style, index) => [style, index]));
  for (const sourceStyleId of new Set(sourceStyleIds)) {
    const style = makeCentered(Number(sourceStyleId));
    let index = styleIndexes.get(style);
    if (index === undefined) {
      index = xfNodes.length + added.length;
      styleIndexes.set(style, index);
      added.push(style);
    }
    overrides.set(sourceStyleId, String(index));
  }
  if (added.length === 0) return overrides;
  const updatedXfs = `${xfXml}${added.join("")}`;
  const patched = stylesXml.replace(
    cellXfsMatch[0],
    cellXfsMatch[0]
      .replace(cellXfsMatch[1], updatedXfs)
      .replace(/(<cellXfs\b[^>]*\bcount=")\d+("[^>]*>)/, `$1${xfNodes.length + added.length}$2`)
  );
  zip.file("xl/styles.xml", patched);
  return overrides;
}

function sheetCellStyleIds(sheetXml: string): Set<string> {
  const sheetDataMatch = sheetXml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return new Set(["0"]);
  const rows = parseRows(sheetDataMatch[1] ?? "");
  const styles = new Set<string>();
  for (const row of rows) for (const cell of row.cells) styles.add(cell.styleId ?? "0");
  return styles.size ? styles : new Set(["0"]);
}

/** Apply only the required number format to existing V/A/kW/kVA data cells. */
function applyMeasurementNumberFormats(
  sheetXml: string,
  sharedStrings: string[],
  numberStyles: Map<string, string>,
  centeredStyles?: Map<string, string>
): string {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return sheetXml;
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => {
    const keys = row.cells.map(cell => cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""));
    return (keys.includes("month") || keys.includes("no")) &&
      keys.some(key => key.includes("voltage") || key.includes("current") || key.includes("kw") || key.includes("kva"));
  });
  if (!header) return sheetXml;
  const columns = new Set(header.cells
    .filter(cell => {
      const key = cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, "");
      return key.includes("voltage") || key.includes("current") || key.includes("kw") || key.includes("kva");
    })
    .map(cell => cell.colLetter));
  if (columns.size === 0) return sheetXml;

  const patchedRows = rows.map(row => {
    if (row.rowNumber <= header.rowNumber) return row.raw;
    let raw = row.raw;
    for (const cell of row.cells.filter(candidate => columns.has(candidate.colLetter))) {
      const numberStyle = numberStyles.get(cell.styleId ?? "0") ?? cell.styleId;
      const styleId = centeredStyles?.get(numberStyle ?? "0") ?? numberStyle;
      if (!styleId) continue;
      const ref = `${cell.colLetter}${row.rowNumber}`;
      const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), match => {
        const end = match.indexOf(">");
        const opening = match.slice(0, end + 1);
        const rest = match.slice(end + 1);
        const formatted = /\bs="[^"]*"/.test(opening)
          ? opening.replace(/\bs="[^"]*"/, `s="${styleId}"`)
          : opening.replace(/\/?>(?:$)/, suffix => ` s="${styleId}"${suffix}`);
        return formatted + rest;
      });
    }
    return raw;
  });
  return sheetXml.replace(sheetDataMatch[0], `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`);
}

/**
 * Apply the workbook-wide numeric display rule without changing stored values
 * or formulas. Month/date columns and text lookup formulas retain their
 * existing formats; Dashboard-FAC's Air GWh source/difference cells are the
 * sole numeric exception and retain the source workbook's precision.
 */
function applyGlobalNumericNumberFormats(
  sheetXml: string,
  sharedStrings: string[],
  numberStyles: Map<string, string>,
  percentageStyles: Map<string, string>,
  centeredStyles?: Map<string, string>,
  sheetName?: string
): string {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return sheetXml;
  const rows = parseRows(sheetDataMatch[2]);
  const monthColumns = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      const key = cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key === "month" || key === "reportingmonth") monthColumns.add(cell.colLetter);
    }
  }
  const airExceptionColumns = new Set<string>();
  let airHeaderRow = -1;
  let airEndRow = Number.POSITIVE_INFINITY;
  const percentageRegions = sheetName === "Dashboard-FAC" ? dashboardPercentageRegions(rows, sharedStrings) : [];
  if (sheetName === "Dashboard-FAC") {
    const airHeader = rows.find(row => row.cells.some(cell => {
      const key = cellText(cell, sharedStrings).replace(/[^a-z0-9]/gi, "").toLowerCase();
      return key.startsWith("eb") && key.endsWith("gwh");
    }));
    if (airHeader) {
      airHeaderRow = airHeader.rowNumber;
      for (const cell of airHeader.cells) {
        const key = cellText(cell, sharedStrings).replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (key.startsWith("eb") && key.endsWith("gwh")) airExceptionColumns.add(cell.colLetter);
      }
      airEndRow = rows.find(row => row.rowNumber > airHeaderRow && /^\d+\.?\s*(?:dc|overall)/i.test(cellText(row.cells[0] ?? { colLetter: "", attrs: "", inner: null, styleId: null, type: null, formula: null }, sharedStrings)))?.rowNumber ?? Number.POSITIVE_INFINITY;
    }
  }
  const isNumericFormula = (cell: ParsedCell): boolean => {
    if (cell.formula === null) return false;
    return !/PPC-Mapping/i.test(cell.formula);
  };
  const hasNumericValue = (cell: ParsedCell): boolean => {
    const value = cell.inner?.match(/<v>([^<]*)<\/v>/)?.[1]?.trim();
    return value !== undefined && value !== "" && Number.isFinite(Number(value));
  };
  const formatCell = (row: ParsedRow, cell: ParsedCell): string => {
    if (monthColumns.has(cell.colLetter) || (sheetName === "Dashboard-FAC" && cell.colLetter === "H" && row.rowNumber === 1)) return row.raw;
    if (sheetName === "Dashboard-FAC" && row.rowNumber > airHeaderRow && row.rowNumber < airEndRow && airExceptionColumns.has(cell.colLetter)) return row.raw;
    if (sheetName === "Dashboard-FAC" && isDashboardPercentageCell(row, cell, percentageRegions)) return row.raw;
    if (!hasNumericValue(cell) && !isNumericFormula(cell)) return row.raw;
    const numberStyle = numberStyles.get(cell.styleId ?? "0") ?? cell.styleId;
    const styleId = centeredStyles?.get(numberStyle ?? "0") ?? numberStyle;
    if (!styleId) return row.raw;
    const ref = `${cell.colLetter}${row.rowNumber}`;
    const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return row.raw.replace(new RegExp(`<c\\b(?=[^>]*\\br=\"${escapedRef}\")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), match => {
      const end = match.indexOf(">");
      const opening = match.slice(0, end + 1);
      const rest = match.slice(end + 1);
      const formatted = /\bs="[^"]*"/.test(opening)
        ? opening.replace(/\bs="[^"]*"/, `s="${styleId}"`)
        : opening.replace(/\/?>(?:$)/, suffix => ` s="${styleId}"${suffix}`);
      return formatted + rest;
    });
  };
  const patchedRows = rows.map(row => {
    let raw = row.raw;
    for (const cell of row.cells) raw = formatCell({ ...row, raw }, cell);
    return raw;
  });
  const formatted = sheetXml.replace(sheetDataMatch[0], `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`);
  return sheetName === "Dashboard-FAC"
    ? applyDashboardPercentageNumberFormats(formatted, sharedStrings, percentageStyles, centeredStyles)
    : formatted;
}

/** Keep the existing Dashboard-FAC calculations, but extend their DC source
 * ranges to the existing table so newly appended months participate. */
function patchDashboardDcLookupRanges(sheetXml: string): string {
  return sheetXml
    .replace(/'3\. DC Data Log'!\$A\$3:\$A\$12/g, "PPC_DC[Month]")
    .replace(/'3\. DC Data Log'!\$B\$3:\$B\$12/g, "PPC_DC[DC Power Panel]")
    .replace(/'3\. DC Data Log'!\$C\$3:\$C\$12/g, "PPC_DC[DC Voltage (V)]")
    .replace(/'3\. DC Data Log'!\$D\$3:\$D\$12/g, "PPC_DC[DC Current (A)]");
}

interface DashboardPercentageRegion {
  column: string;
  startRow: number;
  endRow: number;
}

function dashboardPercentageRegions(rows: ParsedRow[], sharedStrings: string[]): DashboardPercentageRegion[] {
  const regions: DashboardPercentageRegion[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cellText(cell, sharedStrings).includes("%")) continue;
      const nextHeader = rows.find(candidate => candidate.rowNumber > row.rowNumber && (() => {
        const next = candidate.cells.find(item => item.colLetter === cell.colLetter);
        return Boolean(next && next.formula === null && cellText(next, sharedStrings).trim() !== "");
      })());
      regions.push({ column: cell.colLetter, startRow: row.rowNumber + 1, endRow: nextHeader?.rowNumber ?? Number.POSITIVE_INFINITY });
    }
  }
  return regions;
}

function isDashboardPercentageCell(row: ParsedRow, cell: ParsedCell, regions: DashboardPercentageRegion[]): boolean {
  return regions.some(region => region.column === cell.colLetter && row.rowNumber >= region.startRow && row.rowNumber < region.endRow);
}

function applyDashboardPercentageNumberFormats(
  sheetXml: string,
  sharedStrings: string[],
  percentageStyles: Map<string, string>,
  centeredStyles?: Map<string, string>
): string {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return sheetXml;
  const rows = parseRows(sheetDataMatch[2]);
  const regions = dashboardPercentageRegions(rows, sharedStrings);
  if (regions.length === 0) return sheetXml;
  const numericFormula = (cell: ParsedCell) => cell.formula !== null && !/PPC-Mapping/i.test(cell.formula);
  const numericValue = (cell: ParsedCell) => {
    const value = cell.inner?.match(/<v>([^<]*)<\/v>/)?.[1]?.trim();
    return value !== undefined && value !== "" && Number.isFinite(Number(value));
  };
  const patchedRows = rows.map(row => {
    let raw = row.raw;
    for (const cell of row.cells) {
      if (!isDashboardPercentageCell(row, cell, regions) || (!numericValue(cell) && !numericFormula(cell))) continue;
      const percentageStyle = percentageStyles.get(cell.styleId ?? "0") ?? cell.styleId;
      const styleId = centeredStyles?.get(percentageStyle ?? "0") ?? percentageStyle;
      if (!styleId) continue;
      const ref = `${cell.colLetter}${row.rowNumber}`;
      const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), match => {
        const end = match.indexOf(">");
        const opening = match.slice(0, end + 1);
        const rest = match.slice(end + 1);
        const formatted = /\bs="[^"]*"/.test(opening)
          ? opening.replace(/\bs="[^"]*"/, `s="${styleId}"`)
          : opening.replace(/\/?>(?:$)/, suffix => ` s="${styleId}"${suffix}`);
        return formatted + rest;
      });
    }
    return raw;
  });
  return sheetXml.replace(sheetDataMatch[0], `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`);
}

/** Remove stale formula error caches so Excel can recalculate the preserved
 * Dashboard-FAC formulas from the now-normalized numeric source cells. */
function clearFormulaErrorCaches(sheetXml: string): string {
  return sheetXml.replace(/<v(?:\s[^>]*)?>#(?:VALUE|REF|N\/A|DIV\/0|NAME|NUM|NULL)!?<\/v>/gi, "");
}

function validatePersistedDcInputs(
  zip: JSZip,
  sheets: SheetLocation[],
  sharedStrings: string[]
): Promise<void> {
  return (async () => {
    const location = sheets.find(sheet => sheet.name === "3. DC Data Log");
    if (!location) return;
    const xml = await entryText(zip, location.xmlPath);
    const sheetData = xml?.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
    if (!sheetData) throw new WorkbookError("VALIDATION_FAILED", "DC save validation failed: 3. DC Data Log has no data.", "validate");
    const rows = parseRows(sheetData);
    const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
    if (!header) throw new WorkbookError("VALIDATION_FAILED", "DC save validation failed: 3. DC Data Log header is missing.", "validate");
    const columns = new Map(header.cells.map(cell => [cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), cell.colLetter]));
    const monthCol = columns.get("month");
    const idCol = columns.get("dcpowerpanel");
    const voltageCol = columns.get("dcvoltagev");
    const currentCol = columns.get("dccurrenta");
    if (!monthCol || !idCol || !voltageCol || !currentCol) throw new WorkbookError("VALIDATION_FAILED", "DC save validation failed: required columns are missing.", "validate");
    for (const row of rows.filter(candidate => candidate.rowNumber > header.rowNumber)) {
      const month = normalizeMonthCell(cellText(row.cells.find(cell => cell.colLetter === monthCol) ?? { colLetter: "", attrs: "", inner: null, styleId: null, type: null, formula: null }, sharedStrings));
      const id = cellText(row.cells.find(cell => cell.colLetter === idCol) ?? { colLetter: "", attrs: "", inner: null, styleId: null, type: null, formula: null }, sharedStrings).trim();
      if (!month?.startsWith("2026-") || !id) continue;
      for (const [field, column] of [["DC Voltage (V)", voltageCol], ["DC Current (A)", currentCol]] as const) {
        const cell = row.cells.find(candidate => candidate.colLetter === column);
        const value = cell?.inner?.match(/<v>([^<]*)<\/v>/)?.[1];
        if (value !== undefined && value !== "" && !Number.isFinite(Number(value))) {
          throw new WorkbookError("VALIDATION_FAILED", `DC save validation failed: ${month}, ${id}, ${field}, ${column}${row.rowNumber} is not a finite numeric value.`, "validate");
        }
      }
    }
  })();
}

/** Center exactly the header and valid monthly-record cells in a monthly table. */
function centerMonthlySheetRecords(
  sheetXml: string,
  sharedStrings: string[],
  centeredStyles: Map<string, string>
): string {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return sheetXml;
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) return sheetXml;
  const monthCol = header.cells.find(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month")?.colLetter;
  if (!monthCol) return sheetXml;
  const centerRow = (row: ParsedRow): string => {
    let raw = row.raw;
    for (const cell of row.cells) {
      const styleId = centeredStyles.get(cell.styleId ?? "0");
      if (!styleId) continue;
      const ref = `${cell.colLetter}${row.rowNumber}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), match => {
        const end = match.indexOf(">");
        const opening = match.slice(0, end + 1);
        const rest = match.slice(end + 1);
        const centered = /\bs="[^"]*"/.test(opening)
          ? opening.replace(/\bs="[^"]*"/, `s="${styleId}"`)
          : opening.replace(/\/?>(?:$)/, suffix => ` s="${styleId}"${suffix}`);
        return centered + rest;
      });
    }
    return raw;
  };
  const patchedRows = rows.map(row => {
    if (row.rowNumber === header.rowNumber) return centerRow(row);
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    return row.rowNumber > header.rowNumber && normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null)
      ? centerRow(row)
      : row.raw;
  });
  return sheetXml.replace(sheetDataMatch[0], `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`);
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

const ENGLISH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatWorkbookMonth(value: unknown): string | null {
  const normalized = normalizeMonthCell(value);
  if (!normalized) return null;
  const [year, month] = normalized.split("-").map(Number);
  return Number.isInteger(year) && month >= 1 && month <= 12 ? `${ENGLISH_MONTHS[month - 1]}-${String(year).slice(-2)}` : null;
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
  /** Preserve a formula while refreshing its cached result from the app calculation. */
  updateFormulaCaches?: boolean;
  /** Exact display styles for app-written numeric cells. */
  numberStyles?: Map<string, string>;
  /** Exact display styles for app-written Month cells. */
  monthStyles?: Map<string, string>;
  /** Workbook date system. */
  date1904?: boolean;
}

function isMonthIn2026(value: unknown): boolean {
  return normalizeMonthCell(value)?.startsWith("2026-") ?? false;
}

function isPpc43Id(value: string): boolean {
  return /^ppc\s*43(?:\s*[ab])?(?:\s*-|$)/i.test(value.trim());
}

/**
 * Sheet 1.4.1's Current (A) is the exact Panel 1 + Panel 2 total from
 * Sheet 1.6 for the same PPC43 phase.  Never fall back to the old phase
 * value: a missing source must make the save fail instead of retaining it.
 */
function ppc43PanelCurrentTotal(
  input: SrinakarinInputSnapshot | undefined,
  month: string,
  phaseId: string
): number | null {
  const match = phaseId.match(/^\s*(ppc\s*43[ab])\s*-\s*([rst])\s*$/i);
  if (!match) return null;
  const base = match[1].replace(/\s+/g, " ").trim();
  const phase = match[2].toUpperCase();
  const normalized = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();
  const required = [1, 2].map(panel => `${base} - ${phase} - Panel ${panel}`);
  const values = required.map(id => {
    const entry = Object.entries(input?.ppc43Current ?? {})
      .find(([sourceId]) => normalized(sourceId) === normalized(id));
    return entry?.[1];
  });
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw new WorkbookError(
      "VALIDATION_FAILED",
      `Missing PPC43 panel current source for ${normalizeMonthCell(month) ?? month}, ${base}, phase ${phase} (Panel 1 and Panel 2 are required).`
    );
  }
  return (values[0] as number) + (values[1] as number);
}

/**
 * Remove records that do not belong in an input table while retaining the
 * table's existing cells, styles and formulas for every kept record. Rows are
 * compacted so the table range contains no blank historical records.
 */
function retainInputSheetRecords(
  sheetXml: string,
  sharedStrings: string[],
  keepRecord: (month: string, id: string | null) => boolean
): InputPatchResult {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return { xml: sheetXml, lastDataRow: 0 };
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };

  const headers = new Map<string, string>();
  for (const cell of header.cells) {
    const key = cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!headers.has(key)) headers.set(key, cell.colLetter);
  }
  const monthCol = headers.get("month");
  const idCol = [...headers.entries()].find(([key]) => key.includes("ups") || key.includes("panel") || key.includes("acpower"))?.[1];
  if (!monthCol) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };

  const keptRows: string[] = [];
  let nextRowNumber = header.rowNumber;
  for (const row of rows) {
    if (row.rowNumber <= header.rowNumber) {
      keptRows.push(row.raw);
      continue;
    }
    const month = normalizeMonthCell(cellText(row.cells.find(cell => cell.colLetter === monthCol) ?? { colLetter: "", attrs: "", inner: null, styleId: null, type: null, formula: null }, sharedStrings));
    const id = idCol ? cellText(row.cells.find(cell => cell.colLetter === idCol) ?? { colLetter: "", attrs: "", inner: null, styleId: null, type: null, formula: null }, sharedStrings).trim() || null : null;
    if (!month || (idCol && !id) || !keepRecord(month, id)) continue;

    const targetRowNumber = ++nextRowNumber;
    if (targetRowNumber === row.rowNumber) {
      keptRows.push(row.raw);
      continue;
    }
    const delta = targetRowNumber - row.rowNumber;
    const renumbered = row.raw
      .replace(/(<row\b[^>]*\br=")\d+"/, `$1${targetRowNumber}"`)
      .replace(/(\br="[A-Z]+)\d+"/g, `$1${targetRowNumber}"`)
      .replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_all, open: string, formula: string, close: string) => `${open}${adjustFormulaRows(formula, delta)}${close}`);
    keptRows.push(renumbered);
  }

  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${keptRows.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${nextRowNumber}"/>`);
  return { xml, lastDataRow: nextRowNumber };
}

/**
 * Discard only preformatted empty rows from a formula-backed input table and
 * compact its valid Month(+ID) records without changing their formatting,
 * row height or relative formulas.
 */
function compactInputSheetRecords(
  sheetXml: string,
  sharedStrings: string[],
  idRequired: boolean
): InputPatchResult {
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) return { xml: sheetXml, lastDataRow: 0 };
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };
  const headers = new Map<string, string>();
  for (const cell of header.cells) {
    const key = cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!headers.has(key)) headers.set(key, cell.colLetter);
  }
  const monthCol = headers.get("month");
  const idCol = idRequired
    ? [...headers.entries()].find(([key]) => key.includes("ups") || key.includes("panel") || key.includes("acpower"))?.[1]
    : undefined;
  if (!monthCol || (idRequired && !idCol)) return { xml: sheetXml, lastDataRow: rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) };

  const kept: string[] = [];
  let nextRowNumber = header.rowNumber;
  for (const row of rows) {
    if (row.rowNumber <= header.rowNumber) {
      kept.push(row.raw);
      continue;
    }
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = idCol ? row.cells.find(cell => cell.colLetter === idCol) : undefined;
    const month = normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null);
    const hasId = !idRequired || Boolean(idCell && cellText(idCell, sharedStrings).trim());
    if (!month || !hasId) continue;
    const targetRowNumber = ++nextRowNumber;
    if (targetRowNumber === row.rowNumber) {
      kept.push(row.raw);
      continue;
    }
    const delta = targetRowNumber - row.rowNumber;
    kept.push(row.raw
      .replace(/(<row\b[^>]*\br=")\d+"/, `$1${targetRowNumber}"`)
      .replace(/(\br="[A-Z]+)\d+"/g, `$1${targetRowNumber}"`)
      .replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_all, open: string, formula: string, close: string) => `${open}${adjustFormulaRows(formula, delta)}${close}`));
  }
  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${kept.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${nextRowNumber}"/>`);
  return { xml, lastDataRow: nextRowNumber };
}

function copiedRowAttrs(row: ParsedRow, rowNumber: number): string {
  const attrs = row.raw.match(/^<row\b([^>]*)>/)?.[1] ?? "";
  return attrs.replace(/\br="\d+"/, `r="${rowNumber}"`).trim() || `r="${rowNumber}"`;
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
    if (monthCell) {
      const monthRef = `${monthCol}${row.rowNumber}`;
      const escapedRef = monthRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(
        new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`),
        buildCellXml(
          monthRef,
          options.monthStyles?.get(monthCell?.styleId ?? "0") ?? monthCell?.styleId,
          "month",
          workbookMonthSerial(patch.month, options.date1904)
        )
      );
    }
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
        if (!cell || (cell.formula !== null && !options.replaceFormulaCells && !options.updateFormulaCaches)) continue;
        const styleId = options.numberStyles?.get(cell.styleId ?? "0") ?? cell.styleId;
        const replacement = cell.formula !== null && options.updateFormulaCaches
          ? buildFormulaCellXml(`${col}${row.rowNumber}`, styleId, cell.formula, value)
          : buildCellXml(`${col}${row.rowNumber}`, styleId, "number", value);
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
    for (const patch of missingPatches) {
      const rowNumber = ++lastDataRow;
      const rowAttrs = copiedRowAttrs(template, rowNumber);
      const rowCells = template.cells.map(cell => {
        const ref = `${cell.colLetter}${rowNumber}`;
        if (cell.colLetter === monthCol) {
          return buildCellXml(
            ref,
            options.monthStyles?.get(cell.styleId ?? "0") ?? cell.styleId,
            "month",
            workbookMonthSerial(patch.month, options.date1904)
          );
        }
        if (idCol && cell.colLetter === idCol) {
          return buildCellXml(ref, null, "text", patch.id ?? null);
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
          const value = field ? patch.values[field] : null;
          const styleId = options.numberStyles?.get(cell.styleId ?? "0") ?? cell.styleId;
          return cell.formula !== null && options.updateFormulaCaches
            ? buildFormulaCellXml(ref, styleId, adjustFormulaRows(cell.formula, rowNumber - template.rowNumber), value)
            : buildCellXml(ref, styleId, "number", value);
        }
        return "";
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

/**
 * Sheet 1.2 is a formula-backed table.  Its existing AVERAGEIFS/SUMIFS
 * formulas are part of the workbook contract, so only their cached values
 * are refreshed here.  New rows copy those exact template formulas.
 */
function patchSrinakarinUpsAverageSheetXml(
  sheetXml: string,
  patches: InputPatch[],
  sharedStrings: string[],
  options: InputPatchOptions
): InputPatchResult {
  sheetXml = compactInputSheetRecords(sheetXml, sharedStrings, true).xml;
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.2 UPS Data Log_Average has no sheetData.");
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.2 UPS Data Log_Average is missing its header.");

  const headerColumns = header.cells.map(cell => [cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), cell.colLetter] as const);
  const columnFor = (field: string): string | undefined => {
    const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
    return headerColumns.find(([key]) => key === normalized || key.includes(normalized))?.[1];
  };
  const monthCol = columnFor("month");
  const idCol = columnFor("ups");
  const formulaFields = ["voltage", "current", "loadKw", "loadKva"];
  if (!monthCol || !idCol || formulaFields.some(field => !columnFor(field))) {
    throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.2 UPS Data Log_Average is missing a required mapped column.");
  }

  const formulaCellXml = (cell: ParsedCell | undefined, ref: string, value: number | null, rowDelta = 0): string => {
    if (!cell || cell.formula === null) {
      throw new WorkbookError("INVALID_WORKBOOK", `Sheet 1.2 UPS Data Log_Average is missing its formula at ${ref}.`);
    }
    const styleId = options.numberStyles?.get(cell.styleId ?? "0") ?? cell.styleId;
    return buildFormulaCellXml(ref, styleId, adjustFormulaRows(cell.formula, rowDelta), value);
  };

  const byKey = new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch]));
  const existingKeys = new Set<string>();
  const patchedRows = rows.map(row => {
    if (row.rowNumber <= header.rowNumber) return row.raw;
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = row.cells.find(cell => cell.colLetter === idCol);
    const patch = byKey.get(inputKey(monthCell ? cellText(monthCell, sharedStrings) : "", idCell ? cellText(idCell, sharedStrings) : undefined));
    if (!patch) return row.raw;
    existingKeys.add(inputKey(patch.month, patch.id));
    let raw = row.raw;
    const replaceCell = (ref: string, replacement: string): void => {
      const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), replacement);
    };
    if (monthCell) {
      replaceCell(`${monthCol}${row.rowNumber}`, buildCellXml(
        `${monthCol}${row.rowNumber}`,
        options.monthStyles?.get(monthCell.styleId ?? "0") ?? monthCell.styleId,
        "month",
        workbookMonthSerial(patch.month, options.date1904)
      ));
    }
    for (const field of formulaFields) {
      const column = columnFor(field)!;
      const cell = row.cells.find(candidate => candidate.colLetter === column);
      replaceCell(`${column}${row.rowNumber}`, formulaCellXml(cell, `${column}${row.rowNumber}`, patch.values[field] ?? null));
    }
    return raw;
  });

  const template = rows.find(row => row.rowNumber > header.rowNumber &&
    row.cells.find(cell => cell.colLetter === monthCol) && row.cells.find(cell => cell.colLetter === idCol));
  let lastDataRow = rows.reduce((max, row) => Math.max(max, row.rowNumber), header.rowNumber);
  const missingPatches = [...byKey.values()].filter(patch => !existingKeys.has(inputKey(patch.month, patch.id)));
  if (missingPatches.length > 0 && !template) {
    throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.2 UPS Data Log_Average has no formula template row.");
  }
  for (const patch of missingPatches) {
    const rowNumber = ++lastDataRow;
    const monthCell = template!.cells.find(cell => cell.colLetter === monthCol)!;
    const cells = [
      buildCellXml(`${monthCol}${rowNumber}`, options.monthStyles?.get(monthCell.styleId ?? "0") ?? monthCell.styleId, "month", workbookMonthSerial(patch.month, options.date1904)),
      buildCellXml(`${idCol}${rowNumber}`, null, "text", patch.id ?? null),
      ...formulaFields.map(field => {
        const column = columnFor(field)!;
        return formulaCellXml(template!.cells.find(cell => cell.colLetter === column), `${column}${rowNumber}`, patch.values[field] ?? null, rowNumber - template!.rowNumber);
      })
    ].join("");
    patchedRows.push(`<row ${copiedRowAttrs(template!, rowNumber)}>${cells}</row>`);
  }

  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${lastDataRow}"/>`);
  return { xml, lastDataRow };
}

/**
 * Sheet 1.5 mirrors the same formula-backed pattern as 1.2, but its kW/kVA
 * columns include legacy literal formulas for PPC 44B.  Preserve every
 * existing formula and refresh only its cached value; plain kW/kVA cells are
 * still written from the matching PPC record.
 */
function patchSrinakarinPpcAverageSheetXml(
  sheetXml: string,
  patches: InputPatch[],
  sharedStrings: string[],
  options: InputPatchOptions
): InputPatchResult {
  sheetXml = compactInputSheetRecords(sheetXml, sharedStrings, true).xml;
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5 AC PPC Log_Average has no sheetData.");
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5 AC PPC Log_Average is missing its header.");

  const columns = header.cells.map(cell => ({ key: cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), column: cell.colLetter }));
  const monthCol = columns.find(column => column.key === "month")?.column;
  const idCol = columns.find(column => column.key.includes("acpowerpanel"))?.column;
  const valueCols = {
    voltage: columns.find(column => column.key.includes("voltage"))?.column,
    current: columns.find(column => column.key.includes("current"))?.column,
    loadKw: columns.find(column => column.key.includes("loadkw"))?.column,
    loadKva: columns.find(column => column.key.includes("loadkva"))?.column
  };
  if (!monthCol || !idCol || Object.values(valueCols).some(column => !column)) {
    throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5 AC PPC Log_Average is missing a required mapped column.");
  }

  const byKey = new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch]));
  const existingKeys = new Set<string>();
  const replaceCell = (raw: string, ref: string, replacement: string): string => {
    const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), replacement);
  };
  const renderedValue = (cell: ParsedCell | undefined, ref: string, value: number | null, rowDelta = 0): string => {
    if (!cell) return buildCellXml(ref, null, "number", value);
    const styleId = options.numberStyles?.get(cell.styleId ?? "0") ?? cell.styleId;
    return cell.formula !== null
      ? buildFormulaCellXml(ref, styleId, adjustFormulaRows(cell.formula, rowDelta), value)
      : buildCellXml(ref, styleId, "number", value);
  };

  const patchedRows = rows.map(row => {
    if (row.rowNumber <= header.rowNumber) return row.raw;
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = row.cells.find(cell => cell.colLetter === idCol);
    const patch = byKey.get(inputKey(monthCell ? cellText(monthCell, sharedStrings) : "", idCell ? cellText(idCell, sharedStrings) : undefined));
    if (!patch) return row.raw;
    existingKeys.add(inputKey(patch.month, patch.id));
    let raw = row.raw;
    raw = replaceCell(raw, `${monthCol}${row.rowNumber}`, buildCellXml(
      `${monthCol}${row.rowNumber}`,
      options.monthStyles?.get(monthCell?.styleId ?? "0") ?? monthCell?.styleId ?? null,
      "month",
      workbookMonthSerial(patch.month, options.date1904)
    ));
    for (const [field, column] of Object.entries(valueCols) as Array<[keyof typeof valueCols, string]>) {
      const cell = row.cells.find(candidate => candidate.colLetter === column);
      raw = replaceCell(raw, `${column}${row.rowNumber}`, renderedValue(cell, `${column}${row.rowNumber}`, patch.values[field] ?? null));
    }
    return raw;
  });

  let lastDataRow = rows.reduce((max, row) => Math.max(max, row.rowNumber), header.rowNumber);
  const missingPatches = [...byKey.values()].filter(patch => !existingKeys.has(inputKey(patch.month, patch.id)));
  for (const patch of missingPatches) {
    const template = rows.find(row => {
      const idCell = row.cells.find(cell => cell.colLetter === idCol);
      return row.rowNumber > header.rowNumber && idCell !== undefined &&
        cellText(idCell, sharedStrings).trim().toLowerCase() === patch.id?.trim().toLowerCase();
    })
      ?? rows.find(row => row.rowNumber > header.rowNumber && row.cells.some(cell => cell.colLetter === monthCol) && row.cells.some(cell => cell.colLetter === idCol));
    if (!template) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5 AC PPC Log_Average has no row template.");
    const rowNumber = ++lastDataRow;
    const monthCell = template.cells.find(cell => cell.colLetter === monthCol);
    const cells = [
      buildCellXml(`${monthCol}${rowNumber}`, options.monthStyles?.get(monthCell?.styleId ?? "0") ?? monthCell?.styleId ?? null, "month", workbookMonthSerial(patch.month, options.date1904)),
      buildCellXml(`${idCol}${rowNumber}`, null, "text", patch.id ?? null),
      ...Object.entries(valueCols).map(([field, column]) => renderedValue(
        template.cells.find(cell => cell.colLetter === column),
        `${column}${rowNumber}`,
        patch.values[field] ?? null,
        rowNumber - template.rowNumber
      ))
    ].join("");
    patchedRows.push(`<row ${copiedRowAttrs(template, rowNumber)}>${cells}</row>`);
  }

  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${lastDataRow}"/>`);
  return { xml, lastDataRow };
}

type Ppc43AverageFormulaField = "voltage" | "current";

/** A valid C/D formula must remain tied to the matching 1.4.1 Month and PPC. */
function isValidPpc43AverageFormula(field: Ppc43AverageFormulaField, formula: string | null | undefined): formula is string {
  if (!formula || /#(?:REF|VALUE|DIV\/0)/i.test(formula)) return false;
  const normalized = xmlUnescape(formula).replace(/\s+/g, "").toLowerCase();
  const source = field === "voltage" ? "l43ab[voltage(v)]" : "l43ab[current(a)]";
  return [
    "averageifs(",
    source,
    "l43ab[month]",
    "ppc_data43ab[[#thisrow],[month]]",
    "l43ab[acpowerpanel]",
    "ppc_data43ab[[#thisrow],[acpowerpanel]]&\"-*\""
  ].every(token => normalized.includes(token));
}

/**
 * Sheet 1.5.1 is likewise formula-backed: the workbook owns its AVERAGEIFS
 * and SUMIFS formulas, while the save path refreshes their matching-month
 * cached results from the same 1.4.1 / 1.7 source values.
 */
function patchSrinakarinPpc43AverageSheetXml(
  sheetXml: string,
  patches: InputPatch[],
  sharedStrings: string[],
  options: InputPatchOptions
): InputPatchResult {
  sheetXml = compactInputSheetRecords(sheetXml, sharedStrings, true).xml;
  const sheetDataMatch = sheetXml.match(/<sheetData([^>]*)>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5.1 AC PPC Log_Average(43AB) has no sheetData.");
  const rows = parseRows(sheetDataMatch[2]);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5.1 AC PPC Log_Average(43AB) is missing its header.");

  const headerColumns = header.cells.map(cell => [cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), cell.colLetter] as const);
  const columnFor = (field: string): string | undefined => {
    const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
    return headerColumns.find(([key]) => key === normalized || key.includes(normalized))?.[1];
  };
  const monthCol = columnFor("month");
  const idCol = headerColumns.find(([key]) => key.includes("panel") || key.includes("acpower"))?.[1];
  const formulaFields = ["voltage", "current", "loadKw", "loadKva"];
  if (!monthCol || !idCol || formulaFields.some(field => !columnFor(field))) {
    throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5.1 AC PPC Log_Average(43AB) is missing a required mapped column.");
  }

  const nearestValidFormulaCell = (field: Ppc43AverageFormulaField, rowNumber: number): ParsedCell | undefined => {
    const column = columnFor(field)!;
    return rows
      .filter(row => row.rowNumber > header.rowNumber)
      .sort((left, right) => Math.abs(left.rowNumber - rowNumber) - Math.abs(right.rowNumber - rowNumber))
      .map(row => row.cells.find(cell => cell.colLetter === column))
      .find(cell => isValidPpc43AverageFormula(field, cell?.formula));
  };

  const formulaCellXml = (cell: ParsedCell | undefined, ref: string, value: number | null, rowDelta = 0): string => {
    if (!cell || cell.formula === null) {
      throw new WorkbookError("INVALID_WORKBOOK", `Sheet 1.5.1 AC PPC Log_Average(43AB) is missing its formula at ${ref}.`);
    }
    const styleId = options.numberStyles?.get(cell.styleId ?? "0") ?? cell.styleId;
    return buildFormulaCellXml(ref, styleId, adjustFormulaRows(cell.formula, rowDelta), value);
  };

  // C/D are the only formulas repaired here.  E/F keep their established
  // formula handling because their workbook formulas are outside this fix.
  const restoredAverageFormulaCellXml = (
    field: Ppc43AverageFormulaField,
    cell: ParsedCell | undefined,
    ref: string,
    value: number | null
  ): string => {
    const source = isValidPpc43AverageFormula(field, cell?.formula)
      ? cell
      : nearestValidFormulaCell(field, Number(ref.replace(/^[A-Z]+/, "")));
    if (!source?.formula) {
      throw new WorkbookError("INVALID_WORKBOOK", `Sheet 1.5.1 AC PPC Log_Average(43AB) has no valid ${field} formula template for ${ref}.`);
    }
    const styleId = options.numberStyles?.get(cell?.styleId ?? source.styleId ?? "0") ?? (cell?.styleId ?? source.styleId);
    // C/D use structured references only.  Do not run the generic A1 row
    // shifter here: it misreads the L43AB table name as cell L43 and corrupts
    // it when appending a row.
    return buildFormulaCellXml(ref, styleId, source.formula, value);
  };

  const byKey = new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch]));
  const existingKeys = new Set<string>();
  const patchedRows = rows.map(row => {
    if (row.rowNumber <= header.rowNumber) return row.raw;
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = row.cells.find(cell => cell.colLetter === idCol);
    const patch = byKey.get(inputKey(monthCell ? cellText(monthCell, sharedStrings) : "", idCell ? cellText(idCell, sharedStrings) : undefined));
    if (!patch) return row.raw;
    existingKeys.add(inputKey(patch.month, patch.id));
    let raw = row.raw;
    const replaceCell = (ref: string, replacement: string): void => {
      const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      raw = raw.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), replacement);
    };
    if (monthCell) {
      replaceCell(`${monthCol}${row.rowNumber}`, buildCellXml(
        `${monthCol}${row.rowNumber}`,
        options.monthStyles?.get(monthCell.styleId ?? "0") ?? monthCell.styleId,
        "month",
        workbookMonthSerial(patch.month, options.date1904)
      ));
    }
    for (const field of formulaFields) {
      const column = columnFor(field)!;
      const cell = row.cells.find(candidate => candidate.colLetter === column);
      const replacement = field === "voltage" || field === "current"
        ? restoredAverageFormulaCellXml(field, cell, `${column}${row.rowNumber}`, patch.values[field] ?? null)
        : formulaCellXml(cell, `${column}${row.rowNumber}`, patch.values[field] ?? null);
      replaceCell(`${column}${row.rowNumber}`, replacement);
    }
    return raw;
  });

  const template = rows.find(row => row.rowNumber > header.rowNumber &&
    row.cells.find(cell => cell.colLetter === monthCol) && row.cells.find(cell => cell.colLetter === idCol));
  let lastDataRow = rows.reduce((max, row) => Math.max(max, row.rowNumber), header.rowNumber);
  const missingPatches = [...byKey.values()].filter(patch => !existingKeys.has(inputKey(patch.month, patch.id)));
  if (missingPatches.length > 0 && !template) {
    throw new WorkbookError("INVALID_WORKBOOK", "Sheet 1.5.1 AC PPC Log_Average(43AB) has no formula template row.");
  }
  for (const patch of missingPatches) {
    const rowNumber = ++lastDataRow;
    const monthCell = template!.cells.find(cell => cell.colLetter === monthCol)!;
    const cells = [
      buildCellXml(`${monthCol}${rowNumber}`, options.monthStyles?.get(monthCell.styleId ?? "0") ?? monthCell.styleId, "month", workbookMonthSerial(patch.month, options.date1904)),
      buildCellXml(`${idCol}${rowNumber}`, null, "text", patch.id ?? null),
      ...formulaFields.map(field => {
        const column = columnFor(field)!;
        const cell = template!.cells.find(cell => cell.colLetter === column);
        return field === "voltage" || field === "current"
          ? restoredAverageFormulaCellXml(field, cell, `${column}${rowNumber}`, patch.values[field] ?? null)
          : formulaCellXml(cell, `${column}${rowNumber}`, patch.values[field] ?? null, rowNumber - template!.rowNumber);
      })
    ].join("");
    patchedRows.push(`<row ${copiedRowAttrs(template!, rowNumber)}>${cells}</row>`);
  }

  const patchedSheetData = `<sheetData${sheetDataMatch[1]}>${patchedRows.join("")}<\/sheetData>`;
  let xml = sheetXml.replace(sheetDataMatch[0], patchedSheetData);
  const maxColumn = header.cells.reduce((max, cell) => Math.max(max, colLetterToIndex(cell.colLetter)), 1);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${indexToColLetter(maxColumn)}${lastDataRow}"/>`);
  return { xml, lastDataRow };
}

/** Verify the repaired C/D formulas and Dashboard-FAC's existing dependency path. */
async function validateSrinakarinPpc43AveragePersistence(
  zip: JSZip,
  sheets: SheetLocation[],
  sharedStrings: string[],
  patches: InputPatch[]
): Promise<void> {
  if (patches.length === 0) return;
  // Match the patcher's last-write-wins behavior when callers submit a
  // selected-month update alongside an older in-memory copy of that month.
  const finalPatches = [...new Map(patches.map(patch => [inputKey(patch.month, patch.id), patch])).values()];
  const averageLocation = sheets.find(sheet => sheet.name === "1.5.1 AC PPC Log_Average(43AB)");
  if (!averageLocation) throw new WorkbookError("VALIDATION_FAILED", "PPC43 average validation failed: Sheet 1.5.1 AC PPC Log_Average(43AB) is missing.", "validate");
  const averageXml = await entryText(zip, averageLocation.xmlPath);
  const sheetData = averageXml?.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
  if (!sheetData) throw new WorkbookError("VALIDATION_FAILED", "PPC43 average validation failed: Sheet 1.5.1 has no sheetData.", "validate");
  const rows = parseRows(sheetData);
  const header = rows.find(row => row.cells.some(cell => cellText(cell, sharedStrings).trim().toLowerCase() === "month"));
  if (!header) throw new WorkbookError("VALIDATION_FAILED", "PPC43 average validation failed: Sheet 1.5.1 header is missing.", "validate");
  const columnFor = (field: string): string | undefined => header.cells
    .map(cell => [cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), cell.colLetter] as const)
    .find(([name]) => name === field || name.includes(field))?.[1];
  const monthCol = columnFor("month");
  const idCol = header.cells
    .map(cell => [cellText(cell, sharedStrings).toLowerCase().replace(/[^a-z0-9]/g, ""), cell.colLetter] as const)
    .find(([name]) => name.includes("panel") || name.includes("acpower"))?.[1];
  const voltageCol = columnFor("voltage");
  const currentCol = columnFor("current");
  if (!monthCol || !idCol || !voltageCol || !currentCol) {
    throw new WorkbookError("VALIDATION_FAILED", "PPC43 average validation failed: Sheet 1.5.1 C/D mapping is missing.", "validate");
  }

  const rowByKey = new Map<string, ParsedRow[]>();
  for (const row of rows.filter(candidate => candidate.rowNumber > header.rowNumber)) {
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    const idCell = row.cells.find(cell => cell.colLetter === idCol);
    if (!monthCell || !idCell) continue;
    const month = cellText(monthCell, sharedStrings);
    const id = cellText(idCell, sharedStrings);
    const key = inputKey(month, id);
    if (!normalizeMonthCell(month) || !id.trim()) continue;
    const matches = rowByKey.get(key) ?? [];
    matches.push(row);
    rowByKey.set(key, matches);
  }
  const failure = (patch: InputPatch, field: Ppc43AverageFormulaField, ref: string, reason: string): WorkbookError =>
    new WorkbookError("VALIDATION_FAILED", `PPC43 average validation failed for ${patch.month}, ${patch.id}, ${field === "voltage" ? "Voltage (V)" : "Current (A)"}, ${ref}: ${reason}`, "validate");

  for (const patch of finalPatches) {
    const matchingRows = rowByKey.get(inputKey(patch.month, patch.id)) ?? [];
    if (matchingRows.length !== 1) {
      throw failure(patch, "voltage", `${voltageCol}?`, matchingRows.length === 0 ? "matching Month/PPC row is missing" : "matching Month/PPC rows are duplicated");
    }
    const row = matchingRows[0];
    for (const [field, column] of [["voltage", voltageCol], ["current", currentCol]] as const) {
      const ref = `${column}${row.rowNumber}`;
      const cell = row.cells.find(candidate => candidate.colLetter === column);
      if (!isValidPpc43AverageFormula(field, cell?.formula)) {
        throw failure(patch, field, ref, "formula does not reference the matching 1.4.1 Month and PPC source");
      }
      const expected = patch.values[field];
      const actual = Number(cellText(cell, sharedStrings));
      if (typeof expected !== "number" || !Number.isFinite(expected) || !Number.isFinite(actual)) {
        throw failure(patch, field, ref, "calculated value is not a finite number");
      }
      if (Math.abs(actual - expected) > 1e-9) {
        throw failure(patch, field, ref, `cached value ${actual} does not match calculated value ${expected}`);
      }
    }
  }

  const dashboardLocation = sheets.find(sheet => sheet.name === "Dashboard-FAC");
  const dashboardXml = dashboardLocation ? await entryText(zip, dashboardLocation.xmlPath) : null;
  const dashboardData = dashboardXml?.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
  if (!dashboardData) throw new WorkbookError("VALIDATION_FAILED", "PPC43 average validation failed: Dashboard-FAC is missing its data.", "validate");
  const dashboardRows = parseRows(dashboardData);
  const activeMonthCell = dashboardRows.find(row => row.rowNumber === 1)?.cells.find(cell => cell.colLetter === "H");
  const activeMonth = activeMonthCell ? normalizeMonthCell(cellText(activeMonthCell, sharedStrings)) : null;
  for (const id of ["PPC 43A", "PPC 43B"]) {
    const row = dashboardRows.find(candidate => candidate.cells.some(cell => cellText(cell, sharedStrings).trim() === id));
    if (!row) throw new WorkbookError("VALIDATION_FAILED", `PPC43 average validation failed: Dashboard-FAC row for ${id} is missing.`, "validate");
    for (const [field, sourceToken] of [["voltage", "ppc_data43ab[voltage(v)]"], ["current", "ppc_data43ab[current(a)]"]] as const) {
      const cell = row.cells.find(candidate => (candidate.formula ?? "").replace(/\s+/g, "").toLowerCase().includes(sourceToken));
      const normalizedFormula = cell?.formula?.replace(/\s+/g, "").toLowerCase() ?? "";
      if (!cell || !normalizedFormula.includes("xlookup(") || !normalizedFormula.includes("ppc_data43ab[month]=$h$1") || !normalizedFormula.includes("ppc_data43ab[acpowerpanel]")) {
        throw new WorkbookError("VALIDATION_FAILED", `PPC43 average validation failed: Dashboard-FAC ${id} ${field} dependency formula was changed.`, "validate");
      }
      const activePatch = activeMonth ? finalPatches.find(patch => patch.month === activeMonth && patch.id === id) : undefined;
      if (activePatch) {
        const actual = Number(cellText(cell, sharedStrings));
        const expected = activePatch.values[field];
        if (typeof expected !== "number" || !Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
          throw new WorkbookError("VALIDATION_FAILED", `PPC43 average validation failed: Dashboard-FAC ${id} ${field} is incomplete for ${activeMonth}.`, "validate");
        }
      }
    }
  }
}

function finiteValues(rows: InputPatch[], field: string): number[] {
  return rows.map(row => row.values[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

/** Exact cached results of Sheet 1.2's AVERAGEIFS/SUMIFS formula pair. */
function deriveSrinakarinUpsAveragePatches(phasePatches: InputPatch[]): InputPatch[] {
  const finalPhaseByKey = new Map(phasePatches.map(patch => [inputKey(patch.month, patch.id), patch]));
  const groups = new Map<string, InputPatch[]>();
  for (const patch of finalPhaseByKey.values()) {
    const baseId = patch.id?.replace(/\s+-\s+[RST]$/i, "").trim();
    if (!baseId) continue;
    const key = inputKey(patch.month, baseId);
    const group = groups.get(key) ?? [];
    group.push(patch);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, phases]) => {
    const separator = key.indexOf("|");
    const month = key.slice(0, separator);
    const id = phases[0].id!.replace(/\s+-\s+[RST]$/i, "").trim();
    const average = (field: string): number | null => {
      const values = finiteValues(phases, field);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const sum = (field: string): number => finiteValues(phases, field).reduce((total, value) => total + value, 0);
    return { month, id, values: { voltage: average("voltage"), current: average("current"), loadKw: sum("loadKw"), loadKva: sum("loadKva") } };
  });
}

/** Sheet 1.3 stores the paired-A/B kW and kVA sums from Sheet 1.2. */
function deriveSrinakarinUpsSumPatches(averagePatches: InputPatch[]): InputPatch[] {
  const groups = new Map<string, InputPatch[]>();
  for (const patch of averagePatches) {
    const baseId = patch.id?.replace(/[AB]$/i, "").trim();
    if (!baseId || !/[AB]$/i.test(patch.id ?? "")) continue;
    const key = inputKey(patch.month, baseId);
    const group = groups.get(key) ?? [];
    group.push(patch);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const separator = key.indexOf("|");
    return {
      month: key.slice(0, separator),
      id: rows[0].id!.replace(/[AB]$/i, "").trim(),
      values: {
        loadKw: finiteValues(rows, "loadKw").reduce((total, value) => total + value, 0),
        loadKva: finiteValues(rows, "loadKva").reduce((total, value) => total + value, 0)
      }
    };
  });
}

const SRINAKARIN_PPC_AVERAGE_IDS = new Set(["PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B", "PPC 44A", "PPC 44B"]);

/** Cached values for Sheet 1.5: V/A from its 1.4 AVERAGEIFS source; kW/kVA from the corresponding PPC row. */
function deriveSrinakarinPpcAveragePatches(logs: MonthlyLog[], phasePatches: InputPatch[]): InputPatch[] {
  const phasesByKey = new Map<string, InputPatch[]>();
  // Match the source-sheet writer: a later edit for the same Month/PPC/phase
  // replaces the earlier value before Sheet 1.5's AVERAGEIFS cache is formed.
  const finalPhaseByKey = new Map(phasePatches.map(patch => [inputKey(patch.month, patch.id), patch]));
  for (const patch of finalPhaseByKey.values()) {
    const baseId = patch.id?.replace(/\s+-\s+[RST]$/i, "").trim();
    if (!baseId || !SRINAKARIN_PPC_AVERAGE_IDS.has(baseId)) continue;
    const key = inputKey(patch.month, baseId);
    const phases = phasesByKey.get(key) ?? [];
    phases.push(patch);
    phasesByKey.set(key, phases);
  }
  const average = (rows: InputPatch[], field: string): number | null => {
    const values = finiteValues(rows, field);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const patches: InputPatch[] = [];
  for (const log of logs) {
    for (const record of log.ups) {
      const id = record.upsId.replace(/\s+/g, " ").trim();
      if (!SRINAKARIN_PPC_AVERAGE_IDS.has(id)) continue;
      const phases = phasesByKey.get(inputKey(log.month, id)) ?? [];
      // Sheet 1.5 is the calculated view of 1.4. Do not manufacture PPC
      // rows for historical aggregate-only months that have no 1.4 source.
      if (phases.length === 0) continue;
      patches.push({
        month: log.month,
        id,
        values: {
          voltage: average(phases, "voltage"),
          current: average(phases, "current"),
          loadKw: record.loadKw,
          loadKva: record.loadKva
        }
      });
    }
  }
  return patches;
}

/** Cached results for Sheet 1.5.1's existing AVERAGEIFS/SUMIFS formulas. */
function deriveSrinakarinPpc43AveragePatches(logs: MonthlyLog[]): InputPatch[] {
  const normalized = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();
  const average = (values: Array<number | null | undefined>): number | null => {
    const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
  };
  const sum = (values: Array<number | null | undefined>): number | null => {
    const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return present.length ? present.reduce((total, value) => total + value, 0) : null;
  };

  return logs.flatMap(log => ["PPC 43A", "PPC 43B"].flatMap(id => {
    const input = log.srinakarinInputs;
    const phases = Object.entries(input?.acPhase ?? {})
      .filter(([phaseId]) => normalized(phaseId).startsWith(`${normalized(id)} - `));
    if (phases.length === 0) return [];
    const requiredPhases = ["R", "S", "T"].map(phase => {
      const phaseRecord = Object.entries(input?.acPhase ?? {})
        .find(([phaseId]) => normalized(phaseId) === normalized(`${id} - ${phase}`));
      if (!phaseRecord || typeof phaseRecord[1].voltage !== "number" || !Number.isFinite(phaseRecord[1].voltage)) {
        throw new WorkbookError(
          "VALIDATION_FAILED",
          `PPC43 average validation failed for ${log.month}, ${id}, Voltage (V), C: ${phase} phase voltage is required.`,
          "validate"
        );
      }
      let current: number | null;
      try {
        current = ppc43PanelCurrentTotal(input, log.month, phaseRecord[0]);
      } catch (error) {
        throw new WorkbookError(
          "VALIDATION_FAILED",
          `PPC43 average validation failed for ${log.month}, ${id}, Current (A), D: ${error instanceof Error ? error.message : "Panel 1 and Panel 2 current are required."}`,
          "validate"
        );
      }
      if (typeof current !== "number" || !Number.isFinite(current)) {
        throw new WorkbookError(
          "VALIDATION_FAILED",
          `PPC43 average validation failed for ${log.month}, ${id}, Current (A), D: ${phase} phase Panel 1 + Panel 2 current is required.`,
          "validate"
        );
      }
      return { voltage: phaseRecord[1].voltage, current };
    });
    const panels = Object.entries(input?.ppc43Panel ?? {})
      .filter(([panelId]) => normalized(panelId).startsWith(`${normalized(id)} panel `));
    return [{
      month: log.month,
      id,
      values: {
        voltage: average(requiredPhases.map(phase => phase.voltage)),
        // 1.4.1's Current formula is SUMIFS over Sheet 1.6. Match those
        // three Panel 1 + Panel 2 phase totals exactly.
        current: average(requiredPhases.map(phase => phase.current)),
        loadKw: panels.length ? sum(panels.map(([, values]) => values.loadKw)) : null,
        loadKva: panels.length ? sum(panels.map(([, values]) => values.loadKva)) : null
      }
    }];
  }));
}

function srinakarinInputPatches(logs: MonthlyLog[]): Record<string, InputPatch[]> {
  const result: Record<string, InputPatch[]> = {
    "1.1 UPS Data Log By Phase": [],
    "1.2 UPS Data Log_Average": [],
    "1.3 UPS Data Log_Average SUM": [],
    "1. UPS Data Log": [],
    "1.4 AC PPC Log By Phase": [],
    "1.4.1 AC PPC Log By Phase(43AB)": [],
    "1.6 AC PPC43 (A)": [],
    "1.7 AC PPC43 Panel (A)": [],
    "1.5.1 AC PPC Log_Average(43AB)": [],
    "1.5 AC PPC Log_Average": [],
    "2. Air Energy Consumption Log": [],
    "3. DC Data Log": [],
    "4. Electricity Cost Log": []
  };
  for (const log of logs) {
    if (isMonthIn2026(log.month)) {
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
    }
    const input: SrinakarinInputSnapshot | undefined = log.srinakarinInputs;
    for (const [id, values] of Object.entries(input?.upsPhase ?? {})) result["1.1 UPS Data Log By Phase"].push({ month: log.month, id, values });
    for (const ups of log.ups) {
      for (const [phase, values] of Object.entries(ups.phases ?? {})) {
        result["1.1 UPS Data Log By Phase"].push({ month: log.month, id: `${ups.upsId} - ${phase}`, values: { ...values } });
      }
    }
    for (const [id, values] of Object.entries(input?.acPhase ?? {})) {
      const target = isPpc43Id(id) ? "1.4.1 AC PPC Log By Phase(43AB)" : "1.4 AC PPC Log By Phase";
      const totalCurrent = target === "1.4.1 AC PPC Log By Phase(43AB)"
        ? ppc43PanelCurrentTotal(input, log.month, id)
        : null;
      result[target].push({
        month: log.month,
        id,
        values: totalCurrent === null ? values : { ...values, current: totalCurrent }
      });
    }
    for (const [id, value] of Object.entries(input?.ppc43Current ?? {})) result["1.6 AC PPC43 (A)"].push({ month: log.month, id, values: { panelcurrenta: value } });
    for (const [id, values] of Object.entries(input?.ppc43Panel ?? {})) result["1.7 AC PPC43 Panel (A)"].push({ month: log.month, id, values });
    const airValues: Record<string, number | null> = {};
    for (const field of log.energyCalculation?.airFields ?? ["eb41a", "eb41b", "eb42a", "eb42b"]) {
      airValues[field] = getAirValue(log, field);
    }
    result["2. Air Energy Consumption Log"].push({ month: log.month, values: airValues });
    for (const dc of log.dc) result["3. DC Data Log"].push({ month: log.month, id: dc.panelId, values: { voltage: dc.voltage, current: dc.current } });
    const energy = calculateEnergyCostForMonth(logs, log.month);
    result["4. Electricity Cost Log"].push({
      month: log.month,
      values: {
        buildingenergyconsumptionkwh: log.energyCost.buildingEnergyKwh,
        buildingelectricitycostthb: log.energyCost.buildingElectricityCostThb,
        floorelectricitycostthb: energy.floorElectricityCostThb,
        averageelectricityratethbkwh: energy.averageElectricityRateThbPerKwh
      }
    });
  }
  result["1.2 UPS Data Log_Average"] = deriveSrinakarinUpsAveragePatches(result["1.1 UPS Data Log By Phase"]);
  result["1.3 UPS Data Log_Average SUM"] = deriveSrinakarinUpsSumPatches(result["1.2 UPS Data Log_Average"]);
  result["1.5 AC PPC Log_Average"] = deriveSrinakarinPpcAveragePatches(logs, result["1.4 AC PPC Log By Phase"]);
  result["1.5.1 AC PPC Log_Average(43AB)"] = deriveSrinakarinPpc43AveragePatches(logs);
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
  numberStyles: Map<string, string>,
  monthStyles: Map<string, string>,
  centeredStyles: Map<string, string>,
  date1904: boolean
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
      if (hasFormula && hasStoredValue && field !== "averageElectricityRateThbPerKwh") {
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
  const monthCol = byField.get("month")!;
  const deviceCol = byField.get("deviceId") ?? null;
  // The workbook templates include preformatted empty rows.  They must not
  // become the style/formula source for an actual record.
  const validDataRows = dataRows.filter(row => {
    const monthCell = row.cells.find(cell => cell.colLetter === monthCol);
    if (!normalizeMonthCell(monthCell ? cellText(monthCell, sharedStrings) : null)) return false;
    if (!deviceCol) return true;
    const deviceCell = row.cells.find(cell => cell.colLetter === deviceCol);
    return Boolean(deviceCell && cellText(deviceCell, sharedStrings).trim());
  });
  const rowsWithMonth = validDataRows;
  const templateRow = rowsWithMonth[rowsWithMonth.length - 1] ?? null;
  const templateByCol = new Map<string, ParsedCell>();
  if (templateRow) for (const cell of templateRow.cells) templateByCol.set(cell.colLetter, cell);
  const templateRowNumber = templateRow?.rowNumber ?? headerRowNumber + 1;
  const appStyleId = (field: FieldId, col: string, row?: ParsedRow): string | null => {
    const sourceStyle = row?.cells.find(cell => cell.colLetter === col)?.styleId ?? templateByCol.get(col)?.styleId ?? "0";
    const kind = schema.columns.find(column => column.field === field)?.kind;
    const styles = field === "month" ? monthStyles : kind === "number" ? numberStyles : undefined;
    const formattedStyle = styles?.get(sourceStyle) ?? sourceStyle;
    return centeredStyles.get(formattedStyle) ?? (formattedStyle === "0" ? null : formattedStyle);
  };
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
  const extrasByKey = new Map<string, Map<string, ParsedCell>>();
  const sourceRowsByKey = new Map<string, ParsedRow>();
  for (const row of validDataRows) {
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
    sourceRowsByKey.set(key, row);
  }

  // --- Generate new data rows ---
  const columnKind = new Map<FieldId, "month" | "text" | "number" | "timestamp">();
  for (const col of schema.columns) columnKind.set(col.field, col.kind);

  const rowsByKey = new Map<string, SheetRow>();
  for (const row of rows) {
    rowsByKey.set(rowKey(schema.key, row.month, (row.values.deviceId as string) ?? null), row);
  }
  const rowsToWrite = [...rowsByKey.values()];
  const rowAttrs = (rowNumber: number, sourceRow?: ParsedRow): string => {
    const source = sourceRow ?? templateRow;
    const attrs = source?.raw.match(/^<row\b([^>]*)>/)?.[1] ?? "";
    return attrs.replace(/\br="\d+"/, `r="${rowNumber}"`).trim() || `r="${rowNumber}"`;
  };
  const newRowsXml: string[] = [];
  let rowNumber = headerRowNumber;
  for (const row of rowsToWrite) {
    rowNumber++;
    const cellsXml: string[] = [];
    const key = rowKey(schema.key, row.month, (row.values.deviceId as string) ?? null);
    const extras = extrasByKey.get(key);
    const sourceRow = sourceRowsByKey.get(key);

    for (const col of orderedCols) {
      const ref = `${col}${rowNumber}`;
      const field = managedCols.get(col);
      const resolvedField = Array.from(byField.entries()).find(([, fieldCol]) => fieldCol === col)?.[0];

      if (field) {
        if (field === "month") {
          cellsXml.push(buildCellXml(ref, appStyleId(field, col, sourceRow), "month", workbookMonthSerial(row.month, date1904)));
        } else if (field === "deviceId") {
          cellsXml.push(buildCellXml(ref, appStyleId(field, col, sourceRow), "text", String(row.values.deviceId ?? "")));
        } else {
          const kind = columnKind.get(field) ?? "number";
          const value = row.values[field] ?? null;
          cellsXml.push(buildCellXml(ref, appStyleId(field, col, sourceRow), kind, value as string | number | null));
        }
        continue;
      }

      // Calculated Energy fields are exported as final numeric values.
      if (schema.key === "ENERGY" && resolvedField === "floorElectricityCostThb") {
        const value = row.values.floorElectricityCostThb;
        cellsXml.push(buildCellXml(ref, appStyleId(resolvedField, col, sourceRow), "number", value as number | null));
        continue;
      }
      if (schema.key === "ENERGY" && resolvedField === "averageElectricityRateThbPerKwh") {
        cellsXml.push(buildCellXml(ref, appStyleId(resolvedField, col, sourceRow), "number", cachedAverageRate(row)));
        continue;
      }

      // Unmanaged column: carry the original cell, else derive from template.
      const carried = extras?.get(col);
      if (carried) {
        if (carried.formula !== null) {
          const template = templateByCol.get(col);
          const formula = carried.formula || template?.formula || "";
          cellsXml.push(buildFormulaCellXml(
            ref,
            centeredStyles.get(carried.styleId ?? "0") ?? carried.styleId,
            adjustFormulaRows(formula, rowNumber - (sourceRow?.rowNumber ?? templateRowNumber)),
            null
          ));
        } else {
          // Rewrite the row part of the ref, keep everything else untouched.
          const originalStyle = carried.styleId ?? "0";
          const styleId = centeredStyles.get(originalStyle) ?? carried.styleId;
          const attrs = carried.attrs
            .replace(/r="[A-Z]+\d+"/, `r="${ref}"`)
            .replace(/\bs="[^"]*"/, `s="${styleId}"`);
          cellsXml.push(carried.inner === null ? `<c${attrs}/>` : `<c${attrs}>${carried.inner}</c>`);
        }
        continue;
      }

      const template = templateByCol.get(col);
      if (template && template.formula !== null) {
        const formula = adjustFormulaRows(template.formula, rowNumber - formulaTemplateRowNumber);
        cellsXml.push(buildFormulaCellXml(
          ref,
          centeredStyles.get(template.styleId ?? "0") ?? template.styleId,
          formula,
          null
        ));
      } else if (template?.styleId) {
        const styleId = centeredStyles.get(template.styleId) ?? template.styleId;
        cellsXml.push(`<c r="${ref}" s="${styleId}"/>`);
      }
      // No template and no carried cell -> emit nothing for this column.
    }
    newRowsXml.push(`<row ${rowAttrs(rowNumber, sourceRow)}>${cellsXml.join("")}</row>`);
  }

  const keptRows = parsedRows.filter(r => r.rowNumber < headerRowNumber).map(r => r.raw);
  let centeredHeader = headerRow.raw;
  for (const cell of headerRow.cells) {
    const sourceStyle = cell.styleId ?? "0";
    const styleId = centeredStyles.get(sourceStyle);
    if (!styleId) continue;
    const ref = `${cell.colLetter}${headerRowNumber}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    centeredHeader = centeredHeader.replace(new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`), value =>
      /\bs="[^"]*"/.test(value)
        ? value.replace(/\bs="[^"]*"/, `s="${styleId}"`)
        : value.replace(/<c\b/, `<c s="${styleId}"`)
    );
  }
  keptRows.push(centeredHeader);
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
  const sharedStrings = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const rowsByTab = logsToRows(logs, devices);
  // Sheet 1 is the current-year UPS log. Keep historical data in every
  // other worksheet, but never reintroduce non-2026 UPS records here.
  rowsByTab.UPS = rowsByTab.UPS.filter(row => isMonthIn2026(row.month));
  const date1904 = workbookUsesDate1904((await entryText(zip, "xl/workbook.xml")) ?? "");
  const appWrittenStyleIds = new Set<string>();
  for (const location of sheets) {
    for (const styleId of sheetCellStyleIds((await entryText(zip, location.xmlPath)) ?? "")) appWrittenStyleIds.add(styleId);
  }
  const numberStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "#,##0.00");
  const monthStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "mmm-yy");
  const percentageStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "0.00%");
  const centeredStyles = await ensureCenteredCellStyles(zip, [
    ...appWrittenStyleIds,
    ...numberStyles.values(),
    ...monthStyles.values(),
    ...percentageStyles.values()
  ]);
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
      numberStyles,
      monthStyles,
      centeredStyles,
      date1904
    );
    zip.file(location.xmlPath, patchedXml);
    await patchSheetTables(zip, location.xmlPath, patchedXml, lastDataRow);
    stats.push({ tab: schema.key, sheetName, dataRows: rowsByTab[schema.key].length });
  }
  for (const location of sheets) {
    const xml = await entryText(zip, location.xmlPath);
    if (xml) {
      const dashboardXml = location.name === "Dashboard-FAC" ? patchDashboardDcLookupRanges(xml) : xml;
      zip.file(location.xmlPath, centerMonthlySheetRecords(
        applyGlobalNumericNumberFormats(
          location.name === "Dashboard-FAC"
            ? dashboardXml
            : applyMeasurementNumberFormats(dashboardXml, sharedStrings, numberStyles, centeredStyles),
          sharedStrings,
          numberStyles,
          percentageStyles,
          centeredStyles,
          location.name
        ),
        sharedStrings,
        centeredStyles
      ));
      zip.file(location.xmlPath, clearFormulaErrorCaches(await entryText(zip, location.xmlPath) ?? ""));
    }
  }
  await validatePersistedDcInputs(zip, sheets, sharedStrings);

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
  const date1904 = workbookUsesDate1904((await entryText(zip, "xl/workbook.xml")) ?? "");
  const appWrittenStyleIds = new Set<string>();
  for (const location of sheets) {
    for (const styleId of sheetCellStyleIds((await entryText(zip, location.xmlPath)) ?? "")) appWrittenStyleIds.add(styleId);
  }
  const numberStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "#,##0.00");
  const monthStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "mmm-yy");
  const percentageStyles = await ensureExactCellFormatStyles(zip, appWrittenStyleIds, "0.00%");
  const centeredStyles = await ensureCenteredCellStyles(zip, [
    ...appWrittenStyleIds,
    ...numberStyles.values(),
    ...monthStyles.values(),
    ...percentageStyles.values()
  ]);
  for (const [sheetName, sheetPatches] of Object.entries(patches)) {
    const location = sheets.find(sheet => sheet.name === sheetName);
    if (!location) {
      if (["1.1 UPS Data Log By Phase", "1.2 UPS Data Log_Average", "1.3 UPS Data Log_Average SUM", "1.5 AC PPC Log_Average", "1.5.1 AC PPC Log_Average(43AB)"].includes(sheetName)) {
        throw new WorkbookError("INVALID_WORKBOOK", `Required Srinakarin helper sheet is missing: ${sheetName}.`);
      }
      continue;
    }
    let xml = await entryText(zip, location.xmlPath);
    if (!xml) continue;
    let retained: InputPatchResult | undefined;
    if (sheetName === "1. UPS Data Log") {
      retained = retainInputSheetRecords(xml, sharedStrings, month => isMonthIn2026(month));
      xml = retained.xml;
    } else if (sheetName === "1.4.1 AC PPC Log By Phase(43AB)") {
      retained = retainInputSheetRecords(xml, sharedStrings, (_month, id) => id !== null && isPpc43Id(id));
      xml = retained.xml;
    }
    if (sheetPatches.length === 0) {
      zip.file(location.xmlPath, xml);
      if (retained) await patchSheetTables(zip, location.xmlPath, xml, retained.lastDataRow);
      continue;
    }
    const idRequired = !["2. Air Energy Consumption Log", "4. Electricity Cost Log"].includes(sheetName);
    const isMonthlyAggregate = sheetName === "1. UPS Data Log";
    const patchOptions: InputPatchOptions = {
      firstMatchingColumnOnly: isMonthlyAggregate,
      replaceFormulaCells: isMonthlyAggregate || sheetName === "4. Electricity Cost Log",
      updateFormulaCaches: sheetName === "1.4.1 AC PPC Log By Phase(43AB)",
      numberStyles,
      monthStyles,
      date1904
    };
    const patchedInput = sheetName === "1.2 UPS Data Log_Average"
      ? patchSrinakarinUpsAverageSheetXml(xml, sheetPatches, sharedStrings, patchOptions)
      : sheetName === "1.5 AC PPC Log_Average"
        ? patchSrinakarinPpcAverageSheetXml(xml, sheetPatches, sharedStrings, patchOptions)
        : sheetName === "1.5.1 AC PPC Log_Average(43AB)"
          ? patchSrinakarinPpc43AverageSheetXml(xml, sheetPatches, sharedStrings, patchOptions)
        : patchInputSheetXmlWithStats(xml, sheetPatches, idRequired, sharedStrings, patchOptions);
    zip.file(location.xmlPath, patchedInput.xml);
    await patchSheetTables(zip, location.xmlPath, patchedInput.xml, patchedInput.lastDataRow);
  }
  for (const location of sheets) {
    const xml = await entryText(zip, location.xmlPath);
    if (xml) {
      const dashboardXml = location.name === "Dashboard-FAC" ? patchDashboardDcLookupRanges(xml) : xml;
      zip.file(location.xmlPath, centerMonthlySheetRecords(
        applyGlobalNumericNumberFormats(
          location.name === "Dashboard-FAC"
            ? dashboardXml
            : applyMeasurementNumberFormats(dashboardXml, sharedStrings, numberStyles, centeredStyles),
          sharedStrings,
          numberStyles,
          percentageStyles,
          centeredStyles,
          location.name
        ),
        sharedStrings,
        centeredStyles
      ));
      zip.file(location.xmlPath, clearFormulaErrorCaches(await entryText(zip, location.xmlPath) ?? ""));
    }
  }
  await validatePersistedDcInputs(zip, sheets, sharedStrings);
  await validateSrinakarinPpc43AveragePersistence(
    zip,
    sheets,
    sharedStrings,
    patches["1.5.1 AC PPC Log_Average(43AB)"]
  );

  const workbookXml = await entryText(zip, "xl/workbook.xml");
  if (workbookXml) {
    const patched = /<calcPr\b[^>]*\/>/.test(workbookXml)
      ? workbookXml.replace(/<calcPr\b([^>]*?)\s*\/>/, (_all, attrs: string) => `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`)
      : workbookXml.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
    zip.file("xl/workbook.xml", patched);
  }

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
