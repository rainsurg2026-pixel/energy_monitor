/**
 * Preview -> Production historical-data migration (MUST/SHOULD MIGRATE
 * tables only - see docs/web-clean-v1/PRODUCTION_DATA_MIGRATION_PLAN.md).
 *
 * Defaults to --dry-run: reads the source only, prints exactly what it
 * would copy (counts, aggregates, date ranges), writes nothing anywhere.
 * Real writes require --execute AND MIGRATION_ALLOW_WRITE=true AND a
 * target that is verified, at runtime, to be a different database than
 * the source - this refuses to run if source and target resolve to the
 * same connection string, as a hard guard against ever double-writing
 * into Preview.
 *
 * Never touches: users, local_credentials, auth_identities, sessions,
 * user_roles, http_rate_limit_buckets, audit_events, backup_config,
 * backup_log, google_oauth_states, google_sheets_connections - none of
 * those table names appear in this file. Admin creation is a separate,
 * already-existing script (scripts/bootstrap-admin.ts), not this one.
 *
 * Usage:
 *   npx tsx scripts/migrate-preview-to-production.ts               # dry-run (default)
 *   MIGRATION_SOURCE_DATABASE_URL=... MIGRATION_TARGET_DATABASE_URL=... \
 *     MIGRATION_ALLOW_WRITE=true npx tsx scripts/migrate-preview-to-production.ts --execute
 */
import { Pool } from "pg";

const DRY_RUN = !process.argv.includes("--execute");

if (!DRY_RUN) {
  throw new Error("Preview-to-Production migration is retired: Preview now shares the Production database and must never be used as a write source.");
}

interface SiteRow { id: string; code: string; name: string }
interface PeriodRow { id: string; site_id: string; period_month: string; row_version: number }

async function main(): Promise<void> {
  const sourceUrl = process.env.MIGRATION_SOURCE_DATABASE_URL;
  if (!sourceUrl) throw new Error("MIGRATION_SOURCE_DATABASE_URL is required (Preview's DATABASE_URL, read-only use here).");
  const source = new Pool({ connectionString: sourceUrl, max: 3 });

  let target: Pool | null = null;
  if (!DRY_RUN) {
    if (process.env.MIGRATION_ALLOW_WRITE !== "true") throw new Error("--execute requires MIGRATION_ALLOW_WRITE=true.");
    const targetUrl = process.env.MIGRATION_TARGET_DATABASE_URL;
    if (!targetUrl) throw new Error("MIGRATION_TARGET_DATABASE_URL is required for --execute.");
    if (targetUrl.trim() === sourceUrl.trim()) throw new Error("Refusing to run: source and target connection strings are identical. This would write into Preview.");
    target = new Pool({ connectionString: targetUrl, max: 3 });
    const [sourceDb, targetDb] = await Promise.all([
      source.query<{ current_database: string }>("SELECT current_database()"),
      target.query<{ current_database: string }>("SELECT current_database()")
    ]);
    // Belt-and-suspenders: even with different connection strings, refuse
    // if they somehow resolve to the same physical database.
    if (sourceDb.rows[0].current_database === targetDb.rows[0].current_database) {
      const sourceHost = new URL(sourceUrl.replace(/^postgres(ql)?:/, "http:")).host;
      const targetHost = new URL(targetUrl.replace(/^postgres(ql)?:/, "http:")).host;
      if (sourceHost === targetHost) throw new Error("Refusing to run: source and target resolve to the same database host+name.");
    }
  }

  try {
    // --- 1. Read source: sites ---
    const sites = await source.query<SiteRow>("SELECT id, code, name FROM public.sites ORDER BY code");
    console.log(`Sites in source: ${sites.rows.map(s => `${s.code} (id=${s.id})`).join(", ")}`);

    // --- 2. Read source: monthly_periods per site, with date range ---
    const periodSummary = await source.query<{ code: string; periods: string; earliest: string; latest: string }>(
      `SELECT s.code, count(mp.id) AS periods, min(mp.period_month) AS earliest, max(mp.period_month) AS latest
       FROM public.sites s LEFT JOIN public.monthly_periods mp ON mp.site_id = s.id
       GROUP BY s.code ORDER BY s.code`
    );
    for (const row of periodSummary.rows) {
      console.log(`  ${row.code}: ${row.periods} periods, ${row.earliest} .. ${row.latest}`);
    }

    // --- 3. Aggregate integrity targets (verification baseline) ---
    const upsAgg = await source.query<{ sum_load_kw: string; sum_load_kva: string; n: string }>(
      "SELECT round(sum(load_kw)::numeric,2) AS sum_load_kw, round(sum(load_kva)::numeric,2) AS sum_load_kva, count(*) AS n FROM public.ups_readings"
    );
    console.log(`ups_readings: n=${upsAgg.rows[0].n}, sum(load_kw)=${upsAgg.rows[0].sum_load_kw}, sum(load_kva)=${upsAgg.rows[0].sum_load_kva}`);

    const tableCounts = await source.query<{ t: string; n: string }>(`
      SELECT 'air_meter_readings' t, count(*) n FROM public.air_meter_readings
      UNION ALL SELECT 'dc_readings', count(*) FROM public.dc_readings
      UNION ALL SELECT 'electrical_phase_readings', count(*) FROM public.electrical_phase_readings
      UNION ALL SELECT 'energy_cost_inputs', count(*) FROM public.energy_cost_inputs
      UNION ALL SELECT 'rack_capacity_snapshots', count(*) FROM public.rack_capacity_snapshots
      UNION ALL SELECT 'rack_capacity_records', count(*) FROM public.rack_capacity_records
      UNION ALL SELECT 'rack_unit_capacity_snapshots', count(*) FROM public.rack_unit_capacity_snapshots
    `);
    for (const row of tableCounts.rows) console.log(`  ${row.t}: ${row.n}`);

    if (DRY_RUN) {
      console.log("\nDRY RUN complete - no writes attempted anywhere. Re-run with --execute (and required env vars) to perform the real, guarded copy.");
      return;
    }

    if (!target) throw new Error("Internal error: --execute set but target pool was not created.");

    // --- Real copy path (sites -> monthly_periods -> readings -> rack) ---
    // Intentionally verbose/explicit rather than generic - this is a
    // one-time, reviewed operation, not reusable ETL infrastructure.
    await target.query("BEGIN");
    try {
      const siteIdMap = new Map<string, string>(); // source site id -> target site id
      for (const site of sites.rows) {
        const existing = await target.query<{ id: string }>("SELECT id FROM public.sites WHERE code = $1", [site.code]);
        if (existing.rows[0]) {
          siteIdMap.set(site.id, existing.rows[0].id);
          continue;
        }
        const inserted = await target.query<{ id: string }>(
          "INSERT INTO public.sites(code, name, active) VALUES ($1, $2, true) RETURNING id",
          [site.code, site.name]
        );
        siteIdMap.set(site.id, inserted.rows[0].id);
      }
      console.log(`Sites ready in target: ${[...siteIdMap.entries()].map(([s, t]) => `${s}->${t}`).join(", ")}`);

      const periodIdMap = new Map<string, string>();
      const periods = await source.query<PeriodRow>("SELECT id, site_id, period_month, row_version FROM public.monthly_periods");
      for (const period of periods.rows) {
        const targetSiteId = siteIdMap.get(period.site_id);
        if (!targetSiteId) throw new Error(`No target site mapping for source site_id=${period.site_id}`);
        const inserted = await target.query<{ id: string }>(
          `INSERT INTO public.monthly_periods(site_id, period_month, row_version) VALUES ($1, $2, $3)
           ON CONFLICT (site_id, period_month) DO UPDATE SET row_version = EXCLUDED.row_version
           RETURNING id`,
          [targetSiteId, period.period_month, period.row_version]
        );
        periodIdMap.set(period.id, inserted.rows[0].id);
      }
      console.log(`Migrated ${periodIdMap.size} monthly_periods rows.`);

      // Readings tables: device/meter/panel codes are looked up (never
      // hand-mapped) via the same upsert-by-code pattern the running
      // application already uses in saveMonthlyLogInTransaction, so the
      // resulting devices/air_meters/dc_panels rows in target are
      // identical to what a real Data Entry save would produce.
      const upsertDeviceId = async (targetSiteId: string, code: string): Promise<string> => {
        const result = await target!.query<{ id: string }>(
          `INSERT INTO public.devices(site_id, code, name, kind) VALUES ($1, $2, $2, 'ups')
           ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [targetSiteId, code]
        );
        return result.rows[0].id;
      };
      const upsertMeterId = async (targetSiteId: string, code: string): Promise<string> => {
        const result = await target!.query<{ id: string }>(
          `INSERT INTO public.air_meters(site_id, code, name) VALUES ($1, $2, $2)
           ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [targetSiteId, code]
        );
        return result.rows[0].id;
      };
      const upsertPanelId = async (targetSiteId: string, code: string): Promise<string> => {
        const result = await target!.query<{ id: string }>(
          `INSERT INTO public.dc_panels(site_id, code, name) VALUES ($1, $2, $2)
           ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [targetSiteId, code]
        );
        return result.rows[0].id;
      };

      const upsReadings = await source.query<{ period_id: string; site_id: string; code: string; phase_code: string; voltage: string | null; current: string | null; load_kw: string | null; load_kva: string | null; raw_inputs: unknown }>(
        `SELECT u.period_id, u.site_id, d.code, u.phase_code, u.voltage, u.current, u.load_kw, u.load_kva, u.raw_inputs
         FROM public.ups_readings u JOIN public.devices d ON d.id = u.device_id`
      );
      for (const row of upsReadings.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        const targetPeriodId = periodIdMap.get(row.period_id)!;
        const targetDeviceId = await upsertDeviceId(targetSiteId, row.code);
        await target.query(
          `INSERT INTO public.ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (period_id, device_id, phase_code) DO NOTHING`,
          [targetPeriodId, targetDeviceId, targetSiteId, row.phase_code, row.voltage, row.current, row.load_kw, row.load_kva, row.raw_inputs]
        );
      }
      console.log(`Migrated ${upsReadings.rows.length} ups_readings rows.`);

      const airReadings = await source.query<{ period_id: string; site_id: string; code: string; reading: string | null; raw_inputs: unknown }>(
        `SELECT a.period_id, a.site_id, m.code, a.reading, a.raw_inputs
         FROM public.air_meter_readings a JOIN public.air_meters m ON m.id = a.meter_id`
      );
      for (const row of airReadings.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        const targetPeriodId = periodIdMap.get(row.period_id)!;
        const targetMeterId = await upsertMeterId(targetSiteId, row.code);
        await target.query(
          `INSERT INTO public.air_meter_readings(period_id, meter_id, site_id, reading, raw_inputs)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (period_id, meter_id) DO NOTHING`,
          [targetPeriodId, targetMeterId, targetSiteId, row.reading, row.raw_inputs]
        );
      }
      console.log(`Migrated ${airReadings.rows.length} air_meter_readings rows.`);

      const dcReadings = await source.query<{ period_id: string; site_id: string; code: string; voltage: string | null; current: string | null; raw_inputs: unknown }>(
        `SELECT d.period_id, d.site_id, p.code, d.voltage, d.current, d.raw_inputs
         FROM public.dc_readings d JOIN public.dc_panels p ON p.id = d.panel_id`
      );
      for (const row of dcReadings.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        const targetPeriodId = periodIdMap.get(row.period_id)!;
        const targetPanelId = await upsertPanelId(targetSiteId, row.code);
        await target.query(
          `INSERT INTO public.dc_readings(period_id, panel_id, site_id, voltage, current, raw_inputs)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (period_id, panel_id) DO NOTHING`,
          [targetPeriodId, targetPanelId, targetSiteId, row.voltage, row.current, row.raw_inputs]
        );
      }
      console.log(`Migrated ${dcReadings.rows.length} dc_readings rows.`);

      const phaseReadings = await source.query<{ period_id: string; site_id: string; source_kind: string; source_key: string; phase_code: string; panel_key: string; voltage: string | null; current: string | null; load_kw: string | null; load_kva: string | null; raw_inputs: unknown }>(
        "SELECT period_id, site_id, source_kind, source_key, phase_code, panel_key, voltage, current, load_kw, load_kva, raw_inputs FROM public.electrical_phase_readings"
      );
      for (const row of phaseReadings.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        const targetPeriodId = periodIdMap.get(row.period_id)!;
        await target.query(
          `INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, panel_key, voltage, current, load_kw, load_kva, raw_inputs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (period_id, source_kind, source_key, phase_code, panel_key) DO NOTHING`,
          [targetPeriodId, targetSiteId, row.source_kind, row.source_key, row.phase_code, row.panel_key, row.voltage, row.current, row.load_kw, row.load_kva, row.raw_inputs]
        );
      }
      console.log(`Migrated ${phaseReadings.rows.length} electrical_phase_readings rows.`);

      const energyCost = await source.query<{ period_id: string; site_id: string; building_energy_kwh: string | null; building_cost_thb: string | null; raw_inputs: unknown }>(
        "SELECT period_id, site_id, building_energy_kwh, building_cost_thb, raw_inputs FROM public.energy_cost_inputs"
      );
      for (const row of energyCost.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        const targetPeriodId = periodIdMap.get(row.period_id)!;
        await target.query(
          `INSERT INTO public.energy_cost_inputs(period_id, site_id, building_energy_kwh, building_cost_thb, raw_inputs)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (period_id) DO NOTHING`,
          [targetPeriodId, targetSiteId, row.building_energy_kwh, row.building_cost_thb, row.raw_inputs]
        );
      }
      console.log(`Migrated ${energyCost.rows.length} energy_cost_inputs rows.`);

      // Rack capacity: current-state snapshot + records (not a month series).
      const rackSnapshots = await source.query<{ id: string; site_id: string; snapshot_month: string; row_version: number }>(
        "SELECT id, site_id, snapshot_month, row_version FROM public.rack_capacity_snapshots"
      );
      for (const snap of rackSnapshots.rows) {
        const targetSiteId = siteIdMap.get(snap.site_id)!;
        const insertedSnap = await target.query<{ id: string }>(
          `INSERT INTO public.rack_capacity_snapshots(site_id, snapshot_month, row_version) VALUES ($1,$2,$3)
           ON CONFLICT (site_id, snapshot_month) DO UPDATE SET row_version = EXCLUDED.row_version RETURNING id`,
          [targetSiteId, snap.snapshot_month, snap.row_version]
        );
        const targetSnapshotId = insertedSnap.rows[0].id;
        const records = await source.query<{ source_row_number: number | null; rack_zone: string | null; rack_id: string | null; status: string | null; cabinet_size: string | null; detail: string | null; device_type: string | null; remarks: string | null; raw_inputs: unknown }>(
          "SELECT source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs FROM public.rack_capacity_records WHERE snapshot_id = $1",
          [snap.id]
        );
        for (const rec of records.rows) {
          await target.query(
            `INSERT INTO public.rack_capacity_records(snapshot_id, source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [targetSnapshotId, rec.source_row_number, rec.rack_zone, rec.rack_id, rec.status, rec.cabinet_size, rec.detail, rec.device_type, rec.remarks, rec.raw_inputs]
          );
        }
        console.log(`Migrated rack_capacity_snapshot for site ${targetSiteId}: ${records.rows.length} records.`);
      }

      const rackUnitSnapshots = await source.query<{ site_id: string; period_month: string; total_u: string; used_u: string; row_version: number }>(
        "SELECT site_id, period_month, total_u, used_u, row_version FROM public.rack_unit_capacity_snapshots"
      );
      for (const row of rackUnitSnapshots.rows) {
        const targetSiteId = siteIdMap.get(row.site_id)!;
        await target.query(
          `INSERT INTO public.rack_unit_capacity_snapshots(site_id, period_month, total_u, used_u, row_version)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (site_id, period_month) DO UPDATE SET total_u = EXCLUDED.total_u, used_u = EXCLUDED.used_u, row_version = EXCLUDED.row_version`,
          [targetSiteId, row.period_month, row.total_u, row.used_u, row.row_version]
        );
      }
      console.log(`Migrated ${rackUnitSnapshots.rows.length} rack_unit_capacity_snapshots rows.`);

      await target.query("COMMIT");
      console.log("\nMigration committed. Run the verification queries in PRODUCTION_DATA_MIGRATION_PLAN.md §5 before declaring go-live ready.");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
  } finally {
    await source.end();
    if (target) await target.end();
  }
}

void main();
