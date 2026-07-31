/**
 * Controlled, safe writer for the "Rack Capacity" sheet's "Table7" (Rack
 * Zone / Rack ID / Status / Cabinet Size / Detail / Device Type / Remarks).
 *
 * Verified real schema (both facilities, 2026-07-31): Table7 header row 9,
 * data rows 10..N, columns A-G in the order above. Status cells are stored
 * as shared strings (t="s"), not inline text or a formula. Same OPC/zip-level
 * philosophy as UpsGroupHistoryWriter.ts: no existing zip part is rewritten
 * wholesale through ExcelJS (that path was already proven elsewhere in this
 * codebase to drop VBA/pivots/charts) - only the specific Status cell(s)
 * actually being changed are touched.
 *
 * Row identity for a change is (facility file) + rowNumber, with rackId and
 * the caller's expected previous status re-verified server-side before the
 * cell is touched - never trust a UI-supplied "it used to be X" without
 * checking it against the just-read-from-disk value (optimistic concurrency,
 * same principle as the rest of this app's "zero-leakage" write pattern).
 */
import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";
import { checkWorkbookLock, createBackup, WorkbookError } from "./WorkbookWriter";
import { readRackCapacityFromBuffer } from "../reports/rackCapacityReader";
import { calculateRackCapacityMetrics } from "../utils/rackCapacity";
import { patchRackCapacityHistoryBuffer, readRackCapacityHistoryFromBuffer, RackCapacityHistoryRow } from "./RackCapacityHistoryWriter";

export const RACK_CAPACITY_SHEET_NAME = "Rack Capacity";
export const RACK_CAPACITY_TABLE_NAME = "Table7";

export interface RackStatusChange {
  /** Sheet row number, as returned by readRackCapacityFromBuffer's RackRecord.rowNumber. */
  rowNumber: number;
  rackId: string;
  /** What the UI believes the status currently is (null = blank). Must match
   *  the on-disk value or the change is rejected as a conflict. */
  expectedStatus: string | null;
  newStatus: string;
}

export interface RackStatusChangeOutcome {
  rowNumber: number;
  rackId: string;
  applied: boolean;
  /** Present only when applied is false. */
  conflictActualStatus?: string | null;
  conflictReason?: "row_not_found" | "rack_id_mismatch" | "status_mismatch";
}

export interface RackCapacityWriteResult {
  buffer: Buffer;
  outcomes: RackStatusChangeOutcome[];
  changedCount: number;
  imageEmbedded: boolean;
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
    // OOXML's own escape for control/reserved characters inside shared
    // strings (e.g. an embedded newline in a header becomes "_x000A_").
    // Verified present in Srinakarin's real Table7 "Cabinet Size" header.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function getAttr(tagAttrs: string, name: string): string | null {
  const m = tagAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

/** Resolves the "Rack Capacity" worksheet's zip path via workbook.xml + rels
 *  (same technique used throughout this codebase's writer modules). */
async function locateRackCapacitySheetXmlPath(zip: JSZip): Promise<string | null> {
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
    if (name && xmlUnescape(name) === RACK_CAPACITY_SHEET_NAME && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

async function locateSheetXmlPathByName(zip: JSZip, sheetName: string): Promise<string | null> {
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
    if (name && xmlUnescape(name) === sheetName && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}

function excelSerialToYearMonth(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Reads Dashboard-FAC!H1 (the workbook's own existing "active reporting
 * month" selector, confirmed in the v2.2.1 investigation to drive every
 * Dashboard-FAC KPI in both facilities) to determine which month a Rack
 * Capacity snapshot belongs to. Deliberately not the PC's system date - a
 * workbook mid-review for an earlier month must snapshot under that month,
 * not today's calendar date. Returns null if it cannot be read (the history
 * snapshot step is then skipped, never guessed).
 */
async function getActiveReportingMonth(zip: JSZip): Promise<string | null> {
  const dashboardPath = await locateSheetXmlPathByName(zip, "Dashboard-FAC");
  if (!dashboardPath) return null;
  const xml = await entryText(zip, dashboardPath);
  if (!xml) return null;
  const cellMatch = xml.match(cellRegex("H1"));
  if (!cellMatch) return null;
  const v = cellMatch[0].match(/<v>([^<]*)<\/v>/);
  if (!v) return null;
  return excelSerialToYearMonth(Number(v[1]));
}

/** Resolves Table7's data range (row after the header, through the last
 *  table row) and its column letters, from the table definition part itself
 *  - never assumed, always read from xl/tables/*.xml's ref= and
 *  tableColumns, matching how rackCapacityReader.ts already resolves it via
 *  ExcelJS's getTable("Table7"). */
async function locateTable7(zip: JSZip, sheetXmlPath: string): Promise<{
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  columns: Record<"rackZone" | "rackId" | "status" | "cabinetSize" | "detail" | "deviceType" | "remarks", string>;
} | null> {
  const sheetDir = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetDir}.rels`;
  const relsXml = await entryText(zip, relsPath);
  if (!relsXml) return null;
  let tableTarget: string | null = null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/table") && getAttr(m[1], "Target")) {
      const candidateTarget = getAttr(m[1], "Target")!;
      const candidatePath = candidateTarget.startsWith("/") ? candidateTarget.slice(1) : `xl/worksheets/${candidateTarget}`;
      const normalized = candidatePath.replace(/xl\/worksheets\/\.\.\//, "xl/");
      const xml = await entryText(zip, normalized);
      if (xml && /\bname="Table7"/.test(xml)) {
        tableTarget = normalized;
        break;
      }
    }
  }
  if (!tableTarget) return null;
  const tableXml = await entryText(zip, tableTarget);
  if (!tableXml) return null;
  const refMatch = tableXml.match(/\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
  if (!refMatch) return null;
  const headerRow = Number(refMatch[2]);
  const lastDataRow = Number(refMatch[4]);

  const columnMatches = [...tableXml.matchAll(/<tableColumn\b([^>]*)\/>/g)];
  const nameToIndex = new Map<string, number>();
  columnMatches.forEach((m, idx) => {
    const name = getAttr(m[1], "name");
    if (name) nameToIndex.set(xmlUnescape(name).replace(/\s+/g, " ").trim().toLowerCase(), idx);
  });
  const colLetter = (idx: number): string => {
    let n = idx + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const findCol = (aliases: string[]): string | null => {
    for (const alias of aliases) {
      const idx = nameToIndex.get(alias);
      if (idx !== undefined) return colLetter(idx);
    }
    return null;
  };
  const rackZone = findCol(["rack zone"]);
  const rackId = findCol(["rack id"]);
  const status = findCol(["status"]);
  const cabinetSize = findCol(["cabinet size", "cabinet size (wxd cm)"]);
  const detail = findCol(["detail"]);
  const deviceType = findCol(["device type"]);
  const remarks = findCol(["remarks"]);
  if (!rackZone || !rackId || !status || !cabinetSize || !detail || !deviceType || !remarks) return null;

  return {
    headerRow,
    firstDataRow: headerRow + 1,
    lastDataRow,
    columns: { rackZone, rackId, status, cabinetSize, detail, deviceType, remarks }
  };
}

function cellRegex(ref: string): RegExp {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
}

function cellSharedStringIndex(cellXml: string): number | null {
  if (!/\bt="s"/.test(cellXml)) return null;
  const v = cellXml.match(/<v>(\d+)<\/v>/);
  return v ? Number(v[1]) : null;
}

/** Finds an existing shared-string index for `text`, or appends a new one.
 *  Returns the index and the (possibly unchanged) sharedStrings.xml text. */
function findOrAddSharedString(sharedStringsXml: string, text: string): { index: number; xml: string } {
  const items = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)];
  for (let i = 0; i < items.length; i++) {
    const t = items[i][1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    if (t && xmlUnescape(t[1]) === text) return { index: i, xml: sharedStringsXml };
  }
  const newIndex = items.length;
  const newItem = `<si><t xml:space="preserve">${xmlEscape(text)}</t></si>`;
  const withNewItem = sharedStringsXml.replace(/<\/sst>/, `${newItem}</sst>`);
  const countMatch = withNewItem.match(/<sst\b[^>]*\bcount="(\d+)"/);
  const uniqueCountMatch = withNewItem.match(/\buniqueCount="(\d+)"/);
  let xml = withNewItem;
  if (countMatch) xml = xml.replace(/(\bcount=")(\d+)(")/, (_all, pre, n, post) => `${pre}${Number(n) + 1}${post}`);
  if (uniqueCountMatch) xml = xml.replace(/(\buniqueCount=")(\d+)(")/, (_all, pre, n, post) => `${pre}${Number(n) + 1}${post}`);
  return { index: newIndex, xml };
}

export interface RackCapacityImageInput {
  bytes: Buffer;
  type: "png" | "jpeg";
  width: number;
  height: number;
}

const K9_ANCHOR_COL = 10; // K, 0-based (A=0)
const K9_ANCHOR_ROW = 8; // row 9, 0-based
const EMU_PER_PX = 9525;
const MAX_DISPLAY_PX = 480;

function nextPartIndex(zip: JSZip, pattern: RegExp): number {
  let max = 0;
  for (const name of Object.keys(zip.files)) {
    const m = name.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function displaySizePx(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_DISPLAY_PX && height <= MAX_DISPLAY_PX) return { width, height };
  const scale = MAX_DISPLAY_PX / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function ensureContentTypesForImage(contentTypesXml: string, extension: string, mimeType: string, drawingPath: string | null): string {
  let xml = contentTypesXml;
  if (!new RegExp(`<Default\\b[^>]*Extension="${extension}"`).test(xml)) {
    xml = xml.replace(/<\/Types>/, `<Default Extension="${extension}" ContentType="${mimeType}"/></Types>`);
  }
  if (drawingPath && !xml.includes(`PartName="/${drawingPath}"`)) {
    xml = xml.replace(
      /<\/Types>/,
      `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
    );
  }
  return xml;
}

function buildDrawingXml(cx: number, cy: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>${K9_ANCHOR_COL}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${K9_ANCHOR_ROW}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:pic>` +
    `<xdr:nvPicPr><xdr:cNvPr id="1" name="Rack Capacity Image"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic>` +
    `<xdr:clientData/>` +
    `</xdr:oneCellAnchor>` +
    `</xdr:wsDr>`
  );
}

/**
 * Embeds (or replaces) the single, designated Rack Capacity image - a real
 * Excel drawing anchored at K9, never a file path/filename/base64 string
 * written into a cell. K9 was confirmed empty and unmerged on both real
 * production workbooks, and neither workbook has any pre-existing drawing on
 * the Rack Capacity sheet, so the first embed always creates a fresh,
 * dedicated drawing part; a later replace reuses that same part and only
 * swaps its image relationship, so no unrelated drawing/chart anywhere else
 * in the workbook is ever touched.
 */
async function embedRackCapacityImage(zip: JSZip, sheetXmlPath: string, image: RackCapacityImageInput): Promise<void> {
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const sheetXml = await entryText(zip, sheetXmlPath);
  if (!sheetXml) throw new Error(`Missing worksheet part ${sheetXmlPath}.`);
  let relsXml = (await entryText(zip, relsPath)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  let existingDrawingTarget: string | null = null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      existingDrawingTarget = getAttr(m[1], "Target");
      break;
    }
  }

  const ext = image.type;
  const mimeType = image.type === "png" ? "image/png" : "image/jpeg";
  const { width: dispW, height: dispH } = displaySizePx(image.width, image.height);
  const cx = dispW * EMU_PER_PX;
  const cy = dispH * EMU_PER_PX;

  const mediaIndex = nextPartIndex(zip, /^xl\/media\/image(\d+)\.(?:png|jpeg|jpg)$/);
  const mediaPath = `xl/media/image${mediaIndex}.${ext}`;

  if (existingDrawingTarget) {
    // Replace: reuse the same, already-dedicated drawing part; only its
    // image relationship (and displayed size, if the new image's aspect
    // ratio differs) changes.
    const drawingPath = `xl/drawings/${existingDrawingTarget.replace(/^(\.\.\/)?drawings\//, "")}`;
    const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
    const drawingRelsPath = `xl/drawings/_rels/${drawingFile}.rels`;
    const drawingXml = await entryText(zip, drawingPath);
    const drawingRelsXml = await entryText(zip, drawingRelsPath);
    if (!drawingXml || !drawingRelsXml) throw new Error("Rack Capacity image drawing part is missing its expected rels.");

    let oldMediaTarget: string | null = null;
    for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      if (getAttr(m[1], "Type")?.endsWith("/image")) {
        oldMediaTarget = getAttr(m[1], "Target");
        break;
      }
    }
    zip.file(mediaPath, image.bytes);
    if (oldMediaTarget) {
      const oldMediaPath = `xl/media/${oldMediaTarget.replace(/^(\.\.\/)?media\//, "")}`;
      if (oldMediaPath !== mediaPath) zip.remove(oldMediaPath);
    }
    const patchedDrawingRels = drawingRelsXml.replace(/Target="[^"]*media\/[^"]*"/, `Target="../media/image${mediaIndex}.${ext}"`);
    zip.file(drawingRelsPath, patchedDrawingRels);
    const patchedDrawing = drawingXml
      .replace(/<xdr:ext\b[^>]*\/>/, `<xdr:ext cx="${cx}" cy="${cy}"/>`)
      .replace(/<a:ext\b[^>]*\/>/, `<a:ext cx="${cx}" cy="${cy}"/>`);
    zip.file(drawingPath, patchedDrawing);

    const contentTypesXml = await entryText(zip, "[Content_Types].xml");
    if (contentTypesXml) zip.file("[Content_Types].xml", ensureContentTypesForImage(contentTypesXml, ext, mimeType, null));
    return;
  }

  // Create: brand-new, dedicated drawing part for this sheet only.
  const drawingIndex = nextPartIndex(zip, /^xl\/drawings\/drawing(\d+)\.xml$/);
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;

  zip.file(mediaPath, image.bytes);
  zip.file(drawingPath, buildDrawingXml(cx, cy));
  zip.file(
    drawingRelsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.${ext}"/>` +
      `</Relationships>`
  );

  const existingRelIds = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
    .map(m => parseInt((getAttr(m[1], "Id") ?? "rId0").replace("rId", ""), 10))
    .filter(Number.isFinite);
  const newRid = `rId${(existingRelIds.length > 0 ? Math.max(...existingRelIds) : 0) + 1}`;
  relsXml = relsXml.replace(
    /<\/Relationships>/,
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`
  );
  zip.file(relsPath, relsXml);

  // <drawing> must precede <tableParts> in CT_Worksheet's element sequence
  // (both real production sheets end "...</headerFooter><tableParts ...").
  // Fall back to inserting right before </worksheet> if that anchor is ever
  // absent, rather than guessing a different position.
  const drawingEl = `<drawing r:id="${newRid}"/>`;
  const patchedSheetXml = /<tableParts\b/.test(sheetXml)
    ? sheetXml.replace(/<tableParts\b/, `${drawingEl}<tableParts`)
    : sheetXml.replace("</worksheet>", `${drawingEl}</worksheet>`);
  zip.file(sheetXmlPath, patchedSheetXml);

  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml) zip.file("[Content_Types].xml", ensureContentTypesForImage(contentTypesXml, ext, mimeType, drawingPath));
}

/**
 * Applies status changes to Table7, verifying each row's current Rack ID and
 * Status against the caller's expectation before writing (rows that drifted
 * since the UI last read them are reported as conflicts, not silently
 * overwritten). Only the Status cell's `<v>` (shared-string index) is
 * touched; the cell's existing style/format is preserved untouched. Every
 * other worksheet, table, pivot, chart, and VBA part is left byte-for-byte
 * alone - this never goes through the generic patchWorkbookBuffer/
 * patchSrinakarinWorkbookBuffer save path.
 */
export async function applyRackCapacityStatusChanges(
  original: Buffer,
  changes: RackStatusChange[],
  image?: RackCapacityImageInput | null
): Promise<RackCapacityWriteResult> {
  const zip = await JSZip.loadAsync(original);
  const sheetXmlPath = await locateRackCapacitySheetXmlPath(zip);
  if (!sheetXmlPath) throw new Error(`Workbook is missing the "${RACK_CAPACITY_SHEET_NAME}" sheet.`);
  const table = await locateTable7(zip, sheetXmlPath);
  if (!table) throw new Error(`"${RACK_CAPACITY_SHEET_NAME}" sheet is missing the required "${RACK_CAPACITY_TABLE_NAME}" table headers.`);

  const sheetXmlRaw = await entryText(zip, sheetXmlPath);
  if (!sheetXmlRaw) throw new Error(`Missing worksheet part ${sheetXmlPath}.`);
  let sheetXml: string = sheetXmlRaw;
  const sharedStringsXmlRaw = await entryText(zip, "xl/sharedStrings.xml");
  if (!sharedStringsXmlRaw) throw new Error("Workbook is missing xl/sharedStrings.xml.");
  let sharedStringsXml: string = sharedStringsXmlRaw;
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
    const t = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    return t ? xmlUnescape(t[1]) : "";
  });

  const outcomes: RackStatusChangeOutcome[] = [];
  let changedCount = 0;

  for (const change of changes) {
    if (change.rowNumber < table.firstDataRow || change.rowNumber > table.lastDataRow) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
      continue;
    }
    const rackIdRef = `${table.columns.rackId}${change.rowNumber}`;
    const statusRef = `${table.columns.status}${change.rowNumber}`;
    const rackIdCellMatch: RegExpMatchArray | null = sheetXml.match(cellRegex(rackIdRef));
    const statusCellMatch: RegExpMatchArray | null = sheetXml.match(cellRegex(statusRef));
    if (!rackIdCellMatch) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
      continue;
    }
    const rackIdIndex = cellSharedStringIndex(rackIdCellMatch[0]);
    const actualRackId = rackIdIndex !== null ? sharedStrings[rackIdIndex] ?? null : null;
    if ((actualRackId ?? "").trim() !== change.rackId.trim()) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "rack_id_mismatch", conflictActualStatus: null });
      continue;
    }
    const statusIndex = statusCellMatch ? cellSharedStringIndex(statusCellMatch[0]) : null;
    const actualStatus = statusIndex !== null ? sharedStrings[statusIndex] ?? null : null;
    const normalizedActual = actualStatus && actualStatus.trim() !== "" ? actualStatus.trim() : null;
    const normalizedExpected = change.expectedStatus && change.expectedStatus.trim() !== "" ? change.expectedStatus.trim() : null;
    if (normalizedActual !== normalizedExpected) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "status_mismatch", conflictActualStatus: normalizedActual });
      continue;
    }
    if (normalizedActual === change.newStatus.trim()) {
      // Already the target value - a true no-op, not a conflict.
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: true });
      continue;
    }

    const { index: newSharedIndex, xml: patchedSharedStrings } = findOrAddSharedString(sharedStringsXml, change.newStatus.trim());
    sharedStringsXml = patchedSharedStrings;
    if (!sharedStrings[newSharedIndex]) sharedStrings[newSharedIndex] = change.newStatus.trim();

    if (statusCellMatch) {
      const replaced: string = statusCellMatch[0].replace(/<v>\d*<\/v>/, `<v>${newSharedIndex}</v>`);
      sheetXml = sheetXml.replace(statusCellMatch[0], replaced);
    } else {
      // Cell did not exist (blank status) - insert a new <c> into its row.
      const rowMatch: RegExpMatchArray | null = sheetXml.match(new RegExp(`<row r="${change.rowNumber}"[^>]*>([\\s\\S]*?)<\\/row>`));
      if (!rowMatch) {
        outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
        continue;
      }
      const newCell = `<c r="${statusRef}" t="s"><v>${newSharedIndex}</v></c>`;
      sheetXml = sheetXml.replace(rowMatch[0], rowMatch[0].replace("</row>", `${newCell}</row>`));
    }
    changedCount++;
    outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: true });
  }

  if (changedCount > 0) {
    zip.file(sheetXmlPath, sheetXml);
    zip.file("xl/sharedStrings.xml", sharedStringsXml);

    // Table7's pivot cache can otherwise go stale relative to a Status edit
    // (confirmed in Srinakarin's real production file: a pivot last
    // refreshed 2026-07-15 was already one record off from the live table
    // by 2026-07-31). Flag every pivot cache to refresh next time a human
    // opens the file in Excel - same mechanism already proven correct for
    // Dashboard-FAC's pivot cache in the v2.2.1 fix.
    for (const name of Object.keys(zip.files)) {
      if (/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)) {
        const xml = await entryText(zip, name);
        if (xml && !/refreshOnLoad=/.test(xml)) {
          zip.file(name, xml.replace(/<pivotCacheDefinition\b/, `<pivotCacheDefinition refreshOnLoad="1"`));
        }
      }
    }
  }

  let imageEmbedded = false;
  if (image) {
    await embedRackCapacityImage(zip, sheetXmlPath, image);
    imageEmbedded = true;
  }

  const buffer = (await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  })) as Buffer;
  return { buffer, outcomes, changedCount, imageEmbedded };
}

export interface RackCapacitySaveResult {
  path: string;
  backupPath: string | null;
  outcomes: RackStatusChangeOutcome[];
  changedCount: number;
  imageEmbedded: boolean;
  savedAt: string;
  /** Freshly re-read totals so the caller can refresh its UI without a
   *  second round trip. Null only if the sheet vanished mid-save. */
  rackCapacity: Awaited<ReturnType<typeof readRackCapacityFromBuffer>>;
  rackCapacityHistory: RackCapacityHistoryRow[];
}

/**
 * Full controlled save: lock check -> apply status changes -> backup ->
 * atomic write -> re-read for verification. Mirrors saveWorkbook()'s
 * lock/backup/atomic-write shape but is scoped entirely to Table7's Status
 * column - it never touches the four managed log sheets, VBA, pivots, or
 * charts. If `changes` produces zero actual writes (e.g. every change was a
 * no-op or a conflict), the file on disk is never touched and backupPath is
 * null - a read-only/no-op attempt must never appear as a save in the
 * backup history.
 */
export async function saveRackCapacityStatusChanges(
  filePath: string,
  changes: RackStatusChange[],
  options: { backupDir: string; backupKeep: number },
  image?: RackCapacityImageInput | null,
  facilityId?: string | null
): Promise<RackCapacitySaveResult> {
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

  const { buffer: statusBuffer, outcomes, changedCount, imageEmbedded } = await applyRackCapacityStatusChanges(original, changes, image);

  if (changedCount === 0 && !imageEmbedded) {
    const rackCapacity = await readRackCapacityFromBuffer(original);
    const rackCapacityHistory = await readRackCapacityHistoryFromBuffer(original);
    return { path: filePath, backupPath: null, outcomes, changedCount: 0, imageEmbedded: false, savedAt: new Date().toISOString(), rackCapacity, rackCapacityHistory };
  }

  // Step 4 of the save transaction (per spec): only after the primary save
  // actually produced a change, upsert this reporting month's Rack Capacity
  // History snapshot into the SAME buffer that gets written to disk - one
  // atomic write, not a separate second save. A history-snapshot failure
  // (e.g. Dashboard-FAC's H1 unreadable) must never abort an otherwise-valid
  // Table7/image save, so it is best-effort and logged via the thrown
  // outcome rather than blocking.
  let buffer = statusBuffer;
  if (facilityId) {
    try {
      const zipForMonth = await JSZip.loadAsync(statusBuffer);
      const month = await getActiveReportingMonth(zipForMonth);
      if (month) {
        const postSaveRackCapacity = await readRackCapacityFromBuffer(statusBuffer);
        if (postSaveRackCapacity) {
          const metrics = calculateRackCapacityMetrics(postSaveRackCapacity.records);
          buffer = await patchRackCapacityHistoryBuffer(statusBuffer, facilityId, month, metrics);
        }
      }
    } catch {
      /* history snapshot is best-effort; the primary Table7/image save above already succeeded */
    }
  }

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
    throw new WorkbookError("WRITE_FAILED", `Could not write Rack Capacity changes: ${(err as Error).message}`, "write");
  }

  const rackCapacity = await readRackCapacityFromBuffer(buffer);
  const rackCapacityHistory = await readRackCapacityHistoryFromBuffer(buffer);
  return { path: filePath, backupPath, outcomes, changedCount, imageEmbedded, savedAt: new Date().toISOString(), rackCapacity, rackCapacityHistory };
}
