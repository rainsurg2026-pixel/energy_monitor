import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SOURCE_MONTH,
  TARGET_MONTHS,
  RECORD_INSERT_SQL,
  HISTORY_INSERT_SQL,
  planBackfill,
  recordInsertValues,
  historyInsertValues,
  type RackHistorySource,
  type RackRecordSource,
  type SiteBaseline
} from "./backfill-rack-capacity-history";

// (arity) every INSERT placeholder maps to exactly one value, in order.
const maxPlaceholder = (sql: string) => Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
assert.equal(maxPlaceholder(RECORD_INSERT_SQL), recordInsertValues({
  source_row_number: 1, rack_zone: "Z", rack_id: "R", status: "s", cabinet_size: "c",
  detail: "d", device_type: "dt", remarks: "", raw_inputs: {}
}, "S").length, "rack_capacity_records: placeholder count == value count");
assert.equal(maxPlaceholder(HISTORY_INSERT_SQL), historyInsertValues({
  facility: "F", rack_zone: "Z", total_racks: 1, in_use: 1, available: 0, reserved: 0,
  pending_dismantle: 0, other: 0, usage_pct: null, availability_pct: null, reserved_pct: null,
  pending_dismantle_pct: null, other_pct: null, data_version: 1
}, 1, "2026-03", "2026-08-01T00:00:00.000Z").length, "rack_capacity_history: placeholder count == value count");
// raw_inputs null -> "{}" (never a SQL NULL into the NOT NULL jsonb column)
assert.equal(recordInsertValues({
  source_row_number: null, rack_zone: null, rack_id: null, status: null, cabinet_size: null,
  detail: null, device_type: null, remarks: null, raw_inputs: null
}, "S").at(-1), "{}");

const src = readFileSync(new URL("./backfill-rack-capacity-history.ts", import.meta.url), "utf8");

// --- shape / allow-list -----------------------------------------------------
assert.equal(SOURCE_MONTH, "2026-07");
assert.deepEqual([...TARGET_MONTHS], ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
assert.ok(TARGET_MONTHS.every(m => m < SOURCE_MONTH), "(7) no target month is July or later");
assert.ok(TARGET_MONTHS.every(m => m >= "2025-12"), "only 2025-12..2026-06");
assert.equal(new Set(TARGET_MONTHS).size, TARGET_MONTHS.length, "no duplicate target months");

const zone = (over: Partial<RackHistorySource> = {}): RackHistorySource => ({
  facility: "Rangsit", rack_zone: "Zone A", total_racks: 100, in_use: 60, available: 30, reserved: 7,
  pending_dismantle: 3, other: 0, usage_pct: 0.6, availability_pct: 0.3, reserved_pct: 0.07,
  pending_dismantle_pct: 0.03, other_pct: 0, data_version: 1, ...over
});
const record = (over: Partial<RackRecordSource> = {}): RackRecordSource => ({
  source_row_number: 1, rack_zone: "Zone A", rack_id: "AA01", status: "In Use", cabinet_size: "42U",
  detail: "compute", device_type: "server", remarks: "", raw_inputs: { note: "x" }, ...over
});

const rangsit: SiteBaseline = {
  site: { id: 11, code: "rangsit", name: "Rangsit" },
  hasSource: true,
  records: [record({ source_row_number: 1, rack_id: "AA01" }), record({ source_row_number: 2, rack_id: "AA02", status: "Available" })],
  history: [zone({ rack_zone: "Zone A", total_racks: 120, in_use: 70, available: 40, reserved: 7, pending_dismantle: 3 }),
            zone({ rack_zone: "Zone B", total_racks: 117, in_use: 50, available: 60, reserved: 5, pending_dismantle: 2 })],
  existingMonths: new Set([SOURCE_MONTH])
};
const srinakarin: SiteBaseline = {
  site: { id: 22, code: "srinakarin", name: "Srinakarin" },
  hasSource: true,
  records: [record({ source_row_number: 1, rack_zone: "S-1", rack_id: "S001", remarks: "srin only" })],
  history: [zone({ facility: "Srinakarin", rack_zone: "S-1", total_racks: 40, in_use: 10, available: 25, reserved: 4, pending_dismantle: 1 })],
  existingMonths: new Set([SOURCE_MONTH])
};

// --- (5)(6) same-site only: each site's plan rows carry ONLY its own totals/rows
const plan = planBackfill([rangsit, srinakarin], new Date("2026-07-15T00:00:00Z"));
const rangsitRows = plan.filter(r => r.site === "rangsit");
const srinRows = plan.filter(r => r.site === "srinakarin");
assert.ok(rangsitRows.every(r => r.siteId === 11 && r.sourceRowCount === 2 && r.expectedTotalRacks === 237), "(5) Rangsit uses only Rangsit source (2 rows, 120+117 racks)");
assert.ok(srinRows.every(r => r.siteId === 22 && r.sourceRowCount === 1 && r.expectedTotalRacks === 40), "(6) Srinakarin uses only Srinakarin source (1 row, 40 racks)");
assert.equal(rangsitRows.find(r => r.targetMonth === "2026-03")!.inUse, 120);
assert.equal(srinRows.find(r => r.targetMonth === "2026-03")!.inUse, 10);

// --- (4)(7)(11) actions -----------------------------------------------------
for (const m of TARGET_MONTHS) {
  assert.equal(rangsitRows.find(r => r.targetMonth === m)!.action, "INSERT", `(1) missing ${m} -> INSERT`);
}
assert.equal(plan.find(r => r.site === "rangsit" && r.targetMonth === SOURCE_MONTH)!.action, "KEEP_EXISTING", "(7) July -> KEEP_EXISTING");

// (11) idempotent: a second run (every target month already present) -> all SKIP_EXISTING, zero INSERT
const secondRun = planBackfill(
  [{ ...rangsit, existingMonths: new Set([SOURCE_MONTH, ...TARGET_MONTHS]) },
   { ...srinakarin, existingMonths: new Set([SOURCE_MONTH, ...TARGET_MONTHS]) }],
  new Date("2026-07-15T00:00:00Z")
);
assert.equal(secondRun.filter(r => r.action === "INSERT").length, 0, "(11) second run inserts nothing");
assert.ok(secondRun.filter(r => TARGET_MONTHS.includes(r.targetMonth as (typeof TARGET_MONTHS)[number])).every(r => r.action === "SKIP_EXISTING"), "(11) all target months SKIP_EXISTING");

// (4) a partial pre-existing month is skipped, the rest still INSERT
const partial = planBackfill([{ ...rangsit, existingMonths: new Set([SOURCE_MONTH, "2026-02"]) }, srinakarin], new Date("2026-07-15T00:00:00Z"));
assert.equal(partial.find(r => r.site === "rangsit" && r.targetMonth === "2026-02")!.action, "SKIP_EXISTING");
assert.equal(partial.find(r => r.site === "rangsit" && r.targetMonth === "2026-01")!.action, "INSERT");

// SOURCE_MISSING when a site has no July snapshot (never fabricated)
const noSource = planBackfill([{ ...rangsit, hasSource: false, records: [], history: [] }], new Date("2026-07-15T00:00:00Z"));
assert.ok(noSource.every(r => r.action === "SOURCE_MISSING"), "no July snapshot -> SOURCE_MISSING, never INSERT");

// planner refuses a future target month
assert.throws(() => planBackfill([rangsit], new Date("2026-01-15T00:00:00Z")), /future target month/, "refuses to write a month after 'now'");

// --- (1)(3) cloned values: business content copied, identity/audit regenerated
const recVals = recordInsertValues(rangsit.records[0], "NEW-SNAP-99");
assert.deepEqual(recVals, ["NEW-SNAP-99", 1, "Zone A", "AA01", "In Use", "42U", "compute", "server", "", JSON.stringify({ note: "x" })],
  "(1) rack_capacity_records tuple = new snapshot_id + business fields + raw_inputs; NO source id");
assert.equal(recVals.length, 10, "record tuple has no primary-key column");

const now = "2026-08-01T12:00:00.000Z";
const histVals = historyInsertValues(rangsit.history[0], 11, "2026-03", now);
assert.deepEqual(histVals, [11, "2026-03-01", "Rangsit", "Zone A", 120, 70, 40, 7, 3, 0, 0.6, 0.3, 0.07, 0.03, 0, now, 1],
  "(3) rack_capacity_history tuple = target site_id + target month + copied zone totals/pcts + fresh generated_at");
// (3) month + site identity is the TARGET, not the source
assert.equal(histVals[0], 11);
assert.equal(histVals[1], "2026-03-01");
// (2) generated_at is regenerated (the passed 'now'), not a source timestamp
assert.equal(histVals[15], now);

// --- structural guarantees in the script text -----------------------------
// (2) new IDs: snapshots inserted with only (site_id, snapshot_month, row_version); records/history never list `id`
assert.match(src, /INSERT INTO public\.rack_capacity_snapshots \(site_id, snapshot_month, row_version\) VALUES \(\$1, \$2::date, 1\) ON CONFLICT \(site_id, snapshot_month\) DO NOTHING RETURNING id/);
assert.doesNotMatch(src, /INSERT INTO public\.rack_capacity_records[\s\S]{0,120}\bid\b\s*,/);
assert.match(src, /ON CONFLICT \(site_id, snapshot_month, rack_zone\) DO NOTHING/); // (4) history never overwritten
// (4) execute loop pre-checks existence and skips
assert.match(src, /SELECT 1 FROM public\.rack_capacity_snapshots WHERE site_id = \$1 AND snapshot_month = \$2::date/);
assert.match(src, /pushTo\(skippedBySite, baseline\.site\.code, targetMonth\)/);
// no destructive SQL statements anywhere (prose like "no DELETE" is fine)
assert.doesNotMatch(src, /DELETE\s+FROM|DROP\s+(TABLE|INDEX|COLUMN)|TRUNCATE\s+\w|UPDATE\s+public\.\w+\s+SET/i);
const tablesTouched = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+public\.([a-z_]+)/gi)].map(m => m[1].toLowerCase());
assert.ok(tablesTouched.length >= 5, "sanity: found the qualified SQL table references");
const allowedTables = new Set(["rack_capacity_snapshots", "rack_capacity_records", "rack_capacity_history", "sites"]);
const disallowed = [...new Set(tablesTouched)].filter(t => !allowedTables.has(t));
assert.deepEqual(disallowed, [], `backfill SQL must only touch ${[...allowedTables].join(", ")}; also referenced: ${disallowed.join(", ")}`);
// per-site atomic transaction, advisory lock, rollback on error
assert.match(src, /await client\.query\("BEGIN"\)/);
assert.match(src, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
assert.match(src, /await client\.query\("ROLLBACK"\)\.catch\(\(\) => undefined\);\s*\n\s*throw new Error\(`Backfill failed for site/);
assert.match(src, /await client\.query\("COMMIT"\)/);
// write guards are not weakened
assert.match(src, /if \(process\.env\.BACKFILL_ALLOW_WRITE !== "true"\) throw new Error\("--execute requires BACKFILL_ALLOW_WRITE=true\."\)/);
assert.match(src, /if \(config\.readOnlyMode\) throw new Error\("Refusing to --execute: READ_ONLY_MODE is set/);
assert.match(src, /if \(sites\.length !== 2\) throw new Error/);
assert.match(src, /requireMigrationDatabase: true/);
// provenance is logged (no schema migration added)
assert.match(src, /provenance: Backfilled from July 2026 baseline \| site=\$\{baseline\.site\.code\} id=\$\{baseline\.site\.id\} \|/);
assert.ok(!/CREATE TABLE|ALTER TABLE|apply_migration/i.test(src), "no schema change");
// entrypoint guard uses basename equality so importing helpers never runs main()
assert.match(src, /const invokedBasename = process\.argv\[1\]\?\.split\(\/\[\\\\\/\]\/\)\.pop\(\);\s*\n\s*if \(invokedBasename === "backfill-rack-capacity-history\.ts"\)/);
assert.doesNotMatch(src, /process\.argv\[1\]\?\.endsWith/);
// dry run is the default (no --execute => no writes)
assert.match(src, /const execute = process\.argv\.includes\("--execute"\)/);
assert.match(src, /if \(!execute\) \{\s*\n\s*console\.log\("\\nDry run complete\. No rows written\./);

console.log("backfill-rack-capacity-history: same-site-only clone, new IDs, July untouched, idempotent, guarded, no schema change - verified");
