import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import JSZip from "jszip";
import {
  ensureRackUnitCapacityImageHistorySheet,
  upsertRackUnitCapacityImageHistoryRow,
  readRackUnitCapacityImageForMonth,
  readRackUnitCapacityImageHistoryFromBuffer,
  RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME
} from "../src/excel/RackUnitCapacityImageHistoryWriter";

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
    const data = await zip.file(name)!.async("nodebuffer");
    result[name] = crypto.createHash("sha256").update(data).digest("hex");
  }
  return result;
}

async function upsert(buffer: Buffer, facility: string, reportingMonth: string, user: string, png: Buffer, w: number, h: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const { xmlPath } = await ensureRackUnitCapacityImageHistorySheet(zip);
  await upsertRackUnitCapacityImageHistoryRow(
    zip,
    xmlPath,
    { reportingMonth, facility, timestamp: new Date().toISOString(), user, mimeType: "image/png", dataVersion: 1 },
    { bytes: png, type: "png", width: w, height: h }
  );
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);
  const beforeHashes = await unrelatedPartHashes(original, new Set());
  const beforeDrawingNames = new Set(
    (await JSZip.loadAsync(original)).files
      ? Object.keys((await JSZip.loadAsync(original)).files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n))
      : []
  );

  // ---- First save: August, creates the sheet + first row + first image ----
  const pngAug = makeValidPng(400, 200, [200, 60, 60]);
  const afterAug = await upsert(original, label, "2026-08", "test.user.aug", pngAug, 400, 200);

  const rowsAfterAug = await readRackUnitCapacityImageHistoryFromBuffer(afterAug);
  check(`${label}: after August save, exactly one row exists`, rowsAfterAug.length === 1, JSON.stringify(rowsAfterAug));
  check(`${label}: row records the right facility/month/user`, rowsAfterAug[0]?.facility === label && rowsAfterAug[0]?.reportingMonth === "2026-08" && rowsAfterAug[0]?.user === "test.user.aug");
  check(`${label}: row's MimeType is recorded as image/png`, rowsAfterAug[0]?.mimeType === "image/png");

  const augImage = await readRackUnitCapacityImageForMonth(afterAug, label, "2026-08");
  check(`${label}: August's image reads back non-null`, augImage !== null);
  check(`${label}: August's image bytes match exactly what was saved`, Boolean(augImage && augImage.bytes.equals(pngAug)));
  check(`${label}: August's image preserves its 2:1 aspect ratio`, Boolean(augImage && Math.abs(augImage.width / augImage.height - 2) < 0.05));

  const zipAfterAug = await JSZip.loadAsync(afterAug);
  const drawingXmlAug = await zipAfterAug.file(
    Object.keys(zipAfterAug.files).find(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !beforeDrawingNames.has(n))!
  )!.async("string");
  check(`${label}: August's image (first row) is anchored at K9 (col 10, row 8, 0-based)`, /<xdr:col>10<\/xdr:col>/.test(drawingXmlAug) && /<xdr:row>8<\/xdr:row>/.test(drawingXmlAug));

  const afterAugHashes = await unrelatedPartHashes(afterAug, new Set(Object.keys(zipAfterAug.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !beforeDrawingNames.has(n))));
  const changedByAug = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterAugHashes[name]);
  check(`${label}: VBA/pivot/table/other-drawings untouched by the August save`, changedByAug.length === 0, changedByAug.join(", "));

  // ---- Second save: September (different month) - must NOT disturb August ----
  const pngSep = makeValidPng(100, 300, [40, 160, 90]);
  const afterSep = await upsert(afterAug, label, "2026-09", "test.user.sep", pngSep, 100, 300);

  const rowsAfterSep = await readRackUnitCapacityImageHistoryFromBuffer(afterSep);
  check(`${label}: after September save, exactly two rows exist (August + September)`, rowsAfterSep.length === 2, JSON.stringify(rowsAfterSep));

  const augImageAfterSep = await readRackUnitCapacityImageForMonth(afterSep, label, "2026-08");
  check(`${label}: August's image is UNCHANGED after saving a different month (September)`, Boolean(augImageAfterSep && augImageAfterSep.bytes.equals(pngAug)));

  const sepImage = await readRackUnitCapacityImageForMonth(afterSep, label, "2026-09");
  check(`${label}: September's image reads back correctly`, Boolean(sepImage && sepImage.bytes.equals(pngSep) && !sepImage.bytes.equals(pngAug)));

  const zipAfterSep = await JSZip.loadAsync(afterSep);
  const drawingPathAfterSep = Object.keys(zipAfterSep.files).find(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !beforeDrawingNames.has(n))!;
  const drawingXmlAfterSep = await zipAfterSep.file(drawingPathAfterSep)!.async("string");
  const anchorBlocks = [...drawingXmlAfterSep.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)];
  check(`${label}: both August's and September's images share ONE drawing part with two anchors (OOXML allows only one <drawing> per sheet)`, anchorBlocks.length === 2, String(anchorBlocks.length));
  check(`${label}: September's image is anchored well below August's (row 28, not overlapping K9)`, /<xdr:row>28<\/xdr:row>/.test(drawingXmlAfterSep));

  // ---- Third save: re-save August with a DIFFERENT image (update, not duplicate) ----
  const pngAugV2 = makeValidPng(300, 300, [10, 10, 220]);
  const afterAugV2 = await upsert(afterSep, label, "2026-08", "test.user.aug2", pngAugV2, 300, 300);

  const rowsAfterAugV2 = await readRackUnitCapacityImageHistoryFromBuffer(afterAugV2);
  check(`${label}: re-saving August does NOT create a third row (still exactly two: August, September)`, rowsAfterAugV2.length === 2, JSON.stringify(rowsAfterAugV2.map(r => r.reportingMonth)));

  const augImageV2 = await readRackUnitCapacityImageForMonth(afterAugV2, label, "2026-08");
  check(`${label}: August's image is now the SECOND uploaded image, not the first`, Boolean(augImageV2 && augImageV2.bytes.equals(pngAugV2) && !augImageV2.bytes.equals(pngAug)));

  const sepImageAfterAugV2 = await readRackUnitCapacityImageForMonth(afterAugV2, label, "2026-09");
  check(`${label}: September's image is UNCHANGED after re-saving August (never overwrite other months' history)`, Boolean(sepImageAfterAugV2 && sepImageAfterAugV2.bytes.equals(pngSep)));

  const augRowV2 = rowsAfterAugV2.find(r => r.reportingMonth === "2026-08");
  check(`${label}: August's row metadata (user) updated to the re-save's user`, augRowV2?.user === "test.user.aug2");

  const zipAfterAugV2 = await JSZip.loadAsync(afterAugV2);
  const mediaFilesAfterAugV2 = Object.keys(zipAfterAugV2.files).filter(n => /^xl\/media\/image\d+\.png$/.test(n));
  check(`${label}: re-saving August replaced its media in place (still exactly 2 media files total, not 3)`, mediaFilesAfterAugV2.length === 2, JSON.stringify(mediaFilesAfterAugV2));

  const afterAllHashes = await unrelatedPartHashes(afterAugV2, new Set([drawingPathAfterSep]));
  const changedByAll = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterAllHashes[name]);
  check(`${label}: VBA/pivot/table/other-drawings still untouched after 3 saves`, changedByAll.length === 0, changedByAll.join(", "));

  // ---- No image saved for a month that was never touched ----
  const octImage = await readRackUnitCapacityImageForMonth(afterAugV2, label, "2026-10");
  check(`${label}: a month with no saved image reads back null (never a fallback to another month)`, octImage === null);

  check(`${label}: sheet name is registered and stays within Excel's 31-character worksheet name limit`, (await fs.readFile(sourcePath)).length > 0 && RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME === "Rack Unit Capacity Img History" && RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME.length <= 31);
}

async function testFacilityIsolation(rangsitBuffer: Buffer, srinakarinBuffer: Buffer): Promise<void> {
  console.log(`\n===== FACILITY ISOLATION =====`);
  const pngRangsit = makeValidPng(150, 150, [255, 0, 0]);
  const pngSrinakarin = makeValidPng(150, 150, [0, 255, 0]);

  const rangsitAfter = await upsert(rangsitBuffer, "Rangsit", "2026-11", "u1", pngRangsit, 150, 150);
  const srinakarinAfter = await upsert(srinakarinBuffer, "Srinakarin", "2026-11", "u2", pngSrinakarin, 150, 150);

  const rangsitNovImage = await readRackUnitCapacityImageForMonth(rangsitAfter, "Rangsit", "2026-11");
  const srinakarinNovImage = await readRackUnitCapacityImageForMonth(srinakarinAfter, "Srinakarin", "2026-11");
  check("Rangsit's November image is its own (red), not Srinakarin's", Boolean(rangsitNovImage && rangsitNovImage.bytes.equals(pngRangsit)));
  check("Srinakarin's November image is its own (green), not Rangsit's", Boolean(srinakarinNovImage && srinakarinNovImage.bytes.equals(pngSrinakarin)));

  const wrongFacilityLookup = await readRackUnitCapacityImageForMonth(rangsitAfter, "Srinakarin", "2026-11");
  check("Looking up a different facility in Rangsit's own workbook finds nothing (separate workbooks, separate facilities)", wrongFacilityLookup === null);
}

const workDir = path.resolve("dist-electron/test-work/rack-unit-capacity-image-history");
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
await testFacilityIsolation(await fs.readFile(rangsitCopy), await fs.readFile(srinakarinCopy));

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK UNIT CAPACITY IMAGE HISTORY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
