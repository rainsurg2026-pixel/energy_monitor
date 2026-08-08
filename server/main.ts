import { createApp } from "./http/app";
import { loadDotEnvFile, loadServerConfig } from "./config/env";
import { createPool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { PostgresRepository } from "./db/postgresRepository";

loadDotEnvFile();
const config = loadServerConfig();
const pool = createPool(config);
await runMigrations(pool);
const app = createApp({ config, repository: new PostgresRepository(pool) });
const server = app.listen(config.port, () => console.log(`Energy Monitor API listening on port ${config.port}`));
const shutdown = async () => { server.close(); await pool.end(); };
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
