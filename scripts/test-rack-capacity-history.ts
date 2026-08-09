import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import {
  patchRackCapacityHistoryBuffer,
  readRackCapacityHistoryFromBuffer,
  locateRackCapacityHistorySheet,
  migrateRackCapacityHistoryFormats,
  RACK_CAPACITY_HISTORY_SHEET_NAME,
  RACK_CAPACITY_HISTORY_TOTAL_ZONE,
  rackCapacityHistoryRowsFromMetrics
} from "../src/excel/RackCapacityHistoryWriter";
import { saveRackCapacityFieldChanges } from "../src/excel/RackCapacityWriter";
import { calculateRackCapacityMetrics } from "../src/utils/rackCapacity";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function historyKey(row: { facility: string; snapshotMonth: string; rackZone: string }): string {
  return `${row.facility.toLowerCase()}|${row.snapshotMonth}|${row.rackZone.toLowerCase()}`;
}

async function unrelatedPartHashes(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir && /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables|drawings/.test(name));
  const result: Record<string, string> = {};
  for (const name of names) result[name] = crypto.createHash("sha256").update(await zip.file(name)!.async("nodebuffer")).digest("hex");
  return result;
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);
  const beforeHashes = await unrelatedPartHashes(original);

  const existingHistory = await readRackCapacityHistoryFromBuffer(original);
  const existingHistoryKeys = new Set(existingHistory.map(historyKey));
  check(`${label}: any pre-existing History rows are readable`, existingHistory.every(row => row.snapshotMonth.length === 7 && row.facility.length > 0));

  const rack = await readRackCapacityFromBuffer(original);
  const metrics = calculateRackCapacityMetrics(rack!.records);

  // ---- First save: January snapshot ----
  const buffer1 = await patchRackCapacityHistoryBuffer(original, label.toLowerCase(), "2026-01", metrics);
  const rows1 = await readRackCapacityHistoryFromBuffer(buffer1);
  const januaryRows = rackCapacityHistoryRowsFromMetrics(label.toLowerCase(), "2026-01", metrics, new Date(0).toISOString());
  const januaryNewCount = januaryRows.filter(row => !existingHistoryKeys.has(historyKey(row))).length;
  const expectedRowsAfterJanuary = existingHistory.length + januaryNewCount;
  check(`${label}: first save retains history and adds one row per zone + one (Total) row`, rows1.length === expectedRowsAfterJanuary, `${rows1.length} vs expected ${expectedRowsAfterJanuary}`);
  const totalRow1 = rows1.find(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: (Total) row totalRacks matches facility total`, totalRow1?.totalRacks === metrics.total);
  check(`${label}: (Total) row inUse matches metrics`, totalRow1?.inUse === metrics.inUse.count);
  check(`${label}: (Total) row usagePct is a 0-1 fraction, not 0-100`, (totalRow1?.usagePct ?? 0) <= 1);
  const januaryResultRows = rows1.filter(row => januaryRows.some(incoming => historyKey(incoming) === historyKey(row)));
  check(`${label}: saved January rows are tagged with the right facility`, januaryResultRows.every(r => r.facility === label.toLowerCase()));
  check(`${label}: saved January rows are tagged with the right month`, januaryResultRows.every(r => r.snapshotMonth === "2026-01"));
  const zoneWithData = metrics.zoneMetrics[0];
  const zoneRow1 = rows1.find(r => r.snapshotMonth === "2026-01" && r.rackZone === zoneWithData.zone);
  check(`${label}: a real zone row's counts match calculateRackCapacityMetrics exactly (single authoritative calculation)`, zoneRow1?.inUse === zoneWithData.inUse.count && zoneRow1?.available === zoneWithData.available.count);

  const sheetExists = await (async () => {
    const zip = await JSZip.loadAsync(buffer1);
    const wbXml = await zip.file("xl/workbook.xml")!.async("string");
    return wbXml.includes(RACK_CAPACITY_HISTORY_SHEET_NAME);
  })();
  check(`${label}: workbook.xml registers the "${RACK_CAPACITY_HISTORY_SHEET_NAME}" sheet`, sheetExists);

  // ---- v2.2.3: Month must be a REAL Excel date (mmm-yy), never text; percentages must carry a real 0.00% style ----
  await (async () => {
    const zip = await JSZip.loadAsync(buffer1);
    const sheetPath = await locateRackCapacityHistorySheet(zip);
    const sheetXml = await zip.file(sheetPath!)!.async("string");
    const stylesXml = await zip.file("xl/styles.xml")!.async("string");
    const numFmtFor = (styleId: string): string | undefined => {
      const cellXfs = stylesXml.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)![1];
      const xfNodes = [...cellXfs.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m => m[0]);
      const numFmtId = xfNodes[Number(styleId)]?.match(/numFmtId="(\d+)"/)?.[1];
      // Scoped strictly to the real <numFmts> registry, NOT a document-wide
      // scan - styles.xml also has <numFmt> entries nested inside <dxfs>
      // (conditional-formatting records), a separate id-numbering context.
      // A document-wide Map here would let a dxf-scoped duplicate silently
      // stand in for the genuine cellXfs numFmt, masking exactly the
      // corruption this check exists to catch (see ExcelZipUtils.ts's
      // ensureExactCellFormatStyles for the real-world case that proved it:
      // DC_Rangsit.xlsm has a dxf-scoped numFmtId="14" formatCode="0.00%",
      // while 14 is actually Excel's builtin "m/d/yyyy").
      const numFmtsContainer = stylesXml.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/)?.[1] ?? "";
      const numFmts = new Map([...numFmtsContainer.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)].map(m => [m[1], m[2]]));
      return numFmts.get(numFmtId ?? "");
    };
    // Row 2 is the first data row (row 1 is the header).
    const row2 = sheetXml.match(/<row r="2"[^>]*>([\s\S]*?)<\/row>/)![1];
    const cellA2 = row2.match(/<c\b(?=[^>]*\br="A2")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)![0];
    check(`${label}: History Month (A2) is a numeric Excel date, not inlineStr text`, !/t="inlineStr"/.test(cellA2) && /<v>\d+<\/v>/.test(cellA2));
    const monthStyleId = cellA2.match(/\bs="(\d+)"/)?.[1];
    check(`${label}: History Month (A2) style formats as mmm-yy`, monthStyleId !== undefined && numFmtFor(monthStyleId) === "mmm-yy");
    const cellJ2 = row2.match(/<c\b(?=[^>]*\br="J2")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)![0]; // UsagePct = column J (10th)
    const usagePctStyleId = cellJ2.match(/\bs="(\d+)"/)?.[1];
    check(`${label}: History UsagePct (J2) style formats as 0.00%`, usagePctStyleId !== undefined && numFmtFor(usagePctStyleId) === "0.00%");
    const cellK2 = row2.match(/<c\b(?=[^>]*\br="K2")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)![0]; // AvailabilityPct = column K (11th)
    const availPctStyleId = cellK2.match(/\bs="(\d+)"/)?.[1];
    check(`${label}: History AvailabilityPct (K2) style formats as 0.00%`, availPctStyleId !== undefined && numFmtFor(availPctStyleId) === "0.00%");
    check(`${label}: History percentage value is still a 0-1 fraction on disk (not pre-multiplied by 100)`, Number(cellJ2.match(/<v>([\d.]+)<\/v>/)?.[1]) <= 1);
  })();

  const afterHashes1 = await unrelatedPartHashes(buffer1);
  const changed1 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes1[name]);
  check(`${label}: VBA/pivot/table/chart/drawing parts untouched by history creation`, changed1.length === 0, changed1.join(", "));

  // ---- Second save: same month, IDENTICAL data -> true no-op ----
  const buffer2 = await patchRackCapacityHistoryBuffer(buffer1, label.toLowerCase(), "2026-01", metrics);
  check(`${label}: re-saving identical month/data is a byte-identical no-op`, Buffer.compare(buffer1, buffer2) === 0);

  // ---- Third save: same month, CHANGED data -> updates in place, no duplicate row ----
  const changedMetrics = calculateRackCapacityMetrics([
    ...rack!.records.slice(0, -1),
    { ...rack!.records.at(-1)!, status: rack!.records.at(-1)!.status === "Available" ? "Reserved" : "Available" }
  ]);
  const buffer3 = await patchRackCapacityHistoryBuffer(buffer1, label.toLowerCase(), "2026-01", changedMetrics);
  const rows3 = await readRackCapacityHistoryFromBuffer(buffer3);
  check(`${label}: updated month does not create a duplicate row`, rows3.length === expectedRowsAfterJanuary, String(rows3.length));
  const totalRow3 = rows3.find(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: updated month's (Total) row reflects the new counts`, totalRow3?.totalRacks === changedMetrics.total);

  // ---- Fourth save: a DIFFERENT month -> appends, never overwrites Jan ----
  const buffer4 = await patchRackCapacityHistoryBuffer(buffer3, label.toLowerCase(), "2026-02", metrics);
  const rows4 = await readRackCapacityHistoryFromBuffer(buffer4);
  const februaryRows = rackCapacityHistoryRowsFromMetrics(label.toLowerCase(), "2026-02", metrics, new Date(0).toISOString());
  const februaryNewCount = februaryRows.filter(row => !existingHistoryKeys.has(historyKey(row)) && !januaryRows.some(january => historyKey(january) === historyKey(row))).length;
  const expectedRowsAfterFebruary = expectedRowsAfterJanuary + februaryNewCount;
  check(`${label}: a new month appends rows without touching the prior month`, rows4.length === expectedRowsAfterFebruary, String(rows4.length));
  const janStillThere = rows4.find(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: January's (updated) snapshot survives the February save untouched`, janStillThere?.totalRacks === changedMetrics.total);
  const febRow = rows4.find(r => r.snapshotMonth === "2026-02" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: February row present with its own data`, febRow?.totalRacks === metrics.total);

  const afterHashes4 = await unrelatedPartHashes(buffer4);
  const changed4 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes4[name]);
  check(`${label}: VBA/pivot/table/chart/drawing parts still untouched after multiple history saves`, changed4.length === 0, changed4.join(", "));

  // ---- No fake backfill: this module never invents months on its own ----
  const newlyAddedRows = rows4.filter(row => !existingHistoryKeys.has(historyKey(row)));
  check(`${label}: only explicitly saved months are added (no auto-backfilled history)`, newlyAddedRows.every(row => row.snapshotMonth === "2026-01" || row.snapshotMonth === "2026-02") && newlyAddedRows.length === januaryNewCount + februaryNewCount);

  // ---- End-to-end: a real Table7 status Save auto-creates a history snapshot ----
  const backupDir = path.join(path.dirname(sourcePath), `backup-${label.toLowerCase()}`);
  const target = rack!.records.find(r => r.rackId && r.status)!;
  const otherStatus = target.status === "Available" ? "Reserved" : "Available";
  const saveResult = await saveRackCapacityFieldChanges(
    sourcePath,
    [{ rowNumber: target.rowNumber, rackId: target.rackId!, status: { expected: target.status, next: otherStatus } }],
    { backupDir, backupKeep: 3 },
    label.toLowerCase()
  );
  check(`${label}: real Save produces a non-empty history snapshot end-to-end`, saveResult.rackCapacityHistory.length > 0);
  const e2eMonths = new Set(saveResult.rackCapacityHistory.map(r => r.snapshotMonth));
  check(`${label}: end-to-end snapshot month looks like a real YYYY-MM (from Dashboard-FAC!H1, not fabricated)`, [...e2eMonths].every((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)));
  check(`${label}: end-to-end save did not duplicate the (Total) row for its month`, saveResult.rackCapacityHistory.filter(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE && e2eMonths.has(r.snapshotMonth)).length === e2eMonths.size);

  // ---- v2.2.3: an explicit snapshotMonth (the Editor's own Month/Year
  // selector) must override the auto-detected system month, not just fall
  // back to it silently ----
  const autoDetectedMonth = [...e2eMonths][0]!;
  const explicitMonth = autoDetectedMonth.startsWith("2099") ? "2098-06" : "2099-06"; // guaranteed to differ from the real auto-detected month
  const target2 = rack!.records.find(r => r.rackId && r.status && r.rowNumber !== target.rowNumber)!;
  const otherStatus2 = target2.status === "Available" ? "Reserved" : "Available";
  const explicitSaveResult = await saveRackCapacityFieldChanges(
    sourcePath,
    [{ rowNumber: target2.rowNumber, rackId: target2.rackId!, status: { expected: target2.status, next: otherStatus2 } }],
    { backupDir, backupKeep: 3 },
    label.toLowerCase(),
    explicitMonth
  );
  check(`${label}: an explicit snapshotMonth creates a history row for THAT month, not the auto-detected one`, explicitSaveResult.rackCapacityHistory.some(r => r.snapshotMonth === explicitMonth));
  check(`${label}: the auto-detected month's earlier snapshot still exists (explicit month did not replace it)`, explicitSaveResult.rackCapacityHistory.some(r => r.snapshotMonth === autoDetectedMonth));
}

/** v2.2.3: month identity must survive text->real-date migration exactly,
 *  with no UTC/local timezone drift, including December/January boundaries. */
async function testLegacyMonthMigrationAndTimezoneSafety(original: Buffer): Promise<void> {
  console.log(`\n===== LEGACY MONTH MIGRATION + TIMEZONE SAFETY =====`);
  const rack = await readRackCapacityFromBuffer(original);
  const metrics = calculateRackCapacityMetrics(rack!.records);

  const boundaryMonths = ["2025-12", "2026-01", "2026-12"];
  let buffer = original;
  for (const month of boundaryMonths) {
    buffer = await patchRackCapacityHistoryBuffer(buffer, "rangsit", month, metrics);
  }
  const rowsBeforeTamper = await readRackCapacityHistoryFromBuffer(buffer);
  for (const month of boundaryMonths) {
    check(`legacy migration: ${month} round-trips exactly before any tampering (no timezone drift)`, rowsBeforeTamper.some(r => r.snapshotMonth === month && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE));
  }

  // Simulate a genuine v2.2.2-era row: rewrite ONE month's Month cell back to
  // inlineStr text (the pre-v2.2.3 on-disk representation), byte-patching
  // the zip directly rather than going through this module's own writer.
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = (await locateRackCapacityHistorySheet(zip))!;
  let sheetXml = await zip.file(sheetPath)!.async("string");
  // Locate the 2026-01 (Total) row by its known cached read, then rewrite its A cell.
  const jan2026Row = rowsBeforeTamper.find(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check("legacy migration: setup found the 2026-01 (Total) row to tamper with", Boolean(jan2026Row));
  const rowMatches = [...sheetXml.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)];
  let tamperedRowNumber: number | null = null;
  for (const m of rowMatches) {
    const aCell = m[2].match(/<c\b(?=[^>]*\br="A\d+")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)?.[0];
    const facilityCell = m[2].match(/<c\b(?=[^>]*\br="B\d+")[^>]*>[\s\S]*?<\/c>/)?.[0];
    const zoneCell = m[2].match(/<c\b(?=[^>]*\br="C\d+")[^>]*>[\s\S]*?<\/c>/)?.[0];
    if (aCell && /<v>(\d+)<\/v>/.test(aCell) && facilityCell?.includes("rangsit") && zoneCell?.includes(RACK_CAPACITY_HISTORY_TOTAL_ZONE)) {
      const serial = aCell.match(/<v>(\d+)<\/v>/)![1];
      // Only tamper with the row whose real date matches 2026-01.
      const check1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test((await zip.file("xl/workbook.xml")!.async("string")));
      const epoch = check1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
      const d = new Date(epoch + Number(serial) * 86_400_000);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (ym === "2026-01") tamperedRowNumber = Number(m[1]);
    }
  }
  check("legacy migration: located the exact row number to tamper (2026-01 Total)", tamperedRowNumber !== null);
  const rowXml = rowMatches.find(m => Number(m[1]) === tamperedRowNumber)![0];
  const oldACell = rowXml.match(/<c\b(?=[^>]*\br="A\d+")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)![0];
  const legacyACell = `<c r="A${tamperedRowNumber}" t="inlineStr"><is><t xml:space="preserve">2026-01</t></is></c>`;
  const legacyRowXml = rowXml.replace(oldACell, legacyACell);
  sheetXml = sheetXml.replace(rowXml, legacyRowXml);
  zip.file(sheetPath, sheetXml);
  const tamperedBuffer = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;

  const readBackLegacy = await readRackCapacityHistoryFromBuffer(tamperedBuffer);
  check("legacy migration: text-Month row still reads back as 2026-01 before migration runs", readBackLegacy.some(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE));

  const migrated = await migrateRackCapacityHistoryFormats(tamperedBuffer);
  check("legacy migration: migration actually changed the buffer (text -> real date)", Buffer.compare(migrated, tamperedBuffer) !== 0);
  const migratedZip = await JSZip.loadAsync(migrated);
  const migratedSheetXml = await migratedZip.file(sheetPath)!.async("string");
  const migratedRowXml = [...migratedSheetXml.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)].find(m => Number(m[1]) === tamperedRowNumber)![0];
  const migratedACell = migratedRowXml.match(/<c\b(?=[^>]*\br="A\d+")[^>]*(?:\/>|>[\s\S]*?<\/c>)/)![0];
  check("legacy migration: Month cell is real numeric date after migration, not inlineStr", !/t="inlineStr"/.test(migratedACell) && /<v>\d+<\/v>/.test(migratedACell));

  const readBackMigrated = await readRackCapacityHistoryFromBuffer(migrated);
  check("legacy migration: month identity preserved EXACTLY across migration (still 2026-01, no drift to Dec-25 or Feb-26)", readBackMigrated.some(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE));
  check("legacy migration: no row was duplicated or lost by migration", readBackMigrated.length === rowsBeforeTamper.length);

  const migratedAgain = await migrateRackCapacityHistoryFormats(migrated);
  check("legacy migration: running migration a second time is a true no-op", Buffer.compare(migrated, migratedAgain) === 0);
}

const workDir = path.resolve("dist-electron/test-work/rack-capacity-history");
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
await testLegacyMonthMigrationAndTimezoneSafety(await fs.readFile(path.resolve("DC_Rangsit.xlsm")));

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK CAPACITY HISTORY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
