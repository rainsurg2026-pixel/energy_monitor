import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { previewStatement, splitSqlStatements, statementIndexAtPosition } from "./sqlStatementSplitter";

test("splits ordinary semicolon-delimited statements", () => {
  const statements = splitSqlStatements("CREATE TABLE a (id int);\nCREATE TABLE b (id int);");
  assert.equal(statements.length, 2);
  assert.equal(statements[0].text, "CREATE TABLE a (id int)");
  assert.equal(statements[1].text, "CREATE TABLE b (id int)");
});

test("does not split inside a DO $$ ... $$ block despite internal semicolons", () => {
  const sql = `
    DO $$
    BEGIN
      CREATE TABLE inner_a (id int);
      CREATE TABLE inner_b (id int);
      IF NOT EXISTS (SELECT 1) THEN
        NULL;
      END IF;
    END $$;
    SELECT 1;
  `;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 2, "the DO block is one statement, SELECT 1 is the second");
  assert.ok(statements[0].text.startsWith("DO $$"));
  assert.ok(statements[0].text.trim().endsWith("END $$"));
  assert.equal(statements[1].text, "SELECT 1");
});

test("does not split inside a DO block using a named dollar-quote tag", () => {
  const sql = `DO $migration_block$ BEGIN CREATE TABLE t (id int); END $migration_block$; SELECT 2;`;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 2);
  assert.ok(statements[0].text.includes("CREATE TABLE t"));
});

test("does not split on a semicolon inside a single-quoted string", () => {
  const statements = splitSqlStatements(`INSERT INTO t(a) VALUES ('a;b;c'); SELECT 2;`);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].text, "INSERT INTO t(a) VALUES ('a;b;c')");
});

test("treats a doubled single quote inside a string as an escaped quote, not a terminator", () => {
  const statements = splitSqlStatements(`SELECT 'it''s; still one string'; SELECT 2;`);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].text, "SELECT 'it''s; still one string'");
});

test("does not split on a semicolon inside a double-quoted identifier", () => {
  const statements = splitSqlStatements(`CREATE TABLE "weird;name" (id int); SELECT 3;`);
  assert.equal(statements.length, 2);
  assert.ok(statements[0].text.includes('"weird;name"'));
});

test("does not split on a semicolon inside a line comment", () => {
  const statements = splitSqlStatements(`-- comment; with a semicolon in it\nSELECT 1;`);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].text, "SELECT 1");
});

test("does not split on a semicolon inside a block comment", () => {
  const statements = splitSqlStatements(`/* comment; with a semicolon */ SELECT 1;`);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].text, "SELECT 1");
});

test("handles nested block comments, matching PostgreSQL's own nesting rule", () => {
  const statements = splitSqlStatements(`/* outer /* inner; comment */ still outer; */ SELECT 1;`);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].text, "SELECT 1");
});

test("ignores empty statements produced by stray or trailing semicolons", () => {
  const statements = splitSqlStatements(`;;  CREATE TABLE a (id int);  ;;`);
  assert.equal(statements.length, 1);
  assert.equal(statements[0].text, "CREATE TABLE a (id int)");
});

test("captures a trailing statement with no terminating semicolon", () => {
  const statements = splitSqlStatements(`SELECT 1; SELECT 2`);
  assert.equal(statements.length, 2);
  assert.equal(statements[1].text, "SELECT 2");
});

test("statementIndexAtPosition maps a 1-based Postgres error position back to the right statement", () => {
  const sql = `CREATE TABLE a (id int);\nCREATE TABLE b (id int nope nope);`;
  const statements = splitSqlStatements(sql);
  const positionInsideSecondStatement = sql.indexOf("nope") + 1;
  assert.equal(statementIndexAtPosition(statements, positionInsideSecondStatement), 1);
});

test("statementIndexAtPosition returns -1 for a position outside every statement", () => {
  const statements = splitSqlStatements(`SELECT 1;`);
  assert.equal(statementIndexAtPosition(statements, 9999), -1);
});

test("previewStatement collapses whitespace and truncates long text", () => {
  assert.equal(previewStatement("SELECT   1\n  FROM   t"), "SELECT 1 FROM t");
  const long = "x".repeat(200);
  assert.equal(previewStatement(long, 10), `${"x".repeat(10)}...`);
});

test("real migration 002 file: every DO $$ ... $$ block survives as one statement, not shredded by its internal semicolons/quotes", async () => {
  const filePath = path.resolve(process.cwd(), "db/migrations/002_phase3_auth_security.sql");
  const sql = await readFile(filePath, "utf8");
  const statements = splitSqlStatements(sql);

  const doBlocks = statements.filter(statement => statement.text.startsWith("DO $$"));
  assert.equal(doBlocks.length, 5, "migration 002 contains exactly five top-level DO $$ ... $$ blocks");
  for (const block of doBlocks) {
    assert.ok(block.text.trim().endsWith("END $$"), "each DO block statement ends with its own END $$, proving it was not cut short");
    const semicolonsInsideBlock = (block.text.match(/;/g) ?? []).length;
    assert.ok(semicolonsInsideBlock >= 2, "a shredded block would have at most one semicolon left; a real one retains its internal statement terminators");
  }

  const roleCreationBlock = doBlocks.find(block => block.text.includes("energy_monitor_runtime NOLOGIN"));
  assert.ok(roleCreationBlock, "the role-creation DO block must remain intact and locatable as a single statement");
});

test("real migration 001 file: statement count is consistent with its known table/index shape", async () => {
  const filePath = path.resolve(process.cwd(), "db/migrations/001_phase2_foundation.sql");
  const sql = await readFile(filePath, "utf8");
  const statements = splitSqlStatements(sql);

  const createTableCount = statements.filter(statement => /^CREATE TABLE/i.test(statement.text)).length;
  const createIndexCount = statements.filter(statement => /^CREATE INDEX/i.test(statement.text)).length;
  const doBlockCount = statements.filter(statement => statement.text.startsWith("DO $$")).length;

  assert.equal(createTableCount, 28, "migration 001 creates exactly 28 tables");
  assert.equal(doBlockCount, 1, "migration 001 has exactly one DO $$ block (the provenance_records FK guard)");
  assert.ok(createIndexCount >= 15, "migration 001 creates a substantial number of indexes");
  assert.equal(statements.length, createTableCount + createIndexCount + doBlockCount);
});
