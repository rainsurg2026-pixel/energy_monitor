/**
 * Migration test: seeds a workbook with every legacy Excel-embedded Rack
 * Unit Capacity image mechanism this app has ever shipped (pre-v2.2.3 "Rack
 * Capacity" K9 slot, v2.2.3-v2.2.4 "Rack Unit Capacity" K9 slot, v2.2.5
 * per-(Facility, Month) "Rack Unit Capacity Img History" sheet), then
 * verifies migrateRackUnitCapacityImagesToFilesystem extracts every one of
 * them onto the filesystem ImageStorageProvider, verified by checksum, and
 * removes all three legacy mechanisms from the workbook - while every
 * unrelated part (VBA/pivot/tables/other drawings) stays byte-identical.
 *
 * Production workbooks currently have none of these legacy mechanisms (see
 * DC_Rangsit.xlsm/DC_Srinakarin.xlsm diagnostics run during development),
 * so this hand-seeds the pre-migration state directly at the zip level -
 * the only way to exercise extraction correctness before it ever meets
 * real field data.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import JSZip from "jszip";
import { locateSheetXmlPathByName, getAttr, entryText } from "../src/excel/ExcelZipUtils";
import { migrateRackUnitCapacityImagesToFilesystem } from "../src/excel/RackUnitCapacityImageMigration";
import { ensureRackUnitCapacitySheet } from "../src/excel/RackUnitCapacityWriter";
import * as ImageStorageProvider from "../src/storage/ImageStorageProvider";

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

const EMU_PER_PX = 9525;

/** Seeds a single K9-anchored image on a named sheet - the shape both the
 *  pre-v2.2.3 "Rack Capacity" slot and the v2.2.3-v2.2.4 "Rack Unit
 *  Capacity" slot used. */
async function seedK9Image(zip: JSZip, sheetName: string, png: Buffer, width: number, height: number): Promise<void> {
  const sheetPath = await locateSheetXmlPathByName(zip, sheetName);
  if (!sheetPath) throw new Error(`Sheet not found: ${sheetName}`);
  const sheetFile = sheetPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  let relsXml = (await entryText(zip, relsPath)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const mediaIndex = Math.max(0, ...Object.keys(zip.files).map(n => Number(n.match(/^xl\/media\/image(\d+)\./)?.[1] ?? 0))) + 1;
  const drawingIndex = Math.max(0, ...Object.keys(zip.files).map(n => Number(n.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1] ?? 0))) + 1;
  const mediaPath = `xl/media/image${mediaIndex}.png`;
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
  const cx = width * EMU_PER_PX;
  const cy = height * EMU_PER_PX;

  zip.file(mediaPath, png);
  zip.file(
    drawingPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<xdr:oneCellAnchor><xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>` +
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Legacy Image"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
  );
  zip.file(
    drawingRelsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.png"/></Relationships>`
  );

  const existingRelIds = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].map(m => Number(getAttr(m[1], "Id")?.replace("rId", "") ?? 0)).filter(Number.isFinite);
  const newRid = `rId${(existingRelIds.length > 0 ? Math.max(...existingRelIds) : 0) + 1}`;
  relsXml = relsXml.replace(/<\/Relationships>/, `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`);
  zip.file(relsPath, relsXml);

  const sheetXml = (await entryText(zip, sheetPath))!;
  const drawingEl = `<drawing r:id="${newRid}"/>`;
  zip.file(sheetPath, /<tableParts\b/.test(sheetXml) ? sheetXml.replace(/<tableParts\b/, `${drawingEl}<tableParts`) : sheetXml.replace("</worksheet>", `${drawingEl}</worksheet>`));

  const contentTypesXml = (await entryText(zip, "[Content_Types].xml"))!;
  let patched = contentTypesXml;
  if (!/<Default\b[^>]*Extension="png"/.test(patched)) patched = patched.replace(/<\/Types>/, `<Default Extension="png" ContentType="image/png"/></Types>`);
  patched = patched.replace(/<\/Types>/, `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file("[Content_Types].xml", patched);
}

interface SeedHistoryRow {
  reportingMonth: string;
  facility: string;
  timestamp: string;
  user: string;
  png: Buffer;
  width: number;
  height: number;
}

/** Seeds the v2.2.5 "Rack Unit Capacity Img History" sheet with N rows, each
 *  with its own anchored image in one shared drawing part - the exact shape
 *  RackUnitCapacityImageHistoryWriter.ts's (now-removed) write path used to
 *  produce, reconstructed here only for test fixture purposes. */
async function seedHistorySheet(zip: JSZip, rows: SeedHistoryRow[]): Promise<void> {
  const workbookXml = (await entryText(zip, "xl/workbook.xml"))!;
  const relsXml = (await entryText(zip, "xl/_rels/workbook.xml.rels"))!;
  const contentTypesXml = (await entryText(zip, "[Content_Types].xml"))!;

  const existingSheetIndexes = Object.keys(zip.files).map(n => Number(n.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1] ?? 0)).filter(Boolean);
  const nextSheetIndex = Math.max(0, ...existingSheetIndexes) + 1;
  const newSheetPath = `xl/worksheets/sheet${nextSheetIndex}.xml`;
  const nextSheetId = Math.max(0, ...[...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)].map(m => Number(getAttr(m[1], "sheetId") ?? 0))) + 1;
  const nextRelId = Math.max(0, ...[...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].map(m => Number(getAttr(m[1], "Id")?.replace("rId", "") ?? 0))) + 1;
  const newRid = `rId${nextRelId}`;

  const headerCells = ["ReportingMonth", "Facility", "Timestamp", "User", "MimeType", "DataVersion"]
    .map((h, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${h}</t></is></c>`)
    .join("");
  const dataRows = rows
    .map((row, idx) => {
      const r = idx + 2;
      const cells = [row.reportingMonth, row.facility, row.timestamp, row.user, "image/png"]
        .map((v, i) => `<c r="${String.fromCharCode(65 + i)}${r}" t="inlineStr"><is><t>${v}</t></is></c>`)
        .join("");
      return `<row r="${r}">${cells}<c r="F${r}"><v>1</v></c></row>`;
    })
    .join("");

  zip.file(
    newSheetPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<dimension ref="A1:F${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
      `<sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData></worksheet>`
  );
  zip.file("xl/workbook.xml", workbookXml.replace(/<\/sheets>/, `<sheet name="Rack Unit Capacity Img History" sheetId="${nextSheetId}" r:id="${newRid}"/></sheets>`));
  zip.file("xl/_rels/workbook.xml.rels", relsXml.replace(/<\/Relationships>/, `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetIndex}.xml"/></Relationships>`));
  zip.file("[Content_Types].xml", contentTypesXml.replace(/<\/Types>/, `<Override PartName="/${newSheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));

  // Drawing part shared by every row, one anchor per row (FIRST_ANCHOR_ROW=8, ANCHOR_ROW_STEP=20).
  const drawingIndex = Math.max(0, ...Object.keys(zip.files).map(n => Number(n.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1] ?? 0))) + 1;
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
  let mediaIndex = Math.max(0, ...Object.keys(zip.files).map(n => Number(n.match(/^xl\/media\/image(\d+)\./)?.[1] ?? 0))) + 1;
  const anchors: string[] = [];
  const drawingRels: string[] = [];
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const anchorRow = 8 + (rowNumber - 2) * 20;
    const mediaPath = `xl/media/image${mediaIndex}.png`;
    zip.file(mediaPath, row.png);
    const rid = `rId${idx + 1}`;
    drawingRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaIndex}.png"/>`);
    const cx = row.width * EMU_PER_PX;
    const cy = row.height * EMU_PER_PX;
    anchors.push(
      `<xdr:oneCellAnchor><xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${idx + 1}" name="Rack Unit Capacity Image ${idx + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
    );
    mediaIndex++;
  });
  zip.file(drawingPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join("")}</xdr:wsDr>`);
  zip.file(drawingRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join("")}</Relationships>`);

  const newSheetRelsPath = `xl/worksheets/_rels/sheet${nextSheetIndex}.xml.rels`;
  zip.file(newSheetRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`);
  const sheetXml = (await entryText(zip, newSheetPath))!;
  zip.file(newSheetPath, sheetXml.replace("</worksheet>", `<drawing r:id="rIdDrawing"/></worksheet>`));

  const contentTypes2 = (await entryText(zip, "[Content_Types].xml"))!;
  zip.file("[Content_Types].xml", contentTypes2.replace(/<\/Types>/, `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`));
}

async function unrelatedPartHashes(buffer: Buffer, excludePatterns: RegExp[]): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir && /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables/.test(name) && !excludePatterns.some(p => p.test(name)));
  const result: Record<string, string> = {};
  for (const name of names) result[name] = crypto.createHash("sha256").update(await zip.file(name)!.async("nodebuffer")).digest("hex");
  return result;
}

async function testFacility(label: string, sourcePath: string, imagesRootDir: string, backupDir: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);

  // ---- No-op idempotency: nothing legacy present ----
  const noopResult = await migrateRackUnitCapacityImagesToFilesystem(sourcePath, label, imagesRootDir, { backupDir, backupKeep: 3 });
  check(`${label}: migrating a clean workbook is a true no-op`, noopResult.migrated === false && noopResult.backupPath === null);

  // ---- Seed all three legacy mechanisms ----
  const rackCapacityPng = makeValidPng(120, 80, [10, 10, 200]);
  const legacySlotPng = makeValidPng(150, 90, [200, 100, 10]);
  const historyPng1 = makeValidPng(300, 150, [50, 150, 50]);
  const historyPng2 = makeValidPng(220, 110, [150, 50, 150]);

  let zip = await JSZip.loadAsync(original);
  await ensureRackUnitCapacitySheet(zip); // "Rack Unit Capacity" doesn't exist until first Total/Used save
  await seedK9Image(zip, "Rack Capacity", rackCapacityPng, 120, 80);
  await seedK9Image(zip, "Rack Unit Capacity", legacySlotPng, 150, 90);
  await seedHistorySheet(zip, [
    { reportingMonth: "2026-01", facility: label, timestamp: "2026-01-15T10:00:00.000Z", user: "old-user-1", png: historyPng1, width: 300, height: 150 },
    { reportingMonth: "2026-02", facility: label, timestamp: "2026-02-15T10:00:00.000Z", user: "old-user-2", png: historyPng2, width: 220, height: 110 }
  ]);
  const seeded = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;
  await fs.writeFile(sourcePath, seeded);

  const beforeHashes = await unrelatedPartHashes(seeded, [/^xl\/drawings\//, /^xl\/media\//, /^xl\/worksheets\/sheet\d+\.xml$/]);

  // ---- Run the migration ----
  const result = await migrateRackUnitCapacityImagesToFilesystem(sourcePath, label, imagesRootDir, { backupDir, backupKeep: 3 });
  check(`${label}: migration reports migrated=true`, result.migrated === true);
  check(`${label}: migration produces a backup`, typeof result.backupPath === "string" && result.backupPath.length > 0);
  check(`${label}: migration reports 2 history rows migrated`, result.historyRowsMigrated === 2);
  check(`${label}: migration reports 2 orphans recovered (both legacy K9 slots)`, result.orphansRecovered === 2);
  check(`${label}: migration reports the history sheet was removed`, result.removedHistorySheet === true);
  check(`${label}: migration reports the legacy Rack Capacity K9 slot was removed`, result.removedLegacyRackCapacityK9 === true);
  check(`${label}: migration reports the legacy Rack Unit Capacity K9 slot was removed`, result.removedLegacyRackUnitCapacityK9 === true);

  // ---- Filesystem: every history row landed, verified by checksum ----
  const jan = await ImageStorageProvider.loadImage(imagesRootDir, label, "2026-01");
  const feb = await ImageStorageProvider.loadImage(imagesRootDir, label, "2026-02");
  check(`${label}: January's history image migrated with byte-identical bytes`, jan?.bytes.equals(historyPng1) === true);
  check(`${label}: January's checksum matches a fresh sha256 of the bytes`, jan?.checksum === crypto.createHash("sha256").update(historyPng1).digest("hex"));
  check(`${label}: January's savedBy preserves the original user`, jan?.savedBy === "old-user-1");
  check(`${label}: February's history image migrated with byte-identical bytes`, feb?.bytes.equals(historyPng2) === true);
  check(`${label}: February's savedBy preserves the original user`, feb?.savedBy === "old-user-2");

  // ---- Orphans: legacy K9 slots preserved under a distinct, obviously-not-a-real-month filename ----
  const facilityDir = path.join(imagesRootDir, label);
  const files = await fs.readdir(facilityDir);
  const orphanFiles = files.filter(f => f.startsWith("RUC-legacy-orphan-") && !f.endsWith(".json"));
  check(`${label}: exactly 2 orphan files recovered`, orphanFiles.length === 2);
  const orphanBytesSets = await Promise.all(orphanFiles.map(f => fs.readFile(path.join(facilityDir, f))));
  check(`${label}: one orphan is byte-identical to the legacy Rack Capacity image`, orphanBytesSets.some(b => b.equals(rackCapacityPng)));
  check(`${label}: one orphan is byte-identical to the legacy Rack Unit Capacity K9 image`, orphanBytesSets.some(b => b.equals(legacySlotPng)));

  // ---- Workbook: every legacy mechanism actually gone ----
  const migratedBuffer = await fs.readFile(sourcePath);
  const migratedZip = await JSZip.loadAsync(migratedBuffer);
  const historySheetPath = await locateSheetXmlPathByName(migratedZip, "Rack Unit Capacity Img History");
  check(`${label}: "Rack Unit Capacity Img History" sheet no longer exists`, historySheetPath === null);
  const rackCapacitySheetPath = (await locateSheetXmlPathByName(migratedZip, "Rack Capacity"))!;
  const rackCapacitySheetXml = await migratedZip.file(rackCapacitySheetPath)!.async("string");
  check(`${label}: "Rack Capacity" sheet no longer references a <drawing>`, !/<drawing\b/.test(rackCapacitySheetXml));
  const rackUnitCapacitySheetPath = (await locateSheetXmlPathByName(migratedZip, "Rack Unit Capacity"))!;
  const rackUnitCapacitySheetXml = await migratedZip.file(rackUnitCapacitySheetPath)!.async("string");
  check(`${label}: "Rack Unit Capacity" sheet no longer references a <drawing>`, !/<drawing\b/.test(rackUnitCapacitySheetXml));

  // ---- Everything else byte-identical (VBA/pivots/tables untouched) ----
  const afterHashes = await unrelatedPartHashes(migratedBuffer, [/^xl\/drawings\//, /^xl\/media\//, /^xl\/worksheets\/sheet\d+\.xml$/]);
  const changed = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes[name]);
  check(`${label}: VBA/pivot/table parts untouched by migration`, changed.length === 0, changed.join(", "));

  // ---- Idempotency: running migration again on the already-migrated file is a true no-op ----
  const secondResult = await migrateRackUnitCapacityImagesToFilesystem(sourcePath, label, imagesRootDir, { backupDir, backupKeep: 3 });
  check(`${label}: second migration run is a no-op (nothing left to migrate)`, secondResult.migrated === false && secondResult.backupPath === null);
  const afterSecondRun = await fs.readFile(sourcePath);
  check(`${label}: second migration run never touches the file on disk`, migratedBuffer.equals(afterSecondRun));
}

const workDir = path.resolve("dist-electron/test-work/rack-unit-image-migration");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
const rangsitCopy = path.join(workDir, "DC_Rangsit.xlsm");
const srinakarinCopy = path.join(workDir, "DC_Srinakarin.xlsm");
await fs.copyFile(path.resolve("DC_Rangsit.xlsm"), rangsitCopy);
await fs.copyFile(path.resolve("DC_Srinakarin.xlsm"), srinakarinCopy);
const imagesRootDir = path.join(workDir, "rack-unit-images");
const backupDir = path.join(workDir, "backup");

const prodHashBefore = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};

await testFacility("Rangsit", rangsitCopy, imagesRootDir, backupDir);
await testFacility("Srinakarin", srinakarinCopy, imagesRootDir, backupDir);

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK UNIT IMAGE MIGRATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
