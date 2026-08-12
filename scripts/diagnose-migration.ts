/**
 * DIAGNOSTIC-ONLY. Never commits. Every statement runs inside SAVEPOINTs
 * under one outer transaction that is always rolled back at the end,
 * whether a statement failed or every statement succeeded - this script
 * cannot leave schema changes behind on any database it is pointed at.
 *
 * Executes one migration file's statements individually (using the
 * dollar-quote/comment/string-aware splitter in scripts/lib/sqlStatementSplitter.ts,
 * not a naive semicolon split) so that, unlike sending the whole file as one
 * multi-statement string, the FIRST real failure - and only the first - is
 * attributable to an exact statement index with its own PostgreSQL message,
 * code, detail, hint, and position.
 *
 * This is the operator's tool, not this session's: it must be run manually,
 * pointed at a throwaway/local database, never at Preview or Production. It
 * intentionally does not default DIRECT_DATABASE_URL/DATABASE_URL to
 * anything and does not print the connection string anywhere.
 *
 * Usage (operator-run only):
 *   $env:DIRECT_DATABASE_URL = "<a scratch database, never Preview/Production>"
 *   node node_modules/tsx/dist/cli.mjs scripts/diagnose-migration.ts db/migrations/001_phase2_foundation.sql
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { previewStatement, splitSqlStatements, statementIndexAtPosition } from "./lib/sqlStatementSplitter";

interface PostgresError {
  message?: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
}

async function main(): Promise<void> {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error("Usage: diagnose-migration.ts <path-to-migration-file.sql>");
    process.exitCode = 1;
    return;
  }
  const filePath = path.resolve(process.cwd(), filePathArg);
  const migrationName = path.basename(filePath).replace(/\.sql$/, "");
  const sql = await readFile(filePath, "utf8");
  const statements = splitSqlStatements(sql);

  loadDotEnvFile();
  const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
  const pool = createPool(config, "migration");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    let firstFailureIndex = -1;

    for (let index = 0; index < statements.length; index++) {
      const statement = statements[index];
      await client.query(`SAVEPOINT diag_${index}`);
      try {
        await client.query(statement.text);
      } catch (rawError) {
        const error = rawError as PostgresError;
        await client.query(`ROLLBACK TO SAVEPOINT diag_${index}`);
        firstFailureIndex = index;

        const positionIndex = error.position ? statementIndexAtPosition(statements, Number(error.position)) : index;
        console.log("Migration:", migrationName);
        console.log("Statement index:", index, `(of ${statements.length}, 0-based)`);
        console.log("Statement preview:", previewStatement(statement.text));
        console.log("PostgreSQL message:", error.message ?? "(none)");
        console.log("PostgreSQL code:", error.code ?? "(none)");
        console.log("Detail:", error.detail ?? "(none)");
        console.log("Hint:", error.hint ?? "(none)");
        console.log("Position:", error.position ?? "(none)", positionIndex !== index ? `(maps to statement index ${positionIndex})` : "");
        break;
      }
    }

    if (firstFailureIndex === -1) {
      console.log(`Migration: ${migrationName}`);
      console.log(`All ${statements.length} statements executed without error inside this diagnostic transaction.`);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("Diagnostic run failed before/outside statement execution:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
