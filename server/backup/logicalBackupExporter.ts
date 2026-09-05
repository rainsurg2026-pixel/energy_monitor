import JSZip from "jszip";
import type { Pool } from "pg";

export interface LogicalBackupArtifact {
  bytes: Buffer;
  filename: string;
  rowCount: number;
  tableCount: number;
}

export interface LogicalBackupExporter {
  exportAllDatabase(input: { generatedBy: string; generatedAt?: Date; environment: string }): Promise<LogicalBackupArtifact>;
}

const SAFE_TABLES = [
  "sites", "site_profiles", "electrical_profiles", "devices", "air_meters", "dc_panels",
  "ups_groups", "ups_group_members", "monthly_periods", "ups_readings", "air_meter_readings",
  "dc_readings", "electrical_phase_readings", "energy_cost_inputs", "rack_capacity_snapshots",
  "rack_assets", "rack_capacity_records", "rack_capacity_history", "rack_unit_capacity_snapshots",
  "rack_unit_capacity_images", "global_settings", "ups_group_history", "provenance_records",
  "migration_batches", "migration_errors", "legacy_cached_evidence", "calculation_runs",
  "calculation_output_values", "workbook_source_versions", "audit_events", "backup_config",
  "backup_log", "roles", "user_roles", "schema_migrations"
] as const;
const EXCLUDED_TABLES = [
  "local_credentials", "sessions", "auth_identities", "google_oauth_states",
  "google_sheets_connections", "http_rate_limit_buckets"
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[binary omitted]";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [columns.map(csvCell).join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n") + "\r\n";
}

function backupFilename(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `EnergyMonitor_Database_Backup_${get("day")}-${get("month").slice(0, 3)}-${get("year")}_${get("hour")}-${get("minute")}_GMT+7.zip`;
}
export class PostgresLogicalBackupExporter implements LogicalBackupExporter {
  constructor(private readonly pool: Pool) {}

  async exportAllDatabase(input: { generatedBy: string; generatedAt?: Date; environment: string }): Promise<LogicalBackupArtifact> {
    const generatedAt = input.generatedAt ?? new Date();
    const zip = new JSZip();
    const existing = await this.pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    const available = new Set(existing.rows.map(row => row.table_name));
    const counts: Record<string, number> = {};
    let rowCount = 0;

    if (available.has("users")) {
      const result = await this.pool.query<Record<string, unknown>>("SELECT id, username, normalized_username, display_name, active, failed_attempt_count, locked_until, password_changed_at, row_version, created_at, updated_at FROM public.users ORDER BY id");
      counts.users = result.rowCount ?? result.rows.length;
      rowCount += counts.users;
      zip.file("tables/users.csv", rowsToCsv(result.rows));
    }

    for (const table of SAFE_TABLES) {
      if (!available.has(table)) continue;
      const result = await this.pool.query<Record<string, unknown>>(`SELECT * FROM public."${table}"`);
      counts[table] = result.rowCount ?? result.rows.length;
      rowCount += counts[table];
      zip.file(`tables/${table}.csv`, rowsToCsv(result.rows));
    }
    const manifest = {
      format: "energy-monitor-logical-backup-v1",
      generatedAt: generatedAt.toISOString(),
      generatedBy: input.generatedBy,
      timeZone: "GMT+7 / Asia/Bangkok",
      environment: input.environment,
      tableCount: Object.keys(counts).length,
      rowCount,
      tables: counts,
      excludedTables: EXCLUDED_TABLES,
      exclusionReason: "Authentication credentials, sessions, OAuth state/tokens, and rate-limit buckets are intentionally excluded from downloadable backups.",
      note: "Rack Unit image metadata is included; object-storage image bytes are not database rows and are not embedded in this archive."
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("README.txt", "Energy Monitor logical database backup. CSV files under /tables contain operational, configuration, audit, and non-secret user metadata. Credentials, sessions, OAuth tokens/state, and server environment secrets are intentionally excluded.\r\n");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 7 } });
    return { bytes, filename: backupFilename(generatedAt), rowCount, tableCount: Object.keys(counts).length };
  }
}
