import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Pool } from "pg";
import { runMigrations } from "./migrate";

type QueryCall = { text: string; values?: unknown[] };
type HandlerOutcome = { rows?: unknown[] } | Error | undefined | "pass";
type Handler = (text: string, values: unknown[] | undefined, callIndex: number) => HandlerOutcome;

function isTransactionControl(text: string): boolean {
  return /^\s*(BEGIN|COMMIT|ROLLBACK(\s+TO\s+SAVEPOINT\s+\S+)?|SAVEPOINT\s+\S+|RELEASE\s+SAVEPOINT\s+\S+)\s*$/i.test(text.trim());
}

function createScriptedPool(handlers: Handler[]) {
  const calls: QueryCall[] = [];
  let connectCount = 0;
  const client = {
    query: async (text: string, values?: unknown[]) => {
      const callIndex = calls.length;
      calls.push({ text, values });
      for (const handler of handlers) {
        const outcome = handler(text, values, callIndex);
        if (outcome === undefined) continue;
        if (outcome === "pass") break;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
      if (isTransactionControl(text)) return { rows: [] };
      throw new Error(`Unscripted query with no matching handler and not transaction control: ${text}`);
    },
    release: () => {}
  };
  const pool = { connect: async () => { connectCount++; return client; } };
  return { pool: pool as unknown as Pool, calls, getConnectCount: () => connectCount };
}

function pgError(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function withTempMigrationDir(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "migrate-test-"));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content, "utf8");
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const advisoryLock: Handler = text => (/^SELECT pg_advisory_xact_lock/.test(text) ? { rows: [] } : undefined);

test("fresh database: schema_migrations missing (42P01) is absorbed via SAVEPOINT, the migration still applies, and no 25P02 ever occurs", async () => {
  await withTempMigrationDir({ "001_first.sql": "-- MARKER_001\nCREATE TABLE schema_migrations (version text);" }, async dir => {
    const { pool, calls } = createScriptedPool([
      advisoryLock,
      text => (/^SELECT version FROM schema_migrations/.test(text) ? pgError('relation "schema_migrations" does not exist', "42P01") : undefined),
      text => (text.includes("MARKER_001") ? { rows: [] } : undefined),
      text => (/^INSERT INTO schema_migrations/.test(text) ? { rows: [] } : undefined)
    ]);

    const result = await runMigrations(pool, dir);

    assert.deepEqual(result, { applied: ["001_first"], skipped: [] });
    assert.ok(calls.some(call => /^ROLLBACK TO SAVEPOINT/i.test(call.text)), "the 42P01 must be recovered via ROLLBACK TO SAVEPOINT, not left aborted");
    assert.ok(!calls.some(call => call.values === undefined && /25P02/.test(call.text)), "no 25P02 text ever appears in a query - proves nothing downstream was rejected");
    assert.equal(calls.filter(call => /^BEGIN$/i.test(call.text)).length, 1, "exactly one transaction was opened for the one migration file");
    assert.equal(calls.filter(call => /^COMMIT$/i.test(call.text)).length, 1, "the transaction committed - no full rollback occurred for a successful migration");
  });
});

test("a migration already recorded in schema_migrations is skipped without ever sending its SQL", async () => {
  await withTempMigrationDir({ "001_first.sql": "-- MARKER_001\nCREATE TABLE t(id int);" }, async dir => {
    const { pool, calls } = createScriptedPool([
      advisoryLock,
      text => (/^SELECT version FROM schema_migrations/.test(text) ? { rows: [{ version: "001_first" }] } : undefined)
    ]);

    const result = await runMigrations(pool, dir);

    assert.deepEqual(result, { applied: [], skipped: ["001_first"] });
    assert.ok(!calls.some(call => call.text.includes("MARKER_001")), "the migration's own SQL must never be sent once it is already recorded as applied");
    assert.ok(!calls.some(call => /^INSERT INTO schema_migrations/.test(call.text)), "no duplicate INSERT for an already-applied version");
  });
});

test("a real failure inside a migration's own SQL: transaction rolls back, the ORIGINAL error is preserved (not replaced by 25P02), and no later migration is attempted", async () => {
  await withTempMigrationDir(
    {
      "001_first.sql": "-- MARKER_001\nCREATE TABLE a(id int);",
      "002_second.sql": "-- MARKER_002\nCREATE TABLE b(id nonexistenttype);",
      "003_third.sql": "-- MARKER_003\nCREATE TABLE c(id int);"
    },
    async dir => {
      let schemaMigrationsExists = false;
      const { pool, calls, getConnectCount } = createScriptedPool([
        advisoryLock,
        text => {
          if (!/^SELECT version FROM schema_migrations/.test(text)) return undefined;
          if (!schemaMigrationsExists) return pgError('relation "schema_migrations" does not exist', "42P01");
          return { rows: [] };
        },
        text => (text.includes("MARKER_001") ? { rows: [] } : undefined),
        (text, _values, callIndex) => {
          if (!/^INSERT INTO schema_migrations/.test(text)) return undefined;
          if (callIndex > 0 && calls.some(call => call.text.includes("MARKER_001"))) schemaMigrationsExists = true;
          return { rows: [] };
        },
        text => (text.includes("MARKER_002") ? pgError('type "nonexistenttype" does not exist', "42704") : undefined),
        text => (text.includes("MARKER_003") ? { rows: [] } : undefined)
      ]);

      await assert.rejects(
        () => runMigrations(pool, dir),
        (error: Error & { code?: string }) => {
          assert.equal(error.message, 'type "nonexistenttype" does not exist', "the real Postgres error must surface, not a masking 25P02");
          assert.equal(error.code, "42704");
          return true;
        }
      );

      assert.equal(getConnectCount(), 2, "only migrations 001 and 002 were ever attempted - 003 must never be reached after 002 fails");
      assert.ok(!calls.some(call => call.text.includes("MARKER_003")), "migration 003's SQL was never sent");
      assert.ok(calls.some(call => /^ROLLBACK$/i.test(call.text)), "the failed migration's transaction was rolled back");
      assert.equal(calls.filter(call => /^COMMIT$/i.test(call.text)).length, 1, "only migration 001's transaction committed; 002's did not");
    }
  );
});

test("migration file content is forwarded to the database verbatim in one call - the runner does not naively split on semicolons itself", async () => {
  const tricky = [
    "-- MARKER_TRICKY a comment; with a semicolon",
    "DO $$",
    "BEGIN",
    "  CREATE TABLE inner_a (id int);",
    "  CREATE TABLE inner_b (id int);",
    "END $$;",
    "SELECT 'literal; semicolon; inside a string';"
  ].join("\n");

  await withTempMigrationDir({ "001_tricky.sql": tricky }, async dir => {
    const { pool, calls } = createScriptedPool([
      advisoryLock,
      text => (/^SELECT version FROM schema_migrations/.test(text) ? pgError('relation "schema_migrations" does not exist', "42P01") : undefined),
      text => (text.includes("MARKER_TRICKY") ? { rows: [] } : undefined),
      text => (/^INSERT INTO schema_migrations/.test(text) ? { rows: [] } : undefined)
    ]);

    const result = await runMigrations(pool, dir);

    assert.deepEqual(result, { applied: ["001_tricky"], skipped: [] });
    const migrationCall = calls.find(call => call.text.includes("MARKER_TRICKY"));
    assert.equal(migrationCall?.text, tricky, "the exact, unmodified file content - DO block, comment, and embedded semicolons intact - was sent as a single statement");
  });
});

test("migrations run strictly in filename order regardless of directory listing order", async () => {
  await withTempMigrationDir(
    { "003_third.sql": "-- MARKER_003", "001_first.sql": "-- MARKER_001", "002_second.sql": "-- MARKER_002" },
    async dir => {
      const { pool, calls } = createScriptedPool([
        advisoryLock,
        text => (/^SELECT version FROM schema_migrations/.test(text) ? { rows: [] } : undefined),
        text => (/MARKER_00\d/.test(text) ? { rows: [] } : undefined),
        text => (/^INSERT INTO schema_migrations/.test(text) ? { rows: [] } : undefined)
      ]);

      const result = await runMigrations(pool, dir);

      assert.deepEqual(result.applied, ["001_first", "002_second", "003_third"]);
      const markerOrder = calls.filter(call => /MARKER_00\d/.test(call.text)).map(call => call.text.match(/MARKER_00\d/)?.[0]);
      assert.deepEqual(markerOrder, ["MARKER_001", "MARKER_002", "MARKER_003"]);
    }
  );
});

test("schema_migrations is only recorded after the migration's own SQL succeeds, in the same transaction", async () => {
  await withTempMigrationDir({ "001_first.sql": "-- MARKER_001" }, async dir => {
    const { pool, calls } = createScriptedPool([
      advisoryLock,
      text => (/^SELECT version FROM schema_migrations/.test(text) ? pgError('relation "schema_migrations" does not exist', "42P01") : undefined),
      text => (text.includes("MARKER_001") ? { rows: [] } : undefined),
      text => (/^INSERT INTO schema_migrations/.test(text) ? { rows: [] } : undefined)
    ]);

    await runMigrations(pool, dir);

    const migrationIndex = calls.findIndex(call => call.text.includes("MARKER_001"));
    const insertIndex = calls.findIndex(call => /^INSERT INTO schema_migrations/.test(call.text));
    const commitIndex = calls.findIndex(call => /^COMMIT$/i.test(call.text));
    assert.ok(migrationIndex < insertIndex, "the migration's own DDL runs before its version is recorded");
    assert.ok(insertIndex < commitIndex, "the version record commits together with the DDL, not separately");
  });
});
