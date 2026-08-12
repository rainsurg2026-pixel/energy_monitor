/**
 * Production-safe master-data seeding: creates ONLY the Rangsit and
 * Srinakarin sites (+ site_profiles) with fixed, deterministic values.
 * Touches no other table. Never run automatically - operator-invoked only,
 * with DIRECT_DATABASE_URL/DATABASE_URL supplied the same way as
 * scripts/run-migrations.ts.
 *
 * This is the mirror image of scripts/seed-development-master-data.ts,
 * which refuses to run IN production. This script refuses to run OUTSIDE
 * production, and additionally verifies the connection string itself
 * resolves to the specific known Production project - NODE_ENV alone is
 * not trusted, since a stale env var could claim NODE_ENV=production while
 * still pointing at Preview.
 */
import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool, withTransaction } from "../server/db/pool";
import { verifyProductionEnvironment, verifyProductionTarget } from "./lib/productionTargetGuard";
import { runPreflightScopeGuard, seedProductionSites } from "./lib/seedProductionSites";

loadDotEnvFile();

const environmentCheck = verifyProductionEnvironment(process.env.NODE_ENV);
if (!environmentCheck.ok) {
  throw new Error(`Refusing to run: ${environmentCheck.reason}`);
}

const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
const connectionString = config.directDatabaseUrl ?? config.databaseUrl;
const verification = verifyProductionTarget(connectionString);
if (!verification.ok) {
  throw new Error(`Refusing to run: ${verification.reason}`);
}
console.log(`Target verification: PASS - ${verification.reason}`);

const pool = createPool(config, "migration");

try {
  const result = await withTransaction(pool, async client => {
    const { usersCount } = await runPreflightScopeGuard(client);
    console.log(`Scope guard: PASS (users currently present: ${usersCount})`);
    return seedProductionSites(client);
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
