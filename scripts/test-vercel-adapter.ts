import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { createVercelHandler } from "../server/vercel/handler";
import { ConfigurationError, loadServerConfig } from "../server/config/env";
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

const bridgeCalls: Array<{ url: string; method: string; origin: string | null; cookie: string | null; body: string }> = [];
const bridgeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = String(init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  const body = init?.body ? Buffer.from(init.body as Uint8Array).toString("utf8") : "";
  bridgeCalls.push({ url, method, origin: headers.get("origin"), cookie: headers.get("cookie"), body });
  const pathname = new URL(url).pathname;
  if (pathname === "/api/v1/health/ready") return new Response(JSON.stringify({ ok: true, data: { status: "ready" } }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (pathname === "/api/v1/auth/csrf") return new Response(JSON.stringify({ ok: true, data: { csrfToken: "bridge-csrf" } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "energy_csrf=bridge-csrf; Path=/; SameSite=Lax" } });
  if (pathname === "/api/v1/auth/login") return new Response(JSON.stringify({ ok: true, data: { user: { displayName: "Production User" } } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "energy_session=bridge-session; Path=/; HttpOnly; SameSite=Lax" } });
  if (pathname === "/api/v1/auth/session" && (headers.get("cookie") ?? "").includes("em_session=bridge-session")) return new Response(JSON.stringify({ ok: true, data: { authenticated: true, user: { displayName: "Production User" } } }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication is required." } }), { status: 401, headers: { "content-type": "application/json" } });
};

const bridgeEnvironment: NodeJS.ProcessEnv = { ...testEnvironment, VERCEL_GIT_COMMIT_REF: "feat/energy-monitor-next" };
const renderedPreviewPdfHtml: string[] = [];
const bridgeHandler = createVercelHandler(
  bridgeEnvironment,
  async () => { throw new ConfigurationError("preview runtime intentionally unavailable in bridge test"); },
  bridgeFetch,
  async html => { renderedPreviewPdfHtml.push(html); return Buffer.from("%PDF-1.4\npreview-stub\n%%EOF"); }
);
await withHandler(bridgeHandler, async base => {
  const ready = await request(base, "/api/v1/health/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(JSON.parse(ready.body), { ok: true, data: { status: "ready" } });

  const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`);
  assert.equal(csrfResponse.status, 200);
  assert.equal(csrfResponse.headers.get("x-energy-preview-data-source"), "production-api-read-only");

  const blocked = await fetch(`${base}/api/v1/sites/1/months/2026-09`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json() as any).error.code, "READ_ONLY_MODE");

  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "energy_csrf=bridge-csrf", "x-csrf-token": "bridge-csrf" },
    body: JSON.stringify({ username: "admin", password: "test" })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json() as any).data.user.displayName, "Production User");

  const reportHtml = '<!doctype html><html><head></head><body><section class="cover">PDF</section></body></html>';
  const pdf = await fetch(`${base}/api/v1/reports/render-pdf?filename=DC_Status_MonthlyReport%20of%20RST_Sep-2026.pdf`, {
    method: "POST",
    headers: { "content-type": "text/html; charset=utf-8", cookie: "em_session=bridge-session; em_csrf=bridge-csrf", "x-csrf-token": "bridge-csrf" },
    body: reportHtml
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
  assert.match(pdf.headers.get("content-disposition") ?? "", /RST_Sep-2026\.pdf/);
  assert.equal(pdf.headers.get("x-energy-preview-pdf-renderer"), "server");
  assert.match(Buffer.from(await pdf.arrayBuffer()).toString("utf8"), /^%PDF-1\.4/);
  assert.equal(renderedPreviewPdfHtml.at(-1), reportHtml);

  const badCsrfPdf = await fetch(`${base}/api/v1/reports/render-pdf`, { method: "POST", headers: { "content-type": "text/html", cookie: "em_session=bridge-session; em_csrf=bridge-csrf", "x-csrf-token": "wrong" }, body: reportHtml });
  assert.equal(badCsrfPdf.status, 403);
});
assert.ok(bridgeCalls.some(call => new URL(call.url).pathname === "/api/v1/health/ready"));
const loginBridgeCall = bridgeCalls.find(call => new URL(call.url).pathname === "/api/v1/auth/login");
assert.equal(loginBridgeCall?.origin, "https://energy-monitor-puce.vercel.app");
assert.equal(loginBridgeCall?.cookie, "energy_csrf=bridge-csrf");
assert.match(loginBridgeCall?.body ?? "", /"username":"admin"/);
assert.equal(bridgeCalls.some(call => new URL(call.url).pathname === "/api/v1/sites/1/months/2026-09"), false);

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

assert.throws(
  () => loadServerConfig({ ...testEnvironment, READ_ONLY_MODE: "false" }, { requireDatabase: false, requireRuntimeDatabase: false }),
  /READ_ONLY_MODE=true/
);
assert.throws(() => loadServerConfig({ ...testEnvironment, DATABASE_URL: "runtime-dsn-placeholder", DB_POOL_MAX: "11" }), /DB_POOL_MAX/);
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
