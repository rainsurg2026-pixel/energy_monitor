/**
 * "Rack Unit Capacity Img History" - the v2.2.5-era worksheet that held one
 * row + one embedded image per (Facility, Reporting Month). As of v2.2.6,
 * this sheet is legacy-only: images are never embedded into a workbook
 * again (see src/storage/ImageStorageProvider.ts, the filesystem
 * replacement, and RackUnitCapacityImageMigration.ts, which extracts every
 * row this module can still read and then calls removeRackUnitCapacityImageHistorySheet
 * below to delete the sheet entirely). This module therefore keeps only the
 * READ path (for migration/extraction) and the sheet-removal function - the
 * upsert/embed/save functions that used to live here are gone.
 *
 * Same OPC/zip-level philosophy as RackCapacityHistoryWriter.ts: a worksheet
 * part is read/removed directly at the zip level rather than through
 * ExcelJS (proven elsewhere in this codebase to silently drop
 * vbaProject.bin/pivot tables/charts).
 */
import JSZip from "jszip";
import { entryText, getAttr, workbookUsesDate1904 } from "./ExcelZipUtils";

// Excel worksheet names have a hard 31-character limit; "Rack Unit Capacity
// Image History" (32 chars) exceeds it and made ExcelJS reject the workbook
// on read (WorkbookReader.ts loads the whole file through ExcelJS for the
// energy-log sheets).
export const RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME = "Rack Unit Capacity Img History";

const HEADERS_COUNT = 6; // ReportingMonth, Facility, Timestamp, User, MimeType, DataVersion

export interface RackUnitCapacityImageHistoryRow {
  /** Canonical "YYYY-MM" - the month this image documents, never the upload date. */
  reportingMonth: string;
  facility: string;
  /** ISO 8601 - when this image was saved (wall-clock upload time). */
  timestamp: string;
  /** OS username of whoever ran the save. */
  user: string;
  mimeType: "image/png" | "image/jpeg";
  dataVersion: number;
}

export interface RackUnitCapacityImageHistoryEntry {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const ANCHOR_COL = 10; // K, matching the pre-existing single-image K9 convention
const FIRST_ANCHOR_ROW = 8; // 0-based row 9 (K9) for this sheet's first data row
const ANCHOR_ROW_STEP = 20; // vertical clearance (in rows) per image slot
const EMU_PER_PX = 9525;

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}
function rowKey(facility: string, month: string): string {
  return `${facility.trim().toLowerCase()}|${month.trim()}`;
}
/** The 0-based xdr:row this row's image is anchored at. */
function anchorRowFor(sheetRowNumber: number): number {
  return FIRST_ANCHOR_ROW + (sheetRowNumber - 2) * ANCHOR_ROW_STEP;
}

function serialToYearMonth(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseFullRow(rawRowXml: string, date1904: boolean): RackUnitCapacityImageHistoryRow | null {
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
  if (cells.length < HEADERS_COUNT || cells[0] === null || cells[0] === "") return null;
  const rawMonth = cells[0];
  const reportingMonth = typeof rawMonth === "number" ? serialToYearMonth(rawMonth, date1904) : String(rawMonth);
  if (!reportingMonth) return null;
  const mime = String(cells[4] ?? "");
  return {
    reportingMonth,
    facility: String(cells[1] ?? ""),
    timestamp: String(cells[2] ?? ""),
    user: String(cells[3] ?? ""),
    mimeType: mime === "image/jpeg" ? "image/jpeg" : "image/png",
    dataVersion: Number(cells[5] ?? 1)
  };
}

interface ExistingRow {
  rowNumber: number;
  row: RackUnitCapacityImageHistoryRow | null;
}
function parseExistingRows(sheetDataInner: string, date1904: boolean): ExistingRow[] {
  const rows: ExistingRow[] = [];
  const rowRe = /<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
  for (const match of sheetDataInner.matchAll(rowRe)) {
    const rowNumber = parseInt(match[1], 10);
    if (rowNumber === 1) continue;
    rows.push({ rowNumber, row: parseFullRow(match[0], date1904) });
  }
  return rows;
}

export async function locateRackUnitCapacityImageHistorySheet(zip: JSZip): Promise<string | null> {
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
    if (name && xmlUnescape(name) === RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

async function readRowImage(zip: JSZip, sheetXmlPath: string, anchorRow: number): Promise<RackUnitCapacityImageHistoryEntry | null> {
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const relsXml = await entryText(zip, relsPath);
  if (!relsXml) return null;
  let drawingPath: string | null = null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      const target = getAttr(m[1], "Target")!;
      drawingPath = `xl/drawings/${target.replace(/^(\.\.\/)?drawings\//, "")}`;
      break;
    }
  }
  if (!drawingPath) return null;
  const drawingXml = await entryText(zip, drawingPath);
  if (!drawingXml) return null;

  const anchorBlocks = [...drawingXml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map(m => m[0]);
  const block = anchorBlocks.find(b => new RegExp(`<xdr:from><xdr:col>${ANCHOR_COL}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row>`).test(b));
  if (!block) return null;

  const ridMatch = block.match(/r:embed="([^"]+)"/);
  const extMatch = block.match(/<xdr:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  if (!ridMatch || !extMatch) return null;

  const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
  const drawingRelsXml = await entryText(zip, `xl/drawings/_rels/${drawingFile}.rels`);
  if (!drawingRelsXml) return null;
  let mediaTarget: string | null = null;
  for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Id") === ridMatch[1]) {
      mediaTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!mediaTarget) return null;
  const mediaPath = `xl/media/${mediaTarget.replace(/^(\.\.\/)?media\//, "")}`;
  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return null;
  const bytes = await mediaFile.async("nodebuffer");
  const mimeType: "image/png" | "image/jpeg" = /\.jpe?g$/i.test(mediaPath) ? "image/jpeg" : "image/png";
  const width = Math.round(Number(extMatch[1]) / EMU_PER_PX);
  const height = Math.round(Number(extMatch[2]) / EMU_PER_PX);
  return { bytes, mimeType, width, height };
}

/** Reads the image for exactly one (facility, reportingMonth) from a
 *  not-yet-migrated workbook. Used only by RackUnitCapacityImageMigration.ts
 *  now - the live dashboard/PDF read path goes through
 *  src/storage/ImageStorageProvider.ts instead. */
export async function readRackUnitCapacityImageForMonth(buffer: Buffer, facility: string, reportingMonth: string): Promise<RackUnitCapacityImageHistoryEntry | null> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackUnitCapacityImageHistorySheet(zip);
  if (!xmlPath) return null;
  const xml = await entryText(zip, xmlPath);
  if (!xml) return null;
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return null;

  const key = rowKey(facility, reportingMonth);
  const existing = parseExistingRows(sheetDataMatch[1], date1904).find(r => r.row && rowKey(r.row.facility, r.row.reportingMonth) === key);
  if (!existing) return null;
  return readRowImage(zip, xmlPath, anchorRowFor(existing.rowNumber));
}

/** Reads all persisted (Facility, ReportingMonth, Timestamp, User) rows'
 *  metadata from a not-yet-migrated workbook - never the image bytes
 *  themselves. Used by RackUnitCapacityImageMigration.ts to enumerate every
 *  row that needs extracting. */
export async function readRackUnitCapacityImageHistoryFromBuffer(buffer: Buffer): Promise<RackUnitCapacityImageHistoryRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackUnitCapacityImageHistorySheet(zip);
  if (!xmlPath) return [];
  const xml = await entryText(zip, xmlPath);
  if (!xml) return [];
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return [];
  return parseExistingRows(sheetDataMatch[1], date1904)
    .map(r => r.row)
    .filter((row): row is RackUnitCapacityImageHistoryRow => row !== null);
}

/** Reads exactly one row's image, by its already-known sheet row number.
 *  Used by RackUnitCapacityImageMigration.ts, which enumerates rows via
 *  readRackUnitCapacityImageHistoryFromBuffer's sibling row-number-aware
 *  parse rather than re-deriving it here. */
export async function readRackUnitCapacityImageHistoryRowsWithNumbers(buffer: Buffer): Promise<Array<{ rowNumber: number; row: RackUnitCapacityImageHistoryRow }>> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlPath = await locateRackUnitCapacityImageHistorySheet(zip);
  if (!xmlPath) return [];
  const xml = await entryText(zip, xmlPath);
  if (!xml) return [];
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch || !sheetDataMatch[1]) return [];
  return parseExistingRows(sheetDataMatch[1], date1904)
    .filter((r): r is ExistingRow & { row: RackUnitCapacityImageHistoryRow } => r.row !== null)
    .map(r => ({ rowNumber: r.rowNumber, row: r.row }));
}

/** Reads one already-located row's image bytes, by its raw sheet row number
 *  (== anchorRowFor(rowNumber)). Exposed for RackUnitCapacityImageMigration.ts
 *  so it can extract every row without re-scanning the sheet per row. */
export async function readRackUnitCapacityImageHistoryRowImage(zip: JSZip, sheetXmlPath: string, rowNumber: number): Promise<RackUnitCapacityImageHistoryEntry | null> {
  return readRowImage(zip, sheetXmlPath, anchorRowFor(rowNumber));
}

/**
 * Removes the entire "Rack Unit Capacity Img History" sheet - its worksheet
 * part, rels, drawing part(s) + rels + every media part they reference, and
 * its workbook.xml/<workbook.xml.rels>/[Content_Types].xml registrations.
 * Every other sheet, table, pivot, chart, and VBA part is left untouched.
 * Idempotent: returns false (no-op) if the sheet does not exist.
 */
export async function removeRackUnitCapacityImageHistorySheet(zip: JSZip): Promise<boolean> {
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const relsXml = await entryText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return false;

  const sheetMatch = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)].find(m => {
    const name = getAttr(m[1], "name");
    return name && xmlUnescape(name) === RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME;
  });
  if (!sheetMatch) return false;
  const rid = getAttr(sheetMatch[1], "r:id");
  if (!rid) return false;

  const relMatch = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].find(m => getAttr(m[1], "Id") === rid);
  const target = relMatch ? getAttr(relMatch[1], "Target") : null;
  if (!target) return false;
  const sheetXmlPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;

  // Drawing part(s) + media this sheet's rels reference.
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const sheetRelsXml = await entryText(zip, sheetRelsPath);
  if (sheetRelsXml) {
    for (const m of sheetRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      if (!getAttr(m[1], "Type")?.endsWith("/drawing")) continue;
      const drawingTarget = getAttr(m[1], "Target");
      if (!drawingTarget) continue;
      const drawingPath = `xl/drawings/${drawingTarget.replace(/^(\.\.\/)?drawings\//, "")}`;
      const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
      const drawingRelsPath = `xl/drawings/_rels/${drawingFile}.rels`;
      const drawingRelsXml = await entryText(zip, drawingRelsPath);
      if (drawingRelsXml) {
        for (const mediaRel of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
          const mediaTarget = getAttr(mediaRel[1], "Target");
          if (mediaTarget) zip.remove(`xl/media/${mediaTarget.replace(/^(\.\.\/)?media\//, "")}`);
        }
      }
      zip.remove(drawingPath);
      zip.remove(drawingRelsPath);
      const contentTypesXml = await entryText(zip, "[Content_Types].xml");
      if (contentTypesXml) {
        const escapedPath = drawingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const stripped = contentTypesXml.replace(new RegExp(`<Override PartName="/${escapedPath}"[^>]*\\/>`), "");
        if (stripped !== contentTypesXml) zip.file("[Content_Types].xml", stripped);
      }
    }
  }

  // Worksheet part itself + its rels + its [Content_Types].xml Override.
  zip.remove(sheetXmlPath);
  zip.remove(sheetRelsPath);
  const contentTypesXml2 = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml2) {
    const escapedSheetPath = sheetXmlPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = contentTypesXml2.replace(new RegExp(`<Override PartName="/${escapedSheetPath}"[^>]*\\/>`), "");
    if (stripped !== contentTypesXml2) zip.file("[Content_Types].xml", stripped);
  }

  // workbook.xml's <sheet> entry + workbook.xml.rels' relationship.
  zip.file("xl/workbook.xml", workbookXml.replace(sheetMatch[0], ""));
  zip.file("xl/_rels/workbook.xml.rels", relsXml.replace(relMatch![0], ""));

  return true;
}
