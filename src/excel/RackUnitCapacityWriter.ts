/**
 * "Rack Unit Capacity" - a persisted, one-row-per-month record of the
 * facility's rack-U (rack unit) space: Total (U) and Used (U) are entered by
 * facility staff each month (this is a genuinely new business dimension -
 * physical rack-unit space - with no existing data anywhere in either
 * workbook before v2.2.3; deliberately NOT inferred from Table7's rack
 * count, a different dimension entirely). Available (U) and Availability
 * Capacity (%) are derived exactly once here - Available = Total - Used;
 * Availability = Available / Total, blank when Total is 0 - and persisted as
 * plain values, never a live Excel formula, matching this codebase's
 * zip-surgery philosophy (see WorkbookWriter.ts's header comment) of writing
 * static computed results rather than depending on Excel recalculation.
 *
 * Same OPC/zip-level splice pattern as RackCapacityHistoryWriter.ts (new
 * worksheet part, workbook.xml/rels/[Content_Types].xml registration), but
 * this sheet is also a genuine structured Excel Table (per the v2.2.3 spec),
 * so a matching xl/tables/tableN.xml part is created too, with its own
 * worksheet _rels file and <tableParts> reference - unlike Rack Capacity
 * History, which is a plain sheet with a header row.
 *
 * Row identity is Month alone (one row per month; no zone/facility columns -
 * each workbook already IS one facility). Upserting the same month with
 * identical Total (U)/Used (U) is a true no-op (byte-identical, no rewrite),
 * matching Rack Capacity History's idempotency contract.
 */
import JSZip from "jszip";
import {
  entryText,
  ensureExactCellFormatStyles,
  getAttr,
  resolveRelationshipTarget,
  workbookMonthSerial,
  workbookUsesDate1904
} from "./ExcelZipUtils";

export const RACK_UNIT_CAPACITY_SHEET_NAME = "Rack Unit Capacity";
export const RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME = "RackUnitCapacity";

const HEADERS = ["Month", "Total (U)", "Used (U)", "Available (U)", "Availability Capacity (%)"] as const;

/** What the Editor actually collects: Month plus the two independently
 *  entered facts. Available (U) / Availability Capacity (%) are derived by
 *  deriveSnapshot below - callers never supply them directly. */
export interface RackUnitCapacityInput {
  /** Canonical "YYYY-MM"; on disk always a real Excel date (first-of-month) with an "mmm-yy" style. */
  month: string;
  totalU: number;
  usedU: number;
}

export interface RackUnitCapacityRow extends RackUnitCapacityInput {
  availableU: number;
  availabilityPct: number | null;
}

/** The single authoritative calculation for this sheet's derived columns. */
export function deriveRackUnitCapacityRow(input: RackUnitCapacityInput): RackUnitCapacityRow {
  const availableU = input.totalU - input.usedU;
  const availabilityPct = input.totalU > 0 ? availableU / input.totalU : null;
  return { ...input, availableU, availabilityPct };
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

const LAST_COL = indexToColLetter(HEADERS.length);

/** Excel serial (days since the workbook epoch) -> "YYYY-MM". Pure Date.UTC
 *  math throughout so a month written today and read back later never drifts
 *  by timezone (mirrors RackCapacityHistoryWriter's serialToYearMonth). */
function serialToYearMonth(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function rowKey(month: string): string {
  return month.trim();
}

interface RowStyles {
  monthStyleId: string;
  percentStyleId: string;
}

async function ensureRowStyles(zip: JSZip): Promise<RowStyles> {
  const monthStyles = await ensureExactCellFormatStyles(zip, ["0"], "mmm-yy");
  const percentStyles = await ensureExactCellFormatStyles(zip, ["0"], "0.00%");
  const monthStyleId = monthStyles.get("0");
  const percentStyleId = percentStyles.get("0");
  if (!monthStyleId || !percentStyleId) throw new Error("Could not register Rack Unit Capacity cell styles.");
  return { monthStyleId, percentStyleId };
}

function textCellXml(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}
function numberCellXml(ref: string, value: number, styleId?: string): string {
  return `<c r="${ref}"${styleId ? ` s="${styleId}"` : ""}><v>${value}</v></c>`;
}

function buildHeaderRowXml(): string {
  const cells = HEADERS.map((h, idx) => textCellXml(`${indexToColLetter(idx + 1)}1`, h)).join("");
  return `<row r="1">${cells}</row>`;
}

function buildRowXml(rowNumber: number, row: RackUnitCapacityRow, styles: RowStyles, date1904: boolean): string {
  const monthSerial = workbookMonthSerial(row.month, date1904);
  const col = (idx: number) => `${indexToColLetter(idx + 1)}${rowNumber}`;
  const cells: string[] = [];
  cells.push(monthSerial === null ? textCellXml(col(0), row.month) : numberCellXml(col(0), monthSerial, styles.monthStyleId));
  cells.push(numberCellXml(col(1), row.totalU));
  cells.push(numberCellXml(col(2), row.usedU));
  cells.push(numberCellXml(col(3), row.availableU));
  const pctRef = col(4);
  cells.push(row.availabilityPct === null ? `<c r="${pctRef}" s="${styles.percentStyleId}"/>` : numberCellXml(pctRef, row.availabilityPct, styles.percentStyleId));
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

/** Parses one existing <row> into a complete row. Understands both a real
 *  Excel-date Month (current format) and inline text (defensive only - this
 *  sheet has no pre-v2.2.3 legacy rows since it did not exist before). */
function parseFullRow(rawRowXml: string, date1904: boolean): RackUnitCapacityRow | null {
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const cells: Array<string | number | null> = [];
  for (const cellMatch of rawRowXml.matchAll(cellRe)) {
    const inner = cellMatch[2] ?? null;
    if (!inner) {
      cells.push(null);
      continue;
    }
    const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (t) {
      cells.push(xmlUnescape(t[1]));
      continue;
    }
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    cells.push(v ? Number(v[1]) : null);
  }
  if (cells.length < HEADERS.length || cells[0] === null || cells[0] === "") return null;
  const rawMonth = cells[0];
  const month = typeof rawMonth === "number" ? serialToYearMonth(rawMonth, date1904) : String(rawMonth);
  if (!month) return null;
  const num = (value: string | number | null): number => (typeof value === "number" ? value : Number(value ?? 0));
  const numOrNull = (value: string | number | null): number | null => (value === null || value === "" ? null : Number(value));
  return {
    month,
    totalU: num(cells[1]),
    usedU: num(cells[2]),
    availableU: num(cells[3]),
    availabilityPct: numOrNull(cells[4])
  };
}

interface ExistingRow {
  rowNumber: number;
  row: RackUnitCapacityRow | null;
}

function parseExistingRows(sheetDataInner: string, date1904: boolean): ExistingRow[] {
  const rows: ExistingRow[] = [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of sheetDataInner.matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    if (rowNumber === 1) continue; // header, always rebuilt fresh
    rows.push({ rowNumber, row: parseFullRow(match[0], date1904) });
  }
  return rows;
}

function tableXml(tableId: number, ref: string): string {
  const columns = HEADERS.map((name, idx) => `<tableColumn id="${idx + 1}" name="${xmlEscape(name)}"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${tableId}" ` +
    `name="${RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME}" displayName="${RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${HEADERS.length}">${columns}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`
  );
}

function emptyWorksheetXml(tableRid: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${LAST_COL}1"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${buildHeaderRowXml()}</sheetData>` +
    `<tableParts count="1"><tablePart r:id="${tableRid}"/></tableParts>` +
    `</worksheet>`
  );
}

export async function locateRackUnitCapacitySheet(zip: JSZip): Promise<string | null> {
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const relsXml = await entryText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return null;
  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = getAttr(m[1], "Id");
    const target = getAttr(m[1], "Target");
    if (id && target) relMap.set(id, target);
  }
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = getAttr(m[1], "name");
    const rid = getAttr(m[1], "r:id");
    if (name && xmlUnescape(name) === RACK_UNIT_CAPACITY_SHEET_NAME && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

async function locateTableXmlPath(zip: JSZip, sheetXmlPath: string): Promise<string | null> {
  const sheetName = sheetXmlPath.match(/xl\/worksheets\/(sheet\d+\.xml)$/)?.[1];
  if (!sheetName) return null;
  const relsPath = `xl/worksheets/_rels/${sheetName}.rels`;
  const relsXml = await entryText(zip, relsPath);
  if (!relsXml) return null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const type = getAttr(m[1], "Type");
    const target = getAttr(m[1], "Target");
    if (target && type?.endsWith("/table")) return resolveRelationshipTarget("xl/worksheets", target);
  }
  return null;
}

export async function ensureRackUnitCapacitySheet(zip: JSZip): Promise<{ xmlPath: string; tablePath: string; created: boolean }> {
  const existing = await locateRackUnitCapacitySheet(zip);
  if (existing) {
    const tablePath = await locateTableXmlPath(zip, existing);
    if (!tablePath) throw new Error(`"${RACK_UNIT_CAPACITY_SHEET_NAME}" exists but its table part could not be located.`);
    return { xmlPath: existing, tablePath, created: false };
  }

  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const relsXml = await entryText(zip, "xl/_rels/workbook.xml.rels");
  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (!workbookXml || !relsXml || !contentTypesXml) {
    throw new Error("Workbook is missing workbook.xml, workbook.xml.rels, or [Content_Types].xml.");
  }

  const existingSheetIndexes = Object.keys(zip.files)
    .map(name => name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => parseInt(m[1], 10));
  const nextSheetIndex = (existingSheetIndexes.length > 0 ? Math.max(...existingSheetIndexes) : 0) + 1;
  const newSheetPath = `xl/worksheets/sheet${nextSheetIndex}.xml`;
  const newSheetRelsPath = `xl/worksheets/_rels/sheet${nextSheetIndex}.xml.rels`;

  const sheetIds = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)]
    .map(m => parseInt(getAttr(m[1], "sheetId") ?? "0", 10))
    .filter(Number.isFinite);
  const nextSheetId = (sheetIds.length > 0 ? Math.max(...sheetIds) : 0) + 1;

  const relIds = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
    .map(m => parseInt((getAttr(m[1], "Id") ?? "rId0").replace("rId", ""), 10))
    .filter(Number.isFinite);
  const nextRelId = (relIds.length > 0 ? Math.max(...relIds) : 0) + 1;
  const newRid = `rId${nextRelId}`;

  const existingTableFiles = Object.keys(zip.files)
    .map(name => name.match(/^xl\/tables\/table(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => parseInt(m[1], 10));
  const nextTableFileIndex = (existingTableFiles.length > 0 ? Math.max(...existingTableFiles) : 0) + 1;
  const newTablePath = `xl/tables/table${nextTableFileIndex}.xml`;

  const existingTableIds: number[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/tables\/table\d+\.xml$/.test(name)) continue;
    const txml = await zip.file(name)!.async("string");
    const id = parseInt(getAttr(txml.match(/<table\b([^>]*)>/)?.[1] ?? "", "id") ?? "0", 10);
    if (Number.isFinite(id)) existingTableIds.push(id);
  }
  const nextTableId = (existingTableIds.length > 0 ? Math.max(...existingTableIds) : 0) + 1;

  const initialRef = `A1:${LAST_COL}1`;
  zip.file(newTablePath, tableXml(nextTableId, initialRef));
  zip.file(newSheetRelsPath, (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${nextTableFileIndex}.xml"/>` +
    `</Relationships>`
  ));
  zip.file(newSheetPath, emptyWorksheetXml("rId1"));

  zip.file(
    "xl/workbook.xml",
    workbookXml.replace(/<\/sheets>/, `<sheet name="${xmlEscape(RACK_UNIT_CAPACITY_SHEET_NAME)}" sheetId="${nextSheetId}" r:id="${newRid}"/></sheets>`)
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    relsXml.replace(/<\/Relationships>/, `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetIndex}.xml"/></Relationships>`)
  );
  zip.file(
    "[Content_Types].xml",
    contentTypesXml.replace(
      /<\/Types>/,
      `<Override PartName="/${newSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/${newTablePath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`
    )
  );

  return { xmlPath: newSheetPath, tablePath: newTablePath, created: true };
}

/**
 * Insert-or-update the row for `input.month` (values only - every other
 * month's row is untouched). Every row, touched or not, is re-emitted with
 * the current month/percentage styles on every call, matching Rack Capacity
 * History's rebuild-and-byte-compare idempotency contract. Returns whether
 * the sheet's bytes actually changed.
 */
export async function upsertRackUnitCapacityRow(
  zip: JSZip,
  xmlPath: string,
  tablePath: string,
  input: RackUnitCapacityInput
): Promise<boolean> {
  const xml = await entryText(zip, xmlPath);
  if (!xml) throw new Error(`Rack Unit Capacity worksheet part missing: ${xmlPath}`);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("Rack Unit Capacity worksheet has no sheetData.");
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const styles = await ensureRowStyles(zip);

  const inner = sheetDataMatch[1] ?? "";
  const existingRows = parseExistingRows(inner, date1904);
  const byKey = new Map(existingRows.filter(r => r.row).map(r => [rowKey(r.row!.month), r]));

  let maxRowNumber = existingRows.reduce((max, r) => Math.max(max, r.rowNumber), 1);
  const finalRowByNumber = new Map<number, RackUnitCapacityRow>();
  for (const r of existingRows) if (r.row) finalRowByNumber.set(r.rowNumber, r.row);

  const row = deriveRackUnitCapacityRow(input);
  const key = rowKey(row.month);
  const existing = byKey.get(key);
  const rowsEqual = existing?.row
    ? existing.row.totalU === row.totalU &&
      existing.row.usedU === row.usedU &&
      existing.row.availableU === row.availableU &&
      existing.row.availabilityPct === row.availabilityPct
    : false;
  if (!rowsEqual) {
    if (existing) {
      finalRowByNumber.set(existing.rowNumber, row);
    } else {
      const newRowNumber = ++maxRowNumber;
      finalRowByNumber.set(newRowNumber, row);
    }
  }

  const orderedRowNumbers = Array.from(finalRowByNumber.keys()).sort((a, b) => a - b);
  const newSheetData = `<sheetData>${buildHeaderRowXml()}${orderedRowNumbers.map(n => buildRowXml(n, finalRowByNumber.get(n)!, styles, date1904)).join("")}</sheetData>`;
  if (newSheetData === sheetDataMatch[0]) return false; // true no-op: byte-identical to what's already on disk

  const lastRow = orderedRowNumbers.length > 0 ? Math.max(...orderedRowNumbers) : 1;
  const newRef = `A1:${LAST_COL}${lastRow}`;

  let patchedSheet = xml.replace(sheetDataMatch[0], () => newSheetData);
  patchedSheet = patchedSheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${newRef}"/>`);
  zip.file(xmlPath, patchedSheet);

  const tableXmlText = await entryText(zip, tablePath);
  if (tableXmlText) {
    const patchedTable = tableXmlText
      .replace(/(<table\b[^>]*\bref=")[^"]*(")/, `$1${newRef}$2`)
      .replace(/(<autoFilter\b[^>]*\bref=")[^"]*(")/, `$1${newRef}$2`);
    zip.file(tablePath, patchedTable);
  }

  return true;
}

/** Orchestrates ensure-sheet + upsert for a single month's save (the only
 *  entry point the Rack Unit Capacity editor needs). */
export async function patchRackUnitCapacityBuffer(original: Buffer, input: RackUnitCapacityInput): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const { xmlPath, tablePath, created } = await ensureRackUnitCapacitySheet(zip);
  const changed = await upsertRackUnitCapacityRow(zip, xmlPath, tablePath, input);
  if (!created && !changed) return original;
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}

/** Reads all persisted Rack Unit Capacity rows, if the sheet exists. */
export async function readRackUnitCapacityFromBuffer(buffer: Buffer): Promise<RackUnitCapacityRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackUnitCapacitySheet(zip);
  if (!xmlPath) return [];
  const xml = await entryText(zip, xmlPath);
  if (!xml) return [];
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return [];
  return parseExistingRows(sheetDataMatch[1], date1904)
    .map(r => r.row)
    .filter((row): row is RackUnitCapacityRow => row !== null);
}

export interface RackUnitCapacityImage {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg";
}

/**
 * Reads the embedded "Rack Unit Capacity Image" (if any) - for report/PDF
 * purposes. Browser-safe: only the read path (locate the sheet's drawing
 * relationship, resolve the media part), no image-writing logic needed here.
 */
export async function readRackUnitCapacityImageFromBuffer(buffer: Buffer): Promise<RackUnitCapacityImage | null> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetXmlPath = await locateRackUnitCapacitySheet(zip);
  if (!sheetXmlPath) return null;
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsXml = await entryText(zip, `xl/worksheets/_rels/${sheetFile}.rels`);
  if (!relsXml) return null;

  let drawingTarget: string | null = null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      drawingTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!drawingTarget) return null;

  const drawingPath = resolveRelationshipTarget("xl/worksheets", drawingTarget);
  const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
  const drawingRelsXml = await entryText(zip, `xl/drawings/_rels/${drawingFile}.rels`);
  if (!drawingRelsXml) return null;

  let mediaTarget: string | null = null;
  for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/image")) {
      mediaTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!mediaTarget) return null;

  const mediaPath = resolveRelationshipTarget("xl/drawings", mediaTarget);
  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return null;
  const ext = mediaPath.match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase();
  if (!ext) return null;
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  const bytes = await mediaFile.async("nodebuffer");
  return { bytes, mimeType };
}

