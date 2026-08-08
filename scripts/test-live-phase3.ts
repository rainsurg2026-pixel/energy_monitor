import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApp } from "../server/http/app";
import { Argon2idPasswordHasher, hashNewPassword } from "../server/auth/passwordHasher";
import { PostgresAuthRepository } from "../server/auth/repository";
import { AuthService } from "../server/auth/authService";
import { PostgresRepository } from "../server/db/postgresRepository";
import { assertRuntimeRole } from "../server/db/pool";
import { PostgresRateLimitStore } from "../server/http/security";
import type { ServerConfig } from "../server/config/env";

const databaseUrl = process.env.PHASE3_LIVE_DATABASE_URL;
const testId = process.env.PHASE3_LIVE_TEST_ID ?? randomUUID().replaceAll("-", "");
if (!databaseUrl) throw new Error("PHASE3_LIVE_DATABASE_URL is required.");

const config: ServerConfig = {
  databaseUrl,
  directDatabaseUrl: null,
  nodeEnv: "test",
  port: 0,
  appOrigin: "http://test",
  allowedOrigins: ["http://test"],
  allowedPreviewOrigins: [],
  trustProxy: false,
  sessionSecret: randomBytes(32).toString("base64url"),
  csrfSecret: randomBytes(32).toString("base64url"),
  sessionLifetimeMs: 8 * 60 * 60 * 1000,
  poolMax: 2,
  readOnlyMode: false
};

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10_000 });
await assertRuntimeRole(pool);
const passwordHasher = new Argon2idPasswordHasher();
const authRepository = new PostgresAuthRepository(pool);
const authService = new AuthService(authRepository, { passwordHasher, dummyPasswordHash: await passwordHasher.hash(`dummy-${testId}`) });
const adminUsername = `phase3_live_admin_${testId}`;
const adminPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
const adminHash = await hashNewPassword(adminPassword, passwordHasher);
await authRepository.createUser({ username: adminUsername, normalizedUsername: adminUsername, displayName: "Phase 3 Live Test Admin", passwordHash: adminHash, role: "admin", actorUserId: null }, `phase3-live:${testId}:seed`);
const adminRecord = await authRepository.findLoginByNormalizedUsername(adminUsername);
if (!adminRecord) throw new Error("Live test administrator could not be loaded.");

const app = createApp({ config, repository: new PostgresRepository(pool), authService, rateLimitStore: new PostgresRateLimitStore(pool) });
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Live test server did not bind.");
const base = `http://127.0.0.1:${address.port}`;

function cookiesFrom(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
  return values.map(value => value.split(";")[0].trim()).filter(Boolean);
}

function cookieValue(cookies: readonly string[], name: string): string {
  const value = cookies.find(cookie => cookie.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie.`);
  return decodeURIComponent(value.slice(name.length + 1));
}

async function jsonRequest(path: string, init: RequestInit = {}, cookieJar: readonly string[] = [], csrfToken?: string): Promise<{ status: number; body: any; cookies: string[]; requestId: string | null }> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", "http://test");
  if (cookieJar.length > 0) headers.set("cookie", cookieJar.join("; "));
  if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method?.toUpperCase() ?? "GET")) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  return { status: response.status, body: await response.json(), cookies: cookiesFrom(response), requestId: response.headers.get("x-request-id") };
}

async function login(username: string, password: string): Promise<{ cookies: string[]; csrfToken: string }> {
  const response = await jsonRequest("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200, "live login");
  return { cookies: response.cookies, csrfToken: cookieValue(response.cookies, "em_csrf") };
}

try {
  const health = await jsonRequest("/api/v1/health");
  assert.equal(health.status, 200);
  const admin = await login(adminUsername, adminPassword);
  const users = await jsonRequest("/api/v1/admin/users", {}, admin.cookies);
  assert.equal(users.status, 200);
  assert.equal(users.body.data.some((user: { username: string }) => user.username === adminUsername), true);

  const operatorUsername = `phase3_live_operator_${testId}`;
  const operatorPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  const csrfRejected = await jsonRequest("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: `phase3_live_csrf_${testId}`, display_name: "CSRF Rejected", password: operatorPassword, role: "user" }) }, admin.cookies);
  assert.equal(csrfRejected.status, 403);
  const created = await jsonRequest("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: operatorUsername, display_name: "Phase 3 Live Test Operator", password: operatorPassword, role: "user" }) }, admin.cookies, admin.csrfToken);
  assert.equal(created.status, 200);
  const audit = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM public.audit_events WHERE correlation_id = $1 AND actor_user_id = $2::bigint", [created.requestId, adminRecord.account.id]);
  assert.equal(Number(audit.rows[0]?.count), 1);
  const operator = await login(operatorUsername, operatorPassword);
  const sites = await jsonRequest("/api/v1/sites", {}, operator.cookies);
  assert.equal(sites.status, 200);
  const forbidden = await jsonRequest("/api/v1/admin/users", {}, operator.cookies);
  assert.equal(forbidden.status, 403);
  const forbiddenSettings = await jsonRequest("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-02", expected_row_version: 0 }) }, operator.cookies, operator.csrfToken);
  assert.equal(forbiddenSettings.status, 403);
  const logout = await jsonRequest("/api/v1/auth/logout", { method: "POST" }, operator.cookies, operator.csrfToken);
  assert.equal(logout.status, 200);
  console.log(`live phase3 http: passed for ${testId}`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
