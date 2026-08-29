import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMigrationDatabaseConfig, loadServerConfig } from "./env";
import { createOriginPolicy, createCorsMiddleware } from "../http/security/cors";

const SECRET = "a".repeat(32);

/** Minimal environment that satisfies every hosted-Preview validation
 *  branch in loadServerConfig, so these tests isolate origin derivation
 *  rather than tripping over unrelated required-field checks. */
function previewEnvironment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "energy-monitor-abc123-dcm15.vercel.app",
    VERCEL_BRANCH_URL: "energy-monitor-git-feat-web-v3-dcm15.vercel.app",
    APP_ORIGIN: "https://energy-monitor-abc123-dcm15.vercel.app",
    TRUST_PROXY: "true",
    READ_ONLY_MODE: "true",
    SESSION_SECRET: SECRET,
    CSRF_SECRET: SECRET,
    DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    ...overrides
  };
}

test("a Vercel-hosted deployment trusts its own VERCEL_URL and VERCEL_BRANCH_URL as preview origins", () => {
  const config = loadServerConfig(previewEnvironment(), { requireDatabase: false, requireRuntimeDatabase: false });
  assert.ok(config.allowedPreviewOrigins.includes("https://energy-monitor-abc123-dcm15.vercel.app"));
  assert.ok(config.allowedPreviewOrigins.includes("https://energy-monitor-git-feat-web-v3-dcm15.vercel.app"));
});

test("a non-hosted (local) environment does not add any Vercel self-origin", () => {
  const config = loadServerConfig(
    { NODE_ENV: "development", SESSION_SECRET: SECRET, CSRF_SECRET: SECRET, DATABASE_URL: "postgres://user:pass@localhost:5432/db" },
    { requireDatabase: false, requireRuntimeDatabase: false }
  );
  assert.deepEqual(config.allowedPreviewOrigins, []);
});

test("explicit APP_PREVIEW_ORIGINS and Vercel self-origins combine, still exact-match only", () => {
  const config = loadServerConfig(
    previewEnvironment({ APP_PREVIEW_ORIGINS: "https://staging.example.com" }),
    { requireDatabase: false, requireRuntimeDatabase: false }
  );
  assert.ok(config.allowedPreviewOrigins.includes("https://staging.example.com"));
  assert.ok(config.allowedPreviewOrigins.includes("https://energy-monitor-abc123-dcm15.vercel.app"));
});

test("end-to-end: a request from this deployment's own Preview URL is allowed, an unrelated origin is still rejected", () => {
  const config = loadServerConfig(previewEnvironment(), { requireDatabase: false, requireRuntimeDatabase: false });
  const policy = createOriginPolicy({ allowedOrigins: config.allowedOrigins, allowedPreviewOrigins: config.allowedPreviewOrigins });
  const middleware = createCorsMiddleware(policy);

  // Same as: a browser on this exact deployment's own git-branch URL logging in.
  let allowedNextCalled = false;
  const allowedRes = mockResponse();
  middleware(mockRequest("https://energy-monitor-git-feat-web-v3-dcm15.vercel.app"), allowedRes, () => { allowedNextCalled = true; });
  assert.equal(allowedNextCalled, true);
  assert.equal(allowedRes.headers.get("access-control-allow-origin"), "https://energy-monitor-git-feat-web-v3-dcm15.vercel.app");

  // A different, unrelated Vercel-hosted app must not be trusted just
  // because it also happens to be on *.vercel.app - the fix must not
  // widen to a suffix match.
  const rejectedRes = mockResponse();
  middleware(mockRequest("https://some-other-app-completely-unrelated.vercel.app"), rejectedRes, () => { throw new Error("unrelated origin reached the route"); });
  assert.equal(rejectedRes.statusCode, 403);
  assert.equal(JSON.parse(String(rejectedRes.body)).error.code, "ORIGIN_NOT_ALLOWED");

  // A completely unrelated domain must still be rejected too.
  const evilRes = mockResponse();
  middleware(mockRequest("https://evil.example"), evilRes, () => { throw new Error("evil origin reached the route"); });
  assert.equal(evilRes.statusCode, 403);
});

const validCertificate = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

test("loadMigrationDatabaseConfig succeeds with only NODE_ENV=production and DIRECT_DATABASE_URL - no hosted-server secrets present", () => {
  const config = loadMigrationDatabaseConfig({ NODE_ENV: "production", DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres" });
  assert.equal(config.directDatabaseUrl, "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres");
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.poolMax, 3);
});

test("loadMigrationDatabaseConfig does not require SESSION_SECRET, CSRF_SECRET, or APP_ORIGIN", () => {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres" };
  assert.equal("SESSION_SECRET" in environment, false);
  assert.equal("CSRF_SECRET" in environment, false);
  assert.equal("APP_ORIGIN" in environment, false);
  assert.doesNotThrow(() => loadMigrationDatabaseConfig(environment));
});

test("loadMigrationDatabaseConfig throws clearly when neither DIRECT_DATABASE_URL nor DATABASE_URL is set", () => {
  assert.throws(() => loadMigrationDatabaseConfig({ NODE_ENV: "production" }), /DIRECT_DATABASE_URL or DATABASE_URL is required/);
});

test("loadMigrationDatabaseConfig preserves migration-mode precedence by returning both URLs unresolved", () => {
  const config = loadMigrationDatabaseConfig({
    DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres",
    DATABASE_URL: "postgres://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
  });
  assert.equal(config.directDatabaseUrl, "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres");
  assert.equal(config.databaseUrl, "postgres://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres");
});

test("loadMigrationDatabaseConfig does not require SUPABASE_DB_CA_CERT when DIRECT_DATABASE_URL is present", () => {
  const config = loadMigrationDatabaseConfig({ DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres" });
  assert.equal(config.databaseCaCertificate, null);
});

test("loadMigrationDatabaseConfig requires SUPABASE_DB_CA_CERT when falling back to the pooled DATABASE_URL only", () => {
  assert.throws(
    () => loadMigrationDatabaseConfig({ DATABASE_URL: "postgres://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" }),
    /SUPABASE_DB_CA_CERT/
  );
});

test("loadMigrationDatabaseConfig accepts a valid SUPABASE_DB_CA_CERT for the pooled-fallback path", () => {
  const config = loadMigrationDatabaseConfig({
    DATABASE_URL: "postgres://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    SUPABASE_DB_CA_CERT: validCertificate
  });
  assert.equal(config.databaseCaCertificate, validCertificate);
});

test("loadMigrationDatabaseConfig rejects a malformed SUPABASE_DB_CA_CERT even on the direct path", () => {
  assert.throws(
    () => loadMigrationDatabaseConfig({ DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres", SUPABASE_DB_CA_CERT: "not-a-pem" }),
    /PEM certificate/
  );
});

test("loadMigrationDatabaseConfig respects DB_POOL_MAX and defaults NODE_ENV to development for unrecognized values", () => {
  const config = loadMigrationDatabaseConfig({ DIRECT_DATABASE_URL: "postgres://postgres:pw@db.ajidkjzufpgyibagvvco.supabase.co:5432/postgres", DB_POOL_MAX: "7" });
  assert.equal(config.poolMax, 7);
  assert.equal(config.nodeEnv, "development");
});

test("loadServerConfig itself is unchanged: still requires SESSION_SECRET/CSRF_SECRET/APP_ORIGIN for a hosted server", () => {
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "production", VERCEL: "1", DATABASE_URL: "postgres://user:pass@localhost:5432/db" }, { requireDatabase: false, requireRuntimeDatabase: false }),
    /SESSION_SECRET|APP_ORIGIN/
  );
});

function mockRequest(origin: string) {
  const headers: Record<string, string> = { origin };
  return { method: "POST", headers, header: (name: string) => headers[name.toLowerCase()], get: (name: string) => headers[name.toLowerCase()], socket: { remoteAddress: "127.0.0.1" } } as unknown as Parameters<ReturnType<typeof createCorsMiddleware>>[0];
}

function mockResponse() {
  const headers = new Map<string, string>();
  const state = { statusCode: 200, body: undefined as unknown };
  const response = {
    headers,
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); return response; },
    append(name: string, value: string) { const key = name.toLowerCase(); headers.set(key, headers.has(key) ? `${headers.get(key)}, ${value}` : value); return response; },
    vary(name: string) { headers.set("vary", name); return response; },
    status(code: number) { state.statusCode = code; return response; },
    json(value: unknown) { state.body = JSON.stringify(value); return response; },
    end() { return response; }
  };
  return response as unknown as Parameters<ReturnType<typeof createCorsMiddleware>>[1] & { headers: Map<string, string>; body: unknown; statusCode: number };
}


test("hosted Preview fails closed when READ_ONLY_MODE is missing or false", () => {
  assert.throws(
    () => loadServerConfig(previewEnvironment({ READ_ONLY_MODE: undefined }), { requireDatabase: false, requireRuntimeDatabase: false }),
    /READ_ONLY_MODE=true/
  );
  assert.throws(
    () => loadServerConfig(previewEnvironment({ READ_ONLY_MODE: "false" }), { requireDatabase: false, requireRuntimeDatabase: false }),
    /READ_ONLY_MODE=true/
  );
});

test("hosted Preview rejects DIRECT_DATABASE_URL even when read-only mode is enabled", () => {
  assert.throws(
    () => loadServerConfig(
      previewEnvironment({ DIRECT_DATABASE_URL: "postgres://postgres:pw@db.tofdgndrrpnnyhbuurbx.supabase.co:5432/postgres" }),
      { requireDatabase: false, requireRuntimeDatabase: false }
    ),
    /DIRECT_DATABASE_URL must not be configured/
  );
  assert.throws(
    () => loadMigrationDatabaseConfig({
      ...previewEnvironment(),
      DIRECT_DATABASE_URL: "postgres://postgres:pw@db.tofdgndrrpnnyhbuurbx.supabase.co:5432/postgres"
    }),
    /DIRECT_DATABASE_URL must not be configured/
  );
});
