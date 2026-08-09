import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApp } from "../server/http/app";
import { Argon2idPasswordHasher, hashNewPassword } from "../server/auth/passwordHasher";
import { PostgresAuthRepository } from "../server/auth/repository";
import { AuthService } from "../server/auth/authService";
import { PostgresRepository } from "../server/db/postgresRepository";
import { PostgresRateLimitStore, type RateLimitStore } from "../server/http/security";
import type { ServerConfig } from "../server/config/env";

export async function runLivePhase3(databaseUrl: string, testId = randomUUID().replaceAll("-", "")): Promise<void> {
  if (!databaseUrl) throw new Error("PHASE3_LIVE_DATABASE_URL is required.");

const databaseCaCertificate = process.env.SUPABASE_DB_CA_CERT?.trim().replace(/\\n/g, "\n");
if (!databaseCaCertificate || !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(databaseCaCertificate)) {
  throw new Error("SUPABASE_DB_CA_CERT must contain a PEM certificate for the live database test.");
}

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

const pool = new Pool({ connectionString: databaseUrl, ssl: { ca: databaseCaCertificate, rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 10_000 });
let databaseConnected = false;
const passwordHasher = new Argon2idPasswordHasher();
const authRepository = new PostgresAuthRepository(pool);
const authService = new AuthService(authRepository, { passwordHasher, dummyPasswordHash: await passwordHasher.hash(`dummy-${testId}`) });
const adminUsername = `phase3_live_admin_${testId}`;
const operatorUsername = `phase3_live_operator_${testId}`;
const scopedUsernames = [adminUsername, operatorUsername];
const postgresRateLimitStore = new PostgresRateLimitStore(pool);
const scopedRateLimitKeys = new Set<string>();
const rateLimitStore: RateLimitStore = {
  consume: (key, policy) => {
    const scopedKey = `phase3-live:${testId}:${key}`;
    scopedRateLimitKeys.add(scopedKey);
    return postgresRateLimitStore.consume(scopedKey, policy);
  },
  reset: key => postgresRateLimitStore.reset(`phase3-live:${testId}:${key}`)
};
const adminPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
const adminHash = await hashNewPassword(adminPassword, passwordHasher);
let server: ReturnType<typeof createServer> | null = null;
try {
  await pool.query("SELECT 1");
  databaseConnected = true;
  await authRepository.createUser({ username: adminUsername, normalizedUsername: adminUsername, displayName: "Phase 3 Live Test Admin", passwordHash: adminHash, role: "admin", actorUserId: null }, `phase3-live:${testId}:seed`);
  const adminRecord = await authRepository.findLoginByNormalizedUsername(adminUsername);
  if (!adminRecord) throw new Error("Live test administrator could not be loaded.");

  const app = createApp({ config, repository: new PostgresRepository(pool), authService, rateLimitStore });
  server = createServer(app);
  await new Promise<void>(resolve => server?.listen(0, "127.0.0.1", resolve));
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

  const health = await jsonRequest("/api/v1/health");
  assert.equal(health.status, 200);
  const admin = await login(adminUsername, adminPassword);
  const users = await jsonRequest("/api/v1/admin/users", {}, admin.cookies);
  assert.equal(users.status, 200);
  assert.equal(users.body.data.some((user: { username: string }) => user.username === adminUsername), true);

  const operatorPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  const csrfRejected = await jsonRequest("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: `phase3_live_csrf_${testId}`, display_name: "CSRF Rejected", password: operatorPassword, role: "user" }) }, admin.cookies);
  assert.equal(csrfRejected.status, 403);
  const created = await jsonRequest("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: operatorUsername, display_name: "Phase 3 Live Test Operator", password: operatorPassword, role: "user", active: true }) }, admin.cookies, admin.csrfToken);
  assert.equal(created.status, 200);
  const operatorId = String(created.body.data.id);
  assert.equal(created.body.data.active, true);
  assert.equal(JSON.stringify(created.body).includes("password"), false);
  const assertAudit = async (requestId: string | null, action: string): Promise<void> => {
    assert.ok(requestId);
    const audit = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM public.audit_events WHERE correlation_id = $1 AND actor_user_id = $2::bigint AND action = $3", [requestId, adminRecord.account.id, action]);
    assert.equal(Number(audit.rows[0]?.count), 1, `live audit ${action}`);
  };
  await assertAudit(created.requestId, "user_create");
  const credentials = await pool.query<{ password_hash: string }>("SELECT password_hash FROM public.local_credentials WHERE user_id = $1::bigint", [operatorId]);
  assert.match(credentials.rows[0]?.password_hash ?? "", /^\$argon2id\$/);
  assert.equal(credentials.rows[0]?.password_hash.includes(operatorPassword), false);
  const renamed = await jsonRequest(`/api/v1/admin/users/${operatorId}/display-name`, { method: "PATCH", body: JSON.stringify({ display_name: "Phase 3 Live Renamed Operator" }) }, admin.cookies, admin.csrfToken);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.displayName, "Phase 3 Live Renamed Operator");
  await assertAudit(renamed.requestId, "display_name_change");
  const operator = await login(operatorUsername, operatorPassword);
  const sites = await jsonRequest("/api/v1/sites", {}, operator.cookies);
  assert.equal(sites.status, 200);
  const forbidden = await jsonRequest("/api/v1/admin/users", {}, operator.cookies);
  assert.equal(forbidden.status, 403);
  const escalation = await jsonRequest(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) }, operator.cookies, operator.csrfToken);
  assert.equal(escalation.status, 403);
  const forbiddenSettings = await jsonRequest("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-02", expected_row_version: 0 }) }, operator.cookies, operator.csrfToken);
  assert.equal(forbiddenSettings.status, 403);
  const deactivated = await jsonRequest(`/api/v1/admin/users/${operatorId}/active`, { method: "PATCH", body: JSON.stringify({ active: false }) }, admin.cookies, admin.csrfToken);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.active, false);
  await assertAudit(deactivated.requestId, "user_deactivate");
  const sessionCountAfterDeactivate = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM public.sessions WHERE user_id = $1::bigint AND revoked_at IS NULL", [operatorId]);
  assert.equal(Number(sessionCountAfterDeactivate.rows[0]?.count), 0);
  const inactiveLogin = await jsonRequest("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: operatorUsername, password: operatorPassword }) });
  assert.equal(inactiveLogin.status, 401);
  const reactivated = await jsonRequest(`/api/v1/admin/users/${operatorId}/active`, { method: "PATCH", body: JSON.stringify({ active: true }) }, admin.cookies, admin.csrfToken);
  assert.equal(reactivated.status, 200);
  await assertAudit(reactivated.requestId, "user_activate");
  const operatorAfterReactivate = await login(operatorUsername, operatorPassword);
  const resetPassword = `${randomBytes(24).toString("base64url")}Bb2!`;
  const reset = await jsonRequest(`/api/v1/admin/users/${operatorId}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) }, admin.cookies, admin.csrfToken);
  assert.equal(reset.status, 200);
  assert.equal(JSON.stringify(reset.body).includes("password"), false);
  await assertAudit(reset.requestId, "password_reset");
  const resetSession = await jsonRequest("/api/v1/settings", {}, operatorAfterReactivate.cookies);
  assert.equal(resetSession.status, 401);
  const oldPassword = await jsonRequest("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: operatorUsername, password: operatorPassword }) });
  assert.equal(oldPassword.status, 401);
  const resetLogin = await login(operatorUsername, resetPassword);
  const resetLoginSettings = await jsonRequest("/api/v1/settings", {}, resetLogin.cookies);
  assert.equal(resetLoginSettings.status, 200);
  const newPassword = await jsonRequest(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) }, admin.cookies, admin.csrfToken);
  assert.equal(newPassword.status, 200);
  await assertAudit(newPassword.requestId, "role_change");
  const operatorAdminAfterReset = await login(operatorUsername, resetPassword);
  const adminAccess = await jsonRequest("/api/v1/admin/users", {}, operatorAdminAfterReset.cookies);
  assert.equal(adminAccess.status, 200);
  const demoted = await jsonRequest(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "user" }) }, admin.cookies, admin.csrfToken);
  assert.equal(demoted.status, 200);
  await assertAudit(demoted.requestId, "role_change");
  const lastAdminDemotion = await jsonRequest(`/api/v1/admin/users/${adminRecord.account.id}/role`, { method: "PATCH", body: JSON.stringify({ role: "user" }) }, admin.cookies, admin.csrfToken);
  assert.equal(lastAdminDemotion.status, 409);
  const selfDeactivation = await jsonRequest(`/api/v1/admin/users/${adminRecord.account.id}/active`, { method: "PATCH", body: JSON.stringify({ active: false }) }, admin.cookies, admin.csrfToken);
  assert.equal(selfDeactivation.status, 409);
  const logout = await jsonRequest("/api/v1/auth/logout", { method: "POST" }, operator.cookies, operator.csrfToken);
  assert.equal(logout.status, 200);
  console.log(`live phase3 http: passed for ${testId}`);
} finally {
  if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
  if (databaseConnected) {
    await pool.query("BEGIN");
    try {
      for (const key of scopedRateLimitKeys) await postgresRateLimitStore.reset(key);
      const users = await pool.query<{ id: string }>("SELECT id::text FROM public.users WHERE normalized_username = ANY($1::text[])", [scopedUsernames]);
      const userIds = users.rows.map(row => row.id);
      if (userIds.length > 0) {
        await pool.query("DELETE FROM public.audit_events WHERE entity_type = 'user' AND entity_id = ANY($1::text[])", [userIds]);
        await pool.query("DELETE FROM public.users WHERE id::text = ANY($1::text[])", [userIds]);
      }
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    const remaining = await pool.query<{ users: string; audits: string; rate_limit_buckets: string }>(`
      SELECT
        (SELECT count(*)::text FROM public.users WHERE normalized_username = ANY($1::text[])) AS users,
        (SELECT count(*)::text FROM public.audit_events WHERE entity_type = 'user' AND entity_id IN (SELECT id::text FROM public.users WHERE normalized_username = ANY($1::text[]))) AS audits,
        (SELECT count(*)::text FROM public.http_rate_limit_buckets WHERE key_hash = ANY($2::text[])) AS rate_limit_buckets
    `, [scopedUsernames, [...scopedRateLimitKeys].map(key => createHash("sha256").update(key, "utf8").digest("hex"))]);
    assert.equal(Number(remaining.rows[0]?.users), 0, "live synthetic users cleaned");
    assert.equal(Number(remaining.rows[0]?.audits), 0, "live synthetic audits cleaned");
    assert.equal(Number(remaining.rows[0]?.rate_limit_buckets), 0, "live rate-limit buckets cleaned");
  }
  await pool.end();
}
}

if (process.env.PHASE3_LIVE_DATABASE_URL) await runLivePhase3(process.env.PHASE3_LIVE_DATABASE_URL, process.env.PHASE3_LIVE_TEST_ID);
