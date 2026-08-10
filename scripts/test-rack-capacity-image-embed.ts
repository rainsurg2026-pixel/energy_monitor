import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { applyRackCapacityFieldChanges } from "../src/excel/RackCapacityWriter";

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

async function unrelatedPartHashesExcludingRackDrawing(buffer: Buffer, rackDrawingPaths: Set<string>): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name =>
    !zip.files[name].dir &&
    /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables/.test(name) &&
    !rackDrawingPaths.has(name)
  );
  // Also verify every OTHER drawing part (charts elsewhere in the workbook) untouched.
  const otherDrawings = Object.keys(zip.files).filter(name => /^xl\/drawings\/.*\.xml$/.test(name) && !rackDrawingPaths.has(name));
  const result: Record<string, string> = {};
  for (const name of [...names, ...otherDrawings]) {
    const data = await zip.file(name)!.async("nodebuffer");
    result[name] = crypto.createHash("sha256").update(data).digest("hex");
  }
  return result;
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);
  const beforeZip = await JSZip.loadAsync(original);
  const beforeDrawingNames = new Set(Object.keys(beforeZip.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n)));
  const beforeHashes = await unrelatedPartHashesExcludingRackDrawing(original, new Set());

  // ---- First embed: create ----
  const png1 = makeValidPng(400, 200, [200, 60, 60]);
  const result1 = await applyRackCapacityFieldChanges(original, [], { bytes: png1, type: "png", width: 400, height: 200 });
  check(`${label}: first embed reports imageEmbedded`, result1.imageEmbedded === true);
  const zip1 = await JSZip.loadAsync(result1.buffer);
  const newDrawingNames = Object.keys(zip1.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !beforeDrawingNames.has(n));
  check(`${label}: exactly one new drawing part created`, newDrawingNames.length === 1, JSON.stringify(newDrawingNames));
  const rackDrawingPath = newDrawingNames[0];
  const rackDrawingXml = rackDrawingPath ? await zip1.file(rackDrawingPath)!.async("string") : "";
  check(`${label}: drawing anchored at K9 (col 10, row 8, 0-based)`, /<xdr:col>10<\/xdr:col>/.test(rackDrawingXml) && /<xdr:row>8<\/xdr:row>/.test(rackDrawingXml));
  check(`${label}: drawing preserves 2:1 aspect ratio (400x200 -> cx:cy = 2:1)`, (() => {
    const m = rackDrawingXml.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!m) return false;
    return Math.abs(Number(m[1]) / Number(m[2]) - 2) < 0.01;
  })());

  const mediaNames = Object.keys(zip1.files).filter(n => /^xl\/media\/image\d+\.png$/.test(n));
  check(`${label}: media file created`, mediaNames.length === 1, JSON.stringify(mediaNames));
  const mediaBytes = await zip1.file(mediaNames[0])!.async("nodebuffer");
  check(`${label}: embedded media bytes match the uploaded PNG exactly`, mediaBytes.equals(png1));

  const sheetName = "Rack Capacity";
  const contentTypesXml = await zip1.file("[Content_Types].xml")!.async("string");
  check(`${label}: Content_Types registers png default`, /<Default Extension="png"/.test(contentTypesXml));
  check(`${label}: Content_Types registers the drawing part`, contentTypesXml.includes(`PartName="/${rackDrawingPath}"`));

  // Sheet must reference the drawing, and worksheet must still parse via ExcelJS.
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.load(result1.buffer as unknown as ArrayBuffer);
  const ws1 = wb1.getWorksheet(sheetName)!;
  check(`${label}: workbook with embedded image still opens cleanly via ExcelJS`, Boolean(ws1));
  check(`${label}: Table7 data still intact after image embed`, ws1.getCell("B10").value !== null && ws1.getCell("B10").value !== undefined);

  const afterHashes1 = await unrelatedPartHashesExcludingRackDrawing(result1.buffer, new Set([rackDrawingPath]));
  const changedParts1 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes1[name]);
  check(`${label}: VBA/pivot/table/other-drawings untouched by first embed`, changedParts1.length === 0, changedParts1.join(", "));

  // ---- Second embed: replace (different image, different aspect ratio) ----
  const png2 = makeValidPng(100, 300, [40, 160, 90]);
  const result2 = await applyRackCapacityFieldChanges(result1.buffer, [], { bytes: png2, type: "png", width: 100, height: 300 });
  const zip2 = await JSZip.loadAsync(result2.buffer);
  const drawingNamesAfterReplace = Object.keys(zip2.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !beforeDrawingNames.has(n));
  check(`${label}: replace reuses the SAME drawing part (no duplicate)`, drawingNamesAfterReplace.length === 1 && drawingNamesAfterReplace[0] === rackDrawingPath, JSON.stringify(drawingNamesAfterReplace));
  const replacedDrawingXml = await zip2.file(rackDrawingPath)!.async("string");
  check(`${label}: replaced drawing now has the new 1:3 aspect ratio`, (() => {
    const m = replacedDrawingXml.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!m) return false;
    return Math.abs(Number(m[1]) / Number(m[2]) - 1 / 3) < 0.01;
  })());
  const mediaNamesAfterReplace = Object.keys(zip2.files).filter(n => /^xl\/media\/image\d+\.png$/.test(n));
  check(`${label}: old media file removed, exactly one media file remains after replace`, mediaNamesAfterReplace.length === 1, JSON.stringify(mediaNamesAfterReplace));
  const mediaBytes2 = await zip2.file(mediaNamesAfterReplace[0])!.async("nodebuffer");
  check(`${label}: replaced media bytes match the SECOND uploaded PNG, not the first`, mediaBytes2.equals(png2) && !mediaBytes2.equals(png1));

  const afterHashes2 = await unrelatedPartHashesExcludingRackDrawing(result2.buffer, new Set([rackDrawingPath]));
  const changedParts2 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes2[name]);
  check(`${label}: VBA/pivot/table/other-drawings untouched by replace`, changedParts2.length === 0, changedParts2.join(", "));

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(result2.buffer as unknown as ArrayBuffer);
  check(`${label}: workbook still opens cleanly via ExcelJS after replace`, Boolean(wb2.getWorksheet(sheetName)));

  // ---- Oversized image is downscaled but keeps aspect ratio, never distorted ----
  const png3 = makeValidPng(1600, 800, [10, 10, 200]);
  const result3 = await applyRackCapacityFieldChanges(result2.buffer, [], { bytes: png3, type: "png", width: 1600, height: 800 });
  const zip3 = await JSZip.loadAsync(result3.buffer);
  const drawingXml3 = await zip3.file(rackDrawingPath)!.async("string");
  const extMatch = drawingXml3.match(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/)!;
  const cx = Number(extMatch[1]);
  const cy = Number(extMatch[2]);
  check(`${label}: oversized 1600x800 image is downscaled (cx below the raw 1600px*9525 EMU)`, cx < 1600 * 9525);
  check(`${label}: downscaled image keeps the original 2:1 aspect ratio`, Math.abs(cx / cy - 2) < 0.01);
}

const workDir = path.resolve("dist-electron/test-work/rack-capacity-image");
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

console.log(failures === 0 ? "\nALL RACK CAPACITY IMAGE EMBED TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
