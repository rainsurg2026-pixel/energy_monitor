/**
 * Regression test for the multi-section batched-save data-loss defect.
 *
 * App.tsx's toolbar "Save All" (commitAllDrafts) synchronously commits every
 * dirty entry section (UPS, Air, DC, Energy) for the active month in one
 * tick, without an intervening React re-render. Each section's saveAction
 * builds its next MonthlyLog by spreading a base record and overwriting only
 * its own field, then writes it with saveLogForMonth (a full replace, not a
 * merge - see saveLogForMonth in utils.ts). If that base record is a stale
 * snapshot captured before the batch started (the bug: React's `activeLog`
 * state, never refreshed mid-batch), each section's save silently reverts
 * every other section's edits from earlier in the same batch. The fix reads
 * the base record fresh via loadLogForMonth(month) on every save, so each
 * section's write builds on whatever the previous section in the same batch
 * just committed.
 *
 * This test exercises the exact same utils.ts primitives (loadLogForMonth /
 * saveLogForMonth) App.tsx's save handlers use, simulating a full four-
 * section batch under both the stale-snapshot pattern (proving it loses
 * data) and the fresh-read pattern App.tsx now uses (proving it doesn't).
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-batch-save-merge.ts
 */
import { loadLogForMonth, saveLogForMonth, deleteLogForMonth } from "../src/utils";
import type { MonthlyLog } from "../src/types";

let checks = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    checks++;
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

const MONTH = "2099-01"; // scratch month, never collides with real data

function resetMonth(): void {
  deleteLogForMonth(MONTH);
}

async function main(): Promise<void> {
  console.log("Batch-save merge regression checks");

  // --- 1. The buggy pattern: every section spreads the SAME pre-batch snapshot ---
  resetMonth();
  const staleSnapshot: MonthlyLog = loadLogForMonth(MONTH); // captured once, like React's activeLog

  const buggySaveUps = () => saveLogForMonth(MONTH, { ...staleSnapshot, ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.2 }] });
  const buggySaveAir = () => saveLogForMonth(MONTH, { ...staleSnapshot, air: { eb41a: 111, eb41b: null, eb42a: null, eb42b: null } });
  const buggySaveDc = () => saveLogForMonth(MONTH, { ...staleSnapshot, dc: [{ panelId: "DC PDB41A", voltage: 48, current: 5 }] });
  const buggySaveEnergy = () => saveLogForMonth(MONTH, { ...staleSnapshot, energyCost: { buildingEnergyKwh: 5000, buildingElectricityCostThb: 20000 } });

  buggySaveUps();
  buggySaveAir();
  buggySaveDc();
  buggySaveEnergy(); // last section processed - only this one should "win" under the bug

  const afterBuggyBatch = loadLogForMonth(MONTH);
  check(
    "Reproduces the defect: stale-snapshot batch loses the UPS edit",
    afterBuggyBatch.ups.every(u => u.upsId !== "UPS 11A" || u.voltage === null),
    `expected UPS 1 to have reverted to null voltage, got ${JSON.stringify(afterBuggyBatch.ups.find(u => u.upsId === "UPS 11A"))}`
  );
  check("Reproduces the defect: stale-snapshot batch loses the Air edit", afterBuggyBatch.air.eb41a !== 111);
  check("Reproduces the defect: stale-snapshot batch loses the DC edit", !afterBuggyBatch.dc.some(d => d.panelId === "DC PDB41A" && d.voltage === 48));
  check("Stale-snapshot batch DOES keep the last-processed section (Energy)", afterBuggyBatch.energyCost.buildingEnergyKwh === 5000);

  // --- 2. The fix App.tsx now uses: every section re-reads loadLogForMonth(month) fresh ---
  resetMonth();

  const fixedSaveUps = () => saveLogForMonth(MONTH, { ...loadLogForMonth(MONTH), ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.2 }] });
  const fixedSaveAir = () => saveLogForMonth(MONTH, { ...loadLogForMonth(MONTH), air: { eb41a: 111, eb41b: null, eb42a: null, eb42b: null } });
  const fixedSaveDc = () => saveLogForMonth(MONTH, { ...loadLogForMonth(MONTH), dc: [{ panelId: "DC PDB41A", voltage: 48, current: 5 }] });
  const fixedSaveEnergy = () => saveLogForMonth(MONTH, { ...loadLogForMonth(MONTH), energyCost: { buildingEnergyKwh: 5000, buildingElectricityCostThb: 20000 } });

  fixedSaveUps();
  fixedSaveAir();
  fixedSaveDc();
  fixedSaveEnergy();

  const afterFixedBatch = loadLogForMonth(MONTH);
  const upsRecord = afterFixedBatch.ups.find(u => u.upsId === "UPS 11A");
  check("Fix: batch save keeps the UPS edit", upsRecord?.voltage === 220, JSON.stringify(upsRecord));
  check("Fix: batch save keeps the Air edit", afterFixedBatch.air.eb41a === 111);
  check("Fix: batch save keeps the DC edit", afterFixedBatch.dc.some(d => d.panelId === "DC PDB41A" && d.voltage === 48));
  check("Fix: batch save keeps the Energy edit", afterFixedBatch.energyCost.buildingEnergyKwh === 5000);

  resetMonth();
  console.log(`\n${checks} batch-save merge checks passed.`);
}

main().catch(err => {
  console.error("Batch-save merge test crashed:", err);
  process.exit(1);
});
