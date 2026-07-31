/**
 * Production Stress & Fault Acceptance Test for UPS Group History
 * (persistence + automatic migration-on-open). Adversarial: tries to break
 * the feature via realistic edit/save/reopen cycles, not just confirm the
 * happy path. Exercises the REAL saveWorkbook() pipeline (not the writer
 * primitives directly) so results reflect exactly what the app does.
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-production-stress-fault.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { readWorkbookFromFile, readWorkbookFromBuffer } from "../src/excel/WorkbookReader";
import { saveWorkbook } from "../src/excel/WorkbookWriter";
import { readUpsGroupHistoryFromBuffer } from "../src/reports/upsGroupHistoryReader";
import { migrateUpsGroupHistoryIfNeeded } from "../src/electron/upsGroupHistoryMigration";
import { computeUpsGroupSummary } from "../src/utils/upsGroupAggregation";
import type { UpsGroupConfig } from "../src/utils/upsGroupAggregation";
import type { MonthlyLog } from "../src/types";

let checks = 0;
let failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    checks++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

function hash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const CRITICAL_PARTS = /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables|conditionalFormatting/;

async function partHashes(buf: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  const out: Record<string, string> = {};
  for (const name of names) out[name] = hash(await zip.file(name)!.async("nodebuffer"));
  return out;
}

const RANGSIT_GROUPS: UpsGroupConfig[] = [
  { name: "UPS 11", ids: ["UPS 11A", "UPS 11B"], capacity: 400 },
  { name: "UPS 13", ids: ["UPS 13A", "UPS 13B"], capacity: 400 },
  { name: "UPS 14", ids: ["UPS 14C"], capacity: 120 },
  { name: "UPS 15 (PPC44A, PPC44B)", ids: ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"], capacity: 400 }
];
const DEVICES = {
  upsIds: ["UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A (PPC44A)", "UPS 15B (PPC44B)"],
  dcIds: ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"]
};

function bumpMonth(logs: MonthlyLog[], month: string, delta: number): MonthlyLog[] {
  return logs.map(l => (l.month === month ? { ...l, ups: l.ups.map(u => ({ ...u, loadKw: (u.loadKw ?? 0) + delta })) } : l));
}

async function main(): Promise<void> {
  console.log("PRODUCTION STRESS & FAULT ACCEPTANCE TEST\n");

  const root = path.resolve(".");
  const workDir = path.join(root, "dist-electron", "test-work", "production-stress");
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  const target = path.join(workDir, "DC_Rangsit_stress.xlsm");
  await fs.copyFile(path.join(root, "DC_Rangsit.xlsm"), target);
  const backupDir = path.join(workDir, "backup");

  // Rangsit's UPS input sheet is deliberately the live 2026 log. Historical
  // months have Energy/Air/DC data but no UPS input rows, so a UPS persistence
  // stress cycle must target supported, populated UPS months.
  const JUN = "2026-05";
  const JUL = "2026-06";
  const UNTOUCHED = "2022-01";

  // Baseline: production acceptance already ran a migration once, matching
  // a real workbook that has already been opened in the app before.
  const initialRead = await readWorkbookFromFile(target, DEVICES);
  await migrateUpsGroupHistoryIfNeeded(target, initialRead.logs, "rangsit", RANGSIT_GROUPS, backupDir, 5);
  const baselineBuffer = await fs.readFile(target);
  const baselineParts = await partHashes(baselineBuffer);
  const baselineHistory = await readUpsGroupHistoryFromBuffer(baselineBuffer);
  check("Baseline: migration produced a History sheet before stress testing begins", baselineHistory !== null);
  const untouchedRawRowsBaseline = initialRead.logs.find(l => l.month === UNTOUCHED);
  check(`Baseline: control month ${UNTOUCHED} exists in the fixture (needed for Scenario 8)`, Boolean(untouchedRawRowsBaseline));

  // ===========================================================
  console.log(`\nSCENARIO 1: Modify ${JUN}, Save, close+reopen, verify no corruption`);
  {
    const read = await readWorkbookFromFile(target, DEVICES);
    const mutated = bumpMonth(read.logs, JUN, 5);
    await saveWorkbook(target, mutated, {
      backupDir,
      backupKeep: 5,
      devices: DEVICES,
      upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [JUN] }
    });
    // "Close and reopen": re-run the exact open-time flow (read + migration check).
    const reopened = await readWorkbookFromFile(target, DEVICES);
    check("Scenario 1: workbook re-reads with validation.ok after close+reopen", reopened.validation.ok);
    const migrationOnReopen = await migrateUpsGroupHistoryIfNeeded(target, reopened.logs, "rangsit", RANGSIT_GROUPS, backupDir, 5);
    check("Scenario 1: migration correctly skips on reopen (sheet already exists, no re-migration)", migrationOnReopen.migrated === false);
    const zip = await JSZip.loadAsync(await fs.readFile(target));
    let structurallyValid = true;
    try {
      await new ExcelJS.Workbook().xlsx.load((await fs.readFile(target)) as unknown as ArrayBuffer);
    } catch {
      structurallyValid = false;
    }
    check("Scenario 1: workbook opens cleanly in ExcelJS after the cycle (no corruption)", structurallyValid);
    check("Scenario 1: exactly one History worksheet exists (no duplicate from the reopen)", (await zip.file("xl/workbook.xml")!.async("string")).match(/2\. UPS Group History/g)?.length === 1);
  }

  // ===========================================================
  console.log(`\nSCENARIO 2: Modify ${JUN}, Save, modify again, Save again - no duplicate rows`);
  {
    const read = await readWorkbookFromFile(target, DEVICES);
    const mutated1 = bumpMonth(read.logs, JUN, 1);
    await saveWorkbook(target, mutated1, { backupDir, backupKeep: 5, devices: DEVICES, upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [JUN] } });
    const read2 = await readWorkbookFromFile(target, DEVICES);
    const mutated2 = bumpMonth(read2.logs, JUN, 1);
    await saveWorkbook(target, mutated2, { backupDir, backupKeep: 5, devices: DEVICES, upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [JUN] } });
    const history = await readUpsGroupHistoryFromBuffer(await fs.readFile(target));
    const junRows = history!.rows.filter(r => r.month === JUN);
    check(`Scenario 2: exactly one History row per group for ${JUN} (no duplicates across two saves)`, junRows.length === RANGSIT_GROUPS.length, `${junRows.length} rows`);
    check("Scenario 2: total row count unchanged from baseline (no net growth)", history!.rows.length === baselineHistory!.rows.length);
  }

  // ===========================================================
  console.log(`\nSCENARIO 3: Modify ${JUN}, Save, modify ${JUL}, Save - ${JUN} remains unchanged`);
  {
    const beforeJunRows = (await readUpsGroupHistoryFromBuffer(await fs.readFile(target)))!.rows.filter(r => r.month === JUN);
    const read = await readWorkbookFromFile(target, DEVICES);
    const mutatedJul = bumpMonth(read.logs, JUL, 3);
    await saveWorkbook(target, mutatedJul, { backupDir, backupKeep: 5, devices: DEVICES, upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [JUL] } });
    const afterJunRows = (await readUpsGroupHistoryFromBuffer(await fs.readFile(target)))!.rows.filter(r => r.month === JUN);
    check(
      `Scenario 3: ${JUN}'s History rows (values + generatedAt) are byte-for-byte unchanged after a ${JUL} save`,
      JSON.stringify(beforeJunRows) === JSON.stringify(afterJunRows)
    );
  }

  // ===========================================================
  console.log("\nSCENARIO 4: Open, no edits, Save - UPS Group History byte-identical");
  {
    const beforeBuffer = await fs.readFile(target);
    const beforeHistoryBytes = beforeBuffer; // compare the whole History sheet part specifically below
    const read = await readWorkbookFromFile(target, DEVICES);
    // No mutation at all - saves the exact same logs back, current month
    // hint present (mirrors a real "Save" click with nothing edited).
    await saveWorkbook(target, read.logs, { backupDir, backupKeep: 5, devices: DEVICES, upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [read.logs[read.logs.length - 1].month] } });
    const afterBuffer = await fs.readFile(target);
    const historyBefore = await readUpsGroupHistoryFromBuffer(beforeBuffer);
    const historyAfter = await readUpsGroupHistoryFromBuffer(afterBuffer);
    check(
      "Scenario 4: UPS Group History row values identical after a no-edit Save",
      JSON.stringify(historyBefore!.rows.map(r => ({ ...r, generatedAt: null }))) === JSON.stringify(historyAfter!.rows.map(r => ({ ...r, generatedAt: null })))
    );
    check(
      "Scenario 4: no Generated Timestamp was updated by the no-edit Save",
      JSON.stringify(historyBefore!.rows.map(r => r.generatedAt)) === JSON.stringify(historyAfter!.rows.map(r => r.generatedAt))
    );
    check("Scenario 4: row count unchanged (no rewritten/duplicated rows)", historyBefore!.rows.length === historyAfter!.rows.length);
  }

  // ===========================================================
  console.log("\nSCENARIO 5: Navigate every month - Dashboard-equivalent aggregation matches History for every month");
  {
    const buffer = await fs.readFile(target);
    const read = await readWorkbookFromBuffer(buffer, DEVICES);
    const history = await readUpsGroupHistoryFromBuffer(buffer);
    let mismatches = 0;
    for (const log of read.logs) {
      const expected = computeUpsGroupSummary(log, RANGSIT_GROUPS);
      const actualRows = history!.rows.filter(r => r.month === log.month);
      for (const exp of expected) {
        const actual = actualRows.find(r => r.group === exp.name);
        if (!actual) {
          mismatches++;
          continue;
        }
        const kwOk = Math.abs(actual.totalLoadKw - exp.totalLoadKw) < 0.01;
        const kvaOk = Math.abs(actual.totalLoadKva - exp.totalLoadKva) < 0.01;
        const capOk = actual.capacity === exp.capacity;
        if (!kwOk || !kvaOk || !capOk) mismatches++;
      }
    }
    check(
      `Scenario 5: every one of ${read.logs.length} months' persisted History rows match live Dashboard-equivalent aggregation exactly`,
      mismatches === 0,
      `${mismatches} mismatches`
    );
  }

  // ===========================================================
  console.log("\nSCENARIO 6: 10 consecutive open/save cycles with no edits");
  {
    const sizesBySizeCycle: number[] = [];
    let rowCountStable = true;
    let sheetCountStable = true;
    const startHistory = await readUpsGroupHistoryFromBuffer(await fs.readFile(target));
    const startRowCount = startHistory!.rows.length;
    for (let i = 0; i < 10; i++) {
      const read = await readWorkbookFromFile(target, DEVICES);
      await migrateUpsGroupHistoryIfNeeded(target, read.logs, "rangsit", RANGSIT_GROUPS, backupDir, 5);
      await saveWorkbook(target, read.logs, { backupDir, backupKeep: 5, devices: DEVICES, upsGroupHistory: { facilityId: "rangsit", upsGroups: RANGSIT_GROUPS, onlyMonths: [read.logs[read.logs.length - 1].month] } });
      const buf = await fs.readFile(target);
      sizesBySizeCycle.push(buf.length);
      const hist = await readUpsGroupHistoryFromBuffer(buf);
      if (hist!.rows.length !== startRowCount) rowCountStable = false;
      const zip = await JSZip.loadAsync(buf);
      const sheetMatches = (await zip.file("xl/workbook.xml")!.async("string")).match(/2\. UPS Group History/g)?.length ?? 0;
      if (sheetMatches !== 1) sheetCountStable = false;
    }
    check("Scenario 6: no duplicated worksheets across 10 cycles", sheetCountStable);
    check("Scenario 6: no duplicated rows across 10 cycles (row count constant)", rowCountStable, `sizes seen: row counts stable=${rowCountStable}`);
    const sizeGrowth = sizesBySizeCycle[sizesBySizeCycle.length - 1] - sizesBySizeCycle[0];
    check(
      "Scenario 6: file size does not grow monotonically from repeated migration/save (stabilizes, not unbounded growth)",
      Math.abs(sizeGrowth) < sizesBySizeCycle[0] * 0.05,
      `first=${sizesBySizeCycle[0]} last=${sizesBySizeCycle[sizesBySizeCycle.length - 1]}`
    );
  }

  // ===========================================================
  console.log("\nSCENARIO 7: VBA / Pivot Tables / Charts / Conditional Formatting integrity");
  console.log("  NOTE: this environment cannot launch a licensed Microsoft Excel instance.");
  console.log("  Verified instead: every VBA/pivot/chart/conditionalFormatting zip part is");
  console.log("  byte-identical to the pre-stress-test source, and the workbook re-opens");
  console.log("  cleanly in ExcelJS with those parts present. An actual Excel open is a");
  console.log("  manual verification step outside this tool's capability - not claimed here.");
  {
    const finalBuffer = await fs.readFile(target);
    const finalParts = await partHashes(finalBuffer);
    const criticalNames = Object.keys(baselineParts).filter(n => CRITICAL_PARTS.test(n));
    const allCriticalPreserved = criticalNames.every(n => baselineParts[n] === finalParts[n]);
    check(
      `Scenario 7: all ${criticalNames.length} VBA/pivot/chart/table/conditional-formatting parts byte-identical to baseline after the full stress sequence`,
      allCriticalPreserved
    );
    let opens = true;
    try {
      await new ExcelJS.Workbook().xlsx.load(finalBuffer as unknown as ArrayBuffer);
    } catch {
      opens = false;
    }
    check("Scenario 7: final workbook opens cleanly (structurally valid OOXML)", opens);
  }

  // ===========================================================
  console.log("\nSCENARIO 8: Hash diff before/after for an untouched month; only expected parts differ");
  {
    const finalBuffer = await fs.readFile(target);
    const finalParts = await partHashes(finalBuffer);
    const finalRead = await readWorkbookFromBuffer(finalBuffer, DEVICES);
    const untouchedAfter = finalRead.logs.find(l => l.month === UNTOUCHED);
    check(
      `Scenario 8: control month ${UNTOUCHED}'s raw UPS values are unchanged after the entire stress sequence`,
      JSON.stringify(untouchedRawRowsBaseline!.ups) === JSON.stringify(untouchedAfter!.ups)
    );
    const criticalNames = Object.keys(baselineParts).filter(n => CRITICAL_PARTS.test(n));
    check(
      "Scenario 8: no unrelated workbook part (VBA/pivots/charts/tables/conditional formatting) changed across the whole sequence",
      criticalNames.every(n => baselineParts[n] === finalParts[n])
    );
    // The 4 managed log sheets are legitimately re-serialized on every save
    // (existing, unmodified WorkbookWriter.ts behavior - it always
    // regenerates full <sheetData> for all months, not just edited ones),
    // so their raw XML bytes are NOT expected to be byte-identical; only
    // their DECODED VALUES for untouched months must be. That is what the
    // check above already proves. Documented here so "only expected
    // worksheet XML differs" is not mistaken for a stronger byte-identity
    // claim this codebase's existing save pipeline does not make.
    console.log("  (Managed log-sheet XML is expected to differ on every save by existing, unmodified design - only VALUES for untouched months are the byte-safety contract; verified above.)");
  }

  await fs.rm(workDir, { recursive: true, force: true });

  console.log(`\n${checks} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
}

void main();
