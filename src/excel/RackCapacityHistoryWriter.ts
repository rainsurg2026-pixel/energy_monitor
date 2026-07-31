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
 * touch rows whose key is in the incoming batch; every other row - all
 * prior history - is carried over untouched, and re-saving identical values
 * is a true no-op (no rewrite, same idempotency contract as UPS Group
 * History).
 */
import JSZip from "jszip";
import { RackCapacityMetrics } from "../utils/rackCapacity";

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

async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

function rowKey(facility: string, month: string, zone: string): string {
  return `${facility.trim().toLowerCase()}|${month.trim()}|${zone.trim().toLowerCase()}`;
}

function cellXml(ref: string, kind: "text" | "number", value: string | number): string {
  if (kind === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function buildHeaderRowXml(): string {
  const cells = HEADERS.map((h, idx) => cellXml(`${indexToColLetter(idx + 1)}1`, "text", h)).join("");
  return `<row r="1">${cells}</row>`;
}

function buildRowXml(rowNumber: number, row: RackCapacityHistoryRow): string {
  const values: Array<[string | number, "text" | "number"]> = [
    [row.snapshotMonth, "text"],
    [row.facility, "text"],
    [row.rackZone, "text"],
    [row.totalRacks, "number"],
    [row.inUse, "number"],
    [row.available, "number"],
    [row.reserved, "number"],
    [row.pendingDismantle, "number"],
    [row.other, "number"],
    [row.usagePct ?? "", row.usagePct === null ? "text" : "number"],
    [row.availabilityPct ?? "", row.availabilityPct === null ? "text" : "number"],
    [row.reservedPct ?? "", row.reservedPct === null ? "text" : "number"],
    [row.pendingDismantlePct ?? "", row.pendingDismantlePct === null ? "text" : "number"],
    [row.otherPct ?? "", row.otherPct === null ? "text" : "number"],
    [row.generatedAt, "text"],
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
  key: string | null;
  /** Columns D-N (TotalRacks..OtherPct) as a comparable value signature -
   *  re-saving identical data must never rewrite the row or its timestamp. */
  values: Array<number | null>;
}

function parseExistingRows(sheetDataInner: string): ExistingRow[] {
  const rows: ExistingRow[] = [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of sheetDataInner.matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const texts: string[] = [];
    const values: Array<number | null> = [];
    let col = 0;
    for (const cellMatch of match[0].matchAll(cellRe)) {
      col++;
      const inner = cellMatch[2] ?? null;
      if (col <= 3) {
        if (!inner) {
          texts.push("");
        } else {
          const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          texts.push(t ? xmlUnescape(t[1]) : "");
        }
      } else if (col >= 4 && col <= 14) {
        const v = inner?.match(/<v>([\s\S]*?)<\/v>/);
        const n = v ? Number(v[1]) : NaN;
        values.push(Number.isFinite(n) ? n : null);
      }
    }
    const key = texts.length >= 3 && texts[0] !== "" ? rowKey(texts[1], texts[0], texts[2]) : null;
    rows.push({ rowNumber, key, values });
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

/** Insert-or-update rows for exactly the (Facility, SnapshotMonth, RackZone)
 *  keys in `rows`. Rows for keys NOT present in `rows` are always left
 *  alone - this only ever touches the month just saved. */
export async function upsertRackCapacityHistoryRows(zip: JSZip, xmlPath: string, rows: RackCapacityHistoryRow[]): Promise<boolean> {
  if (rows.length === 0) return false;
  const xml = await entryText(zip, xmlPath);
  if (!xml) throw new Error(`Rack Capacity History worksheet part missing: ${xmlPath}`);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("Rack Capacity History worksheet has no sheetData.");
  const inner = sheetDataMatch[1] ?? buildHeaderRowXml();
  const existingRows = parseExistingRows(inner);
  const byKey = new Map(existingRows.filter(r => r.rowNumber !== 1).map(r => [r.key, r]));

  let maxRowNumber = existingRows.reduce((max, r) => Math.max(max, r.rowNumber), 1);
  const finalRowsByNumber = new Map<number, string>();
  for (const r of existingRows) {
    const raw = inner.match(new RegExp(`<row\\b[^>]*?r="${r.rowNumber}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>)`));
    if (raw) finalRowsByNumber.set(r.rowNumber, raw[0]);
  }
  finalRowsByNumber.set(1, buildHeaderRowXml());
  let changed = false;

  for (const row of rows) {
    const key = rowKey(row.facility, row.snapshotMonth, row.rackZone);
    const existing = byKey.get(key);
    if (existing) {
      if (valuesEqual(existing.values, rowValuesOf(row))) continue;
      changed = true;
      finalRowsByNumber.set(existing.rowNumber, buildRowXml(existing.rowNumber, row));
    } else {
      changed = true;
      const newRowNumber = ++maxRowNumber;
      finalRowsByNumber.set(newRowNumber, buildRowXml(newRowNumber, row));
      byKey.set(key, { rowNumber: newRowNumber, key, values: rowValuesOf(row) });
    }
  }

  if (!changed) return false;
  const orderedRowNumbers = Array.from(finalRowsByNumber.keys()).sort((a, b) => a - b);
  const newSheetData = `<sheetData>${orderedRowNumbers.map(n => finalRowsByNumber.get(n)).join("")}</sheetData>`;
  let patched = xml.replace(sheetDataMatch[0], () => newSheetData);
  const lastCol = indexToColLetter(HEADERS.length);
  patched = patched.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCol}${maxRowNumber}"/>`);
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
 *  single reporting month just saved (never a backfill of other months). */
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

/** Reads all persisted Rack Capacity History rows, if the sheet exists. */
export async function readRackCapacityHistoryFromBuffer(buffer: Buffer): Promise<RackCapacityHistoryRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackCapacityHistorySheet(zip);
  if (!xmlPath) return [];
  const xml = await entryText(zip, xmlPath);
  if (!xml) return [];
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const rows: RackCapacityHistoryRow[] = [];
  for (const match of sheetDataMatch[1].matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    if (rowNumber === 1) continue; // header
    const raw = match[0];
    const cells: Array<string | number | null> = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const cellMatch of raw.matchAll(cellRe)) {
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
    if (cells.length < HEADERS.length || cells[0] === null) continue;
    rows.push({
      snapshotMonth: String(cells[0]),
      facility: String(cells[1] ?? ""),
      rackZone: String(cells[2] ?? ""),
      totalRacks: Number(cells[3] ?? 0),
      inUse: Number(cells[4] ?? 0),
      available: Number(cells[5] ?? 0),
      reserved: Number(cells[6] ?? 0),
      pendingDismantle: Number(cells[7] ?? 0),
      other: Number(cells[8] ?? 0),
      usagePct: cells[9] === null ? null : Number(cells[9]),
      availabilityPct: cells[10] === null ? null : Number(cells[10]),
      reservedPct: cells[11] === null ? null : Number(cells[11]),
      pendingDismantlePct: cells[12] === null ? null : Number(cells[12]),
      otherPct: cells[13] === null ? null : Number(cells[13]),
      generatedAt: String(cells[14] ?? ""),
      dataVersion: Number(cells[15] ?? 1)
    });
  }
  return rows;
}
