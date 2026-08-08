import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { ServerConfig } from "../config/env";

export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export function createPool(config: ServerConfig, mode: "runtime" | "migration" = "runtime"): Pool {
  const connectionString = mode === "migration" ? (config.directDatabaseUrl ?? config.databaseUrl) : config.databaseUrl;
  if (!connectionString) throw new Error(`${mode === "migration" ? "DIRECT_DATABASE_URL or DATABASE_URL" : "DATABASE_URL"} is required to create a PostgreSQL pool.`);
  return new Pool({ connectionString, max: config.poolMax, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function assertRuntimeRole(pool: Pool): Promise<void> {
  const result = await pool.query<{ current_user: string; is_superuser: boolean; bypass_rls: boolean; is_runtime_member: boolean }>(
    "SELECT current_user, rolsuper AS is_superuser, rolbypassrls AS bypass_rls, pg_has_role(current_user, 'energy_monitor_runtime', 'member') AS is_runtime_member FROM pg_roles WHERE rolname = current_user"
  );
  const row = result.rows[0];
  if (!row || row.is_superuser || row.bypass_rls || !row.is_runtime_member) throw new Error("DATABASE_URL must use a non-superuser login role that is a member of energy_monitor_runtime.");
}
export async function query<T extends QueryResultRow = QueryResultRow>(executor: DbExecutor, text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
  return executor.query<T>(text, values as unknown[]);
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
