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
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
  };
}

async function json(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: response.status, body: await response.json() };
}

const mainTestRepository = apiTestRepository();
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
  // Rack Capacity (zone/status): the Web Rack Capacity view was previously
  // entirely absent, so this endpoint had no caller and no test. Verify the
  // records reach the DTO with derived metrics, and that a site with no
  // rack snapshot returns null (not an error) rather than another site's data.
  const racks = await client.request("/api/v1/racks?siteId=1&month=2026-01");
  check("rack snapshot is exposed with derived metrics", racks.status === 200 && racks.body.data.snapshot.records.length === 3 && racks.body.data.snapshot.metrics.total === 3 && racks.body.data.snapshot.metrics.inUse.count === 1);
  const racksEmptySite = await client.request("/api/v1/racks?siteId=2&month=2026-02");
  check("a site with no rack snapshot returns null, not an error or another site's data", racksEmptySite.status === 200 && racksEmptySite.body.data.snapshot === null);
  const comparison = await client.request("/api/v1/site-comparison"); check("comparison excludes hidden period", comparison.status === 200 && comparison.body.data.months.join(",") === "2026-01,2026-02" && !JSON.stringify(comparison.body).includes("2025-12"));
  // UPS Group History: was previously never fetched at all (no repository
  // method/route existed), so the History screen's UPS tab always showed
  // "no data" regardless of what the database held. These assertions cover
  // the fix end to end: valid mapping, DTO field names, display-period
  // filtering, facility isolation, and the genuinely-empty case.
  const site1History = await client.request("/api/v1/sites/1/history");
  check("UPS Group History reaches the history DTO", site1History.status === 200 && site1History.body.data.upsGroupHistory.sourceSheet === "2. UPS Group History");
  check("UPS Group History exposes the visible-month row with correctly mapped fields", site1History.body.data.upsGroupHistory.rows.length === 1 && site1History.body.data.upsGroupHistory.rows[0].month === "2026-01" && site1History.body.data.upsGroupHistory.rows[0].group === "UPS 11" && site1History.body.data.upsGroupHistory.rows[0].totalLoadKw === 30 && site1History.body.data.upsGroupHistory.rows[0].loadPercent === 7.5);
  check("UPS Group History rows outside the Display Period are filtered, not fabricated as missing", !site1History.body.data.upsGroupHistory.rows.some((row: { month: string }) => row.month === "2025-12"));
  const site2History = await client.request("/api/v1/sites/2/history");
  check("a site with genuinely no UPS Group History rows returns an empty array, not an error", site2History.status === 200 && Array.isArray(site2History.body.data.upsGroupHistory.rows) && site2History.body.data.upsGroupHistory.rows.length === 0);
  check("UPS Group History is scoped per site (no cross-facility contamination)", !JSON.stringify(site2History.body.data.upsGroupHistory).includes("UPS 11"));
  // Rack Capacity History / Rack Unit Capacity history: the History screen's
  // Rack tab always rendered empty regardless of real data, because
  // CleanWebApp never fetched or passed rackCapacityHistory/rackUnitCapacity
  // to HistoricalExplorer (rack_capacity_history had a table, migration, and
  // Desktop writer, but zero repository/API/frontend wiring) - the same
  // class of bug as the UPS Group History gap above.
  check("Rack Capacity History exposes the visible-month rows with correctly mapped fields", site1History.body.data.rackCapacityHistory.length === 2 && site1History.body.data.rackCapacityHistory.every((row: { snapshotMonth: string }) => row.snapshotMonth === "2026-01") && site1History.body.data.rackCapacityHistory.some((row: { rackZone: string; totalRacks: number; inUse: number }) => row.rackZone === "Zone A" && row.totalRacks === 2 && row.inUse === 1));
  check("Rack Capacity History rows outside the Display Period are filtered, not fabricated as missing", !site1History.body.data.rackCapacityHistory.some((row: { snapshotMonth: string }) => row.snapshotMonth === "2025-12"));
  check("a site with genuinely no Rack Capacity History rows returns an empty array, not an error", Array.isArray(site2History.body.data.rackCapacityHistory) && site2History.body.data.rackCapacityHistory.length === 0);
  check("Rack Capacity History is scoped per site (no cross-facility contamination)", !JSON.stringify(site2History.body.data.rackCapacityHistory).includes("Zone A"));
  check("Rack Unit Capacity history exposes the visible-month row with derived availableU/availabilityPct", site1History.body.data.rackUnitCapacity.length === 1 && site1History.body.data.rackUnitCapacity[0].month === "2026-01" && site1History.body.data.rackUnitCapacity[0].availableU === 50 && Math.abs(site1History.body.data.rackUnitCapacity[0].availabilityPct - 0.125) < 1e-9);
  check("Rack Unit Capacity history rows outside the Display Period are filtered, not fabricated as missing", !site1History.body.data.rackUnitCapacity.some((row: { month: string }) => row.month === "2025-12"));
  check("a site with genuinely no Rack Unit Capacity history returns an empty array, not an error", Array.isArray(site2History.body.data.rackUnitCapacity) && site2History.body.data.rackUnitCapacity.length === 0);
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

  // Delete user: previously untested at the API layer. Verifies RBAC,
  // self-deletion protection, and that deletion writes both a
  // SESSION_REVOKED_ALL and a user_delete audit row (mirroring the
  // deactivate/password-reset pattern - added because deleteUser did not
  // previously record an explicit session-revocation audit entry, even
  // though the sessions FK is ON DELETE CASCADE and removes the rows
  // regardless).
  const disposableUser = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "disposable", display_name: "Disposable", password: "Correct Horse Battery Staple 321!", role: "user", active: true }) });
  check("temporary user for delete-route testing was created", disposableUser.status === 200);
  const disposableUserId = disposableUser.body.data.id;
  const disposableClient = await login(base, { username: "disposable", password: "Correct Horse Battery Staple 321!" });
  const forbiddenDelete = await disposableClient.request(`/api/v1/admin/users/${disposableUserId}`, { method: "DELETE" });
  check("a non-admin user cannot delete a user", forbiddenDelete.status === 403 && forbiddenDelete.body.error?.code === "FORBIDDEN");
  const selfDelete = await client.request("/api/v1/admin/users/1", { method: "DELETE" });
  check("admin cannot delete the current account", selfDelete.status === 409 && selfDelete.body.error?.code === "SELF_DELETION_NOT_ALLOWED");
  const deleted = await client.request(`/api/v1/admin/users/${disposableUserId}`, { method: "DELETE" });
  check("admin can delete another user", deleted.status === 204);
  const deletedUserGone = await client.request("/api/v1/admin/users");
  check("deleted user no longer appears in the user list", deletedUserGone.status === 200 && !deletedUserGone.body.data.some((user: { id: string }) => user.id === disposableUserId));
  const deletedSessionRevoked = await disposableClient.request("/api/v1/settings");
  check("deletion revokes the deleted user's existing session", deletedSessionRevoked.status === 401);
  const auditedActionsAfterDelete = authentication.repository.audits.filter(audit => audit.entityId === disposableUserId).map(audit => audit.action);
  check("deleting a user is audited with both SESSION_REVOKED_ALL and user_delete", auditedActionsAfterDelete.includes("SESSION_REVOKED_ALL") && auditedActionsAfterDelete.includes("user_delete"));

  // Backup: RBAC reuses the existing backupRestoreManage permission (no new
  // permission was invented). Not configured in this test environment, so
  // "success" here means the routes are reachable and correctly gated -
  // configured-and-working behavior is covered by test:backup-service with
  // mocked Google responses.
  const backupStatus = await client.request("/api/v1/admin/backup/status");
  check("admin can read backup status", backupStatus.status === 200 && backupStatus.body.data.configured === false && Array.isArray(backupStatus.body.data.recent));
  const backupRun = await client.request("/api/v1/admin/backup/run", { method: "POST" });
  check("admin-triggered backup run is logged even when not configured", backupRun.status === 200 && backupRun.body.data.status === "failed" && backupRun.body.data.backupType === "manual");
  const createdViewer = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "viewer", display_name: "Viewer", password: "Correct Horse Battery Staple 000!", role: "user", active: true }) });
  check("temporary user for backup RBAC check was created", createdViewer.status === 200);
  const viewerClient = await login(base, { username: "viewer", password: "Correct Horse Battery Staple 000!" });
  const forbiddenBackupStatus = await viewerClient.request("/api/v1/admin/backup/status");
  check("a non-admin user cannot read backup status", forbiddenBackupStatus.status === 403 && forbiddenBackupStatus.body.error?.code === "FORBIDDEN");
  const forbiddenBackupRun = await viewerClient.request("/api/v1/admin/backup/run", { method: "POST" });
  check("a non-admin user cannot trigger a backup run", forbiddenBackupRun.status === 403 && forbiddenBackupRun.body.error?.code === "FORBIDDEN");

  // Backup destination config: Admin-configurable Google Sheet URL, stored
  // as a non-secret DB row (server extracts+validates the spreadsheet ID -
  // the client never gets to assert one directly). No Google credential
  // ever appears in any of these responses.
  const invalidUrl = await client.request("/api/v1/admin/backup/config", { method: "PUT", body: JSON.stringify({ google_sheet_url: "https://example.com/not-a-sheet", enabled: false }) });
  check("an unrelated URL is rejected as an invalid Google Sheets URL", invalidUrl.status === 400 && invalidUrl.body.error?.code === "INVALID_SHEET_URL");
  const validSpreadsheetId = "a".repeat(44);
  const savedConfig = await client.request("/api/v1/admin/backup/config", { method: "PUT", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit#gid=0`, enabled: true }) });
  check("admin can save a valid Google Sheet URL", savedConfig.status === 200 && savedConfig.body.data.sheetUrl === `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit` && savedConfig.body.data.enabled === true);
  check("the saved config response returns a masked spreadsheet reference, not the raw ID", savedConfig.body.data.spreadsheetIdMasked !== validSpreadsheetId && savedConfig.body.data.spreadsheetIdMasked.includes("…"));
  const savedConfigJson = JSON.stringify(savedConfig.body);
  check("the saved config response never contains credential-shaped fields", !/private_key|client_secret|access_token|refresh_token/i.test(savedConfigJson));
  const statusAfterSave = await client.request("/api/v1/admin/backup/status");
  check("status reflects the newly configured destination", statusAfterSave.status === 200 && statusAfterSave.body.data.destination.spreadsheetIdMasked === savedConfig.body.data.spreadsheetIdMasked && statusAfterSave.body.data.destination.enabled === true);
  const configChangeAudit = mainTestRepository.auditEvents.find(audit => audit.action === "backup_destination_change");
  check("changing the backup destination is audited with a masked reference, not the raw ID or a credential", Boolean(configChangeAudit) && !JSON.stringify(configChangeAudit).includes(validSpreadsheetId));
  const missingEnabled = await client.request("/api/v1/admin/backup/config", { method: "PUT", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit` }) });
  check("saving without the required enabled flag is rejected", missingEnabled.status === 400);
  const testConnectionResult = await client.request("/api/v1/admin/backup/test-connection", { method: "POST", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit` }) });
  check("Test Connection is reachable for an admin and reports a structured result without a live Google credential configured in this test environment", testConnectionResult.status === 200 && testConnectionResult.body.data.ok === false && typeof testConnectionResult.body.data.reason === "string");
  const forbiddenConfigWrite = await viewerClient.request("/api/v1/admin/backup/config", { method: "PUT", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit`, enabled: true }) });
  check("a non-admin user cannot change the backup destination", forbiddenConfigWrite.status === 403 && forbiddenConfigWrite.body.error?.code === "FORBIDDEN");
  const forbiddenTestConnection = await viewerClient.request("/api/v1/admin/backup/test-connection", { method: "POST", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${validSpreadsheetId}/edit` }) });
  check("a non-admin user cannot call Test Connection", forbiddenTestConnection.status === 403 && forbiddenTestConnection.body.error?.code === "FORBIDDEN");

  // Cron endpoint: authenticated by CRON_SECRET only, never a session -
  // must be reachable with no cookies/CSRF token at all (that's the whole
  // point - Vercel Cron has none), and must reject a wrong/missing secret.
  const cronNoSecret = await fetch(`${base}/api/v1/cron/backup`, { method: "POST", headers: { origin: "http://test" } });
  check("cron endpoint rejects a request with no bearer secret", cronNoSecret.status === 401);
  const cronWrongSecret = await fetch(`${base}/api/v1/cron/backup`, { method: "POST", headers: { origin: "http://test", authorization: "Bearer wrong-secret" } });
  check("cron endpoint rejects the wrong bearer secret", cronWrongSecret.status === 401);
  check("cron endpoint was reachable at all (not blocked by the global CSRF gate meant for session-based routes)", cronNoSecret.status !== 403 && cronWrongSecret.status !== 403);
}, mainTestRepository);

await withApi(true, async base => {
  const client = await login(base, { username: "admin", password: "Correct Horse Battery Staple 123!" });
  const get = await client.request("/api/v1/settings"); check("read-only GET allowed", get.status === 200);
  const put = await client.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-03", expected_row_version: 1 }) }); check("read-only mutation rejected server-side", put.status === 423 && put.body.error?.code === "READ_ONLY_MODE");
  const userMutation = await client.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "blocked", display_name: "Blocked", password: "Correct Horse Battery Staple 999!", role: "user" }) }); check("read-only blocks user management mutation", userMutation.status === 423 && userMutation.body.error?.code === "READ_ONLY_MODE");
  const readOnlySpreadsheetId = "b".repeat(44);
  const configWriteBlocked = await client.request("/api/v1/admin/backup/config", { method: "PUT", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${readOnlySpreadsheetId}/edit`, enabled: true }) });
  check("read-only blocks changing the backup destination (a real settings write)", configWriteBlocked.status === 423 && configWriteBlocked.body.error?.code === "READ_ONLY_MODE");
  const testConnectionAllowed = await client.request("/api/v1/admin/backup/test-connection", { method: "POST", body: JSON.stringify({ google_sheet_url: `https://docs.google.com/spreadsheets/d/${readOnlySpreadsheetId}/edit` }) });
  check("read-only still allows Test Connection (a diagnostic read against Google, not an operational-table write)", testConnectionAllowed.status === 200);
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
