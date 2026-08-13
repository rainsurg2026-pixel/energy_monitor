import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { withTransaction } from "../../server/db/pool";
import { ProductionSeedConflictError, runPreflightScopeGuard, seedProductionSites } from "./seedProductionSites";

type QueryCall = { text: string; values?: unknown[] };
type Row = Record<string, unknown>;

/** A minimal in-memory fake of the two `sites`/`site_profiles` tables, driven by real SQL text pattern-matching - not a real Postgres, but enough to exercise this module's exact query shapes deterministically. */
function createFakeSitesDb(initial: { sites?: Row[]; siteProfiles?: Row[]; roles?: Row[]; users?: Row[] } = {}) {
  const state = {
    sites: [...(initial.sites ?? [])] as Array<{ id: string; code: string; name: string }>,
    siteProfiles: [...(initial.siteProfiles ?? [])] as Array<{ site_id: string; profile_code: string }>,
    roles: [...(initial.roles ?? [{ name: "admin" }, { name: "user" }])] as Array<{ name: string }>,
    users: [...(initial.users ?? [])] as Array<{ id: string }>
  };
  let nextId = 1 + state.sites.reduce((max, site) => Math.max(max, Number(site.id) || 0), 0);
  const calls: QueryCall[] = [];

  const client: Pick<PoolClient, "query"> = {
    query: (async (text: string, values?: unknown[]) => {
      calls.push({ text, values });

      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(text.trim())) return { rows: [] };

      if (/SELECT name FROM roles/.test(text)) return { rows: state.roles };

      if (/SELECT code FROM sites WHERE code <> ALL/.test(text)) {
        const expected = new Set(values?.[0] as string[]);
        return { rows: state.sites.filter(site => !expected.has(site.code)).map(site => ({ code: site.code })) };
      }

      if (/SELECT count\(\*\)::text AS count FROM users/.test(text)) return { rows: [{ count: String(state.users.length) }] };

      if (/SELECT id, name FROM sites WHERE code = \$1/.test(text)) {
        const code = values?.[0] as string;
        const found = state.sites.find(site => site.code === code);
        return { rows: found ? [{ id: found.id, name: found.name }] : [] };
      }

      if (/INSERT INTO sites\(code, name, active\)/.test(text)) {
        const [code, name] = values as [string, string];
        const id = String(nextId++);
        state.sites.push({ id, code, name });
        return { rows: [{ id }] };
      }

      if (/SELECT profile_code FROM site_profiles WHERE site_id = \$1/.test(text)) {
        const siteId = values?.[0] as string;
        const found = state.siteProfiles.find(profile => profile.site_id === siteId);
        return { rows: found ? [{ profile_code: found.profile_code }] : [] };
      }

      if (/INSERT INTO site_profiles/.test(text)) {
        const [siteId, profileCode] = values as [string, string];
        state.siteProfiles.push({ site_id: siteId, profile_code: profileCode });
        return { rows: [] };
      }

      throw new Error(`Unhandled query in fake sites DB: ${text}`);
    }) as PoolClient["query"]
  };

  return { client, state, calls };
}

test("preflight: fails closed when the roles seed is missing (wrong/unmigrated target)", async () => {
  const { client } = createFakeSitesDb({ roles: [{ name: "admin" }] });
  await assert.rejects(() => runPreflightScopeGuard(client), ProductionSeedConflictError);
});

test("preflight: fails closed when an unexpected site code already exists", async () => {
  const { client } = createFakeSitesDb({ sites: [{ id: "9", code: "mystery-site", name: "Mystery" }] });
  await assert.rejects(() => runPreflightScopeGuard(client), ProductionSeedConflictError);
});

test("preflight: reports the current users count without gating on it", async () => {
  const { client } = createFakeSitesDb({ users: [{ id: "1" }] });
  const result = await runPreflightScopeGuard(client);
  assert.equal(result.usersCount, 1);
});

test("creates both sites and profiles from empty", async () => {
  const { client, state } = createFakeSitesDb();
  const result = await seedProductionSites(client);
  assert.deepEqual(result, { seeded: ["rangsit", "srinakarin"], alreadyPresent: [] });
  assert.equal(state.sites.length, 2);
  assert.equal(state.siteProfiles.length, 2);
});

test("idempotent: a second run against already-correct data makes no writes and reports alreadyPresent", async () => {
  const { client, calls } = createFakeSitesDb({
    sites: [{ id: "1", code: "rangsit", name: "Rangsit" }, { id: "2", code: "srinakarin", name: "Srinakarin" }],
    siteProfiles: [{ site_id: "1", profile_code: "rangsit-v3" }, { site_id: "2", profile_code: "srinakarin-v3" }]
  });
  const result = await seedProductionSites(client);
  assert.deepEqual(result, { seeded: [], alreadyPresent: ["rangsit", "srinakarin"] });
  assert.ok(!calls.some(call => /^INSERT/.test(call.text)), "no INSERT was issued on a correct second run");
});

test("creates only the missing profile when the site already exists correctly", async () => {
  const { client, state } = createFakeSitesDb({ sites: [{ id: "1", code: "rangsit", name: "Rangsit" }] });
  const result = await seedProductionSites(client);
  assert.ok(result.seeded.includes("rangsit"));
  assert.equal(state.sites.length, 2, "rangsit was not duplicated, srinakarin was added");
  assert.equal(state.sites.filter(s => s.code === "rangsit").length, 1);
});

test("rejects a conflicting site name and makes no write for that site's profile", async () => {
  const { client, calls } = createFakeSitesDb({ sites: [{ id: "1", code: "rangsit", name: "Wrong Name" }] });
  await assert.rejects(() => seedProductionSites(client), ProductionSeedConflictError);
  assert.ok(!calls.some(call => /INSERT INTO site_profiles/.test(call.text)), "must fail before attempting the profile write");
});

test("rejects a conflicting profile_code and leaves the site untouched", async () => {
  const { client, state } = createFakeSitesDb({
    sites: [{ id: "1", code: "rangsit", name: "Rangsit" }],
    siteProfiles: [{ site_id: "1", profile_code: "wrong-profile" }]
  });
  await assert.rejects(() => seedProductionSites(client), ProductionSeedConflictError);
  assert.equal(state.siteProfiles[0]?.profile_code, "wrong-profile", "the conflicting row was never overwritten");
});

test("transaction rollback: a mid-run conflict causes ROLLBACK, not COMMIT, via the real withTransaction", async () => {
  const { client, state, calls } = createFakeSitesDb({
    sites: [{ id: "1", code: "rangsit", name: "Rangsit" }, { id: "2", code: "srinakarin", name: "Wrong Name" }],
    siteProfiles: [{ site_id: "1", profile_code: "rangsit-v3" }]
  });
  const pool = { connect: async () => ({ ...client, release: () => {} }) } as unknown as import("pg").Pool;

  await assert.rejects(() => withTransaction(pool, c => seedProductionSites(c)), ProductionSeedConflictError);

  assert.ok(calls.some(call => /^ROLLBACK$/i.test(call.text)), "ROLLBACK was issued");
  assert.ok(!calls.some(call => /^COMMIT$/i.test(call.text)), "COMMIT was never reached");
  assert.equal(state.siteProfiles.length, 1, "srinakarin's profile was never inserted after the site conflict");
});
