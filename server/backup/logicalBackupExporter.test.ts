import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import type { Pool } from "pg";
import { PostgresLogicalBackupExporter } from "./logicalBackupExporter";

test("logical backup includes business/audit rows and excludes credential tables", async () => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "users" }, { table_name: "sites" }, { table_name: "audit_events" }, { table_name: "local_credentials" }], rowCount: 4 };
    if (sql.includes("FROM public.users")) return { rows: [{ id: 1, username: "admin", normalized_username: "admin", display_name: "Admin", active: true, row_version: 1 }], rowCount: 1 };
    if (sql.includes('public."sites"')) return { rows: [{ id: 1, code: "RST", name: "Rangsit", active: true }], rowCount: 1 };
    if (sql.includes('public."audit_events"')) return { rows: [{ id: 7, action: "update", entity_type: "monthly_period" }], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  } } as unknown as Pool;

  const artifact = await new PostgresLogicalBackupExporter(pool).exportAllDatabase({ generatedBy: "Admin", generatedAt: new Date("2026-09-05T15:30:00Z"), environment: "production" });
  const zip = await JSZip.loadAsync(artifact.bytes);
  assert.ok(zip.file("tables/users.csv"));
  assert.ok(zip.file("tables/sites.csv"));
  assert.ok(zip.file("tables/audit_events.csv"));
  assert.equal(zip.file("tables/local_credentials.csv"), null);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as { excludedTables: string[]; rowCount: number; tableCount: number; generatedBy: string };
  assert.ok(manifest.excludedTables.includes("local_credentials"));
  assert.ok(manifest.excludedTables.includes("sessions"));
  assert.equal(manifest.rowCount, 3);
  assert.equal(manifest.tableCount, 3);
  assert.equal(manifest.generatedBy, "Admin");
  assert.equal(artifact.rowCount, 3);
  assert.equal(artifact.tableCount, 3);
  assert.match(artifact.filename, /^EnergyMonitor_Database_Backup_\d{2}-Sep-2026_\d{2}-\d{2}_GMT\+7\.zip$/);
  assert.equal(queries.some(sql => sql.includes("local_credentials")), false);
});
