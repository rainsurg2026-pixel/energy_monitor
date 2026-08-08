import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { withTransaction } from "./pool";

export interface MigrationResult { applied: string[]; skipped: string[]; }
const MIGRATION_LOCK_KEY = "736515828224";

function isMissingMigrationTable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "42P01");
}

export async function runMigrations(pool: Pool, directory = path.resolve(process.cwd(), "db/migrations")): Promise<MigrationResult> {
  const files = (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = await readFile(path.join(directory, file), "utf8");
    const applied = await withTransaction(pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
      const already = await client.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version = $1", [version]).catch(error => {
        if (isMissingMigrationTable(error)) return { rows: [] as { version: string }[] };
        throw error;
      });
      if (already.rows.length > 0) return false;
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
      return true;
    });
    if (applied) result.applied.push(version); else result.skipped.push(version);
  }
  return result;
}
