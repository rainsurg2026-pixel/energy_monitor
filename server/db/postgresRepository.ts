import type { Pool, PoolClient } from "pg";
import type { MonthlyLog, UpsRecord } from "../../src/types";
import { withTransaction, type DbExecutor, query } from "./pool";
import { HttpError } from "../errors";
import type { BackendRepository, GoogleOAuthStateRecord, GoogleSheetsConnectionRecord, MonthlySectionKey, PeriodRecord, RackSnapshotRecord, RackUnitImageRecord, RackUnitSnapshotRecord, SaveMonthlyLogInput, SaveRackCapacityHistoryInput, SaveRackSnapshotInput, SaveRackUnitImageInput, SaveRackUnitSnapshotInput, SaveUpsGroupHistoryInput, SaveWorkbookSourceInput, SiteRecord, UpdateSettingsInput, WorkbookSourceRecord } from "../repositories/contracts";
import type { RackCapacityHistoryRow } from "../../src/excel/RackCapacityHistoryWriter";
import type { UpsGroupHistoryRow } from "../../src/reports/reportTypes";
import type { DisplayPeriod } from "../policies/displayPeriod";

function numberOrNull(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function monthString(value: unknown): string { return new Date(String(value)).toISOString().slice(0, 7); }

export class PostgresRepository implements BackendRepository {
  private readonly executor: DbExecutor;

  constructor(private readonly pool: Pool | null, executor?: DbExecutor) {
    if (executor) this.executor = executor;
    else if (pool) this.executor = pool;
    else throw new Error("A PostgreSQL executor is required.");
  }

  async ping(): Promise<void> { await this.executor.query("SELECT 1"); }

  async listSites(): Promise<SiteRecord[]> {
    const result = await query<{ id: string; code: string; name: string; active: boolean }>(this.executor, "SELECT id, code, name, active FROM sites WHERE active = true ORDER BY name, id");
    return result.rows.map(row => ({ id: Number(row.id), code: row.code, name: row.name, active: row.active }));
  }

  async getSite(siteId: number): Promise<SiteRecord | null> {
    const result = await query<{ id: string; code: string; name: string; active: boolean }>(this.executor, "SELECT id, code, name, active FROM sites WHERE id = $1", [siteId]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), code: row.code, name: row.name, active: row.active } : null;
  }

  async getGlobalSettings(): Promise<DisplayPeriod | null> {
    const result = await query<{ start_month: string; end_month: string; row_version: number }>(this.executor, "SELECT start_month, end_month, row_version FROM global_settings WHERE id = 1");
    const row = result.rows[0];
    return row ? { startMonth: monthString(row.start_month), endMonth: monthString(row.end_month), rowVersion: row.row_version } : null;
  }

  async saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveMonthlyLogInTransaction(client, input));
  }

  protected async saveMonthlyLogInTransaction(client: PoolClient, input: SaveMonthlyLogInput): Promise<PeriodRecord> {
    const site = await client.query<{ id: string }>("SELECT id FROM sites WHERE id = $1 AND active = true", [input.siteId]);
    if (!site.rows[0]) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");

    const existing = await client.query<{ id: string; row_version: number; last_saved_ups: string | null; last_saved_air: string | null; last_saved_dc: string | null; last_saved_energy_cost: string | null }>(
      "SELECT id, row_version, last_saved_ups, last_saved_air, last_saved_dc, last_saved_energy_cost FROM monthly_periods WHERE site_id = $1 AND period_month = $2::date FOR UPDATE",
      [input.siteId, `${input.log.month}-01`]
    );
    const timestampDefinitions: Array<{ section: MonthlySectionKey; field: "lastSavedUps" | "lastSavedAir" | "lastSavedDc" | "lastSavedEnergyCost"; column: string }> = [
      { section: "ups", field: "lastSavedUps", column: "last_saved_ups" },
      { section: "air", field: "lastSavedAir", column: "last_saved_air" },
      { section: "dc", field: "lastSavedDc", column: "last_saved_dc" },
      { section: "energyCost", field: "lastSavedEnergyCost", column: "last_saved_energy_cost" }
    ];
    const savedAt = input.savedAt ?? new Date().toISOString();
    const savedSections = new Set(input.savedSections ?? []);
    const timestampChanges = timestampDefinitions.map(definition => {
      const incoming = input.log[definition.field];
      const explicit = savedSections.has(definition.section);
      const imported = input.savedSections === undefined && incoming !== null && incoming !== undefined;
      return { ...definition, write: explicit || imported, value: explicit ? savedAt : (incoming ?? null) };
    });
    const persistedTimestamps = Object.fromEntries(timestampDefinitions.map(definition => {
      const change = timestampChanges.find(item => item.field === definition.field);
      const existingValue = existing.rows[0]?.[definition.column as "last_saved_ups" | "last_saved_air" | "last_saved_dc" | "last_saved_energy_cost"] ?? null;
      return [definition.field, change?.write ? change.value : existingValue];
    })) as Pick<PeriodRecord, "lastSavedUps" | "lastSavedAir" | "lastSavedDc" | "lastSavedEnergyCost">;
    let periodId: string;
    let rowVersion: number;
    if (existing.rows[0]) {
      if (input.expectedRowVersion !== existing.rows[0].row_version) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
      const updateValues: unknown[] = [];
      const updateParts = ["row_version = row_version + 1", "updated_at = now()"];
      for (const change of timestampChanges) {
        if (!change.write) continue;
        updateParts.push(`${change.column} = $${updateValues.length + 1}::timestamptz`);
        updateValues.push(change.value);
      }
      const idParameter = updateValues.length + 1;
      const versionParameter = updateValues.length + 2;
      updateValues.push(existing.rows[0].id, input.expectedRowVersion);
      const updated = await client.query<{ id: string; row_version: number }>(
        `UPDATE monthly_periods SET ${updateParts.join(", ")} WHERE id = $${idParameter} AND row_version = $${versionParameter} RETURNING id, row_version`,
        updateValues
      );
      if (!updated.rows[0]) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
      periodId = updated.rows[0].id;
      rowVersion = updated.rows[0].row_version;
    } else {
      if (input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
      const insertColumns = ["site_id", "period_month"];
      const insertValues: unknown[] = [input.siteId, `${input.log.month}-01`];
      const valuePlaceholders = ["$1", "$2::date"];
      for (const change of timestampChanges) {
        if (!change.write) continue;
        insertColumns.push(change.column);
        insertValues.push(change.value);
        valuePlaceholders.push(`$${insertValues.length}::timestamptz`);
      }
      const inserted = await client.query<{ id: string; row_version: number }>(
        `INSERT INTO monthly_periods(${insertColumns.join(", ")}) VALUES (${valuePlaceholders.join(", ")}) ON CONFLICT (site_id, period_month) DO NOTHING RETURNING id, row_version`,
        insertValues
      );
      if (!inserted.rows[0]) throw new HttpError(409, "STALE_VERSION", "Monthly data changed before this save was committed.");
      periodId = inserted.rows[0].id;
      rowVersion = inserted.rows[0].row_version;
    }

    await client.query("DELETE FROM ups_readings WHERE period_id = $1", [periodId]);
    await client.query("DELETE FROM air_meter_readings WHERE period_id = $1", [periodId]);
    await client.query("DELETE FROM dc_readings WHERE period_id = $1", [periodId]);
    await client.query("DELETE FROM electrical_phase_readings WHERE period_id = $1", [periodId]);
    await client.query("DELETE FROM energy_cost_inputs WHERE period_id = $1", [periodId]);

    const upsertDevice = async (code: string, name: string, kind: string): Promise<string> => {
      const result = await client.query<{ id: string }>(
        "INSERT INTO devices(site_id, code, name, kind) VALUES ($1, $2, $3, $4) ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, updated_at = now() RETURNING id",
        [input.siteId, code, name, kind]
      );
      return result.rows[0].id;
    };
    const upsertMeter = async (code: string): Promise<string> => {
      const result = await client.query<{ id: string }>(
        "INSERT INTO air_meters(site_id, code, name) VALUES ($1, $2, $2) ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        [input.siteId, code]
      );
      return result.rows[0].id;
    };
    const upsertPanel = async (code: string): Promise<string> => {
      const result = await client.query<{ id: string }>(
        "INSERT INTO dc_panels(site_id, code, name) VALUES ($1, $2, $2) ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        [input.siteId, code]
      );
      return result.rows[0].id;
    };

    for (const record of input.log.ups) {
      const deviceId = await upsertDevice(record.upsId, record.upsId, "ups");
      const base = [periodId, deviceId, input.siteId, "", record.voltage, record.current, record.loadKw, record.loadKva, record];
      await client.query("INSERT INTO ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", base);
      for (const [phaseCode, phase] of Object.entries(record.phases ?? {})) {
        await client.query("INSERT INTO ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [periodId, deviceId, input.siteId, phaseCode, phase.voltage, phase.current, phase.loadKw, phase.loadKva, phase]);
      }
    }

    const airValues: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(input.log.air as unknown as Record<string, unknown>)) {
      if (key !== "meters" && (typeof value === "number" || value === null)) airValues[key] = typeof value === "number" ? value : null;
    }
    for (const [key, value] of Object.entries(input.log.air.meters ?? {})) airValues[key] = value;
    for (const [code, reading] of Object.entries(airValues)) {
      const meterId = await upsertMeter(code);
      await client.query("INSERT INTO air_meter_readings(period_id, meter_id, site_id, reading, raw_inputs) VALUES ($1,$2,$3,$4,$5)", [periodId, meterId, input.siteId, reading, { code, reading }]);
    }

    for (const record of input.log.dc) {
      const panelId = await upsertPanel(record.panelId);
      await client.query("INSERT INTO dc_readings(period_id, panel_id, site_id, voltage, current, raw_inputs) VALUES ($1,$2,$3,$4,$5,$6)", [periodId, panelId, input.siteId, record.voltage, record.current, record]);
    }

    for (const [sourceKey, value] of Object.entries(input.log.srinakarinInputs?.upsPhase ?? {})) {
      const [source, phaseCode = ""] = sourceKey.split(" - ");
      await client.query("INSERT INTO electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, load_kw, load_kva, raw_inputs) VALUES ($1,$2,'ups_phase',$3,$4,$5,$6,$7,$8,$9)", [periodId, input.siteId, source, phaseCode, value.voltage, value.current, value.loadKw, value.loadKva, value]);
    }
    for (const [sourceKey, value] of Object.entries(input.log.srinakarinInputs?.acPhase ?? {})) {
      const [source, phaseCode = ""] = sourceKey.split(" - ");
      await client.query("INSERT INTO electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, raw_inputs) VALUES ($1,$2,'ac_phase',$3,$4,$5,$6,$7)", [periodId, input.siteId, source, phaseCode, value.voltage, value.current, value]);
    }
    for (const [sourceKey, current] of Object.entries(input.log.srinakarinInputs?.ppc43Current ?? {})) {
      await client.query("INSERT INTO electrical_phase_readings(period_id, site_id, source_kind, source_key, current, raw_inputs) VALUES ($1,$2,'ppc43_current',$3,$4,$5)", [periodId, input.siteId, sourceKey, current, { sourceKey, current }]);
    }
    for (const [sourceKey, value] of Object.entries(input.log.srinakarinInputs?.ppc43Panel ?? {})) {
      await client.query("INSERT INTO electrical_phase_readings(period_id, site_id, source_kind, source_key, load_kw, load_kva, raw_inputs) VALUES ($1,$2,'ppc43_panel',$3,$4,$5,$6)", [periodId, input.siteId, sourceKey, value.loadKw, value.loadKva, value]);
    }

    await client.query("INSERT INTO energy_cost_inputs(period_id, site_id, building_energy_kwh, building_cost_thb, raw_inputs) VALUES ($1,$2,$3,$4,$5)", [periodId, input.siteId, input.log.energyCost.buildingEnergyKwh, input.log.energyCost.buildingElectricityCostThb, input.log.energyCost]);
    if (input.log.energyCalculation) {
      await client.query("INSERT INTO electrical_profiles(site_id, profile_version, ups_groups, dc_ids, air_fields) VALUES ($1,'desktop-v2.3.1',$2,$3,$4) ON CONFLICT (site_id) DO UPDATE SET ups_groups = EXCLUDED.ups_groups, dc_ids = EXCLUDED.dc_ids, air_fields = EXCLUDED.air_fields, updated_at = now()", [input.siteId, JSON.stringify(input.log.energyCalculation.upsGroups), JSON.stringify(input.log.energyCalculation.dcIds), JSON.stringify(input.log.energyCalculation.airFields)]);
    }
    if (input.provenance) {
      await client.query("INSERT INTO provenance_records(entity_type, entity_id, source_type, source_file_hash, source_file_name, source_sheet, source_location) VALUES ('monthly_period', $1, $2, $3, $4, $5, $6)", [periodId, input.provenance.sourceType, input.provenance.sourceFileHash ?? null, input.provenance.sourceFileName ?? null, input.provenance.sourceSheet ?? null, input.provenance.sourceLocation ?? null]);
    }
    await client.query("INSERT INTO audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, "upsert", "monthly_period", periodId, JSON.stringify({ dataset: "monthly_log", site_id: input.siteId, period_month: input.log.month, record: "raw_inputs", row_version: input.expectedRowVersion }), JSON.stringify({ dataset: "monthly_log", site_id: input.siteId, period_month: input.log.month, record: "raw_inputs", row_version: rowVersion, provenance: input.provenance?.sourceType ?? "web-api" }), input.correlationId]);
    return { id: Number(periodId), siteId: input.siteId, month: input.log.month, hasData: true, rowVersion, ...persistedTimestamps };
  }

  async saveRackSnapshot(input: SaveRackSnapshotInput): Promise<RackSnapshotRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveRackSnapshotInTransaction(client, input));
  }

  protected async saveRackSnapshotInTransaction(client: PoolClient, input: SaveRackSnapshotInput): Promise<RackSnapshotRecord> {
    const site = await client.query<{ id: string }>("SELECT id FROM sites WHERE id = $1 AND active = true", [input.siteId]);
    if (!site.rows[0]) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const existing = await client.query<{ id: string; row_version: number }>("SELECT id, row_version FROM rack_capacity_snapshots WHERE site_id = $1 AND snapshot_month = $2::date FOR UPDATE", [input.siteId, `${input.month}-01`]);
    let snapshotId: string;
    let rowVersion: number;
    if (existing.rows[0]) {
      if (input.expectedRowVersion !== existing.rows[0].row_version) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
      const updated = await client.query<{ id: string; row_version: number }>("UPDATE rack_capacity_snapshots SET row_version = row_version + 1, updated_at = now() WHERE id = $1 AND row_version = $2 RETURNING id, row_version", [existing.rows[0].id, input.expectedRowVersion]);
      if (!updated.rows[0]) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
      snapshotId = updated.rows[0].id; rowVersion = updated.rows[0].row_version;
    } else {
      if (input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
      const inserted = await client.query<{ id: string; row_version: number }>("INSERT INTO rack_capacity_snapshots(site_id, snapshot_month) VALUES ($1, $2::date) ON CONFLICT (site_id, snapshot_month) DO NOTHING RETURNING id, row_version", [input.siteId, `${input.month}-01`]);
      if (!inserted.rows[0]) throw new HttpError(409, "STALE_VERSION", "Rack Capacity data changed before this save was committed.");
      snapshotId = inserted.rows[0].id; rowVersion = inserted.rows[0].row_version;
    }
    await client.query("DELETE FROM rack_capacity_records WHERE snapshot_id = $1", [snapshotId]);
    for (const record of input.records) await client.query("INSERT INTO rack_capacity_records(snapshot_id, source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [snapshotId, record.rowNumber, record.rackZone, record.rackId, record.status, record.cabinetSize, record.detail, record.deviceType, record.remarks, record]);
    await client.query("INSERT INTO audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2,'upsert','rack_capacity_snapshot',$3,$4,$5,$6)", [input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, snapshotId, JSON.stringify({ dataset: "rack_capacity", site_id: input.siteId, month: input.month, row_version: input.expectedRowVersion }), JSON.stringify({ dataset: "rack_capacity", site_id: input.siteId, month: input.month, record_count: input.records.length, row_version: rowVersion }), input.correlationId]);
    return { month: input.month, rowVersion, records: input.records.map(record => ({ ...record })) };
  }

  async saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveRackUnitSnapshotInTransaction(client, input));
  }

  protected async saveRackUnitSnapshotInTransaction(client: PoolClient, input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord> {
    const site = await client.query<{ id: string }>("SELECT id FROM sites WHERE id = $1 AND active = true", [input.siteId]);
    if (!site.rows[0]) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const existing = await client.query<{ id: string; row_version: number }>("SELECT id, row_version FROM rack_unit_capacity_snapshots WHERE site_id = $1 AND period_month = $2::date FOR UPDATE", [input.siteId, `${input.month}-01`]);
    let snapshotId: string;
    let rowVersion: number;
    if (existing.rows[0]) {
      if (input.expectedRowVersion !== existing.rows[0].row_version) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
      const updated = await client.query<{ id: string; row_version: number }>("UPDATE rack_unit_capacity_snapshots SET total_u = $1, used_u = $2, row_version = row_version + 1, updated_at = now() WHERE id = $3 AND row_version = $4 RETURNING id, row_version", [input.totalU, input.usedU, existing.rows[0].id, input.expectedRowVersion]);
      if (!updated.rows[0]) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
      snapshotId = updated.rows[0].id; rowVersion = updated.rows[0].row_version;
    } else {
      if (input.expectedRowVersion !== null && input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
      const inserted = await client.query<{ id: string; row_version: number }>("INSERT INTO rack_unit_capacity_snapshots(site_id, period_month, total_u, used_u) VALUES ($1, $2::date, $3, $4) ON CONFLICT (site_id, period_month) DO NOTHING RETURNING id, row_version", [input.siteId, `${input.month}-01`, input.totalU, input.usedU]);
      if (!inserted.rows[0]) throw new HttpError(409, "STALE_VERSION", "Rack Unit Capacity data changed before this save was committed.");
      snapshotId = inserted.rows[0].id; rowVersion = inserted.rows[0].row_version;
    }
    await client.query("INSERT INTO audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2,'upsert','rack_unit_capacity_snapshot',$3,$4,$5,$6)", [input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, snapshotId, JSON.stringify({ dataset: "rack_unit_capacity", site_id: input.siteId, month: input.month, row_version: input.expectedRowVersion }), JSON.stringify({ dataset: "rack_unit_capacity", site_id: input.siteId, month: input.month, total_u: input.totalU, used_u: input.usedU, row_version: rowVersion }), input.correlationId]);
    return { month: input.month, rowVersion, totalU: input.totalU, usedU: input.usedU };
  }

  async updateGlobalSettings(input: UpdateSettingsInput, correlationId: string): Promise<DisplayPeriod> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, async client => {
      const previous = await client.query<{ start_month: string; end_month: string; row_version: number }>(
        "SELECT start_month, end_month, row_version FROM global_settings WHERE id = 1 FOR UPDATE"
      );
      if (!previous.rows[0]) {
        if (input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
        const created = await client.query<{ start_month: string; end_month: string; row_version: number }>(
          "INSERT INTO global_settings(id, start_month, end_month, row_version) VALUES (1, $1::date, $2::date, 1) ON CONFLICT (id) DO NOTHING RETURNING start_month, end_month, row_version",
          [`${input.startMonth}-01`, `${input.endMonth}-01`]
        );
        if (!created.rows[0]) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
        await client.query(
          "INSERT INTO audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, "create", "global_settings", "1", JSON.stringify({ dataset: "global_settings", record: "display_period", previous: null }), JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: input.startMonth, end_month: input.endMonth, row_version: created.rows[0].row_version }), correlationId]
        );
        return { startMonth: monthString(created.rows[0].start_month), endMonth: monthString(created.rows[0].end_month), rowVersion: created.rows[0].row_version };
      }
      if (previous.rows[0].row_version !== input.expectedRowVersion) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
      const update = await client.query<{ start_month: string; end_month: string; row_version: number }>(
        "UPDATE global_settings SET start_month = $1::date, end_month = $2::date, row_version = row_version + 1, updated_at = now() WHERE id = 1 AND row_version = $3 RETURNING start_month, end_month, row_version",
        [`${input.startMonth}-01`, `${input.endMonth}-01`, input.expectedRowVersion]
      );
      if (update.rows.length === 0) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
      const row = update.rows[0];
      await client.query(
        "INSERT INTO audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, "update", "global_settings", "1", JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: monthString(previous.rows[0].start_month), end_month: monthString(previous.rows[0].end_month), row_version: previous.rows[0].row_version }), JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: input.startMonth, end_month: input.endMonth, row_version: row.row_version }), correlationId]
      );
      return { startMonth: monthString(row.start_month), endMonth: monthString(row.end_month), rowVersion: row.row_version };
    });
  }

  async listPeriods(siteId: number): Promise<PeriodRecord[]> {
    const result = await query<{ id: string; site_id: string; period_month: string; row_version: number; has_data: boolean; last_saved_ups: string | null; last_saved_air: string | null; last_saved_dc: string | null; last_saved_energy_cost: string | null }>(this.executor,
      `SELECT p.id, p.site_id, p.period_month, p.row_version, p.last_saved_ups, p.last_saved_air, p.last_saved_dc, p.last_saved_energy_cost,
        (EXISTS (SELECT 1 FROM ups_readings u WHERE u.period_id = p.id)
         OR EXISTS (SELECT 1 FROM air_meter_readings a WHERE a.period_id = p.id)
         OR EXISTS (SELECT 1 FROM dc_readings d WHERE d.period_id = p.id)
         OR EXISTS (SELECT 1 FROM electrical_phase_readings ep WHERE ep.period_id = p.id)
         OR EXISTS (SELECT 1 FROM energy_cost_inputs e WHERE e.period_id = p.id)) AS has_data
       FROM monthly_periods p WHERE p.site_id = $1 ORDER BY p.period_month`, [siteId]);
    return result.rows.map(row => ({ id: Number(row.id), siteId: Number(row.site_id), month: monthString(row.period_month), hasData: row.has_data, rowVersion: row.row_version, lastSavedUps: row.last_saved_ups, lastSavedAir: row.last_saved_air, lastSavedDc: row.last_saved_dc, lastSavedEnergyCost: row.last_saved_energy_cost }));
  }

  async getMonthlyLogs(siteId: number, months: readonly string[]): Promise<MonthlyLog[]> {
    if (months.length === 0) return [];
    const periodResult = await query<{ id: string; period_month: string; building_energy_kwh: unknown; building_cost_thb: unknown; last_saved_ups: string | null; last_saved_air: string | null; last_saved_dc: string | null; last_saved_energy_cost: string | null }>(this.executor,
      `SELECT p.id, p.period_month, p.last_saved_ups, p.last_saved_air, p.last_saved_dc, p.last_saved_energy_cost, e.building_energy_kwh, e.building_cost_thb
       FROM monthly_periods p LEFT JOIN energy_cost_inputs e ON e.period_id = p.id
       WHERE p.site_id = $1 AND p.period_month = ANY($2::date[]) ORDER BY p.period_month`, [siteId, months.map(month => `${month}-01`)]);
    const periodIds = periodResult.rows.map(row => row.id);
    if (periodIds.length === 0) return [];
    const [ups, air, dc, electrical, profile] = await Promise.all([
      query<{ period_id: string; ups_id: string; phase_code: string; voltage: unknown; current: unknown; load_kw: unknown; load_kva: unknown }>(this.executor,
        `SELECT u.period_id, d.code AS ups_id, u.phase_code, u.voltage, u.current, u.load_kw, u.load_kva FROM ups_readings u JOIN devices d ON d.id = u.device_id WHERE u.period_id = ANY($1::bigint[])`, [periodIds]),
      query<{ period_id: string; code: string; reading: unknown }>(this.executor,
        `SELECT a.period_id, m.code, a.reading FROM air_meter_readings a JOIN air_meters m ON m.id = a.meter_id WHERE a.period_id = ANY($1::bigint[])`, [periodIds]),
      query<{ period_id: string; code: string; voltage: unknown; current: unknown }>(this.executor,
        `SELECT d.period_id, p.code, d.voltage, d.current FROM dc_readings d JOIN dc_panels p ON p.id = d.panel_id WHERE d.period_id = ANY($1::bigint[])`, [periodIds]),
      query<{ period_id: string; source_kind: string; source_key: string; phase_code: string; panel_key: string; voltage: unknown; current: unknown; load_kw: unknown; load_kva: unknown }>(this.executor,
        `SELECT period_id, source_kind, source_key, phase_code, panel_key, voltage, current, load_kw, load_kva FROM electrical_phase_readings WHERE period_id = ANY($1::bigint[])`, [periodIds]),
      query<{ profile_version: string; ups_groups: unknown; dc_ids: unknown; air_fields: unknown }>(this.executor,
        "SELECT profile_version, ups_groups, dc_ids, air_fields FROM electrical_profiles WHERE site_id = $1", [siteId])
    ]);
    const profileRow = profile.rows[0];
    const byPeriod = new Map<string, MonthlyLog>();
    for (const row of periodResult.rows) {
      byPeriod.set(row.id, {
        month: monthString(row.period_month), ups: [], air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} }, dc: [],
        energyCost: { buildingEnergyKwh: numberOrNull(row.building_energy_kwh), buildingElectricityCostThb: numberOrNull(row.building_cost_thb) },
        lastSavedUps: row.last_saved_ups, lastSavedAir: row.last_saved_air, lastSavedDc: row.last_saved_dc, lastSavedEnergyCost: row.last_saved_energy_cost,
        energyCalculation: profileRow ? { upsGroups: (profileRow.ups_groups ?? []) as string[][], dcIds: (profileRow.dc_ids ?? []) as string[], airFields: (profileRow.air_fields ?? []) as string[] } : undefined
      });
    }
    for (const row of ups.rows) {
      const log = byPeriod.get(row.period_id); if (!log) continue;
      const record: UpsRecord = { upsId: row.ups_id, voltage: numberOrNull(row.voltage), current: numberOrNull(row.current), loadKw: numberOrNull(row.load_kw), loadKva: numberOrNull(row.load_kva) };
      if (row.phase_code) { const phases = (log.ups.find(item => item.upsId === record.upsId)?.phases ?? {}); phases[row.phase_code] = { voltage: record.voltage, current: record.current, loadKw: record.loadKw, loadKva: record.loadKva }; const existing = log.ups.find(item => item.upsId === record.upsId); if (existing) existing.phases = phases; else log.ups.push({ ...record, phases }); }
      else log.ups.push(record);
    }
    for (const row of air.rows) { const log = byPeriod.get(row.period_id); if (!log) continue; if (row.code in log.air) (log.air as unknown as Record<string, number | null>)[row.code] = numberOrNull(row.reading); else log.air.meters![row.code] = numberOrNull(row.reading); }
    for (const row of dc.rows) { const log = byPeriod.get(row.period_id); if (log) log.dc.push({ panelId: row.code, voltage: numberOrNull(row.voltage), current: numberOrNull(row.current) }); }
    for (const row of electrical.rows) {
      const log = byPeriod.get(row.period_id); if (!log) continue;
      if (row.source_kind === "ups_phase") { const existing = log.srinakarinInputs ?? { upsPhase: {}, acPhase: {}, ppc43Current: {}, ppc43Panel: {} }; existing.upsPhase[`${row.source_key} - ${row.phase_code}`] = { voltage: numberOrNull(row.voltage), current: numberOrNull(row.current), loadKw: numberOrNull(row.load_kw), loadKva: numberOrNull(row.load_kva) }; log.srinakarinInputs = existing; }
      else if (row.source_kind === "ac_phase") { const existing = log.srinakarinInputs ?? { upsPhase: {}, acPhase: {}, ppc43Current: {}, ppc43Panel: {} }; existing.acPhase[`${row.source_key} - ${row.phase_code}`] = { voltage: numberOrNull(row.voltage), current: numberOrNull(row.current) }; log.srinakarinInputs = existing; }
      else if (row.source_kind === "ppc43_current") { const existing = log.srinakarinInputs ?? { upsPhase: {}, acPhase: {}, ppc43Current: {}, ppc43Panel: {} }; existing.ppc43Current[row.source_key] = numberOrNull(row.current); log.srinakarinInputs = existing; }
      else { const existing = log.srinakarinInputs ?? { upsPhase: {}, acPhase: {}, ppc43Current: {}, ppc43Panel: {} }; existing.ppc43Panel[row.source_key] = { loadKw: numberOrNull(row.load_kw), loadKva: numberOrNull(row.load_kva) }; log.srinakarinInputs = existing; }
    }
    return [...byPeriod.values()];
  }

  async hasImportedSourceHash(siteId: number, sourceFileHash: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(this.executor,
      "SELECT EXISTS (SELECT 1 FROM provenance_records p JOIN monthly_periods m ON m.id = p.entity_id WHERE m.site_id = $1 AND p.entity_type = 'monthly_period' AND p.source_file_hash = $2) AS exists",
      [siteId, sourceFileHash]);
    return result.rows[0]?.exists === true;
  }

  async getRackSnapshot(siteId: number, month: string): Promise<RackSnapshotRecord | null> {
    const snapshot = await query<{ id: string; snapshot_month: string; row_version: number }>(this.executor, "SELECT id, snapshot_month, row_version FROM rack_capacity_snapshots WHERE site_id = $1 AND snapshot_month = $2::date", [siteId, `${month}-01`]);
    const row = snapshot.rows[0]; if (!row) return null;
    const records = await query<{ source_row_number: number | null; rack_zone: string | null; rack_id: string | null; status: string | null; cabinet_size: string | null; detail: string | null; device_type: string | null; remarks: string | null }>(this.executor, "SELECT source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks FROM rack_capacity_records WHERE snapshot_id = $1 ORDER BY source_row_number NULLS LAST, id", [row.id]);
    return { month: monthString(row.snapshot_month), rowVersion: row.row_version, records: records.rows.map(item => ({ rowNumber: item.source_row_number, rackZone: item.rack_zone, rackId: item.rack_id, status: item.status, cabinetSize: item.cabinet_size, detail: item.detail, deviceType: item.device_type, remarks: item.remarks })) };
  }

  async getRackUnitSnapshot(siteId: number, month: string): Promise<RackUnitSnapshotRecord | null> {
    const result = await query<{ period_month: string; row_version: number; total_u: unknown; used_u: unknown }>(this.executor, "SELECT period_month, row_version, total_u, used_u FROM rack_unit_capacity_snapshots WHERE site_id = $1 AND period_month = $2::date", [siteId, `${month}-01`]);
    const row = result.rows[0];
    return row ? { month: monthString(row.period_month), rowVersion: row.row_version, totalU: Number(row.total_u), usedU: Number(row.used_u) } : null;
  }

  async listRackUnitSnapshots(siteId: number): Promise<RackUnitSnapshotRecord[]> {
    const result = await query<{ period_month: string; row_version: number; total_u: unknown; used_u: unknown }>(this.executor,
      "SELECT period_month, row_version, total_u, used_u FROM rack_unit_capacity_snapshots WHERE site_id = $1 ORDER BY period_month", [siteId]);
    return result.rows.map(row => ({ month: monthString(row.period_month), rowVersion: row.row_version, totalU: Number(row.total_u), usedU: Number(row.used_u) }));
  }

  async saveRackCapacityHistory(input: SaveRackCapacityHistoryInput): Promise<void> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveRackCapacityHistoryInTransaction(client, input));
  }

  protected async saveRackCapacityHistoryInTransaction(executor: DbExecutor, input: SaveRackCapacityHistoryInput): Promise<void> {
    if (input.rows.length === 0) return;
    const chunkSize = 200;
    for (let start = 0; start < input.rows.length; start += chunkSize) {
      const chunk = input.rows.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, index) => {
        const offset = index * 17;
        values.push(input.siteId, `${row.snapshotMonth}-01`, row.facility, row.rackZone, row.totalRacks, row.inUse, row.available, row.reserved, row.pendingDismantle, row.other, row.usagePct, row.availabilityPct, row.reservedPct, row.pendingDismantlePct, row.otherPct, row.generatedAt, row.dataVersion);
        return `($${offset + 1},$${offset + 2}::date,$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15},$${offset + 16}::timestamptz,$${offset + 17})`;
      }).join(",");
      await query(executor,
        `INSERT INTO rack_capacity_history(site_id, snapshot_month, facility, rack_zone, total_racks, in_use, available, reserved, pending_dismantle, other, usage_pct, availability_pct, reserved_pct, pending_dismantle_pct, other_pct, generated_at, data_version)
         VALUES ${placeholders}
         ON CONFLICT (site_id, snapshot_month, rack_zone) DO UPDATE SET facility = EXCLUDED.facility, total_racks = EXCLUDED.total_racks, in_use = EXCLUDED.in_use, available = EXCLUDED.available, reserved = EXCLUDED.reserved, pending_dismantle = EXCLUDED.pending_dismantle, other = EXCLUDED.other, usage_pct = EXCLUDED.usage_pct, availability_pct = EXCLUDED.availability_pct, reserved_pct = EXCLUDED.reserved_pct, pending_dismantle_pct = EXCLUDED.pending_dismantle_pct, other_pct = EXCLUDED.other_pct, generated_at = EXCLUDED.generated_at, data_version = EXCLUDED.data_version`, values);
    }
  }

  async getRackCapacityHistory(siteId: number): Promise<RackCapacityHistoryRow[]> {
    const result = await query<{ snapshot_month: string; facility: string; rack_zone: string; total_racks: number; in_use: number; available: number; reserved: number; pending_dismantle: number; other: number; usage_pct: unknown; availability_pct: unknown; reserved_pct: unknown; pending_dismantle_pct: unknown; other_pct: unknown; generated_at: string; data_version: number }>(this.executor,
      `SELECT snapshot_month, facility, rack_zone, total_racks, in_use, available, reserved, pending_dismantle, other, usage_pct, availability_pct, reserved_pct, pending_dismantle_pct, other_pct, generated_at, data_version
       FROM rack_capacity_history WHERE site_id = $1 ORDER BY snapshot_month, rack_zone`, [siteId]);
    return result.rows.map(row => ({ snapshotMonth: monthString(row.snapshot_month), facility: row.facility, rackZone: row.rack_zone, totalRacks: Number(row.total_racks), inUse: Number(row.in_use), available: Number(row.available), reserved: Number(row.reserved), pendingDismantle: Number(row.pending_dismantle), other: Number(row.other), usagePct: numberOrNull(row.usage_pct), availabilityPct: numberOrNull(row.availability_pct), reservedPct: numberOrNull(row.reserved_pct), pendingDismantlePct: numberOrNull(row.pending_dismantle_pct), otherPct: numberOrNull(row.other_pct), generatedAt: new Date(row.generated_at).toISOString(), dataVersion: Number(row.data_version) }));
  }

  async saveUpsGroupHistory(input: SaveUpsGroupHistoryInput): Promise<void> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveUpsGroupHistoryInTransaction(client, input));
  }

  protected async saveUpsGroupHistoryInTransaction(executor: DbExecutor, input: SaveUpsGroupHistoryInput): Promise<void> {
    if (input.rows.length === 0) return;
    const chunkSize = 200;
    for (let start = 0; start < input.rows.length; start += chunkSize) {
      const chunk = input.rows.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((row, index) => {
        const offset = index * 13;
        values.push(input.siteId, input.sourceSheet, row.facility, `${row.month}-01`, row.group, row.totalLoadKw, row.totalLoadKva, row.capacity, row.loadPercent, row.availablePercent, row.monthlyEnergyKwh, row.generatedAt, row.dataVersion);
        return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4}::date,$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12}::timestamptz,$${offset + 13})`;
      }).join(",");
      await query(executor,
        `INSERT INTO ups_group_history(site_id, source_sheet, facility, history_month, group_name, total_load_kw, total_load_kva, capacity, load_percent, available_percent, monthly_energy_kwh, generated_at, data_version)
         VALUES ${placeholders}
         ON CONFLICT (site_id, history_month, group_name) DO UPDATE SET source_sheet = EXCLUDED.source_sheet, facility = EXCLUDED.facility, total_load_kw = EXCLUDED.total_load_kw, total_load_kva = EXCLUDED.total_load_kva, capacity = EXCLUDED.capacity, load_percent = EXCLUDED.load_percent, available_percent = EXCLUDED.available_percent, monthly_energy_kwh = EXCLUDED.monthly_energy_kwh, generated_at = EXCLUDED.generated_at, data_version = EXCLUDED.data_version`, values);
    }
  }

  async getUpsGroupHistory(siteId: number): Promise<{ sourceSheet: string; rows: UpsGroupHistoryRow[] }> {
    const result = await query<{ source_sheet: string; facility: string; history_month: string; group_name: string; total_load_kw: unknown; total_load_kva: unknown; capacity: unknown; load_percent: unknown; available_percent: unknown; monthly_energy_kwh: unknown; generated_at: string | null; data_version: number | null }>(this.executor,
      `SELECT source_sheet, facility, history_month, group_name, total_load_kw, total_load_kva, capacity, load_percent, available_percent, monthly_energy_kwh, generated_at, data_version
       FROM ups_group_history WHERE site_id = $1 ORDER BY history_month, group_name`, [siteId]);
    const sourceSheet = result.rows[0]?.source_sheet ?? "2. UPS Group History";
    return {
      sourceSheet,
      rows: result.rows.map(row => ({
        facility: row.facility,
        month: monthString(row.history_month),
        group: row.group_name,
        totalLoadKw: Number(row.total_load_kw),
        totalLoadKva: Number(row.total_load_kva),
        capacity: numberOrNull(row.capacity),
        loadPercent: numberOrNull(row.load_percent),
        availablePercent: numberOrNull(row.available_percent),
        monthlyEnergyKwh: Number(row.monthly_energy_kwh),
        generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null,
        dataVersion: row.data_version === null ? null : Number(row.data_version)
      }))
    };
  }

  async saveRackUnitImage(input: SaveRackUnitImageInput): Promise<RackUnitImageRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveRackUnitImageInTransaction(client, input));
  }

  protected async saveRackUnitImageInTransaction(executor: DbExecutor, input: SaveRackUnitImageInput): Promise<RackUnitImageRecord> {
    const savedAt = input.savedAt ?? new Date().toISOString();
    const snapshot = await query<{ id: string }>(executor, "SELECT id FROM rack_unit_capacity_snapshots WHERE site_id = $1 AND period_month = $2::date", [input.siteId, `${input.month}-01`]);
    if (!snapshot.rows[0]) throw new HttpError(409, "RACK_UNIT_SNAPSHOT_NOT_FOUND", "Rack Unit Capacity image has no matching monthly snapshot.");
    await query(executor, "DELETE FROM rack_unit_capacity_images WHERE snapshot_id = $1", [snapshot.rows[0].id]);
    await query(executor,
      `INSERT INTO rack_unit_capacity_images(snapshot_id, object_key, content_type, byte_size, sha256, width, height, saved_at, saved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
      [snapshot.rows[0].id, input.objectKey, input.contentType, input.byteSize, input.sha256, input.width, input.height, savedAt, input.savedBy]);
    return { siteId: input.siteId, month: input.month, objectKey: input.objectKey, contentType: input.contentType, byteSize: input.byteSize, sha256: input.sha256, width: input.width, height: input.height, savedAt: new Date(savedAt).toISOString(), savedBy: input.savedBy };
  }

  async getRackUnitImage(siteId: number, month: string): Promise<RackUnitImageRecord | null> {
    const result = await query<{ period_month: string; object_key: string; content_type: "image/png" | "image/jpeg"; byte_size: string; sha256: string; width: number; height: number; saved_at: string; saved_by: string }>(this.executor,
      `SELECT s.period_month, i.object_key, i.content_type, i.byte_size, i.sha256, i.width, i.height, i.saved_at, i.saved_by
       FROM rack_unit_capacity_snapshots s JOIN rack_unit_capacity_images i ON i.snapshot_id = s.id
       WHERE s.site_id = $1 AND s.period_month = $2::date ORDER BY i.saved_at DESC, i.id DESC LIMIT 1`, [siteId, `${month}-01`]);
    const row = result.rows[0];
    return row ? { siteId, month: monthString(row.period_month), objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size), sha256: row.sha256, width: Number(row.width), height: Number(row.height), savedAt: new Date(row.saved_at).toISOString(), savedBy: row.saved_by } : null;
  }

  async saveWorkbookSource(input: SaveWorkbookSourceInput): Promise<WorkbookSourceRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.saveWorkbookSourceInTransaction(client, input));
  }

  protected async saveWorkbookSourceInTransaction(executor: DbExecutor, input: SaveWorkbookSourceInput): Promise<WorkbookSourceRecord> {
    await query(executor, "UPDATE workbook_source_versions SET is_current = false WHERE site_id = $1 AND is_current = true", [input.siteId]);
    const result = await query<{ id: string; site_id: string; source_file_name: string; source_file_hash: string; object_key: string; content_type: string; byte_size: string; imported_at: string; actor_user_id: string | null }>(executor,
      `INSERT INTO workbook_source_versions(site_id, source_file_name, source_file_hash, object_key, content_type, byte_size, actor_user_id, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, site_id, source_file_name, source_file_hash, object_key, content_type, byte_size, imported_at, actor_user_id`,
      [input.siteId, input.sourceFileName, input.sourceFileHash, input.objectKey, input.contentType, input.byteSize, input.actorUserId ?? null, input.correlationId]);
    const row = result.rows[0];
    if (!row) throw new Error("Workbook source metadata was not saved.");
    return { id: Number(row.id), siteId: Number(row.site_id), sourceFileName: row.source_file_name, sourceFileHash: row.source_file_hash, objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size), importedAt: new Date(row.imported_at).toISOString(), actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id) };
  }

  async getWorkbookSource(siteId: number): Promise<WorkbookSourceRecord | null> {
    const result = await query<{ id: string; site_id: string; source_file_name: string; source_file_hash: string; object_key: string; content_type: string; byte_size: string; imported_at: string; actor_user_id: string | null }>(this.executor,
      `SELECT id, site_id, source_file_name, source_file_hash, object_key, content_type, byte_size, imported_at, actor_user_id
       FROM workbook_source_versions WHERE site_id = $1 AND is_current = true ORDER BY imported_at DESC, id DESC LIMIT 1`, [siteId]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), siteId: Number(row.site_id), sourceFileName: row.source_file_name, sourceFileHash: row.source_file_hash, objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size), importedAt: new Date(row.imported_at).toISOString(), actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id) } : null;
  }

  async listWorkbookSources(siteId: number): Promise<WorkbookSourceRecord[]> {
    const result = await query<{ id: string; site_id: string; source_file_name: string; source_file_hash: string; object_key: string; content_type: string; byte_size: string; imported_at: string; actor_user_id: string | null }>(this.executor,
      `SELECT id, site_id, source_file_name, source_file_hash, object_key, content_type, byte_size, imported_at, actor_user_id
       FROM workbook_source_versions WHERE site_id = $1 ORDER BY imported_at DESC, id DESC`, [siteId]);
    return result.rows.map(row => ({ id: Number(row.id), siteId: Number(row.site_id), sourceFileName: row.source_file_name, sourceFileHash: row.source_file_hash, objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size), importedAt: new Date(row.imported_at).toISOString(), actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id) }));
  }

  async restoreWorkbookSourceCurrent(siteId: number, sourceId: number): Promise<WorkbookSourceRecord> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, client => this.restoreWorkbookSourceCurrentInTransaction(client, siteId, sourceId));
  }

  protected async restoreWorkbookSourceCurrentInTransaction(executor: DbExecutor, siteId: number, sourceId: number): Promise<WorkbookSourceRecord> {
    await query(executor, "UPDATE workbook_source_versions SET is_current = false WHERE site_id = $1 AND is_current = true", [siteId]);
    const result = await query<{ id: string; site_id: string; source_file_name: string; source_file_hash: string; object_key: string; content_type: string; byte_size: string; imported_at: string; actor_user_id: string | null }>(executor,
      `UPDATE workbook_source_versions SET is_current = true WHERE site_id = $1 AND id = $2 RETURNING id, site_id, source_file_name, source_file_hash, object_key, content_type, byte_size, imported_at, actor_user_id`, [siteId, sourceId]);
    const row = result.rows[0];
    if (!row) throw new HttpError(404, "WORKBOOK_BACKUP_NOT_FOUND", "The workbook backup was not found.");
    return { id: Number(row.id), siteId: Number(row.site_id), sourceFileName: row.source_file_name, sourceFileHash: row.source_file_hash, objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size), importedAt: new Date(row.imported_at).toISOString(), actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id) };
  }

  async saveGoogleOAuthState(input: GoogleOAuthStateRecord): Promise<void> {
    await query(this.executor,
      `INSERT INTO google_oauth_states(state_hash, user_id, session_id, encrypted_code_verifier, expires_at)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5::timestamptz)
       ON CONFLICT (state_hash) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, encrypted_code_verifier = EXCLUDED.encrypted_code_verifier, expires_at = EXCLUDED.expires_at`,
      [input.stateHash, input.userId, input.sessionId, input.encryptedCodeVerifier, input.expiresAt]);
  }

  async consumeGoogleOAuthState(stateHash: string, userId: number, sessionId: string): Promise<GoogleOAuthStateRecord | null> {
    const result = await query<{ state_hash: string; user_id: string; session_id: string; encrypted_code_verifier: string; expires_at: string }>(this.executor,
      `DELETE FROM google_oauth_states
       WHERE state_hash = $1 AND user_id = $2::bigint AND session_id = $3::bigint AND expires_at > now()
       RETURNING state_hash, user_id, session_id, encrypted_code_verifier, expires_at`,
      [stateHash, userId, sessionId]);
    const row = result.rows[0];
    return row ? { stateHash: row.state_hash, userId: Number(row.user_id), sessionId: row.session_id, encryptedCodeVerifier: row.encrypted_code_verifier, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }

  async saveGoogleSheetsConnection(input: GoogleSheetsConnectionRecord): Promise<void> {
    await query(this.executor,
      `INSERT INTO google_sheets_connections(user_id, encrypted_refresh_token, email, updated_at)
       VALUES ($1::bigint, $2, $3, $4::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, email = EXCLUDED.email, updated_at = EXCLUDED.updated_at`,
      [input.userId, input.encryptedRefreshToken, input.email, input.updatedAt]);
  }

  async getGoogleSheetsConnection(userId: number): Promise<GoogleSheetsConnectionRecord | null> {
    const result = await query<{ user_id: string; encrypted_refresh_token: string; email: string | null; updated_at: string }>(this.executor,
      "SELECT user_id, encrypted_refresh_token, email, updated_at FROM google_sheets_connections WHERE user_id = $1::bigint", [userId]);
    const row = result.rows[0];
    return row ? { userId: Number(row.user_id), encryptedRefreshToken: row.encrypted_refresh_token, email: row.email, updatedAt: new Date(row.updated_at).toISOString() } : null;
  }

  async deleteGoogleSheetsConnection(userId: number): Promise<void> { await query(this.executor, "DELETE FROM google_sheets_connections WHERE user_id = $1::bigint", [userId]); }

  async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error("A transaction-bound repository cannot start a nested transaction.");
    return withTransaction(this.pool, async client => work(new PostgresTransactionRepository(client)));
  }
}

export class PostgresTransactionRepository extends PostgresRepository {
  constructor(private readonly client: PoolClient) { super(null, client); }
  override async withTransaction<T>(work: (repository: BackendRepository) => Promise<T>): Promise<T> { return work(this); }
  override async updateGlobalSettings(input: UpdateSettingsInput, correlationId: string): Promise<DisplayPeriod> {
    const previous = await this.client.query<{ start_month: string; end_month: string; row_version: number }>("SELECT start_month, end_month, row_version FROM global_settings WHERE id = 1 FOR UPDATE");
    if (!previous.rows[0]) {
      if (input.expectedRowVersion !== 0) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
      const created = await this.client.query<{ start_month: string; end_month: string; row_version: number }>("INSERT INTO global_settings(id, start_month, end_month, row_version) VALUES (1, $1::date, $2::date, 1) ON CONFLICT (id) DO NOTHING RETURNING start_month, end_month, row_version", [`${input.startMonth}-01`, `${input.endMonth}-01`]);
      if (!created.rows[0]) throw new HttpError(409, "STALE_VERSION", "Global settings changed before this update was saved.");
       await this.client.query("INSERT INTO audit_events(actor_type,actor_user_id,action,entity_type,entity_id,previous_value,new_value,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, "create", "global_settings", "1", JSON.stringify({ dataset: "global_settings", record: "display_period", previous: null }), JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: input.startMonth, end_month: input.endMonth, row_version: created.rows[0].row_version }), correlationId]);
      const r = created.rows[0]; return { startMonth: monthString(r.start_month), endMonth: monthString(r.end_month), rowVersion: r.row_version };
    }
    if (previous.rows[0].row_version !== input.expectedRowVersion) throw new HttpError(409,"STALE_VERSION","Global settings changed before this update was saved.");
    const result = await this.client.query("UPDATE global_settings SET start_month=$1::date,end_month=$2::date,row_version=row_version+1,updated_at=now() WHERE id=1 AND row_version=$3 RETURNING start_month,end_month,row_version", [`${input.startMonth}-01`, `${input.endMonth}-01`, input.expectedRowVersion]);
    if (!result.rows[0]) throw new HttpError(409,"STALE_VERSION","Global settings changed before this update was saved.");
     const r=result.rows[0]; await this.client.query("INSERT INTO audit_events(actor_type,actor_user_id,action,entity_type,entity_id,previous_value,new_value,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",[input.actorUserId === null || input.actorUserId === undefined ? "system" : "user", input.actorUserId ?? null, "update", "global_settings", "1", JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: monthString(previous.rows[0].start_month), end_month: monthString(previous.rows[0].end_month), row_version: previous.rows[0].row_version }), JSON.stringify({ dataset: "global_settings", record: "display_period", start_month: input.startMonth, end_month: input.endMonth, row_version: r.row_version }), correlationId]);
    return {startMonth:monthString(r.start_month),endMonth:monthString(r.end_month),rowVersion:r.row_version};
  }
  override async saveMonthlyLog(input: SaveMonthlyLogInput): Promise<PeriodRecord> { return this.saveMonthlyLogInTransaction(this.client, input); }
  override async saveRackSnapshot(input: SaveRackSnapshotInput): Promise<RackSnapshotRecord> { return this.saveRackSnapshotInTransaction(this.client, input); }
  override async saveRackUnitSnapshot(input: SaveRackUnitSnapshotInput): Promise<RackUnitSnapshotRecord> { return this.saveRackUnitSnapshotInTransaction(this.client, input); }
  override async saveRackCapacityHistory(input: SaveRackCapacityHistoryInput): Promise<void> { return this.saveRackCapacityHistoryInTransaction(this.client, input); }
  override async saveUpsGroupHistory(input: SaveUpsGroupHistoryInput): Promise<void> { return this.saveUpsGroupHistoryInTransaction(this.client, input); }
  override async saveRackUnitImage(input: SaveRackUnitImageInput): Promise<RackUnitImageRecord> { return this.saveRackUnitImageInTransaction(this.client, input); }
  override async saveWorkbookSource(input: SaveWorkbookSourceInput): Promise<WorkbookSourceRecord> { return this.saveWorkbookSourceInTransaction(this.client, input); }
  override async restoreWorkbookSourceCurrent(siteId: number, sourceId: number): Promise<WorkbookSourceRecord> { return this.restoreWorkbookSourceCurrentInTransaction(this.client, siteId, sourceId); }
}
