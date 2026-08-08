import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { createVercelHandler } from "../api/[...path]";
import { loadServerConfig } from "../server/config/env";

const testEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  TRUST_PROXY: "true",
  APP_ORIGIN: "https://preview.example.test",
  APP_ORIGINS: "https://preview.example.test",
  SESSION_SECRET: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  READ_ONLY_MODE: "true"
};

async function withAdapter<T>(work: (base: string) => Promise<T>): Promise<T> {
  const handler = createVercelHandler(testEnvironment);
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try { return await work(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
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

const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8")) as { rewrites?: Array<{ source?: string; destination?: string }> };
const spaRewrite = vercelConfig.rewrites?.find(rewrite => rewrite.destination === "/index.html");
assert.ok(spaRewrite);
assert.match(spaRewrite.source ?? "", /api\//);
assert.match(spaRewrite.source ?? "", /api\$/);

assert.throws(() => loadServerConfig({ ...testEnvironment, READ_ONLY_MODE: "false" }, { requireDatabase: false, requireRuntimeDatabase: false }), /READ_ONLY_MODE=true/);
assert.throws(() => loadServerConfig({ ...testEnvironment, DATABASE_URL: "runtime-dsn-placeholder", DB_POOL_MAX: "11" }), /DB_POOL_MAX/);
const previewConfig = loadServerConfig({ ...testEnvironment, DATABASE_URL: "runtime-dsn-placeholder" });
assert.equal(previewConfig.nodeEnv, "production");
assert.equal(previewConfig.readOnlyMode, true);

console.log("vercel adapter: smoke passed; health/readiness/API paths are JSON and not SPA HTML");
