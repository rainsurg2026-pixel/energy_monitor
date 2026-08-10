import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { createVercelHandler } from "../server/vercel/handler";
import { loadServerConfig } from "../server/config/env";
import { createPoolOptions } from "../server/db/pool";
import type { ConfiguredRuntime } from "../server/runtime";

const testCertificate = "-----BEGIN CERTIFICATE-----\npreview-test-certificate\n-----END CERTIFICATE-----";

const testEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  TRUST_PROXY: "true",
  APP_ORIGIN: "https://preview.example.test",
  APP_ORIGINS: "https://preview.example.test",
  SESSION_SECRET: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  READ_ONLY_MODE: "true",
  SUPABASE_DB_CA_CERT: testCertificate
};

async function withHandler<T>(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>, work: (base: string) => Promise<T>): Promise<T> {
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try { return await work(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function withAdapter<T>(work: (base: string) => Promise<T>): Promise<T> {
  return withHandler(createVercelHandler(testEnvironment), work);
}

async function request(base: string, path: string): Promise<{ status: number; contentType: string; body: string }> {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, contentType: response.headers.get("content-type") ?? "", body: await response.text() };
}

await withAdapter(async base => {
  const health = await request(base, "/api/v1/health");
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/);
  assert.deepEqual(JSON.parse(health.body), { ok: true, data: { status: "ok", service: "energy-monitor-api" } });
  assert.equal(health.body.includes("<div id=\"root\">"), false);

  const readiness = await request(base, "/api/v1/health/ready");
  assert.equal(readiness.status, 503);
  assert.match(readiness.contentType, /application\/json/);
  assert.equal(readiness.body.includes("<div id=\"root\">"), false);
  assert.deepEqual(JSON.parse(readiness.body), {
    ok: false,
    error: { code: "SERVICE_UNAVAILABLE", message: "The API service is unavailable.", reason: "configuration" }
  });
  assert.equal(readiness.body.includes("DATABASE_URL"), false);
  assert.equal(readiness.body.includes("SUPABASE_DB_CA_CERT"), false);

  const readinessAlias = await request(base, "/api/v1/readiness");
  assert.equal(readinessAlias.status, 503);
  assert.match(readinessAlias.contentType, /application\/json/);
  assert.equal(readinessAlias.body.includes("<div id=\"root\">"), false);

  const bootstrap = await request(base, "/api/v1/bootstrap");
  assert.equal(bootstrap.status, 503);
  assert.match(bootstrap.contentType, /application\/json/);
  assert.equal(bootstrap.body.includes("<div id=\"root\">"), false);
  assert.equal(bootstrap.body.includes("DATABASE_URL"), false);

  const sites = await request(base, "/api/v1/sites");
  assert.equal(sites.status, 503);
  assert.match(sites.contentType, /application\/json/);
  assert.equal(sites.body.includes("<div id=\"root\">"), false);
});

let startupAttempts = 0;
const recoveringHandler = createVercelHandler(testEnvironment, async () => {
  startupAttempts += 1;
  if (startupAttempts === 1) throw new Error("temporary startup failure");
  return {
    app: ((_: IncomingMessage, response: ServerResponse) => {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ ok: true, data: { recovered: true } }));
    }) as unknown as ConfiguredRuntime["app"],
    config: {} as ConfiguredRuntime["config"],
    pool: {} as ConfiguredRuntime["pool"]
  };
});
await withHandler(recoveringHandler, async base => {
  const first = await request(base, "/api/v1/auth/session");
  assert.equal(first.status, 503);
  const second = await request(base, "/api/v1/auth/session");
  assert.equal(second.status, 200);
  assert.deepEqual(JSON.parse(second.body), { ok: true, data: { recovered: true } });
  assert.equal(startupAttempts, 2);
});

const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8")) as { rewrites?: Array<{ source?: string; destination?: string }> };
const spaRewrite = vercelConfig.rewrites?.find(rewrite => rewrite.destination === "/index.html");
assert.ok(spaRewrite);
assert.match(spaRewrite.source ?? "", /api\//);
assert.match(spaRewrite.source ?? "", /api\$/);

assert.throws(() => loadServerConfig({ ...testEnvironment, READ_ONLY_MODE: "false" }, { requireDatabase: false, requireRuntimeDatabase: false }), /READ_ONLY_MODE=true/);
assert.throws(() => loadServerConfig({ ...testEnvironment, DATABASE_URL: "postgresql://pooler.example.test:6543/postgres", DB_POOL_MAX: "11" }), /DB_POOL_MAX/);
assert.throws(() => loadServerConfig({ ...testEnvironment, DATABASE_URL: "postgresql://pooler.example.test:6543/postgres", SUPABASE_DB_CA_CERT: "" }), /SUPABASE_DB_CA_CERT/);
assert.throws(() => loadServerConfig({ DATABASE_URL: "postgresql://pooler.example.test:6543/postgres" }, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true }), /SUPABASE_DB_CA_CERT/);
const migrationFallbackConfig = loadServerConfig({ DATABASE_URL: "postgresql://pooler.example.test:6543/postgres", SUPABASE_DB_CA_CERT: testCertificate }, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
assert.equal(migrationFallbackConfig.databaseUrl, "postgresql://pooler.example.test:6543/postgres");
const previewConfig = loadServerConfig({ ...testEnvironment, DATABASE_URL: "postgresql://pooler.example.test:6543/postgres?sslmode=no-verify", SUPABASE_DB_CA_CERT: testCertificate });
assert.equal(previewConfig.nodeEnv, "production");
assert.equal(previewConfig.readOnlyMode, true);
assert.equal(previewConfig.databaseCaCertificate, testCertificate);
const poolOptions = createPoolOptions(previewConfig);
assert.deepEqual(poolOptions.ssl, { ca: testCertificate, rejectUnauthorized: true });
assert.equal(poolOptions.connectionString?.includes("sslmode"), false);

console.log("vercel adapter: smoke passed; health/readiness/API paths are JSON and not SPA HTML");
