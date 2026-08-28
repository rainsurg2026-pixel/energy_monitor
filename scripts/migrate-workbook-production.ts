/**
 * One-time, operator-invoked import of the authoritative Desktop workbook
 * into the known Production Supabase project.
 *
 * This is intentionally separate from migrate-workbook.ts. The normal
 * importer remains development/test-only; this command adds independent
 * production target verification and explicit source-hash confirmation before
 * the transactional importer is allowed to write.
 *
 * Required environment variables (set locally, never committed or pasted):
 *   NODE_ENV=production
 *   DIRECT_DATABASE_URL=<Production connection string>
 *   MIGRATION_SITE_CODE=rangsit|srinakarin
 *   MIGRATION_ALLOW_WRITE=true
 *   MIGRATION_CONFIRM_PRODUCTION_IMPORT=YES
 *   MIGRATION_CONFIRM_SOURCE_HASH=<sha256 printed by the preview>
 *
 * This command does not run schema migrations, seed sites, bootstrap users,
 * change display-period settings, or copy data from Preview.
 */
import { loadDotEnvFile, loadMigrationDatabaseConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { createMigrationPlan, previewMigrationPlan } from "../server/migration/engine";
import { importMigrationPlan } from "../server/migration/postgresImporter";
import { readWorkbookSource } from "../server/migration/workbookSource";
import { verifyProductionEnvironment, verifyProductionTarget } from "./lib/productionTargetGuard";
import { SupabaseRackUnitImageStorage } from "../server/storage/rackUnitImageStorage";
import { filterMigrationSourceToMonthWindow } from "../server/migration/monthWindow";

loadDotEnvFile();

const [sourcePath] = process.argv.slice(2);
const siteCode = process.env.MIGRATION_SITE_CODE?.trim();


if (!sourcePath) throw new Error("Usage: npm run migration:workbook:production -- <workbook-path>");
if (!siteCode) throw new Error("MIGRATION_SITE_CODE is required.");

const environmentCheck = verifyProductionEnvironment(process.env.NODE_ENV, { vercelEnv: process.env.VERCEL_ENV, readOnlyMode: process.env.READ_ONLY_MODE === "true" });
if (!environmentCheck.ok) throw new Error(`Refusing to run: ${environmentCheck.reason}`);
if (process.env.MIGRATION_ALLOW_WRITE !== "true") throw new Error("MIGRATION_ALLOW_WRITE=true is required.");
if (process.env.MIGRATION_CONFIRM_PRODUCTION_IMPORT !== "YES") {
  throw new Error("MIGRATION_CONFIRM_PRODUCTION_IMPORT=YES is required.");
}
if (process.env.READ_ONLY_MODE === "true") throw new Error("Refusing to import while READ_ONLY_MODE=true.");

const config = loadMigrationDatabaseConfig(process.env);
const connectionString = config.directDatabaseUrl ?? config.databaseUrl;
const targetVerification = verifyProductionTarget(connectionString);
if (!targetVerification.ok) throw new Error(`Refusing to run: ${targetVerification.reason}`);
console.log(`Target verification: PASS - ${targetVerification.reason}`);

const rawSource = await readWorkbookSource(sourcePath, undefined, {
  imagesRootDir: process.env.MIGRATION_IMAGES_ROOT?.trim() || undefined,
  siteCode
});
const startMonth = process.env.MIGRATION_START_MONTH?.trim() || undefined;
const endMonth = process.env.MIGRATION_END_MONTH?.trim() || undefined;
const source = filterMigrationSourceToMonthWindow(rawSource, startMonth, endMonth);
if (startMonth || endMonth) {
  console.log(`Import month window: ${startMonth ?? "minimum"}..${endMonth ?? "maximum"}`);
}
const plan = createMigrationPlan(source, {
  siteCode,
  expectedSiteName: process.env.MIGRATION_EXPECTED_SITE_NAME?.trim() || undefined,
  expectedProfileCode: process.env.MIGRATION_EXPECTED_PROFILE_CODE?.trim() || undefined
});
const preview = previewMigrationPlan(plan);
console.log(JSON.stringify({ stage: "preview", ...preview }, null, 2));

if (preview.errors.length > 0) {
  throw new Error(`Migration plan contains ${preview.errors.length} validation error(s).`);
}

const confirmedHash = process.env.MIGRATION_CONFIRM_SOURCE_HASH?.trim().toLowerCase();
if (!confirmedHash || confirmedHash !== preview.sourceFileHash) {
  throw new Error("MIGRATION_CONFIRM_SOURCE_HASH must exactly match the printed workbook SHA-256.");
}

const pool = createPool(config, "migration");
try {
  const sourceMonths = [...preview.months].sort();
  const displayPeriod = await pool.query<{ start_month: string; end_month: string }>(
    "SELECT to_char(start_month, 'YYYY-MM') AS start_month, to_char(end_month, 'YYYY-MM') AS end_month FROM global_settings WHERE id = 1"
  );
  const configuredPeriod = displayPeriod.rows[0];
  if (!configuredPeriod) {
    throw new Error("Production Global Display Period is not configured; configure it before importing historical data.");
  }
  if (configuredPeriod.start_month > sourceMonths[0] || configuredPeriod.end_month < sourceMonths[sourceMonths.length - 1]) {
    throw new Error(
      `Production Global Display Period ${configuredPeriod.start_month}..${configuredPeriod.end_month} does not cover source months ${sourceMonths[0]}..${sourceMonths[sourceMonths.length - 1]}. Extend it before importing.`
    );
  }
  console.log(`Display Period coverage: PASS - ${configuredPeriod.start_month}..${configuredPeriod.end_month}`);
  const result = await importMigrationPlan(pool, plan, {
    allowWrite: true,
    targetEnvironment: "production",
    allowProductionImport: true,
    readOnlyMode: false,
    rackUnitImageStorage: config.supabaseUrl && config.supabaseServiceRoleKey
      ? new SupabaseRackUnitImageStorage(config.supabaseUrl, config.supabaseServiceRoleKey, config.rackUnitImageBucket ?? "rack-unit-capacity")
      : undefined
  });
  console.log(JSON.stringify({ stage: "import", ...result }, null, 2));
} finally {
  await pool.end();
}
