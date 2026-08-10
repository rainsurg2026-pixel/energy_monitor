import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { applyRackCapacityFieldChanges, migrateRackCapacityImageToUnitCapacity } from "../src/excel/RackCapacityWriter";
import { locateRackUnitCapacitySheet } from "../src/excel/RackUnitCapacityWriter";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}
function makeValidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = rgb[0];
      raw[px + 1] = rgb[1];
      raw[px + 2] = rgb[2];
    }
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

async function unrelatedPartHashes(buffer: Buffer, excludePaths: Set<string>): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name =>
    !zip.files[name].dir &&
    /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables/.test(name) &&
    !excludePaths.has(name)
  );
  const otherDrawings = Object.keys(zip.files).filter(name => /^xl\/drawings\/.*\.xml$/.test(name) && !excludePaths.has(name));
  const result: Record<string, string> = {};
  for (const name of [...names, ...otherDrawings]) {
    result[name] = crypto.createHash("sha256").update(await zip.file(name)!.async("nodebuffer")).digest("hex");
  }
  return result;
}

/** Hand-crafts a v2.2.2-shaped K9 image directly on the "Rack Capacity"
 *  sheet, mirroring exactly what embedRackCapacityImage's "create" path used
 *  to write before v2.2.3 repointed it at "Rack Unit Capacity" - this is the
 *  only way to construct the legacy pre-migration state, since the (correct,
 *  now-repointed) production embed function can no longer produce it. */
async function seedLegacyRackCapacityImage(original: Buffer, png: Buffer, width: number, height: number): Promise<{ buffer: Buffer; drawingPath: string }> {
  const zip = await JSZip.loadAsync(original);
  const workbookXml = (await zip.file("xl/workbook.xml")!.async("string"));
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")!.async("string"));
  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = m[1].match(/Id="([^"]*)"/)?.[1];
    const target = m[1].match(/Target="([^"]*)"/)?.[1];
    if (id && target) relMap.set(id, target);
  }
  let rackCapacityPath: string | null = null;
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    const rid = m[1].match(/r:id="([^"]*)"/)?.[1];
    if (name === "Rack Capacity" && rid) rackCapacityPath = "xl/" + relMap.get(rid);
  }
  if (!rackCapacityPath) throw new Error("Rack Capacity sheet not found");

  const sheetFile = rackCapacityPath.replace(/^xl\/worksheets\//, "");
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  let sheetRelsXml = (await zip.file(sheetRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const existingIds = [...sheetRelsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
  const newRid = `rId${(existingIds.length ? Math.max(...existingIds) : 0) + 1}`;

  const mediaIndex = (() => {
    const indices = Object.keys(zip.files).map(n => n.match(/^xl\/media\/image(\d+)\./)?.[1]).filter(Boolean).map(Number);
    return (indices.length ? Math.max(...indices) : 0) + 1;
  })();
  const drawingIndex = (() => {
    const indices = Object.keys(zip.files).map(n => n.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1]).filter(Boolean).map(Number);
    return (indices.length ? Math.max(...indices) : 0) + 1;
  })();

  const mediaPath = `xl/media/image${mediaIndex}.png`;
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
  const cx = width * 9525;
  const cy = height * 9525;

  zip.file(mediaPath, png);
  zip.file(drawingPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:pic>` +
    `<xdr:nvPicPr><xdr:cNvPr id="1" name="Rack Capacity Image"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
  );
  zip.file(drawingRelsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.png"/>` +
    `</Relationships>`
  );
  sheetRelsXml = sheetRelsXml.replace(
    /<\/Relationships>/,
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`
  );
  zip.file(sheetRelsPath, sheetRelsXml);

  const sheetXml = (await zip.file(rackCapacityPath)!.async("string"));
  const drawingEl = `<drawing r:id="${newRid}"/>`;
  const patchedSheetXml = /<tableParts\b/.test(sheetXml)
    ? sheetXml.replace(/<tableParts\b/, `${drawingEl}<tableParts`)
    : sheetXml.replace("</worksheet>", `${drawingEl}</worksheet>`);
  zip.file(rackCapacityPath, patchedSheetXml);

  const contentTypesXml = (await zip.file("[Content_Types].xml")!.async("string"));
  let patchedContentTypes = contentTypesXml;
  if (!/<Default\b[^>]*Extension="png"/.test(patchedContentTypes)) {
    patchedContentTypes = patchedContentTypes.replace(/<\/Types>/, `<Default Extension="png" ContentType="image/png"/></Types>`);
  }
  patchedContentTypes = patchedContentTypes.replace(
    /<\/Types>/,
    `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
  );
  zip.file("[Content_Types].xml", patchedContentTypes);

  const buffer = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
  return { buffer, drawingPath };
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);

  const noMigrationResult = await migrateRackCapacityImageToUnitCapacity(await JSZip.loadAsync(original));
  check(`${label}: migrating a workbook with no legacy image is a no-op (returns false)`, noMigrationResult === false);

  const png = makeValidPng(400, 200, [180, 90, 30]);
  const { buffer: seeded, drawingPath: legacyDrawingPath } = await seedLegacyRackCapacityImage(original, png, 400, 200);

  // The legacy drawing itself is the thing being migrated, not "unrelated" -
  // it is EXPECTED to disappear from its old location, so it's excluded from
  // both the before/after unrelated-parts hash snapshots.
  const beforeHashes = await unrelatedPartHashes(seeded, new Set([legacyDrawingPath]));

  // ---- Run the migration ----
  const zip1 = await JSZip.loadAsync(seeded);
  const migrated1 = await migrateRackCapacityImageToUnitCapacity(zip1);
  check(`${label}: migration reports a real change on first run`, migrated1 === true);
  const result1 = (await zip1.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;

  const zipAfter1 = await JSZip.loadAsync(result1);
  const newSheetPath = await locateRackUnitCapacitySheet(zipAfter1);
  check(`${label}: "Rack Unit Capacity" sheet exists after migration`, newSheetPath !== null);

  const newSheetFile = newSheetPath!.match(/xl\/worksheets\/(sheet\d+)\.xml$/)![1];
  const newRelsXml = await zipAfter1.file(`xl/worksheets/_rels/${newSheetFile}.xml.rels`)!.async("string");
  const newDrawingRel = [...newRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].find(m => /Type="[^"]*\/drawing"/.test(m[0]));
  check(`${label}: new sheet has a drawing relationship after migration`, Boolean(newDrawingRel));
  const newDrawingTarget = newDrawingRel?.[1].match(/Target="([^"]*)"/)?.[1];
  const newDrawingPath = `xl/drawings/${newDrawingTarget?.replace(/^(\.\.\/)?drawings\//, "")}`;
  const newDrawingXml = await zipAfter1.file(newDrawingPath)!.async("string");
  check(`${label}: migrated drawing anchored at K9 (col 10, row 8)`, /<xdr:col>10<\/xdr:col>/.test(newDrawingXml) && /<xdr:row>8<\/xdr:row>/.test(newDrawingXml));
  check(`${label}: migrated drawing preserves the exact 400x200 -> 2:1 aspect ratio`, (() => {
    const m = newDrawingXml.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!m) return false;
    return Math.abs(Number(m[1]) / Number(m[2]) - 2) < 0.001;
  })());
  check(`${label}: migrated drawing display name updated to "Rack Unit Capacity Image"`, newDrawingXml.includes('name="Rack Unit Capacity Image"'));

  const newDrawingRelsXml = await zipAfter1.file(`xl/drawings/_rels/${newDrawingPath.replace(/^xl\/drawings\//, "")}.rels`)!.async("string");
  const newMediaTarget = newDrawingRelsXml.match(/Target="([^"]*media\/[^"]*)"/)?.[1];
  const newMediaPath = `xl/media/${newMediaTarget?.replace(/^(\.\.\/)?media\//, "")}`;
  const newMediaBytes = await zipAfter1.file(newMediaPath)!.async("nodebuffer");
  check(`${label}: migrated media bytes are byte-identical to the original PNG`, newMediaBytes.equals(png));

  // ---- Old sheet fully cleaned up ----
  const oldWorkbookXml = await zipAfter1.file("xl/workbook.xml")!.async("string");
  const oldRelMap = new Map<string, string>();
  const relsXmlAfter = await zipAfter1.file("xl/_rels/workbook.xml.rels")!.async("string");
  for (const m of relsXmlAfter.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = m[1].match(/Id="([^"]*)"/)?.[1];
    const target = m[1].match(/Target="([^"]*)"/)?.[1];
    if (id && target) oldRelMap.set(id, target);
  }
  let rackCapacityPathAfter: string | null = null;
  for (const m of oldWorkbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    const rid = m[1].match(/r:id="([^"]*)"/)?.[1];
    if (name === "Rack Capacity" && rid) rackCapacityPathAfter = "xl/" + oldRelMap.get(rid);
  }
  const oldSheetFile = rackCapacityPathAfter!.match(/xl\/worksheets\/(sheet\d+)\.xml$/)![1];
  const oldSheetXmlAfter = await zipAfter1.file(rackCapacityPathAfter!)!.async("string");
  check(`${label}: old "Rack Capacity" sheet no longer references a <drawing>`, !/<drawing\b/.test(oldSheetXmlAfter));
  const oldRelsFile = zipAfter1.file(`xl/worksheets/_rels/${oldSheetFile}.xml.rels`);
  const oldRelsXmlAfter = oldRelsFile ? await oldRelsFile.async("string") : "";
  check(`${label}: old sheet's rels no longer has a drawing relationship`, !/Type="[^"]*\/drawing"/.test(oldRelsXmlAfter));

  const afterHashes1 = await unrelatedPartHashes(result1, new Set([newDrawingPath, legacyDrawingPath]));
  const changedParts1 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes1[name]);
  check(`${label}: VBA/pivot/table/other-drawings untouched by migration`, changedParts1.length === 0, changedParts1.join(", "));

  // ---- Idempotency: running migration again is a true no-op ----
  const zip2 = await JSZip.loadAsync(result1);
  const migrated2 = await migrateRackCapacityImageToUnitCapacity(zip2);
  check(`${label}: second migration run reports no change`, migrated2 === false);
  const result2 = (await zip2.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
  check(`${label}: second migration run produces a byte-identical buffer`, result2.equals(result1));

  // ---- Fresh uploads via applyRackCapacityFieldChanges also land on the new sheet ----
  const freshPng = makeValidPng(100, 100, [10, 200, 10]);
  const freshResult = await applyRackCapacityFieldChanges(original, [], { bytes: freshPng, type: "png", width: 100, height: 100 });
  const freshZip = await JSZip.loadAsync(freshResult.buffer);
  const freshNewSheetPath = await locateRackUnitCapacitySheet(freshZip);
  check(`${label}: a fresh (non-migration) image upload also creates "Rack Unit Capacity"`, freshNewSheetPath !== null);
  const wbFresh = new ExcelJS.Workbook();
  await wbFresh.xlsx.load(freshResult.buffer as unknown as ArrayBuffer);
  check(`${label}: workbook with the fresh upload still opens cleanly via ExcelJS`, Boolean(wbFresh.getWorksheet("Rack Capacity")));
}

const workDir = path.resolve("dist-electron/test-work/rack-capacity-image-migration");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
const rangsitCopy = path.join(workDir, "DC_Rangsit.xlsm");
const srinakarinCopy = path.join(workDir, "DC_Srinakarin.xlsm");
await fs.copyFile(path.resolve("DC_Rangsit.xlsm"), rangsitCopy);
await fs.copyFile(path.resolve("DC_Srinakarin.xlsm"), srinakarinCopy);

const prodHashBefore = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};

await testFacility("RANGSIT", rangsitCopy);
await testFacility("SRINAKARIN", srinakarinCopy);

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK CAPACITY IMAGE MIGRATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
