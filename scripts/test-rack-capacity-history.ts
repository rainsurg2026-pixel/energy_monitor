import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import {
  patchRackCapacityHistoryBuffer,
  readRackCapacityHistoryFromBuffer,
  RACK_CAPACITY_HISTORY_SHEET_NAME,
  RACK_CAPACITY_HISTORY_TOTAL_ZONE
} from "../src/excel/RackCapacityHistoryWriter";
import { saveRackCapacityStatusChanges } from "../src/excel/RackCapacityWriter";
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

  check(`${label}: no History sheet before first save`, (await readRackCapacityHistoryFromBuffer(original)).length === 0);

  const rack = await readRackCapacityFromBuffer(original);
  const metrics = calculateRackCapacityMetrics(rack!.records);

  // ---- First save: January snapshot ----
  const buffer1 = await patchRackCapacityHistoryBuffer(original, label.toLowerCase(), "2026-01", metrics);
  const rows1 = await readRackCapacityHistoryFromBuffer(buffer1);
  check(`${label}: sheet created with one row per zone + one (Total) row`, rows1.length === metrics.zoneMetrics.length + 1, `${rows1.length} vs expected ${metrics.zoneMetrics.length + 1}`);
  const totalRow1 = rows1.find(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: (Total) row totalRacks matches facility total`, totalRow1?.totalRacks === metrics.total);
  check(`${label}: (Total) row inUse matches metrics`, totalRow1?.inUse === metrics.inUse.count);
  check(`${label}: (Total) row usagePct is a 0-1 fraction, not 0-100`, (totalRow1?.usagePct ?? 0) <= 1);
  check(`${label}: every row tagged with the right facility`, rows1.every(r => r.facility === label.toLowerCase()));
  check(`${label}: every row tagged with the right month`, rows1.every(r => r.snapshotMonth === "2026-01"));
  const zoneWithData = metrics.zoneMetrics[0];
  const zoneRow1 = rows1.find(r => r.rackZone === zoneWithData.zone);
  check(`${label}: a real zone row's counts match calculateRackCapacityMetrics exactly (single authoritative calculation)`, zoneRow1?.inUse === zoneWithData.inUse.count && zoneRow1?.available === zoneWithData.available.count);

  const sheetExists = await (async () => {
    const zip = await JSZip.loadAsync(buffer1);
    const wbXml = await zip.file("xl/workbook.xml")!.async("string");
    return wbXml.includes(RACK_CAPACITY_HISTORY_SHEET_NAME);
  })();
  check(`${label}: workbook.xml registers the "${RACK_CAPACITY_HISTORY_SHEET_NAME}" sheet`, sheetExists);

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
  check(`${label}: updated month does not create a duplicate row (still zones+1 rows)`, rows3.length === metrics.zoneMetrics.length + 1, String(rows3.length));
  const totalRow3 = rows3.find(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: updated month's (Total) row reflects the new counts`, totalRow3?.totalRacks === changedMetrics.total);

  // ---- Fourth save: a DIFFERENT month -> appends, never overwrites Jan ----
  const buffer4 = await patchRackCapacityHistoryBuffer(buffer3, label.toLowerCase(), "2026-02", metrics);
  const rows4 = await readRackCapacityHistoryFromBuffer(buffer4);
  check(`${label}: a new month appends rows without touching the prior month`, rows4.length === (metrics.zoneMetrics.length + 1) * 2, String(rows4.length));
  const janStillThere = rows4.find(r => r.snapshotMonth === "2026-01" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: January's (updated) snapshot survives the February save untouched`, janStillThere?.totalRacks === changedMetrics.total);
  const febRow = rows4.find(r => r.snapshotMonth === "2026-02" && r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE);
  check(`${label}: February row present with its own data`, febRow?.totalRacks === metrics.total);

  const afterHashes4 = await unrelatedPartHashes(buffer4);
  const changed4 = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes4[name]);
  check(`${label}: VBA/pivot/table/chart/drawing parts still untouched after multiple history saves`, changed4.length === 0, changed4.join(", "));

  // ---- No fake backfill: this module never invents months on its own ----
  check(`${label}: only the months explicitly saved exist (no auto-backfilled history)`, new Set(rows4.map(r => r.snapshotMonth)).size === 2);

  // ---- End-to-end: a real Table7 status Save auto-creates a history snapshot ----
  const backupDir = path.join(path.dirname(sourcePath), `backup-${label.toLowerCase()}`);
  const target = rack!.records.find(r => r.rackId && r.status)!;
  const otherStatus = target.status === "Available" ? "Reserved" : "Available";
  const saveResult = await saveRackCapacityStatusChanges(
    sourcePath,
    [{ rowNumber: target.rowNumber, rackId: target.rackId!, expectedStatus: target.status, newStatus: otherStatus }],
    { backupDir, backupKeep: 3 },
    null,
    label.toLowerCase()
  );
  check(`${label}: real Save produces a non-empty history snapshot end-to-end`, saveResult.rackCapacityHistory.length > 0);
  const e2eMonths = new Set(saveResult.rackCapacityHistory.map(r => r.snapshotMonth));
  check(`${label}: end-to-end snapshot month looks like a real YYYY-MM (from Dashboard-FAC!H1, not fabricated)`, [...e2eMonths].every(m => /^\d{4}-\d{2}$/.test(m)));
  check(`${label}: end-to-end save did not duplicate the (Total) row for its month`, saveResult.rackCapacityHistory.filter(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE && e2eMonths.has(r.snapshotMonth)).length === e2eMonths.size);
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

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK CAPACITY HISTORY TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
