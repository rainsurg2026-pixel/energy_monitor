/**
 * UPS Group History automatic migration-on-open regression suite.
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-ups-group-history-migration.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { readUpsGroupHistoryFromBuffer } from "../src/reports/upsGroupHistoryReader";
import { migrateUpsGroupHistoryIfNeeded, MigrationStage } from "../src/electron/upsGroupHistoryMigration";
import type { UpsGroupConfig } from "../src/utils/upsGroupAggregation";

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

function hash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function partHashes(buf: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(
    name => /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables/.test(name) && !zip.files[name].dir
  );
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

async function main(): Promise<void> {
  console.log("UPS Group History migration-on-open checks");

  const root = path.resolve(".");
  const workDir = path.join(root, "dist-electron", "test-work", "ups-group-history-migration");
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  const target = path.join(workDir, "DC_Rangsit_migration.xlsm");
  await fs.copyFile(path.join(root, "DC_Rangsit.xlsm"), target);
  const originalBytes = await fs.readFile(target);

  const preOpen = await readUpsGroupHistoryFromBuffer(originalBytes);
  check("Fresh copy: no History sheet before migration (never manually created)", preOpen === null);

  const read = await readWorkbookFromFile(target);
  const stagesSeen: MigrationStage[] = [];

  // --- First open: migration must run automatically ---
  const first = await migrateUpsGroupHistoryIfNeeded(target, read.logs, "rangsit", RANGSIT_GROUPS, null, 0, stage =>
    stagesSeen.push(stage)
  );
  check("First open: migration ran (migrated=true)", first.migrated === true);
  check(
    "First open: rows written == months x groups",
    first.rowsWritten === read.logs.length * RANGSIT_GROUPS.length
  );
  check(
    "Progress stages fired in the expected order (not-found -> migrating -> generating -> saving -> reloading -> complete)",
    JSON.stringify(stagesSeen) === JSON.stringify(["checking", "not-found", "migrating", "generating", "saving", "reloading", "complete"]),
    JSON.stringify(stagesSeen)
  );

  const afterFirstBuffer = await fs.readFile(target);
  const afterFirst = await readUpsGroupHistoryFromBuffer(afterFirstBuffer);
  check("After first open: History sheet exists on disk", afterFirst !== null);
  check(
    "After first open: row count matches",
    afterFirst!.rows.length === read.logs.length * RANGSIT_GROUPS.length
  );

  const beforeParts = await partHashes(originalBytes);
  const afterParts = await partHashes(afterFirstBuffer);
  const allUnchanged = Object.keys(beforeParts).every(name => beforeParts[name] === afterParts[name]);
  check("VBA/pivots/charts/tables byte-identical after migration", allUnchanged, Object.keys(beforeParts).length === 0 ? "no parts found to compare" : "");

  // --- Second "open": Historical Explorer would read this immediately, no Save needed ---
  const readAgain = await readWorkbookFromFile(target);
  check(
    "Second open (no Save in between): Historical Explorer's data source already has all rows",
    readAgain.logs.length === read.logs.length
  );

  // --- Idempotency: simulate re-opening the now-migrated workbook ---
  const secondStages: MigrationStage[] = [];
  const second = await migrateUpsGroupHistoryIfNeeded(target, readAgain.logs, "rangsit", RANGSIT_GROUPS, null, 0, stage =>
    secondStages.push(stage)
  );
  check("Second open: migration is skipped (migrated=false)", second.migrated === false);
  check("Second open: only the 'checking' stage fires, nothing else", JSON.stringify(secondStages) === JSON.stringify(["checking"]));

  const afterSecondBuffer = await fs.readFile(target);
  check(
    "Second open: workbook bytes completely unchanged (true no-op, not even a rewrite)",
    hash(afterFirstBuffer) === hash(afterSecondBuffer)
  );

  await fs.rm(workDir, { recursive: true, force: true });
  console.log(`\n${checks} UPS Group History migration checks passed.`);
}

void main();
