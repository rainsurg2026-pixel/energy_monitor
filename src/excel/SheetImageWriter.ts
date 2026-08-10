/**
 * Generic, sheet-agnostic "embed a single designated image on a worksheet"
 * writer - a real Excel drawing anchored at K9, never a file path/filename/
 * base64 string written into a cell. Used by both RackCapacityWriter.ts (for
 * the pre-v2.2.3 migration source) and RackUnitCapacityWriter.ts (the
 * current destination), which is exactly why this lives in its own module:
 * RackCapacityWriter.ts already imports RackUnitCapacityWriter.ts (for the
 * migration helper), so RackUnitCapacityWriter.ts importing anything back
 * from RackCapacityWriter.ts would be a circular dependency.
 */
import JSZip from "jszip";
import { entryText, getAttr } from "./ExcelZipUtils";

export interface RackCapacityImageInput {
  bytes: Buffer;
  type: "png" | "jpeg";
  width: number;
  height: number;
}

const K9_ANCHOR_COL = 10; // K, 0-based (A=0)
const K9_ANCHOR_ROW = 8; // row 9, 0-based
/** EMU (English Metric Units) per pixel - the fixed OOXML drawing-size unit.
 *  Exported so callers converting a stored <xdr:ext> back to display pixels
 *  (e.g. the image migration's exact-size round-trip) use the same constant. */
export const EMU_PER_PX = 9525;
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
    `<xdr:nvPicPr><xdr:cNvPr id="1" name="Rack Unit Capacity Image"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic>` +
    `<xdr:clientData/>` +
    `</xdr:oneCellAnchor>` +
    `</xdr:wsDr>`
  );
}

/**
 * Embeds (or replaces) the single, designated image on `sheetXmlPath` - a
 * real Excel drawing anchored at K9, confirmed empty and unmerged on both
 * real production workbooks' new "Rack Unit Capacity" sheet (5-column A:E
 * table, clear of K9). The first embed on a given sheet always creates a
 * fresh, dedicated drawing part; a later replace reuses that same part and
 * only swaps its image relationship, so no unrelated drawing/chart anywhere
 * else in the workbook is ever touched.
 */
export async function embedRackCapacityImage(zip: JSZip, sheetXmlPath: string, image: RackCapacityImageInput): Promise<void> {
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
    if (!drawingXml || !drawingRelsXml) throw new Error("Image drawing part is missing its expected rels.");

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
