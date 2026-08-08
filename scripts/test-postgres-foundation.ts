import assert from "node:assert/strict";
import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { runMigrations } from "../server/db/migrate";
import { createPool, withTransaction } from "../server/db/pool";

loadDotEnvFile();
if (process.env.NODE_ENV !== "test" || process.env.ALLOW_DATABASE_TESTS !== "true" || !process.env.DATABASE_URL) {
  console.log("postgres foundation: SKIPPED (set NODE_ENV=test, ALLOW_DATABASE_TESTS=true, and a localhost DATABASE_URL)");
  process.exit(0);
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) throw new Error("Refusing PostgreSQL integration tests against a non-local host.");
const config = loadServerConfig();
const pool = createPool(config);
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

try {
  const migration = await runMigrations(pool);
  check("foundation migration applied or already present", migration.applied.includes("001_phase2_foundation") || migration.skipped.includes("001_phase2_foundation"));
  await withTransaction(pool, async client => {
    async function rejectsQuery(text: string, values: unknown[] = []): Promise<void> {
      await client.query("SAVEPOINT phase2_expected_failure");
      await assert.rejects(() => client.query(text, values));
      await client.query("ROLLBACK TO SAVEPOINT phase2_expected_failure");
      await client.query("RELEASE SAVEPOINT phase2_expected_failure");
    }
    const site = await client.query<{ id: string }>("INSERT INTO sites(code, name) VALUES ('phase2-test-site', 'Phase 2 Test Site') RETURNING id");
    const siteId = site.rows[0].id;
    const otherSite = await client.query<{ id: string }>("INSERT INTO sites(code, name) VALUES ('phase2-test-other-site', 'Phase 2 Other Site') RETURNING id");
    const otherSiteId = otherSite.rows[0].id;
    await client.query("INSERT INTO monthly_periods(site_id, period_month) VALUES ($1, '2026-01-01')", [siteId]);
    await rejectsQuery("INSERT INTO monthly_periods(site_id, period_month) VALUES ($1, '2026-01-01')", [siteId]);
    await rejectsQuery("INSERT INTO monthly_periods(site_id, period_month) VALUES ($1, '2026-02-01')", [999999999]);
    const period = await client.query<{ id: string }>("SELECT id FROM monthly_periods WHERE site_id = $1 AND period_month = '2026-01-01'", [siteId]);
    const otherPeriod = await client.query<{ id: string }>("INSERT INTO monthly_periods(site_id, period_month) VALUES ($1, '2026-01-01') RETURNING id", [otherSiteId]);
    const device = await client.query<{ id: string }>("INSERT INTO devices(site_id, code, name, kind) VALUES ($1, 'UPS-A', 'UPS A', 'ups') RETURNING id", [siteId]);
    const otherDevice = await client.query<{ id: string }>("INSERT INTO devices(site_id, code, name, kind) VALUES ($1, 'UPS-B', 'UPS B', 'ups') RETURNING id", [otherSiteId]);
    await client.query("INSERT INTO ups_readings(period_id, device_id, site_id, phase_code, load_kw) VALUES ($1, $2, $3, '', 1)", [period.rows[0].id, device.rows[0].id, siteId]);
    await rejectsQuery("INSERT INTO ups_readings(period_id, device_id, site_id, phase_code, load_kw) VALUES ($1, $2, $3, '', 1)", [period.rows[0].id, otherDevice.rows[0].id, siteId]);
    await rejectsQuery("INSERT INTO ups_readings(period_id, device_id, site_id, phase_code, load_kw) VALUES ($1, $2, $3, '', 1)", [otherPeriod.rows[0].id, device.rows[0].id, otherSiteId]);
    checks += 5;
    throw new Error("intentional rollback");
  }).catch(error => { if (!(error instanceof Error) || error.message !== "intentional rollback") throw error; });
  const rolledBack = await pool.query("SELECT 1 FROM sites WHERE code = 'phase2-test-site'");
  check("transaction rollback removes logical save", rolledBack.rows.length === 0);
  await withTransaction(pool, async client => {
    await client.query("INSERT INTO global_settings(id, start_month, end_month) VALUES (1, '2026-01-01', '2026-12-01') ON CONFLICT (id) DO NOTHING");
    const first = await client.query("UPDATE global_settings SET row_version=row_version+1 WHERE id=1 AND row_version=1 RETURNING row_version");
    const stale = await client.query("UPDATE global_settings SET row_version=row_version+1 WHERE id=1 AND row_version=1 RETURNING row_version");
    check("optimistic update succeeds", first.rows.length === 1);
    check("stale optimistic update is rejected", stale.rows.length === 0);
    throw new Error("rollback settings test");
  }).catch(error => { if (!(error instanceof Error) || error.message !== "rollback settings test") throw error; });
  console.log(`postgres foundation: ${checks} assertions passed`);
} finally {
  await pool.end();
}
