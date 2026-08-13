/**
 * "Rack Capacity History" - a permanently persisted, per-month, per-Rack-Zone
 * snapshot of Table7's status breakdown (plus one facility-total row per
 * month, RackZone="(Total)"), captured only when a Rack Capacity Save
 * actually succeeds (never backfilled from today's data - see
 * calculateRackCapacityHistorySnapshotRows callers).
 *
 * Same OPC/zip-level philosophy as UpsGroupHistoryWriter.ts, which this
 * module is deliberately modeled on: a brand-new worksheet part is spliced
 * directly into the zip (new xl/worksheets/sheetN.xml + workbook.xml +
 * workbook.xml.rels + [Content_Types].xml registration) rather than going
 * through ExcelJS's load->modify->write cycle, which was already proven
 * elsewhere in this codebase to silently drop vbaProject.bin, pivot
 * tables/caches, and charts.
 *
 * Row identity is (Facility, SnapshotMonth, RackZone). Upserts only ever
 * change the VALUES of rows whose key is in the incoming batch; every other
 * row - all prior history - keeps its data, and re-saving identical values
 * is a true no-op (byte-identical, no rewrite, same idempotency contract as
 * UPS Group History). Every row (touched or not) is rebuilt with the
 * CURRENT number-format styles on every call, which is what makes the
 * v2.2.2 -> v2.2.3 format migration (SnapshotMonth: text -> real Excel date;
 * *Pct columns: unstyled -> "0.00%") both automatic and idempotent - the
 * first post-v2.2.3 call reformats every existing row once; every call
 * after that reproduces byte-identical XML and is a true no-op.
 */
import JSZip from "jszip";
import { RackCapacityMetrics } from "../utils/rackCapacity";
import { ensureExactCellFormatStyles, workbookMonthSerial, workbookUsesDate1904 } from "./ExcelZipUtils";

export const RACK_CAPACITY_HISTORY_SHEET_NAME = "Rack Capacity History";
export const RACK_CAPACITY_HISTORY_TOTAL_ZONE = "(Total)";
export const RACK_CAPACITY_HISTORY_DATA_VERSION = 1;

const HEADERS = [
  "SnapshotMonth",
  "Facility",
  "RackZone",
  "TotalRacks",
  "InUse",
  "Available",
  "Reserved",
  "PendingDismantle",
  "Other",
  "UsagePct",
  "AvailabilityPct",
  "ReservedPct",
  "PendingDismantlePct",
  "OtherPct",
  "GeneratedTimestamp",
  "DataVersion"
] as const;

export interface RackCapacityHistoryRow {
  /** Canonical "YYYY-MM" - the in-memory/app-facing representation. On disk
   *  this is always a real Excel date serial (first-of-month) with an
   *  "mmm-yy" style; never text. */
  snapshotMonth: string;
  facility: string;
  rackZone: string;
  totalRacks: number;
  inUse: number;
  available: number;
  reserved: number;
  pendingDismantle: number;
  other: number;
  usagePct: number | null;
  availabilityPct: number | null;
  reservedPct: number | null;
  pendingDismantlePct: number | null;
  otherPct: number | null;
  generatedAt: string;
  dataVersion: number;
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
    .replace(/&amp;/g, "&")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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

/** Excel serial (days since the workbook epoch) -> "YYYY-MM". Pure Date.UTC
 *  math throughout, matching workbookMonthSerial's own construction, so a
 *  month written today and read back later can never drift by timezone. */
function serialToYearMonth(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

function rowKey(facility: string, month: string, zone: string): string {
  return `${facility.trim().toLowerCase()}|${month.trim()}|${zone.trim().toLowerCase()}`;
}

interface HistoryStyles {
  monthStyleId: string;
  percentStyleId: string;
}

/** Registers (or reuses) the "mmm-yy" and "0.00%" cell styles this sheet
 *  needs. Called once per patch; cheap and idempotent (ensureExactCellFormatStyles
 *  itself reuses an existing numFmt/style if one already matches). */
async function ensureHistoryStyles(zip: JSZip): Promise<HistoryStyles> {
  const monthStyles = await ensureExactCellFormatStyles(zip, ["0"], "mmm-yy");
  const percentStyles = await ensureExactCellFormatStyles(zip, ["0"], "0.00%");
  const monthStyleId = monthStyles.get("0");
  const percentStyleId = percentStyles.get("0");
  if (!monthStyleId || !percentStyleId) throw new Error("Could not register Rack Capacity History cell styles.");
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

function buildRowXml(rowNumber: number, row: RackCapacityHistoryRow, styles: HistoryStyles, date1904: boolean): string {
  const monthSerial = workbookMonthSerial(row.snapshotMonth, date1904);
  const cells: string[] = [];
  const col = (idx: number) => `${indexToColLetter(idx + 1)}${rowNumber}`;
  cells.push(monthSerial === null ? textCellXml(col(0), row.snapshotMonth) : numberCellXml(col(0), monthSerial, styles.monthStyleId));
  cells.push(textCellXml(col(1), row.facility));
  cells.push(textCellXml(col(2), row.rackZone));
  cells.push(numberCellXml(col(3), row.totalRacks));
  cells.push(numberCellXml(col(4), row.inUse));
  cells.push(numberCellXml(col(5), row.available));
  cells.push(numberCellXml(col(6), row.reserved));
  cells.push(numberCellXml(col(7), row.pendingDismantle));
  cells.push(numberCellXml(col(8), row.other));
  const percents = [row.usagePct, row.availabilityPct, row.reservedPct, row.pendingDismantlePct, row.otherPct];
  percents.forEach((value, i) => {
    const ref = col(9 + i);
    cells.push(value === null ? `<c r="${ref}" s="${styles.percentStyleId}"/>` : numberCellXml(ref, value, styles.percentStyleId));
  });
  cells.push(textCellXml(col(14), row.generatedAt));
  cells.push(numberCellXml(col(15), row.dataVersion));
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

/** Parses one existing <row> (any prior version's format: text or real-date
 *  Month, styled or unstyled percentages) into a complete, canonical row. */
async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await entryText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(text => xmlUnescape(text[1])).join("")
  );
}

function parseFullRow(rawRowXml: string, date1904: boolean, sharedStrings: readonly string[] = []): RackCapacityHistoryRow | null {
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const cells: Array<string | number | null> = [];
  for (const cellMatch of rawRowXml.matchAll(cellRe)) {
    const attributes = cellMatch[1];
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
    if (v && getAttr(attributes, "t") === "s") {
      const sharedIndex = Number(v[1]);
      cells.push(Number.isInteger(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "");
    } else {
      cells.push(v ? Number(v[1]) : null);
    }
  }
  if (cells.length < HEADERS.length || cells[0] === null || cells[0] === "") return null;
  const rawMonth = cells[0];
  const snapshotMonth = typeof rawMonth === "number" ? serialToYearMonth(rawMonth, date1904) : String(rawMonth);
  if (!snapshotMonth) return null;
  const num = (value: string | number | null): number => (typeof value === "number" ? value : Number(value ?? 0));
  const numOrNull = (value: string | number | null): number | null => (value === null || value === "" ? null : Number(value));
  return {
    snapshotMonth,
    facility: String(cells[1] ?? ""),
    rackZone: String(cells[2] ?? ""),
    totalRacks: num(cells[3]),
    inUse: num(cells[4]),
    available: num(cells[5]),
    reserved: num(cells[6]),
    pendingDismantle: num(cells[7]),
    other: num(cells[8]),
    usagePct: numOrNull(cells[9]),
    availabilityPct: numOrNull(cells[10]),
    reservedPct: numOrNull(cells[11]),
    pendingDismantlePct: numOrNull(cells[12]),
    otherPct: numOrNull(cells[13]),
    generatedAt: String(cells[14] ?? ""),
    dataVersion: Number(cells[15] ?? 1)
  };
}

interface ExistingRow {
  rowNumber: number;
  row: RackCapacityHistoryRow | null;
}

function parseExistingRows(sheetDataInner: string, date1904: boolean, sharedStrings: readonly string[] = []): ExistingRow[] {
  const rows: ExistingRow[] = [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of sheetDataInner.matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    if (rowNumber === 1) continue; // header, always rebuilt fresh
    rows.push({ rowNumber, row: parseFullRow(match[0], date1904, sharedStrings) });
  }
  return rows;
}

function getAttr(tagAttrs: string, name: string): string | null {
  const m = tagAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function emptyWorksheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:P1"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${buildHeaderRowXml()}</sheetData>` +
    `</worksheet>`
  );
}

export async function locateRackCapacityHistorySheet(zip: JSZip): Promise<string | null> {
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
    if (name && xmlUnescape(name) === RACK_CAPACITY_HISTORY_SHEET_NAME && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

export async function ensureRackCapacityHistorySheet(zip: JSZip): Promise<{ xmlPath: string; created: boolean }> {
  const existing = await locateRackCapacityHistorySheet(zip);
  if (existing) return { xmlPath: existing, created: false };

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

  const sheetIds = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)]
    .map(m => parseInt(getAttr(m[1], "sheetId") ?? "0", 10))
    .filter(Number.isFinite);
  const nextSheetId = (sheetIds.length > 0 ? Math.max(...sheetIds) : 0) + 1;

  const relIds = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
    .map(m => parseInt((getAttr(m[1], "Id") ?? "rId0").replace("rId", ""), 10))
    .filter(Number.isFinite);
  const nextRelId = (relIds.length > 0 ? Math.max(...relIds) : 0) + 1;
  const newRid = `rId${nextRelId}`;

  zip.file(newSheetPath, emptyWorksheetXml());

  zip.file(
    "xl/workbook.xml",
    workbookXml.replace(/<\/sheets>/, `<sheet name="${xmlEscape(RACK_CAPACITY_HISTORY_SHEET_NAME)}" sheetId="${nextSheetId}" r:id="${newRid}"/></sheets>`)
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    relsXml.replace(/<\/Relationships>/, `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetIndex}.xml"/></Relationships>`)
  );
  zip.file(
    "[Content_Types].xml",
    contentTypesXml.replace(/<\/Types>/, `<Override PartName="/${newSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  );

  return { xmlPath: newSheetPath, created: true };
}

function rowValuesOf(row: RackCapacityHistoryRow): Array<number | null> {
  return [row.totalRacks, row.inUse, row.available, row.reserved, row.pendingDismantle, row.other, row.usagePct, row.availabilityPct, row.reservedPct, row.pendingDismantlePct, row.otherPct];
}

function valuesEqual(a: Array<number | null>, b: Array<number | null>): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, idx) => {
    const other = b[idx];
    if (v === null || other === null) return v === other;
    return Math.abs(v - other) < 1e-9;
  });
}

/**
 * Insert-or-update rows for exactly the (Facility, SnapshotMonth, RackZone)
 * keys in `rows` (values only - other rows' data is untouched). Every row in
 * the sheet, touched or not, is then re-emitted with the CURRENT month/
 * percentage styles, which is what makes the v2.2.2 text-Month /
 * unstyled-percentage format migration automatic and idempotent (see file
 * header comment). Returns whether the sheet's bytes actually changed.
 */
export async function upsertRackCapacityHistoryRows(zip: JSZip, xmlPath: string, rows: RackCapacityHistoryRow[]): Promise<boolean> {
  const xml = await entryText(zip, xmlPath);
  if (!xml) throw new Error(`Rack Capacity History worksheet part missing: ${xmlPath}`);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("Rack Capacity History worksheet has no sheetData.");
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sharedStrings = await readSharedStrings(zip);
  const styles = await ensureHistoryStyles(zip);

  const inner = sheetDataMatch[1] ?? "";
  const existingRows = parseExistingRows(inner, date1904, sharedStrings);
  const byKey = new Map(existingRows.filter(r => r.row).map(r => [rowKey(r.row!.facility, r.row!.snapshotMonth, r.row!.rackZone), r]));

  let maxRowNumber = existingRows.reduce((max, r) => Math.max(max, r.rowNumber), 1);
  const finalRowByNumber = new Map<number, RackCapacityHistoryRow>();
  for (const r of existingRows) if (r.row) finalRowByNumber.set(r.rowNumber, r.row);

  for (const row of rows) {
    const key = rowKey(row.facility, row.snapshotMonth, row.rackZone);
    const existing = byKey.get(key);
    if (existing?.row && valuesEqual(rowValuesOf(existing.row), rowValuesOf(row))) {
      continue; // identical data: keep the existing row (and its original
      // generatedAt/dataVersion) untouched - re-saving unchanged data must
      // never refresh the timestamp, or every save would look "changed".
    }
    if (existing) {
      finalRowByNumber.set(existing.rowNumber, row);
    } else {
      const newRowNumber = ++maxRowNumber;
      finalRowByNumber.set(newRowNumber, row);
      byKey.set(key, { rowNumber: newRowNumber, row });
    }
  }

  const orderedRowNumbers = Array.from(finalRowByNumber.keys()).sort((a, b) => a - b);
  const newSheetData = `<sheetData>${buildHeaderRowXml()}${orderedRowNumbers.map(n => buildRowXml(n, finalRowByNumber.get(n)!, styles, date1904)).join("")}</sheetData>`;
  if (newSheetData === sheetDataMatch[0]) return false; // true no-op: byte-identical to what's already on disk

  let patched = xml.replace(sheetDataMatch[0], () => newSheetData);
  const lastCol = indexToColLetter(HEADERS.length);
  const dimensionRef = orderedRowNumbers.length > 0 ? `A1:${lastCol}${Math.max(...orderedRowNumbers)}` : `A1:${lastCol}1`;
  patched = patched.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${dimensionRef}"/>`);
  zip.file(xmlPath, patched);
  return true;
}

/** Builds this month's snapshot rows (one per zone + one facility total row)
 *  from the already-computed authoritative metrics - never re-derives counts
 *  independently. */
export function rackCapacityHistoryRowsFromMetrics(
  facility: string,
  snapshotMonth: string,
  metrics: RackCapacityMetrics,
  generatedAt: string
): RackCapacityHistoryRow[] {
  const toRow = (zone: string, m: { total: number; inUse: { count: number; ratio: number | null }; available: { count: number; ratio: number | null }; reserved: { count: number; ratio: number | null }; pendingDismantle: { count: number; ratio: number | null }; other: { count: number; ratio: number | null } }): RackCapacityHistoryRow => ({
    snapshotMonth,
    facility,
    rackZone: zone,
    totalRacks: m.total,
    inUse: m.inUse.count,
    available: m.available.count,
    reserved: m.reserved.count,
    pendingDismantle: m.pendingDismantle.count,
    other: m.other.count,
    usagePct: m.inUse.ratio,
    availabilityPct: m.available.ratio,
    reservedPct: m.reserved.ratio,
    pendingDismantlePct: m.pendingDismantle.ratio,
    otherPct: m.other.ratio,
    generatedAt,
    dataVersion: RACK_CAPACITY_HISTORY_DATA_VERSION
  });
  return [toRow(RACK_CAPACITY_HISTORY_TOTAL_ZONE, metrics), ...metrics.zoneMetrics.map(z => toRow(z.zone, z))];
}

/** Orchestrates ensure-sheet + upsert for a whole workbook buffer, for the
 *  single reporting month just saved (never a backfill of other months).
 *  Also migrates any pre-v2.2.3 formatting (text Month, unstyled percentages)
 *  on every existing row, since upsertRackCapacityHistoryRows always
 *  rebuilds the whole sheet with current styles. */
export async function patchRackCapacityHistoryBuffer(
  original: Buffer,
  facility: string,
  snapshotMonth: string,
  metrics: RackCapacityMetrics
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const { xmlPath, created } = await ensureRackCapacityHistorySheet(zip);
  const rows = rackCapacityHistoryRowsFromMetrics(facility, snapshotMonth, metrics, new Date().toISOString());
  const changed = await upsertRackCapacityHistoryRows(zip, xmlPath, rows);
  if (!created && !changed) return original;
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}

/**
 * Migrates an existing "Rack Capacity History" sheet's number formats
 * (v2.2.2 text Month -> real Excel date; unstyled percentages -> 0.00%)
 * without changing any data values or adding/removing rows. A no-op (returns
 * the original buffer) if the sheet doesn't exist yet or is already in the
 * current format. Safe to call any number of times (idempotent).
 */
export async function migrateRackCapacityHistoryFormats(original: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(original);
  const xmlPath = await locateRackCapacityHistorySheet(zip);
  if (!xmlPath) return original;
  const changed = await upsertRackCapacityHistoryRows(zip, xmlPath, []);
  if (!changed) return original;
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}

/** Reads all persisted Rack Capacity History rows, if the sheet exists.
 *  Understands both the current real-Excel-date Month format and the
 *  v2.2.2 text-Month format (pre-migration), so a workbook that hasn't been
 *  saved since upgrading still reads correctly. */
export async function readRackCapacityHistoryFromBuffer(buffer: Buffer): Promise<RackCapacityHistoryRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackCapacityHistorySheet(zip);
  if (!xmlPath) return [];
  const xml = await entryText(zip, xmlPath);
  if (!xml) return [];
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sharedStrings = await readSharedStrings(zip);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return [];
  return parseExistingRows(sheetDataMatch[1], date1904, sharedStrings)
    .map(r => r.row)
    .filter((row): row is RackCapacityHistoryRow => row !== null);
}
