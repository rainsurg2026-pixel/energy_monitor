/**
 * Round-trip test for the Excel layer, run against a COPY of the real
 * RST_Dashboard.xlsm (never the live file):
 *
 *   read -> modify -> save -> re-read -> assert data
 *   plus zip-level assertions that VBA, pivots, charts and tables survived.
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-excel-roundtrip.ts <workDir>
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { checkWorkbookLock, saveWorkbook } from "../src/excel/WorkbookWriter";
import { summarizeWorkbookHealth } from "../src/excel/WorkbookValidator";
import { createEmptyLog } from "../src/excel/SheetMapper";

const projectRoot = path.resolve(__dirname, "..");
const sourceWorkbook = path.join(projectRoot, "RST_Dashboard.xlsm");

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function main() {
  const workDir = process.argv[2] ?? path.join(projectRoot, "dist-electron", "test-work");
  await fs.mkdir(workDir, { recursive: true });
  const copyPath = path.join(workDir, "RST_Roundtrip.xlsm");
  await fs.copyFile(sourceWorkbook, copyPath);
  // Remove any stale sidecar/backups from previous runs
  await fs.unlink(`${copyPath}.appmeta.json`).catch(() => undefined);
  const backupDir = path.join(workDir, "backup");
  await fs.rm(backupDir, { recursive: true, force: true });

  const originalZip = await JSZip.loadAsync(await fs.readFile(copyPath));
  const originalVba = await originalZip.file("xl/vbaProject.bin")!.async("nodebuffer");

  // ---------------------------------------------------------------- 1. READ
  console.log("\n1. READ");
  const read1 = await readWorkbookFromFile(copyPath);
  check("workbook validates", read1.validation.ok, read1.validation.errors.join("; "));
  check("months parsed", read1.logs.length > 0, "no months found");
  const health = summarizeWorkbookHealth(read1);
  console.log(
    `     months=${health.monthCount} range=${health.firstMonth}..${health.lastMonth} ` +
      `dups=${health.duplicateCount} missingMonths=${health.missingMonthCount} ` +
      `missingDevices=${health.missingDeviceCount} invalidIds=${health.invalidIdCount}`
  );
  const latest = read1.logs[read1.logs.length - 1];
  const ups11a = latest.ups.find(u => u.upsId.includes("11A"));
  const latestPopulatedUpsMonth = [...read1.logs].reverse().find(log => {
    const record = log.ups.find(u => u.upsId.includes("11A"));
    return record?.voltage !== null && record?.voltage !== undefined;
  });
  check("latest populated month has UPS 11A voltage", Boolean(latestPopulatedUpsMonth));
  check("incomplete latest month preserves blank UPS 11A voltage", ups11a?.voltage === null);
  check(
    "energy cost present in some month",
    read1.logs.some(l => l.energyCost.buildingElectricityCostThb !== null)
  );

  // -------------------------------------------------------------- 2. MODIFY
  console.log("\n2. MODIFY + SAVE");
  const logs = read1.logs.map(l => ({ ...l, ups: l.ups.map(u => ({ ...u })), dc: l.dc.map(d => ({ ...d })), air: { ...l.air }, energyCost: { ...l.energyCost } }));
  const editTarget = logs[logs.length - 1];
  const editedUps = editTarget.ups.find(u => u.upsId.includes("11A"))!;
  editedUps.voltage = 401.5;
  editTarget.lastSavedUps = "16-Jul-2026 19:00:00";

  // add a brand-new month after the last one
  const [ly, lm] = editTarget.month.split("-").map(Number);
  const nextMonth = lm === 12 ? `${ly + 1}-01` : `${ly}-${String(lm + 1).padStart(2, "0")}`;
  const newLog = createEmptyLog(nextMonth);
  newLog.ups[0].voltage = 396;
  newLog.ups[0].current = 210;
  newLog.ups[0].loadKw = 150;
  newLog.ups[0].loadKva = 151;
  newLog.air = { eb41a: 15.1, eb41b: 17.2, eb42a: 6.3, eb42b: 5.4 };
  newLog.dc[0].voltage = 53.9;
  newLog.dc[0].current = 66.1;
  newLog.energyCost = { buildingEnergyKwh: 2999999.5, buildingElectricityCostThb: 10456789.25 };
  logs.push(newLog);

  const saveResult = await saveWorkbook(copyPath, logs, { backupDir, backupKeep: 5 });
  check("save succeeded", saveResult.path === copyPath);
  check("backup created", saveResult.backupPath !== null && (await fs.stat(saveResult.backupPath!)).size > 0);

  // ------------------------------------------------------------- 3. RE-READ
  console.log("\n3. RE-READ");
  const read2 = await readWorkbookFromFile(copyPath);
  check("re-read validates", read2.validation.ok, read2.validation.errors.join("; "));
  check("month count grew by 1", read2.logs.length === read1.logs.length + 1, `${read1.logs.length} -> ${read2.logs.length}`);
  const editedBack = read2.logs.find(l => l.month === editTarget.month)!;
  check("edited UPS voltage persisted", editedBack.ups.find(u => u.upsId.includes("11A"))!.voltage === 401.5);
  check("timestamp persisted via sidecar", editedBack.lastSavedUps === "16-Jul-2026 19:00:00");
  const newBack = read2.logs.find(l => l.month === nextMonth);
  check("new month present", Boolean(newBack), `missing ${nextMonth}`);
  check("new month energy cost persisted", newBack?.energyCost.buildingElectricityCostThb === 10456789.25);
  check("new month air persisted", newBack?.air.eb41b === 17.2);

  // untouched historical value survives
  const firstMonth1 = read1.logs[0];
  const firstMonth2 = read2.logs.find(l => l.month === firstMonth1.month)!;
  check(
    "historical energy value unchanged",
    firstMonth2.energyCost.buildingEnergyKwh === firstMonth1.energyCost.buildingEnergyKwh
  );

  // --------------------------------------------------- 4. ZIP-LEVEL SAFETY
  console.log("\n4. ZIP-LEVEL PRESERVATION");
  const patchedZip = await JSZip.loadAsync(await fs.readFile(copyPath));
  const names = Object.keys(patchedZip.files);

  const vba = patchedZip.file("xl/vbaProject.bin");
  check("vbaProject.bin still present", Boolean(vba));
  if (vba) {
    const vbaBytes = await vba.async("nodebuffer");
    check("vbaProject.bin byte-identical", vbaBytes.equals(originalVba));
  }
  check("charts preserved", names.includes("xl/charts/chart1.xml") && names.includes("xl/charts/chart2.xml"));
  check("pivot table preserved", names.includes("xl/pivotTables/pivotTable1.xml"));
  check("pivot cache preserved", names.includes("xl/pivotCache/pivotCacheDefinition1.xml"));
  check("drawings preserved", names.includes("xl/drawings/drawing1.xml"));
  check("calcChain removed", !names.includes("xl/calcChain.xml"));

  const contentTypes = await patchedZip.file("[Content_Types].xml")!.async("string");
  check("no dangling calcChain content-type", !contentTypes.includes("calcChain"));
  const workbookRels = await patchedZip.file("xl/_rels/workbook.xml.rels")!.async("string");
  check("no dangling calcChain relationship", !workbookRels.includes("calcChain"));

  const workbookXml = await patchedZip.file("xl/workbook.xml")!.async("string");
  check("fullCalcOnLoad set", workbookXml.includes('fullCalcOnLoad="1"'));

  const pivotCacheXml = await patchedZip.file("xl/pivotCache/pivotCacheDefinition1.xml")!.async("string");
  check("pivot cache refreshOnLoad set", pivotCacheXml.includes('refreshOnLoad="1"'));

  // Energy sheet: extra column (4th floor cost) + calculated column preserved
  const costSheet = await patchedZip.file("xl/worksheets/sheet8.xml")!.async("string");
  check("cost sheet keeps rate formula", costSheet.includes("Overall_Energy[[#This Row]"));
  const dRowCount = (costSheet.match(/<c r="D\d+"/g) ?? []).length;
  check("cost sheet keeps extra column D cells", dRowCount >= read1.logs.length, `D cells: ${dRowCount}`);

  // Table ranges must now cover the new month's rows
  let tableOk = false;
  for (const name of names.filter(n => /^xl\/tables\/table\d+\.xml$/.test(n))) {
    const tableXml = await patchedZip.file(name)!.async("string");
    const m = tableXml.match(/<table\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
    if (!m) continue;
    if (tableXml.includes("Overall_Energy")) {
      const endRow = parseInt(m[4], 10);
      // header at row 2 + one row per month
      tableOk = endRow >= 2 + read2.logs.length;
      console.log(`     Overall_Energy table ref end row = ${endRow} (months=${read2.logs.length})`);
    }
  }
  check("Overall_Energy table range extended", tableOk);

  // ------------------------------------------------------ 5. LOCK DETECTION
  console.log("\n5. LOCK DETECTION");
  const ownerFile = path.join(path.dirname(copyPath), `~$${path.basename(copyPath)}`);
  await fs.writeFile(ownerFile, "owner");
  const lock = await checkWorkbookLock(copyPath);
  check("Excel owner file detected", lock.excelOwnerFilePresent);
  await fs.unlink(ownerFile);

  // ------------------------------------------------- 6. SECOND SAVE (idempotence)
  console.log("\n6. SECOND SAVE (idempotence + rotation)");
  const save2 = await saveWorkbook(copyPath, read2.logs, { backupDir, backupKeep: 5 });
  check("second save succeeded", save2.path === copyPath);
  const read3 = await readWorkbookFromFile(copyPath);
  check("second save round-trips", read3.logs.length === read2.logs.length);
  const backups = (await fs.readdir(backupDir)).filter(f => f.endsWith(".xlsm"));
  check("backups accumulate with rotation", backups.length >= 2 && backups.length <= 5, `count=${backups.length}`);

  console.log(failures === 0 ? "\nALL ROUNDTRIP TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Roundtrip test crashed:", err);
  process.exit(1);
});
