/**
 * "2. UPS Group History" - a permanently persisted, per-month, per-UPS-Group
 * summary sheet (Total Load kW/kVA, Capacity, Load %, Available %, Monthly
 * Energy, plus Facility/Month/Generated Timestamp/Data Version metadata).
 *
 * Same OPC/zip-level philosophy as WorkbookWriter.ts: VBA, pivot caches,
 * charts and every other existing part must survive byte-for-byte. Adding a
 * worksheet through ExcelJS's normal load->modify->write cycle was verified
 * to silently drop vbaProject.bin, every pivot table/cache and every chart
 * (see the empirical probe run before writing this module) - so a brand new
 * worksheet part is instead spliced into the zip directly: a new
 * xl/worksheets/sheetN.xml, registered in xl/workbook.xml,
 * xl/_rels/workbook.xml.rels and [Content_Types].xml. No existing zip entry
 * is ever rewritten by this module.
 *
 * Row identity is (facility, month, UPS group name). Upserts only ever
 * touch rows whose key is in the incoming batch; every other row - all of
 * history not part of this call - is carried over untouched.
 */
import JSZip from "jszip";
import { MonthlyLog } from "../types";
import { computeUpsGroupSummary, UpsGroupConfig } from "../utils/upsGroupAggregation";

export const UPS_GROUP_HISTORY_SHEET_NAME = "2. UPS Group History";
export const UPS_GROUP_HISTORY_DATA_VERSION = 1;

const HEADERS = [
  "Facility",
  "Month",
  "UPS Group",
  "Total Load (kW)",
  "Total Load (kVA)",
  "UPS Capacity (kVA)",
  "Load (%)",
  "Available (%)",
  "Monthly Energy (kWh)",
  "Generated Timestamp",
  "Data Version"
] as const;

export interface UpsGroupHistoryRow {
  facility: string;
  month: string;
  group: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
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

async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

function rowKey(facility: string, month: string, group: string): string {
  return `${facility.trim().toLowerCase()}|${month.trim()}|${group.trim().toLowerCase()}`;
}

function cellXml(ref: string, kind: "text" | "number" | "timestamp", value: string | number): string {
  if (kind === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function buildRowXml(rowNumber: number, row: UpsGroupHistoryRow): string {
  const values: Array<[string | number, "text" | "number" | "timestamp"]> = [
    [row.facility, "text"],
    [row.month, "text"],
    [row.group, "text"],
    [row.totalLoadKw, "number"],
    [row.totalLoadKva, "number"],
    [row.capacity ?? "", row.capacity === null ? "text" : "number"],
    [row.loadPercent ?? "", row.loadPercent === null ? "text" : "number"],
    [row.availablePercent ?? "", row.availablePercent === null ? "text" : "number"],
    [row.monthlyEnergyKwh, "number"],
    [row.generatedAt, "timestamp"],
    [row.dataVersion, "number"]
  ];
  const cells = values
    .map(([value, kind], idx) => {
      const ref = `${indexToColLetter(idx + 1)}${rowNumber}`;
      if (value === "" || value === null || value === undefined) return `<c r="${ref}"/>`;
      return cellXml(ref, kind, value);
    })
    .join("");
  return `<row r="${rowNumber}">${cells}</row>`;
}

interface ExistingRow {
  rowNumber: number;
  raw: string;
  key: string | null;
  /** Column D-I (Total Load kW/kVA, Capacity, Load%, Available%, Monthly
   *  Energy) as numbers or null - the comparable "value signature" used to
   *  decide whether a row actually changed, so re-saving unchanged data
   *  never rewrites the row or its Generated Timestamp. */
  values: Array<number | null>;
}

function parseExistingRows(sheetDataInner: string): ExistingRow[] {
  const rows: ExistingRow[] = [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of sheetDataInner.matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    const raw = match[0];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const texts: string[] = [];
    const values: Array<number | null> = [];
    let col = 0;
    for (const cellMatch of raw.matchAll(cellRe)) {
      col++;
      const inner = cellMatch[2] ?? null;
      if (col <= 3) {
        if (!inner) {
          texts.push("");
        } else {
          const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          texts.push(t ? xmlUnescape(t[1]) : "");
        }
      } else if (col >= 4 && col <= 9) {
        const v = inner?.match(/<v>([\s\S]*?)<\/v>/);
        const n = v ? Number(v[1]) : NaN;
        values.push(Number.isFinite(n) ? n : null);
      }
    }
    const key = texts.length >= 3 && texts[1] !== "" ? rowKey(texts[0], texts[1], texts[2]) : null;
    rows.push({ rowNumber, raw, key, values });
  }
  return rows;
}

function emptyWorksheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:K1"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${buildHeaderRowXml()}</sheetData>` +
    `</worksheet>`
  );
}

function buildHeaderRowXml(): string {
  const cells = HEADERS.map((h, idx) => cellXml(`${indexToColLetter(idx + 1)}1`, "text", h)).join("");
  return `<row r="1">${cells}</row>`;
}

function getAttr(tagAttrs: string, name: string): string | null {
  const m = tagAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** True if a worksheet named UPS_GROUP_HISTORY_SHEET_NAME already exists. */
export async function locateUpsGroupHistorySheet(zip: JSZip): Promise<string | null> {
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
    if (name && xmlUnescape(name) === UPS_GROUP_HISTORY_SHEET_NAME && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

/** Creates the worksheet (empty, header row only) if it does not exist yet.
 *  Every other existing zip part is left byte-for-byte untouched. */
export async function ensureUpsGroupHistorySheet(zip: JSZip): Promise<{ xmlPath: string; created: boolean }> {
  const existing = await locateUpsGroupHistorySheet(zip);
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

  const patchedWorkbook = workbookXml.replace(
    /<\/sheets>/,
    `<sheet name="${xmlEscape(UPS_GROUP_HISTORY_SHEET_NAME)}" sheetId="${nextSheetId}" r:id="${newRid}"/></sheets>`
  );
  zip.file("xl/workbook.xml", patchedWorkbook);

  const patchedRels = relsXml.replace(
    /<\/Relationships>/,
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetIndex}.xml"/></Relationships>`
  );
  zip.file("xl/_rels/workbook.xml.rels", patchedRels);

  const patchedContentTypes = contentTypesXml.replace(
    /<\/Types>/,
    `<Override PartName="/${newSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
  );
  zip.file("[Content_Types].xml", patchedContentTypes);

  return { xmlPath: newSheetPath, created: true };
}

/**
 * Insert or update rows for exactly the (facility, month, group) keys in
 * `rows`. `overwriteExisting: false` (backfill) skips any key that already
 * has a row - existing history is never touched. `overwriteExisting: true`
 * (incremental save) replaces the row in place if the key exists, else
 * appends it. Rows for keys NOT present in `rows` are always left alone.
 */
function rowValuesOf(row: UpsGroupHistoryRow): Array<number | null> {
  return [row.totalLoadKw, row.totalLoadKva, row.capacity, row.loadPercent, row.availablePercent, row.monthlyEnergyKwh];
}

function valuesEqual(a: Array<number | null>, b: Array<number | null>): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, idx) => {
    const other = b[idx];
    if (v === null || other === null) return v === other;
    return Math.abs(v - other) < 1e-9;
  });
}

export async function upsertUpsGroupHistoryRows(
  zip: JSZip,
  xmlPath: string,
  rows: UpsGroupHistoryRow[],
  overwriteExisting: boolean
): Promise<void> {
  if (rows.length === 0) return;
  const xml = await entryText(zip, xmlPath);
  if (!xml) throw new Error(`UPS Group History worksheet part missing: ${xmlPath}`);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("UPS Group History worksheet has no sheetData.");
  const inner = sheetDataMatch[1] ?? buildHeaderRowXml();
  const existingRows = parseExistingRows(inner);
  const headerRow = existingRows.find(r => r.rowNumber === 1) ?? { rowNumber: 1, raw: buildHeaderRowXml(), key: null, values: [] };
  const byKey = new Map(existingRows.filter(r => r.rowNumber !== 1).map(r => [r.key, r]));

  let maxRowNumber = existingRows.reduce((max, r) => Math.max(max, r.rowNumber), 1);
  const finalRowsByNumber = new Map<number, string>();
  for (const r of existingRows) finalRowsByNumber.set(r.rowNumber, r.raw);
  finalRowsByNumber.set(1, headerRow.raw);

  for (const row of rows) {
    const key = rowKey(row.facility, row.month, row.group);
    const existing = byKey.get(key);
    if (existing) {
      if (!overwriteExisting) continue; // backfill: never overwrite valid history
      // Value-based idempotency: re-saving unchanged data must never rewrite
      // the row or refresh its Generated Timestamp - only an actual value
      // change does. This is what makes "Save with no edits" a true no-op.
      if (valuesEqual(existing.values, rowValuesOf(row))) continue;
      finalRowsByNumber.set(existing.rowNumber, buildRowXml(existing.rowNumber, row));
    } else {
      const newRowNumber = ++maxRowNumber;
      finalRowsByNumber.set(newRowNumber, buildRowXml(newRowNumber, row));
      byKey.set(key, { rowNumber: newRowNumber, raw: "", key, values: rowValuesOf(row) });
    }
  }

  const orderedRowNumbers = Array.from(finalRowsByNumber.keys()).sort((a, b) => a - b);
  const newSheetData = `<sheetData>${orderedRowNumbers.map(n => finalRowsByNumber.get(n)).join("")}</sheetData>`;
  let patched = xml.replace(sheetDataMatch[0], () => newSheetData);
  const lastCol = indexToColLetter(HEADERS.length);
  patched = patched.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCol}${maxRowNumber}"/>`);
  zip.file(xmlPath, patched);
}

/**
 * Orchestrates ensure-sheet + upsert for a whole workbook buffer.
 * `onlyMonths` unset -> backfill semantics (every month in `logs`, insert
 * only where missing). `onlyMonths` set -> incremental semantics (only
 * those months, insert-or-update).
 */
export async function patchUpsGroupHistoryBuffer(
  original: Buffer,
  facilityId: string,
  upsGroups: UpsGroupConfig[],
  logs: MonthlyLog[],
  onlyMonths?: string[]
): Promise<Buffer> {
  if (upsGroups.length === 0) return original;
  const zip = await JSZip.loadAsync(original);
  const { xmlPath } = await ensureUpsGroupHistorySheet(zip);

  const targetLogs = onlyMonths ? logs.filter(log => onlyMonths.includes(log.month)) : logs;
  const generatedAt = new Date().toISOString();
  const rows: UpsGroupHistoryRow[] = targetLogs.flatMap(log =>
    computeUpsGroupSummary(log, upsGroups).map(summary => ({
      facility: facilityId,
      month: log.month,
      group: summary.name,
      totalLoadKw: summary.totalLoadKw,
      totalLoadKva: summary.totalLoadKva,
      capacity: summary.capacity,
      loadPercent: summary.loadPercent,
      availablePercent: summary.availablePercent,
      monthlyEnergyKwh: summary.monthlyEnergyKwh,
      generatedAt,
      dataVersion: UPS_GROUP_HISTORY_DATA_VERSION
    }))
  );

  await upsertUpsGroupHistoryRows(zip, xmlPath, rows, Boolean(onlyMonths));
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}
