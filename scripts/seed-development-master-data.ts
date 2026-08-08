import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { createPool, withTransaction } from "../server/db/pool";

const DEVELOPMENT_SITES = [
  { code: "rangsit", name: "Rangsit", profileCode: "rangsit-v3" },
  { code: "srinakarin", name: "Srinakarin", profileCode: "srinakarin-v3" }
] as const;

loadDotEnvFile();

if (process.env.NODE_ENV === "production") throw new Error("Development master-data seeding is prohibited in production.");
if (process.env.MIGRATION_TARGET !== "development") throw new Error("Development master-data seeding requires MIGRATION_TARGET=development.");
if (process.env.MIGRATION_ALLOW_WRITE !== "true") throw new Error("Development master-data seeding requires MIGRATION_ALLOW_WRITE=true.");

const config = loadServerConfig(process.env, {
  requireDatabase: true,
  requireRuntimeDatabase: false,
  requireMigrationDatabase: true
});
const pool = createPool(config, "migration");

try {
  const seeded = await withTransaction(pool, async client => {
    const result: string[] = [];
    for (const site of DEVELOPMENT_SITES) {
      const existing = await client.query<{ id: string; name: string; active: boolean }>(
        "SELECT id, name, active FROM sites WHERE code = $1 FOR UPDATE",
        [site.code]
      );
      let siteId: string;
      if (existing.rows[0]) {
        if (existing.rows[0].name !== site.name || !existing.rows[0].active) {
          throw new Error(`Existing site mapping for ${site.code} does not match the approved development master data.`);
        }
        siteId = existing.rows[0].id;
      } else {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO sites(code, name, active) VALUES ($1, $2, true) RETURNING id",
          [site.code, site.name]
        );
        siteId = inserted.rows[0].id;
      }

      const existingProfile = await client.query<{ profile_code: string }>(
        "SELECT profile_code FROM site_profiles WHERE site_id = $1 FOR UPDATE",
        [siteId]
      );
      if (existingProfile.rows[0]) {
        if (existingProfile.rows[0].profile_code !== site.profileCode) {
          throw new Error(`Existing profile mapping for ${site.code} does not match the approved development profile.`);
        }
      } else {
        await client.query(
          "INSERT INTO site_profiles(site_id, profile_code, profile_version, formula_version, policy) VALUES ($1, $2, 'v3.0.0', 'desktop-v2.3.1', '{}'::jsonb)",
          [siteId, site.profileCode]
        );
      }
      result.push(site.code);
    }
    return result;
  });
  console.log(JSON.stringify({ target: "development", seeded }, null, 2));
} finally {
  await pool.end();
}
