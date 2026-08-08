import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { ServerConfig } from "../config/env";

export type DbExecutor = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export function createPool(config: ServerConfig): Pool {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required to create a PostgreSQL pool.");
  return new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
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
