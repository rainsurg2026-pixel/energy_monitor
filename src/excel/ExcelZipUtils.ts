/**
 * ExcelZipUtils - browser-safe OOXML/zip primitives shared by workbook
 * writers that DO need heavy Node-only tooling (WorkbookWriter.ts, which
 * imports fs/path/ExcelJS) and by writers that must also be safely bundled
 * into the renderer for report building (RackCapacityHistoryWriter.ts, via
 * reportDataBuilder.ts/reportHtml.ts). Keep this file free of "fs", "path",
 * and "exceljs" imports - pulling those in here would drag the whole
 * Node-only WorkbookWriter dependency graph into the browser bundle.
 */

import JSZip from "jszip";
import { normalizeMonthCell } from "./ExcelSchema";

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

export function getAttr(tagAttrs: string, name: string): string | null {
  const m = tagAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export async function entryText(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  if (!file) return null;
  return file.async("string");
}

/**
 * Resolves an OOXML relationship Target (which may be absolute - a leading
 * "/" - or relative to the referencing part's directory, including "../"
 * traversal) to a zip entry path. Naively concatenating baseDir+target
 * produces a path like "xl/worksheets/../tables/table7.xml", which is NOT a
 * real zip entry name (JSZip does exact string lookup, no normalization) -
 * proven to silently break table-ref updates on any worksheet whose table
 * relationship was resolved this way.
 */
export function resolveRelationshipTarget(baseDir: string, target: string): string {
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

export async function ensureExactCellFormatStyles(
  zip: JSZip,
  sourceStyleIds: Iterable<string>,
  formatCode: string
): Promise<Map<string, string>> {
  const stylesXml = await entryText(zip, "xl/styles.xml");
  if (!stylesXml) throw new WorkbookError("INVALID_WORKBOOK", "Workbook is missing styles.xml.");

  // Scoped strictly to the real <numFmts> custom-format registry - NOT a
  // document-wide scan. styles.xml can also contain <numFmt> elements nested
  // inside <dxfs> (conditional-formatting/pivot differential-format
  // records), which reuse the numFmtId namespace for their own narrow
  // context and are NOT valid ids to reference from an ordinary cellXfs
  // entry. Proven on real production data: DC_Rangsit.xlsm has a
  // dxf-scoped `<numFmt numFmtId="14" formatCode="0.00%"/>`, while
  // numFmtId 14 is Excel's BUILTIN "m/d/yyyy" - a document-wide scan
  // "reused" that id for a genuine percentage cellXf, which Excel then
  // renders as a garbled date, not a percentage.
  const numFmtsContainer = stylesXml.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/)?.[1] ?? "";
  const numFmtMatches = [...numFmtsContainer.matchAll(/<numFmt\b([^>]*)\/>/g)];
  const formatMatch = numFmtMatches.find(match => getAttr(match[1], "formatCode") === formatCode);
  let patchedStyles = stylesXml;
  let numFmtId = formatMatch ? getAttr(formatMatch[1], "numFmtId") : null;
  if (!numFmtId) {
    // Allocation still scans the WHOLE document (including dxfs) so a newly
    // minted id can never collide with ANY existing numFmtId, anywhere.
    const allIds = [...stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)]
      .map(match => Number(getAttr(match[1], "numFmtId")))
      .filter(Number.isFinite);
    numFmtId = String(Math.max(163, ...allIds) + 1);
    const numFmt = `<numFmt numFmtId="${numFmtId}" formatCode="${formatCode}"/>`;
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
    const withNumberFormat = /\bnumFmtId=/.test(openingTag)
      ? openingTag.replace(/\bnumFmtId="[^"]*"/, `numFmtId="${numFmtId}"`)
      : openingTag.replace(/\/?>(?:$)/, ` numFmtId="${numFmtId}"$&`);
    const patchedOpening = withNumberFormat.replace(/\bapplyNumberFormat="[^"]*"/, "applyNumberFormat=\"1\"");
    const withApply = /\bapplyNumberFormat="1"/.test(patchedOpening)
      ? patchedOpening
      : patchedOpening.replace(/\/?>(?:$)/, ` applyNumberFormat="1"$&`);
    return withApply + source.slice(openingTag.length);
  };
  const styleOverrides = new Map<string, string>();
  const addedStyles: string[] = [];
  const styleIndexes = new Map(xfNodes.map((style, index) => [style, index]));
  for (const sourceStyleId of new Set(sourceStyleIds)) {
    const style = makeStyle(Number(sourceStyleId));
    let index = styleIndexes.get(style);
    if (index === undefined) {
      index = xfNodes.length + addedStyles.length;
      styleIndexes.set(style, index);
      addedStyles.push(style);
    }
    styleOverrides.set(sourceStyleId, String(index));
  }
  if (addedStyles.length === 0) return styleOverrides;
  const updatedXfs = `${xfXml}${addedStyles.join("")}`;
  patchedStyles = patchedStyles.replace(cellXfsMatch[0], cellXfsMatch[0].replace(cellXfsMatch[1], updatedXfs).replace(/(<cellXfs\b[^>]*\bcount=")\d+("[^>]*>)/, `$1${xfNodes.length + addedStyles.length}$2`));
  zip.file("xl/styles.xml", patchedStyles);
  return styleOverrides;
}

export function workbookMonthSerial(value: unknown, date1904 = false): number | null {
  const normalized = normalizeMonthCell(value);
  if (!normalized) return null;
  const [year, month] = normalized.split("-").map(Number);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(year, month - 1, 1) - epoch) / 86_400_000);
}

export function workbookUsesDate1904(workbookXml: string): boolean {
  return /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbookXml);
}

function xmlUnescapeSheetName(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * Resolves a worksheet's zip path by its display name via workbook.xml +
 * workbook.xml.rels - the single shared implementation of a lookup every
 * writer module in this codebase previously duplicated by hand
 * (RackCapacityWriter.ts, RackUnitCapacityWriter.ts, the old
 * RackUnitCapacityImageHistoryWriter.ts). Returns null if no sheet with that
 * exact name exists.
 */
export async function locateSheetXmlPathByName(zip: JSZip, sheetName: string): Promise<string | null> {
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
    if (name && xmlUnescapeSheetName(name) === sheetName && rid) {
      const target = relMap.get(rid);
      if (target) return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return null;
}
