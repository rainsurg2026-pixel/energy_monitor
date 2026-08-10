import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import type { ServerConfig } from "../config/env";

export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export interface RuntimeDatabaseIdentityRow {
  runtime_member: boolean;
  bypass_rls: boolean;
}

export class RuntimeDatabaseIdentityError extends Error {
  readonly code = "RUNTIME_DB_ROLE_INVALID";

  constructor() {
    super("The runtime database identity must be a non-bypass member of energy_monitor_runtime.");
    this.name = "RuntimeDatabaseIdentityError";
  }
}

export function assertRuntimeDatabaseIdentity(row: RuntimeDatabaseIdentityRow | undefined): void {
  if (!row || row.runtime_member !== true || row.bypass_rls !== false) throw new RuntimeDatabaseIdentityError();
}

export async function verifyRuntimeDatabaseIdentity(executor: DbExecutor): Promise<void> {
  const result = await executor.query<RuntimeDatabaseIdentityRow>(`
    SELECT
      pg_has_role(current_user, 'energy_monitor_runtime', 'member') AS runtime_member,
      COALESCE(
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user),
        true
      ) AS bypass_rls
  `);
  assertRuntimeDatabaseIdentity(result.rows[0]);
}

function removeConnectionStringSslOptions(connectionString: string): string {
  const url = new URL(connectionString);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(parameter);
  return url.toString();
}

export function createPoolOptions(config: ServerConfig, mode: "runtime" | "migration" = "runtime"): PoolConfig {
  const connectionString = mode === "migration" ? (config.directDatabaseUrl ?? config.databaseUrl) : config.databaseUrl;
  if (!connectionString) throw new Error(`${mode === "migration" ? "DIRECT_DATABASE_URL or DATABASE_URL" : "DATABASE_URL"} is required to create a PostgreSQL pool.`);
  const ssl = config.databaseCaCertificate ? { ca: config.databaseCaCertificate, rejectUnauthorized: true } : undefined;
  if (mode === "runtime" && config.nodeEnv === "production" && !ssl) throw new Error("Verified TLS is required for a production API database connection.");
  return {
    connectionString: ssl ? removeConnectionStringSslOptions(connectionString) : connectionString,
    ssl,
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  };
}

export function createPool(config: ServerConfig, mode: "runtime" | "migration" = "runtime"): Pool {
  return new Pool(createPoolOptions(config, mode));
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
