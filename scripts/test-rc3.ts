/**
 * Focused regression checks for RC3 UX correctness fixes.
 * Run with: npm run test:rc3
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ExcelProvider } from "../src/data/ExcelProvider";
import { ProviderError } from "../src/data/IDataProvider";
import { beginSaveOnce, clearEntryUndoHistory, endSaveOnce } from "../src/utils/entrySession";
import { saveWorkbook, WorkbookError } from "../src/excel/WorkbookWriter";

let checks = 0;
function check(label: string, condition: unknown): void {
  assert.ok(condition, label);
  checks++;
  console.log(`  PASS ${label}`);
}

async function expectRejects<T extends Error>(
  action: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => T
): Promise<T> {
  try {
    await action();
  } catch (error) {
    check("failed with the expected error type", error instanceof ErrorType);
    return error as T;
  }
  throw new Error("Expected operation to reject.");
}

async function main(): Promise<void> {
  console.log("RC3 regression checks");

  // Workbook, facility, reload and month switches all call this same helper.
  const undoHistory = { current: ["old field value", "another old value"] };
  clearEntryUndoHistory(undoHistory);
  check("context change clears every undo entry", undoHistory.current.length === 0);

  const saveSlot = { current: false };
  check("first save claims the synchronous save slot", beginSaveOnce(saveSlot));
  check("concurrent save is rejected before work begins", !beginSaveOnce(saveSlot));
  endSaveOnce(saveSlot);
  check("save slot is released after completion", beginSaveOnce(saveSlot));
  endSaveOnce(saveSlot);

  const bridge = {
    excel: {
      save: async () => ({ ok: false as const, code: "LOCKED", message: "Workbook is locked", stage: "lock" as const })
    }
  };
  const provider = new ExcelProvider(bridge as never);
  (provider as unknown as { currentPath: string }).currentPath = "C:\\workbook.xlsm";
  const providerError = await expectRejects(() => provider.saveAll([]), ProviderError);
  check("IPC failure stage reaches the renderer provider", providerError.stage === "lock");
  check("IPC failure code reaches the renderer provider", providerError.code === "LOCKED");

  const missingPath = path.join(process.cwd(), "__rc3_missing_workbook__.xlsm");
  const writerError = await expectRejects(() => saveWorkbook(missingPath, [], { backupDir: null, backupKeep: 0 }), WorkbookError);
  check("writer tags missing-workbook saves as the read stage", writerError.stage === "read");

  const appSource = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8");
  check("recovery flow contains no recovery debug logging", !appSource.includes("[RECOVERY]"));
  check("lock save failures are not displayed as backup failures", !appSource.includes('lock: "backup"'));
  check("month context changes use the shared selector", (appSource.match(/setSelectedMonth/g) ?? []).length === 2);

  const saveProgressSource = await readFile(path.join(process.cwd(), "src", "components", "SaveProgress.tsx"), "utf8");
  check("save progress exposes lock as a first-class stage", saveProgressSource.includes('"lock"') && saveProgressSource.includes("Checking Lock"));

  console.log(`\n${checks} RC3 checks passed.`);
}

void main();
