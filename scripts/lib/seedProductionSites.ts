import type { PoolClient } from "pg";

export interface ProductionSiteDefinition {
  code: string;
  name: string;
  profileCode: string;
}

export const PRODUCTION_SITES: readonly ProductionSiteDefinition[] = [
  { code: "rangsit", name: "Rangsit", profileCode: "rangsit-v3" },
  { code: "srinakarin", name: "Srinakarin", profileCode: "srinakarin-v3" }
];

export interface SeedResult {
  seeded: string[];
  alreadyPresent: string[];
}

export class ProductionSeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSeedConflictError";
  }
}

/**
 * Refuses to run against a database that doesn't look like a freshly
 * migrated, not-yet-business-populated Production: the roles seed from
 * migration 002 must be present (a database missing it almost certainly
 * isn't the right target), and no site outside the two expected codes may
 * exist (a stray site would mean this isn't the clean bootstrap this
 * script is designed for). users count is logged, not gated on, because
 * the initial Administrator may legitimately be created before or after
 * this script runs.
 */
export async function runPreflightScopeGuard(client: Pick<PoolClient, "query">): Promise<{ usersCount: number }> {
  const roles = await client.query<{ name: string }>("SELECT name FROM roles");
  const roleNames = new Set(roles.rows.map(row => row.name));
  if (!roleNames.has("admin") || !roleNames.has("user")) {
    throw new ProductionSeedConflictError(
      `Scope guard failed: expected roles ('admin','user') from migration 002 were not both found (found: ${[...roleNames].join(", ") || "none"}). This does not look like a correctly migrated Production database.`
    );
  }

  const expectedCodes = PRODUCTION_SITES.map(site => site.code);
  const unexpectedSites = await client.query<{ code: string }>("SELECT code FROM sites WHERE code <> ALL($1::text[])", [expectedCodes]);
  if (unexpectedSites.rows.length > 0) {
    throw new ProductionSeedConflictError(
      `Scope guard failed: unexpected site code(s) already present: ${unexpectedSites.rows.map(row => row.code).join(", ")}. This script only ever creates ${expectedCodes.join(", ")}; refusing to proceed against unknown existing data.`
    );
  }

  const users = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  return { usersCount: Number(users.rows[0]?.count ?? 0) };
}

export async function seedProductionSites(client: Pick<PoolClient, "query">): Promise<SeedResult> {
  const seeded: string[] = [];
  const alreadyPresent: string[] = [];

  for (const site of PRODUCTION_SITES) {
    const existingSite = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM sites WHERE code = $1 FOR UPDATE",
      [site.code]
    );

    let siteId: string;
    let siteWasCreated = false;
    if (existingSite.rows[0]) {
      if (existingSite.rows[0].name !== site.name) {
        throw new ProductionSeedConflictError(
          `CONFLICT: site '${site.code}' exists with name '${existingSite.rows[0].name}', expected '${site.name}'. Refusing to overwrite - no write was made.`
        );
      }
      siteId = existingSite.rows[0].id;
    } else {
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO sites(code, name, active) VALUES ($1, $2, true) RETURNING id",
        [site.code, site.name]
      );
      siteId = inserted.rows[0].id;
      siteWasCreated = true;
    }

    const existingProfile = await client.query<{ profile_code: string }>(
      "SELECT profile_code FROM site_profiles WHERE site_id = $1 FOR UPDATE",
      [siteId]
    );

    let profileWasCreated = false;
    if (existingProfile.rows[0]) {
      if (existingProfile.rows[0].profile_code !== site.profileCode) {
        throw new ProductionSeedConflictError(
          `CONFLICT: site_profile for '${site.code}' has profile_code '${existingProfile.rows[0].profile_code}', expected '${site.profileCode}'. Refusing to overwrite - no write was made.`
        );
      }
    } else {
      await client.query(
        "INSERT INTO site_profiles(site_id, profile_code, profile_version, formula_version, policy) VALUES ($1, $2, 'v3.0.0', 'desktop-v2.3.1', '{}'::jsonb)",
        [siteId, site.profileCode]
      );
      profileWasCreated = true;
    }

    if (siteWasCreated || profileWasCreated) seeded.push(site.code);
    else alreadyPresent.push(site.code);
  }

  return { seeded, alreadyPresent };
}
