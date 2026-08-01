/**
 * "Rack Unit Capacity Image History" - one row + one embedded image per
 * (Facility, Reporting Month), replacing the pre-v2.2.5 design of a single
 * global image slot (SheetImageWriter.ts's embedRackCapacityImage, still
 * used unmodified by the legacy "Rack Unit Capacity" sheet's fixed K9
 * anchor - this module is entirely separate and does not touch that sheet
 * or that mechanism).
 *
 * Same OPC/zip-level philosophy as RackCapacityHistoryWriter.ts, which this
 * module's sheet/row plumbing is deliberately modeled on: a brand-new
 * worksheet part is spliced directly into the zip rather than going through
 * ExcelJS (proven elsewhere in this codebase to silently drop
 * vbaProject.bin/pivot tables/charts).
 *
 * The image side reuses SheetImageWriter.ts's anchor/replace mechanics,
 * generalized from "exactly one drawing, one fixed anchor" to "one drawing
 * PART shared by the whole sheet, containing one <xdr:oneCellAnchor> block
 * per row" - the OOXML-correct way to have multiple pictures on one sheet
 * (a worksheet may reference at most one drawing PART, but that part may
 * contain any number of anchored pictures). Each row's anchor position is
 * derived from that row's own stable sheet row number (assigned once, on
 * first insert, and never changed by later upserts of OTHER rows - see
 * upsertRackCapacityHistoryRows's identical guarantee) so a row's image
 * never moves or gets confused with another row's once assigned.
 *
 * Row identity is (Facility, ReportingMonth). Upserting an existing key
 * replaces that row's metadata + image; every other row - every other
 * month, every other facility - is byte-identical, untouched. This is the
 * literal mechanism behind "never overwrite existing history".
 */
import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";
import { checkWorkbookLock, createBackup, WorkbookError } from "./WorkbookWriter";
import { entryText, getAttr, ensureExactCellFormatStyles, workbookMonthSerial, workbookUsesDate1904 } from "./ExcelZipUtils";
import type { RackCapacityImageInput } from "./SheetImageWriter";

// Excel worksheet names have a hard 31-character limit; "Rack Unit Capacity
// Image History" (32 chars) exceeds it and made ExcelJS reject the workbook
// on read (WorkbookReader.ts loads the whole file through ExcelJS for the
// energy-log sheets) - found via a real end-to-end PDF-build test, not by
// any of this module's own lower-level XML-splicing checks, which never
// round-trip through ExcelJS and so never enforce Excel's own name limit.
export const RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME = "Rack Unit Capacity Img History";
export const RACK_UNIT_CAPACITY_IMAGE_HISTORY_DATA_VERSION = 1;

const HEADERS = ["ReportingMonth", "Facility", "Timestamp", "User", "MimeType", "DataVersion"] as const;

export interface RackUnitCapacityImageHistoryRow {
  /** Canonical "YYYY-MM" - the month this image documents, never the
   *  upload date. On disk, a real Excel date serial (first-of-month),
   *  "mmm-yy" style - same convention as RackCapacityHistoryRow.snapshotMonth. */
  reportingMonth: string;
  facility: string;
  /** ISO 8601 - when this image was saved (wall-clock upload time). */
  timestamp: string;
  /** OS username of whoever ran the save (os.userInfo().username in the
   *  Electron main process) - this app has no separate login/auth system,
   *  so the OS account is the only real, non-fabricated identity available. */
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
const MAX_DISPLAY_PX = 480;

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
function textCellXml(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}
function numberCellXml(ref: string, value: number, styleId?: string): string {
  return `<c r="${ref}"${styleId ? ` s="${styleId}"` : ""}><v>${value}</v></c>`;
}
function rowKey(facility: string, month: string): string {
  return `${facility.trim().toLowerCase()}|${month.trim()}`;
}
function displaySizePx(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_DISPLAY_PX && height <= MAX_DISPLAY_PX) return { width, height };
  const scale = MAX_DISPLAY_PX / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
/** The 0-based xdr:row this row's image is anchored at - stable for as
 *  long as this row's own sheet row number is stable (assigned once, on
 *  first insert; never reassigned by later upserts of other rows). */
function anchorRowFor(sheetRowNumber: number): number {
  return FIRST_ANCHOR_ROW + (sheetRowNumber - 2) * ANCHOR_ROW_STEP;
}

interface HistoryStyles {
  monthStyleId: string;
}
async function ensureHistoryStyles(zip: JSZip): Promise<HistoryStyles> {
  const monthStyles = await ensureExactCellFormatStyles(zip, ["0"], "mmm-yy");
  const monthStyleId = monthStyles.get("0");
  if (!monthStyleId) throw new Error("Could not register Rack Unit Capacity Image History cell styles.");
  return { monthStyleId };
}

function buildHeaderRowXml(): string {
  const cells = HEADERS.map((h, idx) => textCellXml(`${indexToColLetter(idx + 1)}1`, h)).join("");
  return `<row r="1">${cells}</row>`;
}

function buildRowXml(rowNumber: number, row: RackUnitCapacityImageHistoryRow, styles: HistoryStyles, date1904: boolean): string {
  const monthSerial = workbookMonthSerial(row.reportingMonth, date1904);
  const col = (idx: number) => `${indexToColLetter(idx + 1)}${rowNumber}`;
  const cells = [
    monthSerial === null ? textCellXml(col(0), row.reportingMonth) : numberCellXml(col(0), monthSerial, styles.monthStyleId),
    textCellXml(col(1), row.facility),
    textCellXml(col(2), row.timestamp),
    textCellXml(col(3), row.user),
    textCellXml(col(4), row.mimeType),
    numberCellXml(col(5), row.dataVersion)
  ];
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
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
  if (cells.length < HEADERS.length || cells[0] === null || cells[0] === "") return null;
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

function emptyWorksheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:F1"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${buildHeaderRowXml()}</sheetData>` +
    `</worksheet>`
  );
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

export async function ensureRackUnitCapacityImageHistorySheet(zip: JSZip): Promise<{ xmlPath: string; created: boolean }> {
  const existing = await locateRackUnitCapacityImageHistorySheet(zip);
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
    workbookXml.replace(/<\/sheets>/, `<sheet name="${xmlEscape(RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME)}" sheetId="${nextSheetId}" r:id="${newRid}"/></sheets>`)
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

// --- Drawing (multi-picture-on-one-sheet) plumbing -------------------------

function buildAnchorBlockXml(picId: number, rId: string, anchorRow: number, cx: number, cy: number): string {
  return (
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>${ANCHOR_COL}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:pic>` +
    `<xdr:nvPicPr><xdr:cNvPr id="${picId}" name="Rack Unit Capacity Image ${picId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic>` +
    `<xdr:clientData/>` +
    `</xdr:oneCellAnchor>`
  );
}

function emptyDrawingXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `</xdr:wsDr>`
  );
}

function nextPartIndex(zip: JSZip, pattern: RegExp): number {
  let max = 0;
  for (const name of Object.keys(zip.files)) {
    const m = name.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Ensures this sheet has exactly one drawing part (creating it, and the
 *  <drawing r:id=".."/> reference + rels + Content_Types registration, only
 *  if this is the sheet's very first image). Every subsequent row's image
 *  reuses this same part - OOXML allows a worksheet only one <drawing>
 *  reference, but that one drawing part may hold any number of anchored
 *  pictures. */
async function ensureSheetDrawing(zip: JSZip, sheetXmlPath: string): Promise<{ drawingPath: string; drawingRelsPath: string }> {
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const sheetXml = await entryText(zip, sheetXmlPath);
  if (!sheetXml) throw new Error(`Missing worksheet part ${sheetXmlPath}.`);
  let relsXml = (await entryText(zip, relsPath)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      const target = getAttr(m[1], "Target")!;
      const drawingPath = `xl/drawings/${target.replace(/^(\.\.\/)?drawings\//, "")}`;
      const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
      return { drawingPath, drawingRelsPath: `xl/drawings/_rels/${drawingFile}.rels` };
    }
  }

  const drawingIndex = nextPartIndex(zip, /^xl\/drawings\/drawing(\d+)\.xml$/);
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;

  zip.file(drawingPath, emptyDrawingXml());
  zip.file(drawingRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

  const existingRelIds = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
    .map(m => parseInt((getAttr(m[1], "Id") ?? "rId0").replace("rId", ""), 10))
    .filter(Number.isFinite);
  const newRid = `rId${(existingRelIds.length > 0 ? Math.max(...existingRelIds) : 0) + 1}`;
  relsXml = relsXml.replace(
    /<\/Relationships>/,
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`
  );
  zip.file(relsPath, relsXml);

  const drawingEl = `<drawing r:id="${newRid}"/>`;
  const patchedSheetXml = /<\/worksheet>/.test(sheetXml) ? sheetXml.replace("</worksheet>", `${drawingEl}</worksheet>`) : sheetXml;
  zip.file(sheetXmlPath, patchedSheetXml);

  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml && !contentTypesXml.includes(`PartName="/${drawingPath}"`)) {
    zip.file(
      "[Content_Types].xml",
      contentTypesXml.replace(/<\/Types>/, `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
    );
  }
  return { drawingPath, drawingRelsPath };
}

/** Embeds (or replaces) the image anchored at `anchorRow` within the
 *  sheet's shared drawing part. Only the one matching anchor block (and its
 *  own media relationship) is touched - every other row's anchor block and
 *  image is untouched, byte-identical. */
async function embedRowImage(zip: JSZip, sheetXmlPath: string, anchorRow: number, image: RackCapacityImageInput): Promise<void> {
  const { drawingPath, drawingRelsPath } = await ensureSheetDrawing(zip, sheetXmlPath);
  const drawingXml = (await entryText(zip, drawingPath)) ?? emptyDrawingXml();
  let drawingRelsXml = (await entryText(zip, drawingRelsPath)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const ext = image.type;
  const mimeType = image.type === "png" ? "image/png" : "image/jpeg";
  const { width: dispW, height: dispH } = displaySizePx(image.width, image.height);
  const cx = dispW * EMU_PER_PX;
  const cy = dispH * EMU_PER_PX;

  const anchorBlocks = [...drawingXml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map(m => m[0]);
  const existingBlock = anchorBlocks.find(block => new RegExp(`<xdr:from><xdr:col>${ANCHOR_COL}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row>`).test(block));

  const mediaIndex = nextPartIndex(zip, /^xl\/media\/image(\d+)\.(?:png|jpeg|jpg)$/);
  const mediaPath = `xl/media/image${mediaIndex}.${ext}`;

  if (existingBlock) {
    const ridMatch = existingBlock.match(/r:embed="([^"]+)"/);
    const rId = ridMatch ? ridMatch[1] : null;
    if (!rId) throw new Error("Existing image anchor is missing its r:embed relationship.");

    let oldMediaTarget: string | null = null;
    for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      if (getAttr(m[1], "Id") === rId) {
        oldMediaTarget = getAttr(m[1], "Target");
        break;
      }
    }
    zip.file(mediaPath, image.bytes);
    if (oldMediaTarget) {
      const oldMediaPath = `xl/media/${oldMediaTarget.replace(/^(\.\.\/)?media\//, "")}`;
      if (oldMediaPath !== mediaPath) zip.remove(oldMediaPath);
    }
    drawingRelsXml = drawingRelsXml.replace(
      new RegExp(`<Relationship Id="${rId}"[^>]*\\/>`),
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.${ext}"/>`
    );
    zip.file(drawingRelsPath, drawingRelsXml);

    const picIdMatch = existingBlock.match(/<xdr:cNvPr id="(\d+)"/);
    const picId = picIdMatch ? parseInt(picIdMatch[1], 10) : 1;
    const replacedBlock = buildAnchorBlockXml(picId, rId, anchorRow, cx, cy);
    zip.file(drawingPath, drawingXml.replace(existingBlock, replacedBlock));
  } else {
    const existingPicIds = [...drawingXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map(m => parseInt(m[1], 10)).filter(Number.isFinite);
    const newPicId = (existingPicIds.length > 0 ? Math.max(...existingPicIds) : 0) + 1;
    const existingRelIds = [...drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
      .map(m => parseInt((getAttr(m[1], "Id") ?? "rId0").replace("rId", ""), 10))
      .filter(Number.isFinite);
    const newRid = `rId${(existingRelIds.length > 0 ? Math.max(...existingRelIds) : 0) + 1}`;

    zip.file(mediaPath, image.bytes);
    drawingRelsXml = drawingRelsXml.replace(
      /<\/Relationships>/,
      `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.${ext}"/></Relationships>`
    );
    zip.file(drawingRelsPath, drawingRelsXml);

    const newBlock = buildAnchorBlockXml(newPicId, newRid, anchorRow, cx, cy);
    zip.file(drawingPath, drawingXml.replace("</xdr:wsDr>", `${newBlock}</xdr:wsDr>`));
  }

  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml && !new RegExp(`<Default\\b[^>]*Extension="${ext}"`).test(contentTypesXml)) {
    zip.file("[Content_Types].xml", contentTypesXml.replace(/<\/Types>/, `<Default Extension="${ext}" ContentType="${mimeType}"/></Types>`));
  }
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

// --- Row upsert / read -------------------------------------------------

export async function upsertRackUnitCapacityImageHistoryRow(
  zip: JSZip,
  xmlPath: string,
  row: RackUnitCapacityImageHistoryRow,
  image: RackCapacityImageInput
): Promise<void> {
  const xml = await entryText(zip, xmlPath);
  if (!xml) throw new Error(`Rack Unit Capacity Image History worksheet part missing: ${xmlPath}`);
  const sheetDataMatch = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("Rack Unit Capacity Image History worksheet has no sheetData.");
  const workbookXml = await entryText(zip, "xl/workbook.xml");
  const date1904 = workbookUsesDate1904(workbookXml ?? "");
  const styles = await ensureHistoryStyles(zip);

  const inner = sheetDataMatch[1] ?? "";
  const existingRows = parseExistingRows(inner, date1904);
  const key = rowKey(row.facility, row.reportingMonth);
  const existing = existingRows.find(r => r.row && rowKey(r.row.facility, r.row.reportingMonth) === key);

  let maxRowNumber = existingRows.reduce((max, r) => Math.max(max, r.rowNumber), 1);
  const finalRowByNumber = new Map<number, RackUnitCapacityImageHistoryRow>();
  for (const r of existingRows) if (r.row) finalRowByNumber.set(r.rowNumber, r.row);

  const targetRowNumber = existing ? existing.rowNumber : ++maxRowNumber;
  finalRowByNumber.set(targetRowNumber, row);

  const orderedRowNumbers = Array.from(finalRowByNumber.keys()).sort((a, b) => a - b);
  const newSheetData = `<sheetData>${buildHeaderRowXml()}${orderedRowNumbers.map(n => buildRowXml(n, finalRowByNumber.get(n)!, styles, date1904)).join("")}</sheetData>`;
  let patched = xml.replace(sheetDataMatch[0], () => newSheetData);
  const lastCol = indexToColLetter(HEADERS.length);
  const dimensionRef = orderedRowNumbers.length > 0 ? `A1:${lastCol}${Math.max(...orderedRowNumbers)}` : `A1:${lastCol}1`;
  patched = patched.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${dimensionRef}"/>`);
  zip.file(xmlPath, patched);

  await embedRowImage(zip, xmlPath, anchorRowFor(targetRowNumber), image);
}

/** Reads the image for exactly one (facility, reportingMonth) - never the
 *  whole sheet's images at once, so the renderer only pulls the bytes it's
 *  actually about to display. */
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
 *  metadata - never the image bytes themselves (see
 *  readRackUnitCapacityImageForMonth for that, on demand per month). Useful
 *  for "which months have a recorded image" listings. */
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

// --- Save orchestration (Backup -> Validate -> UPSERT -> Verify) -------

export interface RackUnitCapacityImageHistorySaveResult {
  path: string;
  backupPath: string | null;
  savedAt: string;
  rows: RackUnitCapacityImageHistoryRow[];
}

/**
 * Full controlled save, same shape as saveRackUnitCapacity: lock check
 * (Validate) -> upsert row + embed image (UPSERT) -> backup -> atomic write
 * -> re-read (Verify). Every other (facility, month) row and its image is
 * guaranteed untouched (see upsertRackUnitCapacityImageHistoryRow).
 */
export async function saveRackUnitCapacityImageHistory(
  filePath: string,
  facility: string,
  reportingMonth: string,
  user: string,
  image: RackCapacityImageInput,
  options: { backupDir: string; backupKeep: number }
): Promise<RackUnitCapacityImageHistorySaveResult> {
  let original: Buffer;
  try {
    original = await fs.readFile(filePath);
  } catch {
    throw new WorkbookError("NOT_FOUND", `Workbook not found: ${filePath}`, "read");
  }

  const lock = await checkWorkbookLock(filePath);
  if (lock.locked) {
    throw new WorkbookError("LOCKED", "The workbook is currently open in Excel (or another program). Close it and retry.", "lock");
  }

  const zip = await JSZip.loadAsync(original);
  const { xmlPath } = await ensureRackUnitCapacityImageHistorySheet(zip);
  const row: RackUnitCapacityImageHistoryRow = {
    reportingMonth,
    facility,
    timestamp: new Date().toISOString(),
    user,
    mimeType: image.type === "jpeg" ? "image/jpeg" : "image/png",
    dataVersion: RACK_UNIT_CAPACITY_IMAGE_HISTORY_DATA_VERSION
  };
  await upsertRackUnitCapacityImageHistoryRow(zip, xmlPath, row, image);
  const buffer = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;

  let backupPath: string | null = null;
  try {
    backupPath = await createBackup(filePath, options.backupDir, options.backupKeep);
  } catch (err) {
    throw new WorkbookError("WRITE_FAILED", `Could not create a backup before saving: ${(err as Error).message}`, "backup");
  }

  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
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
    throw new WorkbookError("WRITE_FAILED", `Could not write the Rack Unit Capacity Image History: ${(err as Error).message}`, "write");
  }

  const rows = await readRackUnitCapacityImageHistoryFromBuffer(buffer);
  return { path: filePath, backupPath, savedAt: row.timestamp, rows };
}
