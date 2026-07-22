/**
 * UPS Group History persistence regression suite.
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-ups-group-history.ts
 */
import { promises as fs } from "fs";
import { createHash } from "crypto";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { readUpsMappingFromBuffer } from "../src/reports/upsMappingReader";
import { readUpsGroupHistoryFromBuffer } from "../src/reports/upsGroupHistoryReader";
import {
  patchUpsGroupHistoryBuffer,
  UPS_GROUP_HISTORY_SHEET_NAME,
  UPS_GROUP_HISTORY_DATA_VERSION
} from "../src/excel/UpsGroupHistoryWriter";
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
const SRINAKARIN_GROUPS: UpsGroupConfig[] = [
  { name: "UPS 41", ids: ["UPS 41A", "UPS 41B"], capacity: 400 },
  { name: "PPC 41", ids: ["PPC 41A", "PPC 41B"], capacity: 400 },
  { name: "PPC 42", ids: ["PPC 42A", "PPC 42B"], capacity: 400 },
  { name: "PPC 43", ids: ["PPC 43A", "PPC 43B"], capacity: 400 },
  { name: "PPC 44", ids: ["PPC 44A", "PPC 44B"], capacity: 400 }
];

async function main(): Promise<void> {
  console.log("UPS Group History persistence checks");

  for (const [file, facilityId, groups] of [
    ["DC_Rangsit.xlsm", "rangsit", RANGSIT_GROUPS],
    ["DC_Srinakarin.xlsm", "srinakarin", SRINAKARIN_GROUPS]
  ] as const) {
    console.log(`\n-- ${facilityId} --`);
    const original = await fs.readFile(file);
    const before = await partHashes(original);
    const read = await readWorkbookFromFile(file);
    const logs = read.logs;

    // 1. Fresh workbook: sheet does not exist yet.
    const preExisting = await readUpsGroupHistoryFromBuffer(original);
    check(`${facilityId}: source workbook has no History sheet yet (test fixture untouched)`, preExisting === null);

    // 2. Backfill.
    const backfilled = await patchUpsGroupHistoryBuffer(original, facilityId, groups, logs);
    const afterBackfill = await partHashes(backfilled);
    const unchangedParts = Object.keys(before).every(name => before[name] === afterBackfill[name]);
    check(`${facilityId}: VBA/pivots/charts/tables byte-identical after backfill`, unchangedParts);

    const historyAfterBackfill = await readUpsGroupHistoryFromBuffer(backfilled);
    check(`${facilityId}: History sheet created`, historyAfterBackfill !== null);
    check(
      `${facilityId}: backfill row count == months x groups`,
      historyAfterBackfill!.rows.length === logs.length * groups.length,
      `${historyAfterBackfill!.rows.length} != ${logs.length * groups.length}`
    );
    check(
      `${facilityId}: every backfilled row carries Facility/Month/Timestamp/DataVersion metadata`,
      historyAfterBackfill!.rows.every(r => r.facility === facilityId && r.month && r.generatedAt && r.dataVersion === UPS_GROUP_HISTORY_DATA_VERSION)
    );

    // 3. Idempotency: re-run backfill on the already-backfilled buffer.
    const backfilledAgain = await patchUpsGroupHistoryBuffer(backfilled, facilityId, groups, logs);
    const historyAfterRerun = await readUpsGroupHistoryFromBuffer(backfilledAgain);
    check(
      `${facilityId}: re-running backfill does not duplicate rows`,
      historyAfterRerun!.rows.length === historyAfterBackfill!.rows.length
    );
    check(
      `${facilityId}: re-running backfill never overwrites existing rows (byte-identical, timestamps untouched)`,
      hash(backfilled) === hash(backfilledAgain)
    );

    // 4. Structural validity after patch: re-openable, exactly one History sheet.
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(backfilled as unknown as ArrayBuffer);
    const historySheets = reread.worksheets.filter(w => w.name === UPS_GROUP_HISTORY_SHEET_NAME);
    check(`${facilityId}: exactly one History worksheet (no duplicate worksheet)`, historySheets.length === 1);

    // 5a. Incremental update with UNCHANGED data: re-saving the same month
    // with identical values must be a true no-op - value-based idempotency,
    // not "always refresh the currently-open month".
    const latestMonth = logs[logs.length - 1].month;
    await new Promise(resolve => setTimeout(resolve, 5));
    const incrementalUnchanged = await patchUpsGroupHistoryBuffer(backfilled, facilityId, groups, logs, [latestMonth]);
    check(
      `${facilityId}: incremental save of UNCHANGED data is a true no-op (byte-identical, no timestamp refresh)`,
      hash(backfilled) === hash(incrementalUnchanged)
    );

    // 5b. Incremental update with an ACTUAL data change: only that month's
    // rows change, every other month's generatedAt stays untouched, and the
    // changed month's generatedAt DOES refresh.
    const mutatedLogs = logs.map(l =>
      l.month === latestMonth ? { ...l, ups: l.ups.map(u => ({ ...u, loadKw: (u.loadKw ?? 0) + 1 })) } : l
    );
    const incremental = await patchUpsGroupHistoryBuffer(backfilled, facilityId, groups, mutatedLogs, [latestMonth]);
    const historyAfterIncremental = await readUpsGroupHistoryFromBuffer(incremental);
    check(
      `${facilityId}: incremental update does not change total row count`,
      historyAfterIncremental!.rows.length === historyAfterBackfill!.rows.length
    );
    const otherMonthRows = historyAfterIncremental!.rows.filter(r => r.month !== latestMonth);
    const otherMonthRowsBefore = historyAfterBackfill!.rows.filter(r => r.month !== latestMonth);
    check(
      `${facilityId}: incremental update leaves every other month's generatedAt untouched`,
      otherMonthRows.every(r => otherMonthRowsBefore.find(b => b.month === r.month && b.group === r.group)?.generatedAt === r.generatedAt)
    );
    const targetMonthRows = historyAfterIncremental!.rows.filter(r => r.month === latestMonth);
    const targetMonthRowsBefore = historyAfterBackfill!.rows.filter(r => r.month === latestMonth);
    check(
      `${facilityId}: incremental update with a real data change refreshes the target month's generatedAt`,
      targetMonthRows.every(r => targetMonthRowsBefore.find(b => b.group === r.group)!.generatedAt !== r.generatedAt)
    );

    // 6. Cross-check against the independently-verified Dashboard-FAC reader
    // for whichever month Dashboard-FAC's own $H$1 cell is currently set to
    // (its group-summary table only ever reflects that one active month) -
    // same underlying raw data, single aggregation formula, so History must
    // agree with it exactly for that month.
    const upsMapping = await readUpsMappingFromBuffer(original);
    const probe = new ExcelJS.Workbook();
    await probe.xlsx.load(original as unknown as ArrayBuffer);
    const h1 = probe.getWorksheet("Dashboard-FAC")!.getCell("H1").value;
    const h1Month = h1 instanceof Date ? `${h1.getUTCFullYear()}-${String(h1.getUTCMonth() + 1).padStart(2, "0")}` : null;
    if (upsMapping && h1Month) {
      const h1MonthRows = historyAfterBackfill!.rows.filter(r => r.month === h1Month);
      const dashboardByGroup = new Map(upsMapping.summary.map(s => [s.name, s]));
      const historyByGroup = new Map(h1MonthRows.map(r => [r.group, r]));
      let compared = 0;
      let allMatch = true;
      for (const [name, dash] of dashboardByGroup) {
        const hist = historyByGroup.get(name);
        if (!hist) continue; // group naming differs by source table section; only compare shared names
        compared++;
        const kvaMatch = Math.abs((hist.totalLoadKva ?? 0) - (dash.totalLoadKva ?? 0)) < 0.01;
        const capMatch = hist.capacity === dash.capacity;
        if (!kvaMatch || !capMatch) allMatch = false;
      }
      check(
        `${facilityId}: UPS Group History (${h1Month}) matches Dashboard-FAC's own cached totals for all ${compared} overlapping groups`,
        allMatch && compared > 0
      );
    }
  }

  console.log(`\n${checks} UPS Group History checks passed.`);
}

void main();
