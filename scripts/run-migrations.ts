import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { runMigrations } from "../server/db/migrate";

loadDotEnvFile();
const config = loadServerConfig();
const pool = createPool(config);
try {
  const result = await runMigrations(pool);
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
