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
import { ensureRackUnitCapacitySheet } from "./RackUnitCapacityWriter";
import { resolveRelationshipTarget } from "./ExcelZipUtils";
import { EMU_PER_PX, embedRackCapacityImage, RackCapacityImageInput } from "./SheetImageWriter";

export type { RackCapacityImageInput };

export const RACK_CAPACITY_SHEET_NAME = "Rack Capacity";
export const RACK_CAPACITY_TABLE_NAME = "Table7";

export type RackEditableField = "status" | "cabinetSize" | "detail" | "deviceType";

/** One field's staged edit: what the UI believes is on disk right now
 *  (`expected`, for the optimistic-concurrency check) and what to write
 *  (`next`). Status's `next` is always one of the four canonical values
 *  (enforced at the IPC boundary); the other three are free text (validated
 *  real Table7 data - Cabinet Size is a "WxD cm" dimension string, Detail/
 *  Device Type are free-form, including bare numeric codes in real data -
 *  no controlled value list exists for any of them). */
export interface RackFieldEdit {
  expected: string | null;
  next: string | null;
}

/** One rack's staged modification - any subset of its four editable fields.
 *  Multiple field edits on the same rack are ONE change, applied atomically
 *  per-row (matching the Editor's "one staged rack modification" UI model). */
export interface RackFieldChange {
  /** Sheet row number, as returned by readRackCapacityFromBuffer's RackRecord.rowNumber. */
  rowNumber: number;
  rackId: string;
  status?: RackFieldEdit;
  cabinetSize?: RackFieldEdit;
  detail?: RackFieldEdit;
  deviceType?: RackFieldEdit;
}

export interface RackFieldChangeOutcome {
  rowNumber: number;
  rackId: string;
  applied: boolean;
  /** Present only when applied is false. */
  conflictField?: RackEditableField;
  conflictActualValue?: string | null;
  conflictReason?: "row_not_found" | "rack_id_mismatch" | "field_mismatch";
}

export interface RackCapacityWriteResult {
  buffer: Buffer;
  outcomes: RackFieldChangeOutcome[];
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

/**
 * Matches exactly one cell by ref, never bleeding into the next cell.
 *
 * ROOT CAUSE (found while testing Detail/Cabinet Size/Device Type, which can
 * legitimately be blank, unlike Status): the attrs-consuming `[^>]*` was
 * GREEDY. For a self-closing target cell (e.g. `<c r="E12" s="53"/>`)
 * immediately followed by another cell (`<c r="F12" ...><v>92</v></c>`),
 * greedy `[^>]*` overconsumes through the `/`, lands on the closing `>`,
 * fails the `\/>` branch (no `/` left to match), then falls through to the
 * `>...</c>` branch and matches all the way to the NEXT cell's `</c>` -
 * silently returning the wrong cell's value/style. Verified via real
 * Srinakarin data (row 12: blank Detail immediately followed by Device
 * Type "Server" - a Detail read/conflict-check was returning "Server").
 * Fix: make the real (non-lookahead) `[^>]*` LAZY, so self-closing cells
 * stop at their own `/>` instead of overconsuming into the next tag.
 */
function cellRegex(ref: string): RegExp {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
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

/**
 * One-time, idempotent migration: relocates the single designated image
 * from the old "Rack Capacity" K9 anchor to the new "Rack Unit Capacity"
 * sheet (same K9 anchor - confirmed clear of the new sheet's 5-column A:E
 * table on both real production workbooks). Preserves the exact binary
 * bytes and display size (EMU/px round-trip is exact here since cx/cy were
 * originally produced as Math.round(px) * EMU_PER_PX). The old drawing's
 * part/rels/media/Content_Types entries are removed only after the new
 * embed has fully succeeded (or is confirmed already done), so a mid-way
 * failure can never leave the image orphaned on neither sheet. A true no-op
 * once the old sheet's drawing relationship has been removed (i.e. every
 * call after the first).
 */
export async function migrateRackCapacityImageToUnitCapacity(zip: JSZip): Promise<boolean> {
  const oldSheetXmlPath = await locateRackCapacitySheetXmlPath(zip);
  if (!oldSheetXmlPath) return false;
  const oldSheetFile = oldSheetXmlPath.replace(/^xl\/worksheets\//, "");
  const oldRelsPath = `xl/worksheets/_rels/${oldSheetFile}.rels`;
  const oldRelsXml = await entryText(zip, oldRelsPath);
  if (!oldRelsXml) return false;

  let oldDrawingRid: string | null = null;
  let oldDrawingTarget: string | null = null;
  for (const m of oldRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      oldDrawingRid = getAttr(m[1], "Id");
      oldDrawingTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!oldDrawingRid || !oldDrawingTarget) return false; // nothing to migrate - already done, or never had one

  const oldDrawingPath = resolveRelationshipTarget("xl/worksheets", oldDrawingTarget);
  const oldDrawingFile = oldDrawingPath.replace(/^xl\/drawings\//, "");
  const oldDrawingRelsPath = `xl/drawings/_rels/${oldDrawingFile}.rels`;
  const oldDrawingXml = await entryText(zip, oldDrawingPath);
  const oldDrawingRelsXml = await entryText(zip, oldDrawingRelsPath);
  if (!oldDrawingXml || !oldDrawingRelsXml) return false;

  let oldMediaTarget: string | null = null;
  for (const m of oldDrawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/image")) {
      oldMediaTarget = getAttr(m[1], "Target");
      break;
    }
  }
  const extMatch = oldMediaTarget?.match(/\.(png|jpe?g)$/i);
  const extentMatch = oldDrawingXml.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!oldMediaTarget || !extMatch || !extentMatch) return false;

  const oldMediaPath = resolveRelationshipTarget("xl/drawings", oldMediaTarget);
  const mediaFile = zip.file(oldMediaPath);
  if (!mediaFile) return false;

  const type: "png" | "jpeg" = extMatch[1].toLowerCase() === "png" ? "png" : "jpeg";
  const cx = Number(extentMatch[1]);
  const cy = Number(extentMatch[2]);

  const { xmlPath: newSheetXmlPath } = await ensureRackUnitCapacitySheet(zip);
  const newSheetFile = newSheetXmlPath.replace(/^xl\/worksheets\//, "");
  const newRelsPath = `xl/worksheets/_rels/${newSheetFile}.rels`;
  const newRelsXml = await entryText(zip, newRelsPath);
  const newAlreadyHasImage = newRelsXml
    ? [...newRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].some(m => getAttr(m[1], "Type")?.endsWith("/drawing"))
    : false;

  if (!newAlreadyHasImage) {
    const bytes = await mediaFile.async("nodebuffer");
    const dispWidth = Math.round(cx / EMU_PER_PX);
    const dispHeight = Math.round(cy / EMU_PER_PX);
    await embedRackCapacityImage(zip, newSheetXmlPath, { bytes, type, width: dispWidth, height: dispHeight });
  }

  // Only now remove the old drawing/media/rels/Content_Types entries - the
  // new embed above has either just succeeded or was already in place.
  zip.remove(oldDrawingPath);
  zip.remove(oldDrawingRelsPath);
  zip.remove(oldMediaPath);
  zip.file(oldRelsPath, oldRelsXml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${oldDrawingRid}"[^>]*\\/>`), ""));
  const oldSheetXml = await entryText(zip, oldSheetXmlPath);
  if (oldSheetXml) {
    const strippedSheet = oldSheetXml.replace(new RegExp(`<drawing r:id="${oldDrawingRid}"\\/>`), "");
    if (strippedSheet !== oldSheetXml) zip.file(oldSheetXmlPath, strippedSheet);
  }
  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml) {
    const escapedPath = oldDrawingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strippedContentTypes = contentTypesXml.replace(new RegExp(`<Override PartName="/${escapedPath}"[^>]*\\/>`), "");
    if (strippedContentTypes !== contentTypesXml) zip.file("[Content_Types].xml", strippedContentTypes);
  }

  return true;
}

function normalizeFieldValue(value: string | null | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

/** Reads a Table7 cell's text value regardless of storage type - shared
 *  string (t="s", the predominant real-world form for these columns),
 *  inline string (t="inlineStr"), or a bare number (no t attribute - a small
 *  number of real Detail/Device Type rows hold numeric-looking codes stored
 *  as plain numbers, per the verified production data). */
function readFieldCellValue(cellMatch: RegExpMatchArray | null, sharedStrings: string[]): string | null {
  if (!cellMatch) return null;
  const cellXml = cellMatch[0];
  if (/\bt="s"/.test(cellXml)) {
    const index = cellSharedStringIndex(cellXml);
    return index !== null ? sharedStrings[index] ?? null : null;
  }
  if (/\bt="inlineStr"/.test(cellXml)) {
    const t = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    return t ? xmlUnescape(t[1]) : null;
  }
  const v = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  return v ? v[1] : null;
}

/**
 * Applies field changes (Status/Cabinet Size/Detail/Device Type) to Table7,
 * verifying each row's current Rack ID and every CHANGED field's expected
 * value against the caller's expectation before writing any of them (rows
 * that drifted since the UI last read them are reported as a conflict on
 * that specific field, not silently overwritten - and no field on that row
 * is written if any one of its changed fields conflicts). Only the touched
 * cells' `<v>`/shared-string reference are rewritten; every other
 * worksheet, table, pivot, chart, and VBA part is left byte-for-byte alone -
 * this never goes through the generic patchWorkbookBuffer/
 * patchSrinakarinWorkbookBuffer save path.
 */
export async function applyRackCapacityFieldChanges(
  original: Buffer,
  changes: RackFieldChange[],
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

  const outcomes: RackFieldChangeOutcome[] = [];
  let changedCount = 0;
  const FIELDS: RackEditableField[] = ["status", "cabinetSize", "detail", "deviceType"];

  for (const change of changes) {
    if (change.rowNumber < table.firstDataRow || change.rowNumber > table.lastDataRow) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
      continue;
    }
    const rackIdRef = `${table.columns.rackId}${change.rowNumber}`;
    const rackIdCellMatch: RegExpMatchArray | null = sheetXml.match(cellRegex(rackIdRef));
    if (!rackIdCellMatch) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "row_not_found" });
      continue;
    }
    const actualRackId = readFieldCellValue(rackIdCellMatch, sharedStrings);
    if (normalizeFieldValue(actualRackId) !== normalizeFieldValue(change.rackId)) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "rack_id_mismatch" });
      continue;
    }

    // Verify EVERY changed field's expected value before writing ANY of
    // them - a conflict on one field must not leave the row half-written.
    let conflict: { field: RackEditableField; actual: string | null } | null = null;
    for (const field of FIELDS) {
      const edit = change[field];
      if (!edit) continue;
      const ref = `${table.columns[field]}${change.rowNumber}`;
      const cellMatch: RegExpMatchArray | null = sheetXml.match(cellRegex(ref));
      const actual = normalizeFieldValue(readFieldCellValue(cellMatch, sharedStrings));
      if (actual !== normalizeFieldValue(edit.expected)) {
        conflict = { field, actual };
        break;
      }
    }
    if (conflict) {
      outcomes.push({ rowNumber: change.rowNumber, rackId: change.rackId, applied: false, conflictReason: "field_mismatch", conflictField: conflict.field, conflictActualValue: conflict.actual });
      continue;
    }

    for (const field of FIELDS) {
      const edit = change[field];
      if (!edit) continue;
      const nextValue = normalizeFieldValue(edit.next);
      const currentValue = normalizeFieldValue(edit.expected);
      if (nextValue === currentValue) continue; // already the target value

      const ref = `${table.columns[field]}${change.rowNumber}`;
      const cellMatch: RegExpMatchArray | null = sheetXml.match(cellRegex(ref));
      if (nextValue === null) {
        // Clearing to blank: drop the value/type, keep the cell (and its style) in place.
        if (cellMatch) {
          const styleAttr = cellMatch[0].match(/\bs="\d+"/)?.[0];
          sheetXml = sheetXml.replace(cellMatch[0], `<c r="${ref}"${styleAttr ? ` ${styleAttr}` : ""}/>`);
        }
        changedCount++;
        continue;
      }
      const { index: newSharedIndex, xml: patchedSharedStrings } = findOrAddSharedString(sharedStringsXml, nextValue);
      sharedStringsXml = patchedSharedStrings;
      if (!sharedStrings[newSharedIndex]) sharedStrings[newSharedIndex] = nextValue;

      if (cellMatch && /\bt="s"/.test(cellMatch[0])) {
        const replaced: string = cellMatch[0].replace(/<v>\d*<\/v>/, `<v>${newSharedIndex}</v>`);
        sheetXml = sheetXml.replace(cellMatch[0], replaced);
      } else if (cellMatch) {
        // Existing cell was inline-string/numeric typed - normalize to a shared-string cell, preserving its style.
        const styleAttr = cellMatch[0].match(/\bs="\d+"/)?.[0];
        const replacement = `<c r="${ref}"${styleAttr ? ` ${styleAttr}` : ""} t="s"><v>${newSharedIndex}</v></c>`;
        sheetXml = sheetXml.replace(cellMatch[0], replacement);
      } else {
        // Cell did not exist (blank) - insert a new <c> into its row.
        const rowMatch: RegExpMatchArray | null = sheetXml.match(new RegExp(`<row r="${change.rowNumber}"[^>]*>([\\s\\S]*?)<\\/row>`));
        if (!rowMatch) continue;
        const newCell = `<c r="${ref}" t="s"><v>${newSharedIndex}</v></c>`;
        sheetXml = sheetXml.replace(rowMatch[0], rowMatch[0].replace("</row>", `${newCell}</row>`));
      }
      changedCount++;
    }
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

  // One-time, idempotent relocation of any pre-v2.2.3 image still sitting on
  // the old "Rack Capacity" K9 anchor - runs on every save (cheap no-op once
  // done) so a plain field-only edit still completes the migration, not only
  // a save that happens to include a fresh image upload.
  await migrateRackCapacityImageToUnitCapacity(zip);

  let imageEmbedded = false;
  if (image) {
    const { xmlPath: rackUnitCapacitySheetPath } = await ensureRackUnitCapacitySheet(zip);
    await embedRackCapacityImage(zip, rackUnitCapacitySheetPath, image);
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
  outcomes: RackFieldChangeOutcome[];
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
export async function saveRackCapacityFieldChanges(
  filePath: string,
  changes: RackFieldChange[],
  options: { backupDir: string; backupKeep: number },
  image?: RackCapacityImageInput | null,
  facilityId?: string | null,
  /** Explicit "YYYY-MM" for the History snapshot this save should upsert -
   *  the Editor's own Month/Year selector, not a silent system-month
   *  assumption. Falls back to getActiveReportingMonth (the pre-v2.2.3
   *  behavior) only when omitted, for backward compatibility. */
  snapshotMonth?: string | null
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

  const { buffer: statusBuffer, outcomes, changedCount, imageEmbedded } = await applyRackCapacityFieldChanges(original, changes, image);

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
      const month = snapshotMonth ?? (await getActiveReportingMonth(zipForMonth));
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
