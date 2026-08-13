import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { createMigrationPlan, previewMigrationPlan } from "../server/migration/engine";
import { importMigrationPlan } from "../server/migration/postgresImporter";
import { readWorkbookSource } from "../server/migration/workbookSource";

loadDotEnvFile();

const [sourcePath, ...args] = process.argv.slice(2);
const siteCode = process.env.MIGRATION_SITE_CODE?.trim();
if (!sourcePath) throw new Error("Usage: npm run migration:workbook -- <workbook-path> [--import]");
if (!siteCode) throw new Error("MIGRATION_SITE_CODE is required and must identify an existing development site.");

const source = await readWorkbookSource(sourcePath);
const plan = createMigrationPlan(source, {
  siteCode,
  expectedSiteName: process.env.MIGRATION_EXPECTED_SITE_NAME?.trim() || undefined,
  expectedProfileCode: process.env.MIGRATION_EXPECTED_PROFILE_CODE?.trim() || undefined
});
const preview = previewMigrationPlan(plan);
console.log(JSON.stringify({ stage: "preview", ...preview }, null, 2));

if (preview.errors.length > 0) {
  process.exitCode = 2;
} else if (args.includes("--import")) {
  if (process.env.MIGRATION_TARGET !== "development" && process.env.MIGRATION_TARGET !== "test") throw new Error("Import requires MIGRATION_TARGET=development or MIGRATION_TARGET=test.");
  if (process.env.MIGRATION_ALLOW_WRITE !== "true") throw new Error("Import requires MIGRATION_ALLOW_WRITE=true.");
  const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
  const pool = createPool(config, "migration");
  try {
    const result = await importMigrationPlan(pool, plan, { allowWrite: true, targetEnvironment: process.env.MIGRATION_TARGET, readOnlyMode: config.readOnlyMode });
    console.log(JSON.stringify({ stage: "import", ...result }, null, 2));
  } finally {
    await pool.end();
  }
}
