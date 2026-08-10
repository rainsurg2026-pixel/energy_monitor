import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/http/app";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { apiTestRepository, fixtureLog } from "../server/testFixtures";
import type { ServerConfig } from "../server/config/env";
import { AuthService } from "../server/auth/authService";
import { InMemoryAuthRepository } from "../server/auth/repository";
import { Argon2idPasswordHasher } from "../server/auth/passwordHasher";
import { normalizeUsername } from "../server/auth/passwordPolicy";
import { InMemoryRateLimitStore } from "../server/http/security";

const testHasher = new Argon2idPasswordHasher({ memoryCost: 8 * 1024, timeCost: 1, parallelism: 1, hashLength: 16, saltLength: 16 });
const config = (readOnlyMode = false): ServerConfig => ({
  databaseUrl: null,
  directDatabaseUrl: null,
  nodeEnv: "test",
  port: 0,
  appOrigin: "http://test",
  allowedOrigins: ["http://test", "http://127.0.0.1"],
  allowedPreviewOrigins: [],
  trustProxy: false,
  sessionSecret: "test-session-secret-test-session-secret-1234",
  csrfSecret: "test-csrf-secret-test-csrf-secret-1234",
  sessionLifetimeMs: 8 * 60 * 60 * 1000,
  poolMax: 3,
  readOnlyMode
});
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

interface TestAuth {
  service: AuthService;
  repository: InMemoryAuthRepository;
  admin: { username: string; password: string };
}

async function testAuth(): Promise<TestAuth> {
  const repository = new InMemoryAuthRepository();
  const dummyPasswordHash = await testHasher.hash("dummy-password-for-tests");
  const service = new AuthService(repository, { passwordHasher: testHasher, dummyPasswordHash, sessionSecret: config().sessionSecret });
  const admin = { username: "admin", password: "Correct Horse Battery Staple 123!" };
  repository.seedUser({ username: admin.username, normalizedUsername: normalizeUsername(admin.username), displayName: "Test Admin", passwordHash: await testHasher.hash(admin.password), role: "admin" });
  return { service, repository, admin };
}

async function withApi(readOnlyMode: boolean, work: (base: string, authentication: TestAuth) => Promise<void>, repository = apiTestRepository()): Promise<void> {
  const authentication = await testAuth();
  const server = createServer(createApp({ repository, config: config(readOnlyMode), authService: authentication.service, rateLimitStore: new InMemoryRateLimitStore() }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  try { await work(`http://127.0.0.1:${address.port}`, authentication); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

interface HttpClient { request(path: string, init?: RequestInit): Promise<{ status: number; body: any }>; csrf: string; }

async function login(base: string, credentials: { username: string; password: string }): Promise<HttpClient> {
  let cookie = "";
  const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`);
  cookie = csrfResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  const loginResponse = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://test", cookie },
    body: JSON.stringify(credentials)
  });
  const headerWithSetCookie = loginResponse.headers as Headers & { getSetCookie?: () => string[] };
  const loginCookies = typeof headerWithSetCookie.getSetCookie === "function"
    ? headerWithSetCookie.getSetCookie()
    : (loginResponse.headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
  const cookies = loginCookies.map(value => value.split(";")[0].trim()).filter(Boolean);
  cookie = cookies.join("; ");
  const csrfCookie = cookies.find(value => value.startsWith("em_csrf="));
  const csrf = decodeURIComponent(csrfCookie?.slice("em_csrf=".length) ?? "");
  assert.equal(loginResponse.status, 200, "test admin login");
  return {
    csrf,
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("content-type", "application/json");
      headers.set("cookie", cookie);
      headers.set("origin", "http://test");
      if (["POST", "PUT", "PATCH", "DELETE"].includes(init.method?.toUpperCase() ?? "GET")) headers.set("x-csrf-token", csrf);
      const response = await fetch(`${base}${path}`, { ...init, headers });
      return { status: response.status, body: await response.json() };
    }
  };
}

async function json(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: response.status, body: await response.json() };
}

await withApi(false, async (base, authentication) => {
  const unauthenticated = await json(base, "/api/v1/settings"); check("protected reads require authentication", unauthenticated.status === 401 && unauthenticated.body.error?.code === "UNAUTHORIZED");
  const disallowedOrigin = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ username: "admin", password: "Correct Horse Battery Staple 123!" }) }); check("login rejects unapproved origin", disallowedOrigin.status === 403);
  const invalidLogin = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "http://test" }, body: JSON.stringify({ username: "admin", password: "wrong password" }) }); const invalidLoginBody = await invalidLogin.json() as { error?: { code?: string } }; check("login uses generic invalid credentials", invalidLogin.status === 401 && invalidLoginBody.error?.code === "INVALID_CREDENTIALS");
  const client = await login(base, { username: "admin", password: "Correct Horse Battery Staple 123!" });
  const health = await json(base, "/api/v1/health"); check("health", health.status === 200 && health.body.ok === true);
  const readiness = await json(base, "/api/v1/health/ready"); check("readiness", readiness.status === 200 && readiness.body.data.status === "ready");
  const bootstrap = await client.request("/api/v1/bootstrap"); check("bootstrap exposes authoritative nested site states", bootstrap.status === 200 && bootstrap.body.data.sites.every((item: { site?: { id?: number; name?: string }; availableMonths?: string[] }) => typeof item.site?.id === "number" && typeof item.site?.name === "string" && Array.isArray(item.availableMonths)));
  const periods = await client.request("/api/v1/periods?siteId=1"); check("periods expose allowed/latest", periods.status === 200 && periods.body.data.latestAvailableMonth === "2026-01" && !periods.body.data.availableMonths.includes("2025-12") && !periods.body.data.availableMonths.includes("2026-12"));
  const energy = await client.request("/api/v1/energy?siteId=1&month=2026-01"); const energyText = JSON.stringify(energy.body); check("hidden previous is used internally", energy.status === 200 && energy.body.data.calculation.airEnergyKwh === 16000000); check("hidden previous is not in DTO", !energyText.includes("2025-12"));
  const rackUnit = await client.request("/api/v1/rack-unit-capacity?siteId=1&month=2026-01"); check("rack unit raw snapshot is exposed with derived metrics", rackUnit.status === 200 && rackUnit.body.data.snapshot.availableU === 50 && rackUnit.body.data.snapshot.usagePercent === 87.5);
  const comparison = await client.request("/api/v1/site-comparison"); check("comparison excludes hidden period", comparison.status === 200 && comparison.body.data.months.join(",") === "2026-01,2026-02" && !JSON.stringify(comparison.body).includes("2025-12"));
  const invalid = await client.request("/api/v1/energy?siteId=1&month=2026/01"); check("strict month validation", invalid.status === 404 || invalid.status === 400);
  const outside = await client.request("/api/v1/energy?siteId=1&month=2025-12"); check("outside period rejected", outside.status === 404 && outside.body.error?.code === "MONTH_OUTSIDE_DISPLAY_PERIOD");
  const future = await client.request("/api/v1/energy?siteId=1&month=2026-12"); check("future month rejected", future.status === 404 && future.body.error?.code === "MONTH_NOT_AVAILABLE");
  const save = await client.request("/api/v1/sites/1/periods/2026-03", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-03", 25, 130000, 650000), expected_row_version: 0 }) }); check("raw monthly dataset save", save.status === 200 && save.body.data.rowVersion === 1);
  const staleSave = await client.request("/api/v1/sites/1/periods/2026-03", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-03", 25, 130000, 650000), expected_row_version: 0 }) }); check("raw monthly dataset stale conflict", staleSave.status === 409 && staleSave.body.error?.code === "STALE_VERSION");
  const update = await client.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-02", end_month: "2026-03", expected_row_version: 1 }) }); check("settings update", update.status === 200 && update.body.data.rowVersion === 2);
  const stale = await client.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-03", expected_row_version: 1 }) }); check("stale settings conflict", stale.status === 409 && stale.body.error?.code === "STALE_VERSION");
  const createdUser = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "operator", display_name: "Test Operator", password: "Correct Horse Battery Staple 456!", role: "user", active: true }) });
  const createdUserJson = JSON.stringify(createdUser.body);
  const operatorId = String(createdUser.body.data?.id ?? "");
  check("admin can create active user", createdUser.status === 200 && createdUser.body.data.id && createdUser.body.data.username === "operator" && createdUser.body.data.role === "user" && createdUser.body.data.active === true);
  const shortPassword = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "invalid-password", display_name: "Invalid Password", password: "short", role: "user" }) });
  check("password policy rejection is a safe validation response", shortPassword.status === 400 && shortPassword.body.error?.code === "PASSWORD_TOO_SHORT");
  check("user management response excludes credential internals", !createdUserJson.includes("passwordHash") && !createdUserJson.includes("failedAttemptCount") && !createdUserJson.includes("lockedUntil"));
  const displayName = await client.request(`/api/v1/admin/users/${operatorId}/display-name`, { method: "PATCH", body: JSON.stringify({ display_name: "Renamed Operator" }) }); check("admin can edit display name", displayName.status === 200 && displayName.body.data.displayName === "Renamed Operator");
  const userClient = await login(base, { username: "operator", password: "Correct Horse Battery Staple 456!" });
  const forbiddenAdminRead = await userClient.request("/api/v1/admin/users"); check("user cannot access admin user management", forbiddenAdminRead.status === 403 && forbiddenAdminRead.body.error?.code === "FORBIDDEN");
  const forbiddenSettingsWrite = await userClient.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-02", end_month: "2026-03", expected_row_version: 2 }) }); check("user cannot change display period", forbiddenSettingsWrite.status === 403 && forbiddenSettingsWrite.body.error?.code === "FORBIDDEN");
  const forbiddenRoleChange = await userClient.request(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) }); check("user cannot escalate own role", forbiddenRoleChange.status === 403 && forbiddenRoleChange.body.error?.code === "FORBIDDEN");
  const deactivated = await client.request(`/api/v1/admin/users/${operatorId}/active`, { method: "PATCH", body: JSON.stringify({ active: false }) }); check("admin can deactivate user", deactivated.status === 200 && deactivated.body.data.active === false);
  const revokedSession = await userClient.request("/api/v1/settings"); check("deactivation rejects existing session", revokedSession.status === 401);
  const reactivated = await client.request(`/api/v1/admin/users/${operatorId}/active`, { method: "PATCH", body: JSON.stringify({ active: true }) }); check("admin can reactivate user", reactivated.status === 200 && reactivated.body.data.active === true);
  const userAfterReactivate = await login(base, { username: "operator", password: "Correct Horse Battery Staple 456!" });
  const reset = await client.request(`/api/v1/admin/users/${operatorId}/password`, { method: "POST", body: JSON.stringify({ password: "Correct Horse Battery Staple 789!" }) }); check("admin password reset succeeds without returning a secret", reset.status === 200 && !JSON.stringify(reset.body).includes("Correct Horse Battery Staple"));
  const oldSessionAfterReset = await userAfterReactivate.request("/api/v1/settings"); check("password reset revokes target sessions", oldSessionAfterReset.status === 401);
  const oldPassword = await login(base, { username: "operator", password: "Correct Horse Battery Staple 456!" }).catch(() => null); check("old password fails after reset", oldPassword === null);
  const newPassword = await login(base, { username: "operator", password: "Correct Horse Battery Staple 789!" }); check("new password works after reset", Boolean(newPassword));
  const promoted = await client.request(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) }); check("admin can change user role", promoted.status === 200 && promoted.body.data.role === "admin");
  const promotedAccess = await newPassword.request("/api/v1/admin/users"); check("role change takes effect on next request", promotedAccess.status === 200);
  const demoted = await client.request(`/api/v1/admin/users/${operatorId}/role`, { method: "PATCH", body: JSON.stringify({ role: "user" }) }); check("admin can demote another admin while one remains", demoted.status === 200 && demoted.body.data.role === "user");
  const selfDeactivation = await client.request("/api/v1/admin/users/1/active", { method: "PATCH", body: JSON.stringify({ active: false }) }); check("admin cannot deactivate the current account", selfDeactivation.status === 409 && selfDeactivation.body.error?.code === "SELF_DEACTIVATION_NOT_ALLOWED");
  const lastAdminDemotion = await client.request("/api/v1/admin/users/1/role", { method: "PATCH", body: JSON.stringify({ role: "user" }) }); check("last active admin cannot be demoted", lastAdminDemotion.status === 409 && lastAdminDemotion.body.error?.code === "LAST_ADMIN");
  const auditedActions = authentication.repository.audits.map(audit => audit.action);
  check("admin user-management actions are audited", ["user_create", "display_name_change", "user_deactivate", "user_activate", "password_reset", "role_change"].every(action => auditedActions.includes(action)));
  check("test auth fixture uses the expected admin identity", authentication.admin.username === "admin");
});

await withApi(true, async base => {
  const client = await login(base, { username: "admin", password: "Correct Horse Battery Staple 123!" });
  const get = await client.request("/api/v1/settings"); check("read-only GET allowed", get.status === 200);
  const put = await client.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-03", expected_row_version: 1 }) }); check("read-only mutation rejected server-side", put.status === 423 && put.body.error?.code === "READ_ONLY_MODE");
  const userMutation = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "blocked", display_name: "Blocked", password: "Correct Horse Battery Staple 999!", role: "user" }) }); check("read-only blocks user management mutation", userMutation.status === 423 && userMutation.body.error?.code === "READ_ONLY_MODE");
});

const transactionRepository = new InMemoryRepository({ settings: { startMonth: "2026-01", endMonth: "2026-03", rowVersion: 1 } });
await assert.rejects(() => transactionRepository.withTransaction(async repository => { await repository.updateGlobalSettings({ startMonth: "2026-02", endMonth: "2026-03", expectedRowVersion: 1 }, "rollback-test"); throw new Error("force rollback"); }));
check("in-memory transaction rollback", (await transactionRepository.getGlobalSettings())?.startMonth === "2026-01");

const initialSettingsRepository = new InMemoryRepository({ settings: null });
check("fresh repository has no display period until initialized", (await initialSettingsRepository.getGlobalSettings()) === null);

await withApi(false, async base => {
  const client = await login(base, { username: "admin", password: "Correct Horse Battery Staple 123!" });
  const missing = await client.request("/api/v1/settings"); check("fresh API reports unconfigured display period", missing.status === 503 && missing.body.error?.code === "DISPLAY_PERIOD_NOT_CONFIGURED");
  const configured = await client.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: 0 }) }); check("fresh API initializes display period", configured.status === 200 && configured.body.data.rowVersion === 1);
}, initialSettingsRepository);
check("first-run repository state is initialized", (await initialSettingsRepository.getGlobalSettings())?.rowVersion === 1);

await withApi(false, async base => {
  const ready = await json(base, "/api/v1/health/ready");
  check("database readiness failure is reported as 503", ready.status === 503 && ready.body.error?.code === "DATABASE_NOT_READY");
}, new InMemoryRepository({ databaseReady: false }));

console.log(`api foundation: ${checks} assertions passed`);
