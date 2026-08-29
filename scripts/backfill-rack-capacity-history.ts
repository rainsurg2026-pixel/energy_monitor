/**
 * ONE-TIME historical Rack Capacity backfill (Product-Owner authorized).
 *
 * For BOTH current facilities, use each site's own persisted JULY 2026 Rack
 * Capacity Editor snapshot as the baseline and create standalone monthly
 * snapshots for every missing month in:
 *
 *   2025-12, 2026-01, 2026-02, 2026-03, 2026-04, 2026-05, 2026-06
 *
 * (2026-07 is the source; it is never recreated or overwritten.)
 *
 * SAME SITE ONLY. Rangsit July -> Rangsit Dec-25..Jun-26. Srinakarin July ->
 * Srinakarin Dec-25..Jun-26. There is no code path that reads one site's
 * source and writes another site's month.
 *
 * Tables written (all keyed by site_id + month, all with a UNIQUE guard):
 *   - rack_capacity_snapshots  (id IDENTITY, row_version = 1, created/updated = now())
 *   - rack_capacity_records    (id IDENTITY, snapshot_id = the new snapshot)  <- business rows cloned verbatim
 *   - rack_capacity_history    (id IDENTITY, generated_at = now())           <- aggregate rows cloned, month swapped
 *
 * Nothing else is touched: no monthly_logs / UPS / Air / DC / energy tables,
 * no rack_unit_capacity_*, no users/auth/audit, no schema, no DELETE.
 *
 * Idempotent: a month that already has a rack_capacity_snapshots row is
 * reported SKIP_EXISTING and left completely alone (July values are never
 * merged in). A second run therefore writes nothing.
 *
 * Provenance: this table family has no provenance column and this backfill
 * does NOT add a migration for one. Provenance ("Backfilled from July 2026
 * baseline") is emitted in this script's log with the exact inserted
 * site/month/source-month/snapshot-id, per the execution brief.
 *
 * Usage:
 *   npx tsx scripts/backfill-rack-capacity-history.ts                 # DRY RUN (default) - writes nothing
 *   BACKFILL_ALLOW_WRITE=true npx tsx scripts/backfill-rack-capacity-history.ts --execute
 *
 * --execute additionally requires: a resolvable DIRECT_DATABASE_URL /
 * DATABASE_URL (never entered by an assistant - set by the operator),
 * READ_ONLY_MODE not truthy (Preview is read-only and must never be the
 * target), and exactly two sites present.
 */
import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import type { Pool, PoolClient } from "pg";

export const SOURCE_MONTH = "2026-07";
export const TARGET_MONTHS = [
  "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"
] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface SiteRow { id: number; code: string; name: string }

/** A cloned Rack Capacity Editor business row. Technical identity is NOT
 *  copied: `id` is IDENTITY-generated and `snapshot_id` is the new month's
 *  snapshot. Only Rack Capacity business content + raw_inputs carry over. */
export interface RackRecordSource {
  source_row_number: number | null;
  rack_zone: string | null;
  rack_id: string | null;
  status: string | null;
  cabinet_size: string | null;
  detail: string | null;
  device_type: string | null;
  remarks: string | null;
  raw_inputs: unknown;
}

/** A cloned aggregate history row. `id` (IDENTITY) and `generated_at` are
 *  regenerated; `site_id` + `snapshot_month` are set to the target; the
 *  computed zone totals / percentages / data_version carry over unchanged so
 *  the History summary for a backfilled month equals that site's July. */
export interface RackHistorySource {
  facility: string;
  rack_zone: string;
  total_racks: number;
  in_use: number;
  available: number;
  reserved: number;
  pending_dismantle: number;
  other: number;
  usage_pct: number | null;
  availability_pct: number | null;
  reserved_pct: number | null;
  pending_dismantle_pct: number | null;
  other_pct: number | null;
  data_version: number;
}

export interface SiteBaseline {
  site: SiteRow;
  /** July snapshot exists? Without it this site cannot be backfilled. */
  hasSource: boolean;
  records: RackRecordSource[];
  history: RackHistorySource[];
  /** Months (YYYY-MM) that already have a rack_capacity_snapshots row. */
  existingMonths: ReadonlySet<string>;
  /** Target months whose existing snapshot is missing records or history
   *  rows - these would be SKIP_EXISTING'd yet stay broken; flagged loudly. */
  emptyExistingMonths?: string[];
}

export type BackfillAction = "INSERT" | "SKIP_EXISTING" | "KEEP_EXISTING" | "SOURCE_MISSING";

export interface PlanRow {
  site: string;
  siteId: number;
  targetMonth: string;
  sourceMonth: string;
  sourceRowCount: number;
  existingTarget: boolean;
  action: BackfillAction;
  expectedTotalRacks: number;
  inUse: number;
  available: number;
  reserved: number;
  pendingDismantle: number;
}

function assertMonthAllowList(): void {
  const bad = TARGET_MONTHS.filter(m => !MONTH_RE.test(m) || m >= SOURCE_MONTH || m < "2025-12");
  if (bad.length > 0) throw new Error(`TARGET_MONTHS contains a disallowed month: ${bad.join(", ")}`);
  if (!MONTH_RE.test(SOURCE_MONTH)) throw new Error(`SOURCE_MONTH is not a canonical YYYY-MM: ${SOURCE_MONTH}`);
  if (new Set(TARGET_MONTHS).size !== TARGET_MONTHS.length) throw new Error("TARGET_MONTHS has duplicates.");
}

function currentMonthUtc(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Pure planner: given each site's July baseline + which months already
 *  exist, decide the action for every (site, target month). No I/O. */
export function planBackfill(baselines: readonly SiteBaseline[], now = new Date()): PlanRow[] {
  assertMonthAllowList();
  const nowMonth = currentMonthUtc(now);
  const rows: PlanRow[] = [];
  for (const baseline of baselines) {
    const totals = baseline.history.reduce(
      (acc, row) => ({
        total: acc.total + row.total_racks,
        inUse: acc.inUse + row.in_use,
        available: acc.available + row.available,
        reserved: acc.reserved + row.reserved,
        pending: acc.pending + row.pending_dismantle
      }),
      { total: 0, inUse: 0, available: 0, reserved: 0, pending: 0 }
    );
    for (const targetMonth of TARGET_MONTHS) {
      if (targetMonth > nowMonth) throw new Error(`Refusing a future target month ${targetMonth} (now ${nowMonth}).`);
      const existingTarget = baseline.existingMonths.has(targetMonth);
      const action: BackfillAction = !baseline.hasSource
        ? "SOURCE_MISSING"
        : existingTarget
          ? "SKIP_EXISTING"
          : "INSERT";
      rows.push({
        site: baseline.site.code,
        siteId: baseline.site.id,
        targetMonth,
        sourceMonth: SOURCE_MONTH,
        sourceRowCount: baseline.records.length,
        existingTarget,
        action,
        expectedTotalRacks: totals.total,
        inUse: totals.inUse,
        available: totals.available,
        reserved: totals.reserved,
        pendingDismantle: totals.pending
      });
    }
    rows.push({
      site: baseline.site.code, siteId: baseline.site.id, targetMonth: SOURCE_MONTH, sourceMonth: SOURCE_MONTH,
      sourceRowCount: baseline.records.length, existingTarget: baseline.hasSource,
      action: baseline.hasSource ? "KEEP_EXISTING" : "SOURCE_MISSING",
      expectedTotalRacks: totals.total, inUse: totals.inUse, available: totals.available,
      reserved: totals.reserved, pendingDismantle: totals.pending
    });
  }
  return rows;
}

/** Map a July Editor row -> the INSERT tuple for rack_capacity_records under
 *  the new month's snapshot. `id` is IDENTITY-generated; `snapshot_id` is the
 *  freshly created target snapshot. */
export function recordInsertValues(source: RackRecordSource, newSnapshotId: string | number): unknown[] {
  return [
    newSnapshotId,
    source.source_row_number,
    source.rack_zone,
    source.rack_id,
    source.status,
    source.cabinet_size,
    source.detail,
    source.device_type,
    source.remarks,
    JSON.stringify(source.raw_inputs ?? {})
  ];
}

/** Map a July aggregate row -> the INSERT tuple for rack_capacity_history at
 *  the target month. `id` is IDENTITY-generated; `generated_at` is stamped
 *  now (an honest "created during backfill" time, not a fake measurement). */
export function historyInsertValues(source: RackHistorySource, siteId: number, targetMonth: string, generatedAtIso: string): unknown[] {
  return [
    siteId,
    `${targetMonth}-01`,
    source.facility,
    source.rack_zone,
    source.total_racks,
    source.in_use,
    source.available,
    source.reserved,
    source.pending_dismantle,
    source.other,
    source.usage_pct,
    source.availability_pct,
    source.reserved_pct,
    source.pending_dismantle_pct,
    source.other_pct,
    generatedAtIso,
    source.data_version
  ];
}

export const RECORD_INSERT_SQL = `INSERT INTO public.rack_capacity_records
  (snapshot_id, source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`;

export const HISTORY_INSERT_SQL = `INSERT INTO public.rack_capacity_history
  (site_id, snapshot_month, facility, rack_zone, total_racks, in_use, available, reserved, pending_dismantle, other,
   usage_pct, availability_pct, reserved_pct, pending_dismantle_pct, other_pct, generated_at, data_version)
  VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17)
  ON CONFLICT (site_id, snapshot_month, rack_zone) DO NOTHING`;

async function readSiteBaseline(client: PoolClient, site: SiteRow): Promise<SiteBaseline> {
  const snapshot = await client.query<{ id: string }>(
    "SELECT id FROM public.rack_capacity_snapshots WHERE site_id = $1 AND snapshot_month = $2::date",
    [site.id, `${SOURCE_MONTH}-01`]
  );
  const hasSource = snapshot.rows.length > 0;
  const records = hasSource
    ? (await client.query<RackRecordSource>(
        `SELECT source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs
         FROM public.rack_capacity_records WHERE snapshot_id = $1 ORDER BY source_row_number NULLS LAST, id`,
        [snapshot.rows[0].id]
      )).rows
    : [];
  const history = hasSource
    ? (await client.query<RackHistorySource>(
        `SELECT facility, rack_zone, total_racks, in_use, available, reserved, pending_dismantle, other,
                usage_pct, availability_pct, reserved_pct, pending_dismantle_pct, other_pct, data_version
         FROM public.rack_capacity_history WHERE site_id = $1 AND snapshot_month = $2::date ORDER BY rack_zone`,
        [site.id, `${SOURCE_MONTH}-01`]
      )).rows
    : [];
  const existing = await client.query<{ ym: string }>(
    "SELECT to_char(snapshot_month, 'YYYY-MM') AS ym FROM public.rack_capacity_snapshots WHERE site_id = $1",
    [site.id]
  );
  // For every TARGET month that already has a snapshot, count its records +
  // history rows so a pre-existing but *empty* month is flagged loudly rather
  // than silently SKIP_EXISTING'd.
  const existingTargetHealth = await client.query<{ ym: string; record_count: string; history_count: string }>(
    `SELECT to_char(s.snapshot_month, 'YYYY-MM') AS ym,
            (SELECT count(*) FROM public.rack_capacity_records r WHERE r.snapshot_id = s.id) AS record_count,
            (SELECT count(*) FROM public.rack_capacity_history h WHERE h.site_id = s.site_id AND h.snapshot_month = s.snapshot_month) AS history_count
     FROM public.rack_capacity_snapshots s
     WHERE s.site_id = $1 AND to_char(s.snapshot_month, 'YYYY-MM') = ANY($2::text[])`,
    [site.id, [...TARGET_MONTHS]]
  );
  const emptyExistingMonths = existingTargetHealth.rows
    .filter(r => Number(r.record_count) === 0 || Number(r.history_count) === 0)
    .map(r => `${r.ym} (records=${r.record_count}, history=${r.history_count})`);
  return { site, hasSource, records, history, existingMonths: new Set(existing.rows.map(r => r.ym)), emptyExistingMonths };
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function renderPlan(rows: readonly PlanRow[]): string {
  // Total* columns are the site's July grand total (sum across all zone rows);
  // every backfilled month is a verbatim July clone so they are identical for
  // all target months of a site. `other` racks = Total - (InUse+Avail+Reserved+PendingDismantle).
  const header = ["Site", "Target", "Source", "SrcRows", "Existing?", "Action", "SiteTotalRacks", "InUse", "Available", "Reserved", "PendingDismantle"];
  const body = rows.map(r => [
    r.site, r.targetMonth, r.sourceMonth, String(r.sourceRowCount), r.existingTarget ? "yes" : "no",
    r.action, String(r.expectedTotalRacks), String(r.inUse), String(r.available), String(r.reserved), String(r.pendingDismantle)
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [line(header), widths.map(w => "-".repeat(w)).join("-+-"), ...body.map(line)].join("\n");
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  assertMonthAllowList();

  loadDotEnvFile();
  const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
  if (execute) {
    if (process.env.BACKFILL_ALLOW_WRITE !== "true") throw new Error("--execute requires BACKFILL_ALLOW_WRITE=true.");
    if (config.readOnlyMode) throw new Error("Refusing to --execute: READ_ONLY_MODE is set. The backfill target must be the writable Production database, never Preview.");
  }

  const pool: Pool = createPool(config, "migration");
  const insertedBySite = new Map<string, string[]>();
  const skippedBySite = new Map<string, string[]>();
  let insertedSnapshots = 0;
  let insertedRecords = 0;
  let insertedHistory = 0;

  try {
    const sitesResult = await pool.query<{ id: string; code: string; name: string }>(
      "SELECT id, code, name FROM public.sites WHERE active = true ORDER BY code"
    );
    const sites: SiteRow[] = sitesResult.rows.map(r => ({ id: Number(r.id), code: r.code, name: r.name }));
    if (sites.length !== 2) throw new Error(`Expected exactly 2 sites; found ${sites.length} (${sites.map(s => s.code).join(", ") || "none"}).`);

    // --- read baselines (read-only, one short tx) ---
    const readClient = await pool.connect();
    let baselines: SiteBaseline[];
    try {
      await readClient.query("BEGIN");
      baselines = [];
      for (const site of sites) baselines.push(await readSiteBaseline(readClient, site));
      await readClient.query("ROLLBACK");
    } finally {
      readClient.release();
    }

    const plan = planBackfill(baselines);
    console.log(`\n${execute ? "EXECUTE" : "DRY RUN"} - Rack Capacity backfill  (source month ${SOURCE_MONTH})\n`);
    console.log(renderPlan(plan));

    for (const baseline of baselines) {
      console.log(
        `\n${baseline.site.code} (id=${baseline.site.id}): July source ${baseline.hasSource ? "FOUND" : "MISSING"} - ` +
        `${baseline.records.length} editor rows, ${baseline.history.length} history zone rows, ` +
        `existing snapshot months: ${[...baseline.existingMonths].sort().join(", ") || "(none)"}`
      );
      if (!baseline.hasSource) console.log(`  !! Cannot backfill ${baseline.site.code}: no persisted ${SOURCE_MONTH} rack_capacity_snapshots row.`);
      for (const broken of baseline.emptyExistingMonths ?? []) {
        console.log(`  !! WARNING ${baseline.site.code} ${broken}: snapshot exists but is empty - it will be SKIP_EXISTING'd and stay broken. Fix or delete it before relying on this month.`);
      }
    }

    if (!execute) {
      console.log("\nDry run complete. No rows written. Re-run with --execute and BACKFILL_ALLOW_WRITE=true against Production to apply.");
      return;
    }

    // --- execute: one transaction PER SITE (atomic; rollback on any error) ---
    for (const baseline of baselines) {
      if (!baseline.hasSource) { console.log(`SKIP site ${baseline.site.code}: source missing.`); continue; }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`rack-capacity-backfill:${baseline.site.id}`]);
        for (const targetMonth of TARGET_MONTHS) {
          const exists = await client.query(
            "SELECT 1 FROM public.rack_capacity_snapshots WHERE site_id = $1 AND snapshot_month = $2::date",
            [baseline.site.id, `${targetMonth}-01`]
          );
          if (exists.rows.length > 0) {
            pushTo(skippedBySite, baseline.site.code, targetMonth);
            continue;
          }
          const created = await client.query<{ id: string }>(
            "INSERT INTO public.rack_capacity_snapshots (site_id, snapshot_month, row_version) VALUES ($1, $2::date, 1) ON CONFLICT (site_id, snapshot_month) DO NOTHING RETURNING id",
            [baseline.site.id, `${targetMonth}-01`]
          );
          if (created.rows.length === 0) {
            pushTo(skippedBySite, baseline.site.code, targetMonth);
            continue;
          }
          const newSnapshotId = created.rows[0].id;
          insertedSnapshots += 1;
          for (const record of baseline.records) {
            await client.query(RECORD_INSERT_SQL, recordInsertValues(record, newSnapshotId));
            insertedRecords += 1;
          }
          const generatedAt = new Date().toISOString();
          for (const zone of baseline.history) {
            const result = await client.query(HISTORY_INSERT_SQL, historyInsertValues(zone, baseline.site.id, targetMonth, generatedAt));
            insertedHistory += result.rowCount ?? 0;
          }
          pushTo(insertedBySite, baseline.site.code, targetMonth);
          console.log(
            `provenance: Backfilled from July 2026 baseline | site=${baseline.site.code} id=${baseline.site.id} | ` +
            `month=${targetMonth} | source_month=${SOURCE_MONTH} | snapshot_id=${newSnapshotId} | ` +
            `records=${baseline.records.length} | history_rows=${baseline.history.length}`
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Backfill failed for site ${baseline.site.code}; that site's transaction was rolled back. Cause: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        client.release();
      }
    }

    console.log("\n=== BACKFILL RESULT ===");
    for (const site of sites) {
      console.log(`${site.code}: inserted [${(insertedBySite.get(site.code) ?? []).join(", ") || "none"}]  skipped-existing [${(skippedBySite.get(site.code) ?? []).join(", ") || "none"}]`);
    }
    console.log(`snapshots inserted: ${insertedSnapshots} | records inserted: ${insertedRecords} | history rows inserted: ${insertedHistory}`);
  } finally {
    await pool.end();
  }
}

// Only run when this file is the entrypoint. Basename equality (not endsWith)
// so `scripts/test-backfill-rack-capacity-history.ts` importing the helpers
// never triggers main().
const invokedBasename = process.argv[1]?.split(/[\\/]/).pop();
if (invokedBasename === "backfill-rack-capacity-history.ts") {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
