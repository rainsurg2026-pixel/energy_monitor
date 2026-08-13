import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/http/app";
import type { ServerConfig } from "../server/config/env";
import { AuthService } from "../server/auth/authService";
import { InMemoryAuthRepository } from "../server/auth/repository";
import { Argon2idPasswordHasher } from "../server/auth/passwordHasher";
import { normalizeUsername } from "../server/auth/passwordPolicy";
import { InMemoryRateLimitStore } from "../server/http/security";
import { apiTestRepository, fixtureLog } from "../server/testFixtures";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { importMigrationPlan } from "../server/migration/postgresImporter";

const hasher = new Argon2idPasswordHasher({ memoryCost: 8 * 1024, timeCost: 1, parallelism: 1, hashLength: 16, saltLength: 16 });
const config: ServerConfig = {
  databaseUrl: null, directDatabaseUrl: null, nodeEnv: "test", port: 0,
  appOrigin: "http://test", allowedOrigins: ["http://test"], allowedPreviewOrigins: [], trustProxy: false,
  sessionSecret: "phase6-session-secret-phase6-session-secret-1234",
  csrfSecret: "phase6-csrf-secret-phase6-csrf-secret-1234", sessionLifetimeMs: 8 * 60 * 60 * 1000, poolMax: 3, readOnlyMode: false
};

let assertions = 0;
function check(name: string, value: unknown): void { assert.equal(Boolean(value), true, name); assertions++; }

async function authFixture(): Promise<{ service: AuthService; repository: InMemoryAuthRepository; admin: { username: string; password: string } }> {
  const repository = new InMemoryAuthRepository();
  const password = "Phase6 synthetic admin password 123!";
  const service = new AuthService(repository, { passwordHasher: hasher, dummyPasswordHash: await hasher.hash("phase6-dummy"), sessionSecret: config.sessionSecret });
  repository.seedUser({ username: "phase6-admin", normalizedUsername: normalizeUsername("phase6-admin"), displayName: "Phase 6 Admin", passwordHash: await hasher.hash(password), role: "admin" });
  return { service, repository, admin: { username: "phase6-admin", password } };
}

interface Client { request(path: string, init?: RequestInit): Promise<{ status: number; body: any }>; }

async function login(base: string, username: string, password: string): Promise<Client> {
  const csrf = await fetch(`${base}/api/v1/auth/csrf`);
  const initialCookie = csrf.headers.get("set-cookie")?.split(";")[0] ?? "";
  const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: "http://test", cookie: initialCookie }, body: JSON.stringify({ username, password }) });
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
  const cookies = values.map(value => value.split(";")[0].trim()).filter(Boolean);
  assert.equal(response.status, 200, "Phase 6 test login");
  const cookie = cookies.join("; ");
  const csrfCookie = cookies.find(value => value.startsWith("em_csrf="));
  const csrfToken = decodeURIComponent(csrfCookie?.slice("em_csrf=".length) ?? "");
  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers); headers.set("content-type", "application/json"); headers.set("origin", "http://test"); headers.set("cookie", cookie);
      if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase())) headers.set("x-csrf-token", csrfToken);
      const result = await fetch(`${base}${path}`, { ...init, headers }); return { status: result.status, body: await result.json() };
    }
  };
}

async function withApi<T>(repository: InMemoryRepository, work: (base: string, auth: Awaited<ReturnType<typeof authFixture>>) => Promise<T>, readOnlyMode = false): Promise<T> {
  const auth = await authFixture();
  const server = createServer(createApp({ repository, config: { ...config, readOnlyMode }, authService: auth.service, rateLimitStore: new InMemoryRateLimitStore() }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Phase 6 server did not bind");
  try { return await work(`http://127.0.0.1:${address.port}`, auth); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

const repository = apiTestRepository();
await withApi(repository, async (base, auth) => {
  const admin = await login(base, auth.admin.username, auth.admin.password);
  const raw = await admin.request("/api/v1/sites/1/periods/2026-01");
  check("raw period endpoint exposes only selected month", raw.status === 200 && raw.body.data.month === "2026-01" && !JSON.stringify(raw.body).includes("2025-12"));
  check("raw period returns row version and domain calculation", raw.body.data.rowVersion === 1 && raw.body.data.calculation?.buildingEnergyKwh === 100000);

  const created = await admin.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "phase6-user", display_name: "Phase 6 User", password: "Phase6 synthetic user password 123!", role: "user", active: true }) });
  check("synthetic user is created without credentials in response", created.status === 200 && !JSON.stringify(created.body).includes("password"));
  const user = await login(base, "phase6-user", "Phase6 synthetic user password 123!");
  const forbidden = await user.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: 1 }) });
  check("normal user cannot write global settings", forbidden.status === 403);

  const userLog = fixtureLog("2026-02", 22, 0, 0);
  const userSave = await user.request("/api/v1/sites/2/periods/2026-02", { method: "PUT", body: JSON.stringify({ log: userLog, expected_row_version: 1 }) });
  check("normal user can write operational raw inputs", userSave.status === 200 && userSave.body.data.rowVersion === 2);
  const userRaw = await user.request("/api/v1/sites/2/periods/2026-02");
  check("zero semantics and derived separation are preserved", userRaw.status === 200 && userRaw.body.data.log.energyCost.buildingEnergyKwh === 0 && !JSON.stringify(userRaw.body.data.log).includes("floorElectricityCostThb"));
  check("operational audit identifies authenticated actor", repository.auditEvents.some(event => event.action === "upsert" && event.entityType === "monthly_period" && event.actorUserId === Number(created.body.data.id) && event.correlationId));

  const stale = await admin.request("/api/v1/sites/1/periods/2026-01", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-01", 30, 100001, 500001), expected_row_version: 0 }) });
  check("optimistic concurrency returns 409", stale.status === 409 && stale.body.error?.code === "STALE_VERSION");
  const outside = await admin.request("/api/v1/sites/1/periods/2025-12", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2025-12", 10, 1, 2), expected_row_version: 1 }) });
  check("writes outside Display Period are rejected", outside.status === 404 && outside.body.error?.code === "MONTH_OUTSIDE_DISPLAY_PERIOD");
  const duplicate = fixtureLog("2026-04", 1, 1, 1); duplicate.ups = [duplicate.ups[0], duplicate.ups[0]];
  const invalid = await admin.request("/api/v1/sites/1/periods/2026-04", { method: "PUT", body: JSON.stringify({ log: duplicate, expected_row_version: null }) });
  check("duplicate device inputs are rejected", invalid.status === 400 && invalid.body.error?.code === "DUPLICATE_INPUT");
});

const displayPeriodRepository = apiTestRepository();
await withApi(displayPeriodRepository, async base => {
  const admin = await login(base, "phase6-admin", "Phase6 synthetic admin password 123!");
  const extend = await admin.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2025-01", end_month: "2026-12", expected_row_version: 1 }) });
  check("admin can extend the contiguous Display Period", extend.status === 200 && extend.body.data.startMonth === "2025-01");
  const visible = await admin.request("/api/v1/sites/1/periods/2025-12");
  check("extended period makes prior month available", visible.status === 200 && visible.body.data.log?.month === "2025-12");
  const restore = await admin.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: 2 }) });
  check("Display Period can be restored with optimistic version", restore.status === 200 && restore.body.data.startMonth === "2026-01");
});

const readOnlyRepository = apiTestRepository();
await withApi(readOnlyRepository, async base => {
  const admin = await login(base, "phase6-admin", "Phase6 synthetic admin password 123!");
  const operational = await admin.request("/api/v1/sites/1/periods/2026-01", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-01", 1, 1, 1), expected_row_version: 1 }) });
  const settings = await admin.request("/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: 1 }) });
  const users = await admin.request("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: "blocked", display_name: "Blocked", password: "blocked", role: "user" }) });
  check("READ_ONLY_MODE blocks operational writes", operational.status === 423 && operational.body.error?.code === "READ_ONLY_MODE");
  check("READ_ONLY_MODE blocks settings writes", settings.status === 423 && settings.body.error?.code === "READ_ONLY_MODE");
  check("READ_ONLY_MODE blocks user-management writes", users.status === 423 && users.body.error?.code === "READ_ONLY_MODE");
}, true);

await assert.rejects(() => importMigrationPlan(null as never, null as never, { allowWrite: true, targetEnvironment: "development", readOnlyMode: true }), error => error instanceof Error && error.message.includes("READ_ONLY_MODE"));
check("READ_ONLY_MODE blocks migration/import control", true);

await assert.rejects(() => importMigrationPlan(null as never, null as never, { allowWrite: true, targetEnvironment: "production" }), error => error instanceof Error && error.message.includes("dedicated guarded production importer"));
check("Production import remains blocked without the dedicated production gate", true);

const auditFailureRepository = new InMemoryRepository({ sites: [{ id: 1, code: "site-a", name: "Site A", active: true }], logs: {}, settings: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 1 }, auditFailure: true });
await assert.rejects(() => auditFailureRepository.saveMonthlyLog({ siteId: 1, log: fixtureLog("2026-01", 1, 1, 1), expectedRowVersion: null, correlationId: "phase6-audit-failure" }));
check("audit failure rolls back operational data", (await auditFailureRepository.getMonthlyLogs(1, ["2026-01"])).length === 0 && auditFailureRepository.auditEvents.length === 0);

const transactionalRepository = apiTestRepository();
await assert.rejects(() => transactionalRepository.withTransaction(async tx => { await tx.saveMonthlyLog({ siteId: 1, log: fixtureLog("2026-04", 1, 2, 3), expectedRowVersion: null, correlationId: "phase6-rollback" }); throw new Error("forced transaction failure"); }));
check("failed transaction rolls back data and audit", (await transactionalRepository.getMonthlyLogs(1, ["2026-04"])).length === 0 && transactionalRepository.auditEvents.every(event => event.correlationId !== "phase6-rollback"));

const concurrencyRepository = apiTestRepository();
let expected = 0;
for (let version = 0; version < 5; version++) {
  await concurrencyRepository.saveMonthlyLog({ siteId: 1, log: fixtureLog("2026-04", version, version + 1, version + 2), expectedRowVersion: version === 0 ? null : version, correlationId: `phase6-seed-${version}` });
  expected++;
}
await withApi(concurrencyRepository, async base => {
  const admin = await login(base, "phase6-admin", "Phase6 synthetic admin password 123!");
  const a = await admin.request("/api/v1/sites/1/periods/2026-04", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-04", 6, 6, 6), expected_row_version: expected }) });
  const b = await admin.request("/api/v1/sites/1/periods/2026-04", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-04", 7, 7, 7), expected_row_version: expected }) });
  check("concurrent User A/User B expected version protects last write", a.status === 200 && a.body.data.rowVersion === 6 && b.status === 409 && b.body.error?.code === "STALE_VERSION");
});

console.log(`phase 6: ${assertions} assertions passed; live Supabase/browser gates remain deferred`);
