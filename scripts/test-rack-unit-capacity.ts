import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import {
  patchRackUnitCapacityBuffer,
  readRackUnitCapacityFromBuffer,
  readRackUnitCapacityImageFromBuffer,
  locateRackUnitCapacitySheet,
  deriveRackUnitCapacityRow,
  RACK_UNIT_CAPACITY_SHEET_NAME,
  RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME
} from "../src/excel/RackUnitCapacityWriter";
import { saveRackUnitCapacity } from "../src/excel/RackUnitCapacitySaveWriter";
import { resolveRelationshipTarget } from "../src/excel/ExcelZipUtils";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import zlib from "node:zlib";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function unrelatedPartHashes(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir && /vbaProject|pivotCache|pivotTables|charts\/chart|drawings/.test(name));
  const result: Record<string, string> = {};
  for (const name of names) result[name] = crypto.createHash("sha256").update(await zip.file(name)!.async("nodebuffer")).digest("hex");
  return result;
}

async function existingTableFilesAndIds(buffer: Buffer): Promise<{ files: Set<string>; ids: Set<string> }> {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Set(Object.keys(zip.files).filter(n => /^xl\/tables\/table\d+\.xml$/.test(n)));
  const ids = new Set<string>();
  for (const f of files) {
    const xml = await zip.file(f)!.async("string");
    const id = xml.match(/<table\b[^>]*\bid="([^"]*)"/)?.[1];
    if (id) ids.add(id);
  }
  return { files, ids };
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);
  const beforeHashes = await unrelatedPartHashes(original);
  const beforeTables = await existingTableFilesAndIds(original);

  check(`${label}: no Rack Unit Capacity sheet before first save`, (await readRackUnitCapacityFromBuffer(original)).length === 0);
  const zipBefore = await JSZip.loadAsync(original);
  check(`${label}: locateRackUnitCapacitySheet returns null before creation`, (await locateRackUnitCapacitySheet(zipBefore)) === null);

  // ---- First save: Dec 2025, Total 400 / Used 350 ----
  const result1 = await patchRackUnitCapacityBuffer(original, { month: "2025-12", totalU: 400, usedU: 350 });
  check(`${label}: first save actually changes the buffer`, !result1.equals(original));
  const zip1 = await JSZip.loadAsync(result1);
  const xmlPath1 = await locateRackUnitCapacitySheet(zip1);
  check(`${label}: sheet created and locatable`, xmlPath1 !== null);

  const workbookXml1 = await zip1.file("xl/workbook.xml")!.async("string");
  check(`${label}: workbook.xml registers the "${RACK_UNIT_CAPACITY_SHEET_NAME}" sheet`, workbookXml1.includes(`name="${RACK_UNIT_CAPACITY_SHEET_NAME}"`));

  const sheetXml1 = await zip1.file(xmlPath1!)!.async("string");
  const tableRelPath = xmlPath1!.match(/xl\/worksheets\/(sheet\d+)\.xml$/)![1];
  const sheetRelsXml = await zip1.file(`xl/worksheets/_rels/${tableRelPath}.xml.rels`)!.async("string");
  const tableTarget = sheetRelsXml.match(/Target="([^"]*table[^"]*)"/)?.[1];
  check(`${label}: worksheet has a table relationship`, Boolean(tableTarget));
  const tablePath = resolveRelationshipTarget("xl/worksheets", tableTarget!);
  check(`${label}: worksheet references its table part via <tableParts>`, /<tableParts count="1"><tablePart r:id="rId1"\/><\/tableParts>/.test(sheetXml1));

  const tableXmlText = await zip1.file(tablePath)!.async("string");
  check(`${label}: table displayName is "${RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME}"`, tableXmlText.includes(`displayName="${RACK_UNIT_CAPACITY_TABLE_DISPLAY_NAME}"`));
  check(`${label}: table has exactly 5 columns`, tableXmlText.includes('<tableColumns count="5">'));
  check(`${label}: column header "Month" present`, tableXmlText.includes('name="Month"'));
  check(`${label}: column header "Total (U)" spelled correctly`, tableXmlText.includes('name="Total (U)"'));
  check(`${label}: column header "Used (U)" spelled correctly`, tableXmlText.includes('name="Used (U)"'));
  check(`${label}: column header "Available (U)" spelled correctly (not "Avaliable")`, tableXmlText.includes('name="Available (U)"'));
  check(`${label}: no misspelled "Avaliable" anywhere in the table`, !tableXmlText.includes("Avaliable"));
  check(`${label}: column header "Availability Capacity (%)" spelled correctly (not "Avability")`, tableXmlText.includes('name="Availability Capacity (%)"'));
  check(`${label}: no misspelled "Avability" anywhere in the table`, !tableXmlText.includes("Avability"));
  check(`${label}: table ref matches the actual single-row data extent (A1:E2)`, /ref="A1:E2"/.test(tableXmlText));
  check(`${label}: table id is new, not colliding with an existing table`, !beforeTables.ids.has(tableXmlText.match(/<table\b[^>]*\bid="([^"]*)"/)?.[1] ?? "__none__"));

  // ---- Sheet header row + data row content ----
  const headerRow = sheetXml1.match(/<row r="1">([\s\S]*?)<\/row>/)?.[1] ?? "";
  check(`${label}: header row has exactly the 5 expected labels in order`, (() => {
    const texts = [...headerRow.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]);
    return JSON.stringify(texts) === JSON.stringify(["Month", "Total (U)", "Used (U)", "Available (U)", "Availability Capacity (%)"]);
  })());

  const monthCell = sheetXml1.match(/<c r="A2"([^>]*)><v>([^<]*)<\/v><\/c>/);
  check(`${label}: Month (A2) is a numeric Excel date, not inlineStr text`, Boolean(monthCell) && !sheetXml1.includes('<c r="A2" t="inlineStr"'));
  const monthStyleId = monthCell?.[1].match(/s="([^"]*)"/)?.[1];
  const stylesXml1 = await zip1.file("xl/styles.xml")!.async("string");
  const monthNumFmtId = stylesXml1.match(new RegExp(`<xf[^>]*numFmtId="(\\d+)"[^>]*/>(?=)`))?.[1]; // fallback, real check below
  check(`${label}: Month (A2) style formats as mmm-yy`, (() => {
    if (!monthStyleId) return false;
    const cellXfs = stylesXml1.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
    const xfNodes = [...cellXfs.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m => m[0]);
    const xf = xfNodes[Number(monthStyleId)];
    const numFmtId = xf?.match(/numFmtId="(\d+)"/)?.[1];
    const numFmts = stylesXml1.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/)?.[1] ?? "";
    return numFmts.includes(`numFmtId="${numFmtId}" formatCode="mmm-yy"`);
  })());
  void monthNumFmtId;

  const totalCell = sheetXml1.match(/<c r="B2"[^>]*><v>([^<]*)<\/v><\/c>/);
  const usedCell = sheetXml1.match(/<c r="C2"[^>]*><v>([^<]*)<\/v><\/c>/);
  const availCell = sheetXml1.match(/<c r="D2"[^>]*><v>([^<]*)<\/v><\/c>/);
  const pctCell = sheetXml1.match(/<c r="E2"([^>]*)><v>([^<]*)<\/v><\/c>/);
  check(`${label}: Total (U) = 400`, totalCell?.[1] === "400");
  check(`${label}: Used (U) = 350`, usedCell?.[1] === "350");
  check(`${label}: Available (U) = Total - Used = 50`, availCell?.[1] === "50");
  check(`${label}: Availability % is a 0-1 fraction (0.125), not 12.5`, pctCell?.[2] === "0.125");
  const pctStyleId = pctCell?.[1].match(/s="([^"]*)"/)?.[1];
  check(`${label}: Availability % style formats as 0.00%`, (() => {
    if (!pctStyleId) return false;
    const cellXfs = stylesXml1.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
    const xfNodes = [...cellXfs.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m => m[0]);
    const xf = xfNodes[Number(pctStyleId)];
    const numFmtId = xf?.match(/numFmtId="(\d+)"/)?.[1];
    const numFmts = stylesXml1.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/)?.[1] ?? "";
    return numFmts.includes(`numFmtId="${numFmtId}" formatCode="0.00%"`);
  })());

  // ---- Read-back API returns exactly what was written ----
  const rows1 = await readRackUnitCapacityFromBuffer(result1);
  check(`${label}: read-back has exactly 1 row`, rows1.length === 1);
  check(`${label}: read-back month is "2025-12"`, rows1[0]?.month === "2025-12");
  check(`${label}: read-back totalU/usedU/availableU/availabilityPct match`, rows1[0]?.totalU === 400 && rows1[0]?.usedU === 350 && rows1[0]?.availableU === 50 && Math.abs((rows1[0]?.availabilityPct ?? 0) - 0.125) < 1e-9);

  const afterHashes1 = await unrelatedPartHashes(result1);
  const changedParts1 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes1[name]);
  check(`${label}: VBA/pivot/other-drawings untouched by sheet creation`, changedParts1.length === 0, changedParts1.join(", "));

  // ---- Total = 0 leaves Availability % blank, not a divide-by-zero value ----
  const zeroRow = deriveRackUnitCapacityRow({ month: "2025-11", totalU: 0, usedU: 0 });
  check(`${label}: deriveRackUnitCapacityRow leaves Availability % null when Total is 0`, zeroRow.availabilityPct === null);
  check(`${label}: deriveRackUnitCapacityRow Available (U) is 0 when Total is 0`, zeroRow.availableU === 0);

  // ---- Re-saving the identical month/values is a true byte-identical no-op ----
  const result2 = await patchRackUnitCapacityBuffer(result1, { month: "2025-12", totalU: 400, usedU: 350 });
  check(`${label}: re-saving identical month/values is a byte-identical no-op`, result2.equals(result1));

  // ---- Editing the SAME month (upsert) updates in place, no duplicate row ----
  const result3 = await patchRackUnitCapacityBuffer(result1, { month: "2025-12", totalU: 420, usedU: 300 });
  const rows3 = await readRackUnitCapacityFromBuffer(result3);
  check(`${label}: upserting the same month still has exactly 1 row (no duplicate)`, rows3.length === 1);
  check(`${label}: upserted Dec-2025 row reflects the new Total/Used`, rows3[0]?.totalU === 420 && rows3[0]?.usedU === 300);
  check(`${label}: upserted Dec-2025 Available (U) recalculated (120)`, rows3[0]?.availableU === 120);
  const zip3 = await JSZip.loadAsync(result3);
  const tableXml3 = await zip3.file(tablePath)!.async("string");
  check(`${label}: table ref still matches the single-row extent after upsert (A1:E2)`, /ref="A1:E2"/.test(tableXml3));

  // ---- A new month appends without disturbing the prior month ----
  const result4 = await patchRackUnitCapacityBuffer(result3, { month: "2026-01", totalU: 420, usedU: 310 });
  const rows4 = await readRackUnitCapacityFromBuffer(result4);
  check(`${label}: new month appends - now 2 rows`, rows4.length === 2);
  const dec4 = rows4.find(r => r.month === "2025-12");
  const jan4 = rows4.find(r => r.month === "2026-01");
  check(`${label}: December's row survives the January save untouched`, dec4?.totalU === 420 && dec4?.usedU === 300 && dec4?.availableU === 120);
  check(`${label}: January's new row is present with its own data`, jan4?.totalU === 420 && jan4?.usedU === 310 && jan4?.availableU === 110);
  const zip4 = await JSZip.loadAsync(result4);
  const tableXml4 = await zip4.file(tablePath)!.async("string");
  check(`${label}: table ref extends to A1:E3 after the second month is added`, /ref="A1:E3"/.test(tableXml4));
  check(`${label}: autoFilter ref also extends to A1:E3`, /<autoFilter ref="A1:E3"\/>/.test(tableXml4));

  const afterHashes4 = await unrelatedPartHashes(result4);
  const changedParts4 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes4[name]);
  check(`${label}: VBA/pivot/other-drawings still untouched after multiple saves`, changedParts4.length === 0, changedParts4.join(", "));

  const finalZip = await JSZip.loadAsync(result4);
  const finalWb = await finalZip.file("xl/workbook.xml")!.async("string");
  check(`${label}: exactly one "${RACK_UNIT_CAPACITY_SHEET_NAME}" sheet registered (idempotent creation)`, (finalWb.match(new RegExp(`name="${RACK_UNIT_CAPACITY_SHEET_NAME}"`, "g")) ?? []).length === 1);
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

/** End-to-end: the full lock-check -> backup -> atomic-write -> re-read
 *  pipeline against a real file on disk, mirroring saveRackCapacityFieldChanges's
 *  own end-to-end coverage in test-rack-capacity-history.ts. */
async function testFullSavePipeline(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label}: FULL SAVE PIPELINE =====`);
  const backupDir = path.join(path.dirname(sourcePath), `backup-unit-capacity-${label.toLowerCase()}`);

  const save1 = await saveRackUnitCapacity(sourcePath, { month: "2026-03", totalU: 500, usedU: 420 }, { backupDir, backupKeep: 3 });
  check(`${label}: first real save produces a backup`, typeof save1.backupPath === "string" && save1.backupPath.length > 0);
  check(`${label}: first real save reports the new row`, save1.rows.some(r => r.month === "2026-03" && r.totalU === 500 && r.usedU === 420 && r.availableU === 80));
  const onDiskAfter1 = await readRackUnitCapacityFromBuffer(await fs.readFile(sourcePath));
  check(`${label}: the row is genuinely persisted on disk (re-read from the real file)`, onDiskAfter1.some(r => r.month === "2026-03" && r.totalU === 500));

  const save2 = await saveRackUnitCapacity(sourcePath, { month: "2026-03", totalU: 500, usedU: 420 }, { backupDir, backupKeep: 3 });
  check(`${label}: re-saving identical Total/Used is a no-op (no backup created)`, save2.backupPath === null);

  const png = makeValidPng(300, 150, [50, 120, 200]);
  const save3 = await saveRackUnitCapacity(
    sourcePath,
    { month: "2026-04", totalU: 500, usedU: 350 },
    { backupDir, backupKeep: 3 },
    { bytes: png, type: "png", width: 300, height: 150 }
  );
  check(`${label}: a save combining a new month AND an image reports both`, save3.imageEmbedded === true && save3.rows.some(r => r.month === "2026-04" && r.availableU === 150));
  check(`${label}: combined save also produces a backup`, typeof save3.backupPath === "string" && save3.backupPath.length > 0);
  const finalRows = await readRackUnitCapacityFromBuffer(await fs.readFile(sourcePath));
  check(`${label}: March's row survives the April+image save untouched`, finalRows.some(r => r.month === "2026-03" && r.totalU === 500 && r.usedU === 420));
  const finalZip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const sheetPath = await locateRackUnitCapacitySheet(finalZip);
  const sheetFile = sheetPath!.match(/xl\/worksheets\/(sheet\d+)\.xml$/)![1];
  const relsXml = await finalZip.file(`xl/worksheets/_rels/${sheetFile}.xml.rels`)!.async("string");
  check(`${label}: the sheet has a drawing relationship after the combined save`, /Type="[^"]*\/drawing"/.test(relsXml));

  const readBackImage = await readRackUnitCapacityImageFromBuffer(await fs.readFile(sourcePath));
  check(`${label}: readRackUnitCapacityImageFromBuffer finds the embedded image`, readBackImage !== null);
  check(`${label}: read-back image bytes are byte-identical to what was uploaded`, readBackImage?.bytes.equals(png) === true);
  check(`${label}: read-back image mimeType is image/png`, readBackImage?.mimeType === "image/png");

  // ---- PDF rendering: the "data present" path (test-all-report.ts only
  // covers the "not yet available" path, since production workbooks have no
  // Rack Unit Capacity data yet) ----
  const reportData = await buildReportData({ workbookPath: sourcePath, facility: label, selectedMonth: null, appVersion: "test" });
  const html = buildReportHtml(reportData);
  check(`${label}: PDF shows the renamed "Rack Capacity and Utilization" heading`, html.includes("<h2>Rack Capacity and Utilization</h2>"));
  check(`${label}: PDF Rack Unit Capacity block shows Total (U) = 500`, /Total \(U\)[\s\S]{0,80}500/.test(html));
  check(`${label}: PDF Rack Unit Capacity block shows the latest month's Used (U) = 350`, /Used \(U\)[\s\S]{0,80}350/.test(html));
  check(`${label}: PDF Rack Unit Capacity block shows the latest month's Available (U) = 150`, /Available \(U\)[\s\S]{0,80}150/.test(html));
  check(`${label}: PDF embeds the Rack Unit Capacity Image as a data URI`, /<img src="data:image\/png;base64,[^"]+" alt="Rack Unit Capacity Image" class="rack-unit-capacity-image"\/>/.test(html));
  check(`${label}: PDF Rack Unit Capacity trend page renders (2 months of data)`, /class="page trend-page"[^>]*>\s*<h2>Rack Unit Capacity Availability % Trend<\/h2>|Rack Unit Capacity Availability % Trend/.test(html));
  check(`${label}: PDF does not show the "not yet available" note once data exists`, !html.includes("Rack Unit Capacity data is not yet available"));

  await fs.rm(backupDir, { recursive: true, force: true });
}

const workDir = path.resolve("dist-electron/test-work/rack-unit-capacity");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
const rangsitCopy = path.join(workDir, "DC_Rangsit.xlsm");
const srinakarinCopy = path.join(workDir, "DC_Srinakarin.xlsm");
await fs.copyFile(path.resolve("DC_Rangsit.xlsm"), rangsitCopy);
await fs.copyFile(path.resolve("DC_Srinakarin.xlsm"), srinakarinCopy);
const rangsitPipelineCopy = path.join(workDir, "DC_Rangsit_pipeline.xlsm");
const srinakarinPipelineCopy = path.join(workDir, "DC_Srinakarin_pipeline.xlsm");
await fs.copyFile(path.resolve("DC_Rangsit.xlsm"), rangsitPipelineCopy);
await fs.copyFile(path.resolve("DC_Srinakarin.xlsm"), srinakarinPipelineCopy);

const prodHashBefore = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};

await testFacility("RANGSIT", rangsitCopy);
await testFacility("SRINAKARIN", srinakarinCopy);
await testFullSavePipeline("RANGSIT", rangsitPipelineCopy);
await testFullSavePipeline("SRINAKARIN", srinakarinPipelineCopy);

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK UNIT CAPACITY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
