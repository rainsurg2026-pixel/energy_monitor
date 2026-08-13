import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { runMigrations } from "../server/db/migrate";

loadDotEnvFile();
const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
const pool = createPool(config, "migration");
try {
  const result = await runMigrations(pool);
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
