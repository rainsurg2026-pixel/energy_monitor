import type { Pool, PoolClient } from "pg";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import type { MonthlyLog } from "../../src/types";
import { PostgresTransactionRepository } from "../db/postgresRepository";
import { withTransaction } from "../db/pool";
import { verifyCalculatedParity } from "./engine";
import type { MigrationImportResult, MigrationPlan } from "./types";

export interface MigrationImportOptions {
  allowWrite: boolean;
  targetEnvironment: "development" | "test" | "production";
  readOnlyMode?: boolean;
}

export class MigrationImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MigrationImportError";
  }
}

function redactedError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Migration import failed.";
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted-connection-string>").slice(0, 1000);
}

function sourceLocationForMonth(plan: MigrationPlan, month: string): { sheet: string | null; location: string | null } {
  const locations = plan.source.sourceLocationsByMonth[month] ?? [];
  return {
    sheet: locations.map(location => location.split("!")[0]).filter(Boolean).join(", ") || null,
    location: locations.join(", ") || null
  };
}

function authoritativeLog(log: MonthlyLog): MonthlyLog {
  return {
    ...log,
    energyCost: {
      buildingEnergyKwh: log.energyCost.buildingEnergyKwh,
      buildingElectricityCostThb: log.energyCost.buildingElectricityCostThb
    }
  };
}

async function insertCalculationOutputs(client: PoolClient, periodId: number, plan: MigrationPlan, month: string, batchId: number): Promise<void> {
  const calculation = plan.calculations.find(entry => entry.month === month);
  if (!calculation) throw new MigrationImportError("CALCULATION_MISSING", `No domain calculation exists for ${month}.`);
  const run = await client.query<{ id: string }>(
    "INSERT INTO calculation_runs(period_id, calculation_type, formula_version, input_hash) VALUES ($1,$2,$3,$4) RETURNING id",
    [periodId, "desktop_parity", DESKTOP_FORMULA_VERSION, plan.source.sourceFileHash]
  );
  const runId = Number(run.rows[0].id);
  const numericOutputs: Array<[string, string, number | null, string | null]> = [
    ["energy", "building_energy_kwh", calculation.energy.buildingEnergyKwh, "kWh"],
    ["energy", "building_cost_thb", calculation.energy.buildingElectricityCostThb, "THB"],
    ["energy", "ups_energy_kwh", calculation.energy.upsEnergyKwh, "kWh"],
    ["energy", "air_energy_kwh", calculation.energy.airEnergyKwh, "kWh"],
    ["energy", "dc_energy_kwh", calculation.energy.dcEnergyKwh, "kWh"],
    ["energy", "floor_energy_kwh", calculation.energy.floorEnergyKwh, "kWh"],
    ["energy", "floor_cost_thb", calculation.energy.floorElectricityCostThb, "THB"],
    ["energy", "average_rate_thb_per_kwh", calculation.energy.averageElectricityRateThbPerKwh, "THB/kWh"],
    ["energy", "energy_share_percent", calculation.energy.energySharePercent, "%"],
    ["dashboard", "total_energy_kwh", calculation.metrics.totalEnergyKwh, "kWh"],
    ["dashboard", "it_equipment_energy_kwh", calculation.metrics.itEquipmentEnergyKwh, "kWh"],
    ["dashboard", "pue", calculation.metrics.pue, null],
    ["dashboard", "carbon_emission_kg", calculation.metrics.carbonEmissionKg, "kg"],
    ["dashboard", "actual_cost_thb", calculation.metrics.actualCostThb, "THB"],
    ["dashboard", "estimated_cost_thb", calculation.metrics.estimatedCostThb, "THB"],
    ["dashboard", "average_rate_thb_per_kwh", calculation.metrics.avgElectricityRate, "THB/kWh"],
    ["dashboard", "data_quality_score", calculation.metrics.dataQualityScore, "score"],
    ["dashboard", "facility_health_score", calculation.metrics.facilityHealthScore, "score"],
    ["dashboard", "alerts_count", calculation.metrics.alertsCount, "count"]
  ];
  for (const [scopeType, metricCode, numericValue, unit] of numericOutputs) {
    await client.query(
      "INSERT INTO calculation_output_values(run_id, scope_type, scope_key, metric_code, unit, numeric_value, source_role) VALUES ($1,$2,$3,$4,$5,$6,'calculated')",
      [runId, scopeType, month, metricCode, unit, numericValue]
    );
  }
  await client.query(
    "INSERT INTO calculation_output_values(run_id, scope_type, scope_key, metric_code, json_value, source_role) VALUES ($1,'dashboard',$2,'alerts',$3,'calculated')",
    [runId, month, JSON.stringify(calculation.metrics.alerts)]
  );
  await client.query(
    "UPDATE migration_batches SET metadata = metadata || $2::jsonb WHERE id = $1",
    [batchId, JSON.stringify({ formula_version: DESKTOP_FORMULA_VERSION })]
  );
}

async function recordFailedBatch(pool: Pool, plan: MigrationPlan, code: string, message: string): Promise<void> {
  await withTransaction(pool, async client => {
    const batch = await client.query<{ id: string }>(
      `INSERT INTO migration_batches(source_type, source_identity, source_hash, status, row_count, error_count, idempotency_key, completed_at, metadata)
       VALUES ($1,$2,$3,'failed',$4,1,$5,now(),$6::jsonb)
       ON CONFLICT (idempotency_key) DO UPDATE SET status='failed', error_count=migration_batches.error_count+1, completed_at=now(), metadata=migration_batches.metadata || EXCLUDED.metadata
       RETURNING id`,
      [plan.source.sourceType, `${plan.mapping.siteCode}:${plan.source.sourceFileName}`, plan.source.sourceFileHash, plan.rowCount, plan.idempotencyKey, JSON.stringify({ failure_code: code })]
    );
    await client.query(
      "INSERT INTO migration_errors(migration_batch_id, source_location, error_code, message, diagnostics) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [Number(batch.rows[0].id), plan.source.sourcePath, code, message, JSON.stringify({ site_code: plan.mapping.siteCode, source_file_hash: plan.source.sourceFileHash })]
    );
  }).catch(() => undefined);
}

export async function importMigrationPlan(pool: Pool, plan: MigrationPlan, options: MigrationImportOptions): Promise<MigrationImportResult> {
  if (!options.allowWrite) throw new MigrationImportError("WRITE_NOT_ENABLED", "Import requires an explicit write flag.");
  if (options.readOnlyMode) throw new MigrationImportError("READ_ONLY_MODE", "Migration import is disabled while READ_ONLY_MODE is enabled.");
  if (options.targetEnvironment === "production") throw new MigrationImportError("PRODUCTION_IMPORT_BLOCKED", "Direct production migration is prohibited.");
  const errors = plan.issues.filter(entry => entry.severity === "error");
  if (errors.length > 0) throw new MigrationImportError("PLAN_INVALID", "Migration plan contains validation errors.");

  try {
    return await withTransaction(pool, async client => {
      const existingBatch = await client.query<{ id: string; status: string }>("SELECT id, status FROM migration_batches WHERE idempotency_key = $1 FOR UPDATE", [plan.idempotencyKey]);
      if (existingBatch.rows[0]) {
        if (existingBatch.rows[0].status === "verified" || existingBatch.rows[0].status === "imported") return { status: "skipped", batchId: Number(existingBatch.rows[0].id), verified: existingBatch.rows[0].status === "verified", importedMonths: [], cachedEvidenceCount: 0 };
        throw new MigrationImportError("DUPLICATE_BATCH", "A previous migration batch with this source hash is not verified.");
      }

      const site = await client.query<{ id: string; name: string; active: boolean; profile_code: string | null }>(
        `SELECT s.id, s.name, s.active, sp.profile_code
         FROM sites s LEFT JOIN site_profiles sp ON sp.site_id = s.id
         WHERE s.code = $1 FOR SHARE`, [plan.mapping.siteCode]
      );
      const siteRow = site.rows[0];
      if (!siteRow || !siteRow.active) throw new MigrationImportError("SITE_MAPPING_INVALID", `Active site mapping was not found for ${plan.mapping.siteCode}.`);
      if (plan.mapping.expectedSiteName && siteRow.name !== plan.mapping.expectedSiteName) throw new MigrationImportError("SITE_NAME_MISMATCH", "Target site name does not match the migration mapping.");
      if (plan.mapping.expectedProfileCode && siteRow.profile_code !== plan.mapping.expectedProfileCode) throw new MigrationImportError("PROFILE_MAPPING_INVALID", "Target site profile does not match the migration mapping.");

      const months = plan.source.logs.map(log => `${log.month}-01`);
      const existingPeriods = await client.query<{ period_month: string }>("SELECT period_month FROM monthly_periods WHERE site_id = $1 AND period_month = ANY($2::date[]) FOR SHARE", [siteRow.id, months]);
      if (existingPeriods.rows.length > 0) throw new MigrationImportError("DUPLICATE_TARGET_PERIOD", "One or more target months already contain data; no overwrite was attempted.");

      const batch = await client.query<{ id: string }>(
        `INSERT INTO migration_batches(source_type, source_identity, source_hash, status, row_count, idempotency_key, metadata)
         VALUES ($1,$2,$3,'validated',$4,$5,$6::jsonb) RETURNING id`,
        [plan.source.sourceType, `${plan.mapping.siteCode}:${plan.source.sourceFileName}`, plan.source.sourceFileHash, plan.rowCount, plan.idempotencyKey, JSON.stringify({ target_environment: options.targetEnvironment, source_path: plan.source.sourcePath })]
      );
      const batchId = Number(batch.rows[0].id);
      const transactionRepository = new PostgresTransactionRepository(client);
      const periodIds = new Map<string, number>();
      for (const sourceLog of [...plan.source.logs].sort((a, b) => a.month.localeCompare(b.month))) {
        const log = authoritativeLog(sourceLog);
        const location = sourceLocationForMonth(plan, log.month);
        const period = await transactionRepository.saveMonthlyLog({
          siteId: Number(siteRow.id),
          log,
          expectedRowVersion: null,
          correlationId: `migration:${batchId}:${log.month}`,
          provenance: { sourceType: plan.source.sourceType, sourceFileHash: plan.source.sourceFileHash, sourceFileName: plan.source.sourceFileName, sourceSheet: location.sheet, sourceLocation: location.location }
        });
        periodIds.set(log.month, period.id);
        for (const evidence of plan.source.cachedEvidence.filter(entry => entry.month === log.month)) {
          await client.query(
            "INSERT INTO legacy_cached_evidence(period_id, site_id, field_name, numeric_value, text_value, source_sheet, source_location, formula_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [period.id, siteRow.id, evidence.fieldName, evidence.numericValue, evidence.textValue, evidence.sourceSheet, evidence.sourceLocation, evidence.formulaVersion]
          );
        }
        await insertCalculationOutputs(client, period.id, plan, log.month, batchId);
      }

      const actualLogs = await transactionRepository.getMonthlyLogs(Number(siteRow.id), plan.source.logs.map(log => log.month));
      const parityIssues = verifyCalculatedParity(plan.calculations, actualLogs);
      if (parityIssues.length > 0) throw new MigrationImportError("GOLDEN_PARITY_MISMATCH", "Recomputed database inputs did not match the Phase 1 calculation outputs.");
      const periodIdValues = [...periodIds.values()];
      const [provenance, evidence, runs] = await Promise.all([
        client.query<{ count: string }>("SELECT count(*)::text AS count FROM provenance_records WHERE entity_type = 'monthly_period' AND source_file_hash = $1 AND entity_id = ANY($2::bigint[])", [plan.source.sourceFileHash, periodIdValues]),
        client.query<{ count: string }>("SELECT count(*)::text AS count FROM legacy_cached_evidence WHERE period_id = ANY($1::bigint[])", [periodIdValues]),
        client.query<{ count: string }>("SELECT count(*)::text AS count FROM calculation_runs WHERE period_id = ANY($1::bigint[]) AND input_hash = $2", [periodIdValues, plan.source.sourceFileHash])
      ]);
      if (Number(provenance.rows[0].count) !== plan.source.logs.length || Number(evidence.rows[0].count) !== plan.source.cachedEvidence.length || Number(runs.rows[0].count) !== plan.source.logs.length) throw new MigrationImportError("IMPORT_VERIFY_FAILED", "Raw provenance, cached evidence, or calculation run counts did not match the migration plan.");
      await client.query("UPDATE migration_batches SET status='verified', success_count=$2, completed_at=now() WHERE id=$1", [batchId, plan.source.logs.length]);
      return { status: "imported", batchId, verified: true, importedMonths: plan.source.logs.map(log => log.month).sort(), cachedEvidenceCount: plan.source.cachedEvidence.length };
    });
  } catch (error) {
    const code = error instanceof MigrationImportError ? error.code : "IMPORT_FAILED";
    await recordFailedBatch(pool, plan, code, redactedError(error));
    throw error;
  }
}
