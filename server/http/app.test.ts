import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp, databaseFailureCode } from "./app";
import { InMemoryRateLimitStore, createCsrfToken } from "./security";
import type { ServerConfig } from "../config/env";
import type { BackendRepository } from "../repositories/contracts";
import type { AuthService } from "../auth/authService";

const config: ServerConfig = {
  databaseUrl: null,
  directDatabaseUrl: null,
  nodeEnv: "test",
  port: 0,
  appOrigin: "http://test",
  allowedOrigins: ["http://test"],
  allowedPreviewOrigins: [],
  trustProxy: false,
  sessionSecret: "test-session-secret-test-session-secret-1234",
  csrfSecret: "test-csrf-secret-test-csrf-secret-1234",
  sessionLifetimeMs: 8 * 60 * 60 * 1000,
  poolMax: 3,
  readOnlyMode: false
};

const unusedRepository = {} as BackendRepository;

test("classifies database driver failures without exposing messages", () => {
  assert.equal(databaseFailureCode({ code: "28P01", message: "password=must-not-leak" }), "28P01");
  assert.equal(databaseFailureCode({ code: "08006", message: "connection failed" }), "08006");
  assert.equal(databaseFailureCode({ code: "42P01", message: "relation does not exist" }), "42P01");
});

test("does not misclassify ordinary application errors as database failures", () => {
  assert.equal(databaseFailureCode(new Error("unexpected application fault")), null);
  assert.equal(databaseFailureCode({ code: "VALIDATION_ERROR" }), null);
});

test("sanitizes database failures and preserves a request id", async () => {
  const auth = {
    authenticateSession: async () => null,
    login: async () => { throw { code: "08006", message: "password=must-not-leak" }; }
  } as unknown as AuthService;
  const server = createServer(createApp({ repository: unusedRepository, config, authService: auth, rateLimitStore: new InMemoryRateLimitStore() }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://test" },
      body: JSON.stringify({ username: "admin", password: "not-a-real-password" })
    });
    const body = await response.json() as { ok?: boolean; error?: { code?: string; message?: string; requestId?: string } };
    assert.equal(response.status, 503);
    assert.deepEqual(body.error?.code, "SERVICE_UNAVAILABLE");
    assert.equal(body.error?.message?.includes("password"), false);
    assert.match(body.error?.requestId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get("x-request-id"), body.error?.requestId);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("login does not query a stale session cookie before authenticating", async () => {
  let authenticateSessionCalls = 0;
  const auth = {
    authenticateSession: async () => {
      authenticateSessionCalls++;
      throw { code: "08006", message: "stale session lookup must not block login" };
    },
    login: async () => ({
      user: { id: "1", username: "admin", displayName: "Admin", role: "admin", active: true as const },
      sessionToken: "signed-session-token",
      expiresAt: new Date(Date.now() + 60_000),
      sessionId: "session-1"
    })
  } as unknown as AuthService;
  const server = createServer(createApp({ repository: unusedRepository, config, authService: auth, rateLimitStore: new InMemoryRateLimitStore() }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://test", cookie: "em_session=stale-session" },
      body: JSON.stringify({ username: "admin", password: "not-a-real-password" })
    });
    assert.equal(response.status, 200);
    assert.equal(authenticateSessionCalls, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


test("authenticated PDF render endpoint returns a server-generated attachment", async () => {
  const sessionToken = "pdf-test-session";
  const user = { id: "1", username: "admin", displayName: "Admin", role: "admin" as const, active: true as const };
  const principal = { userId: "1", role: "admin" as const, active: true as const, sessionId: "pdf-test-session-id" };
  const auth = { authenticateSession: async (token?: string) => token === sessionToken ? { user, principal } : null } as unknown as AuthService;
  const rendered: string[] = [];
  const app = createApp({ repository: unusedRepository, config, authService: auth, rateLimitStore: new InMemoryRateLimitStore(), pdfRenderer: async html => { rendered.push(html); return Buffer.from("%PDF-1.4\napp-stub\n%%EOF"); } });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const csrf = createCsrfToken(config.csrfSecret, sessionToken);
    const html = '<!doctype html><html><head></head><body><section class="cover">Report</section></body></html>';
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/reports/render-pdf?filename=DC_Status_MonthlyReport%20of%20RST_Sep-2026.pdf`, {
      method: "POST", headers: { origin: "http://test", "content-type": "text/html; charset=utf-8", cookie: `em_session=${sessionToken}; em_csrf=${csrf}`, "x-csrf-token": csrf }, body: html
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(response.headers.get("content-disposition") ?? "", /RST_Sep-2026\.pdf/);
    assert.match(Buffer.from(await response.arrayBuffer()).toString("utf8"), /^%PDF-1\.4/);
    assert.deepEqual(rendered, [html]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("admin database backup returns a protected ZIP attachment", async () => {
  const sessionToken = "backup-test-session";
  const user = { id: "1", username: "admin", displayName: "Admin Backup", role: "admin" as const, active: true as const };
  const principal = { userId: "1", role: "admin" as const, active: true as const, sessionId: "backup-test-session-id" };
  const auth = { authenticateSession: async (token?: string) => token === sessionToken ? { user, principal } : null } as unknown as AuthService;
  const backupCalls: unknown[] = [];
  const backupExporter = { exportAllDatabase: async (input: unknown) => { backupCalls.push(input); return { bytes: Buffer.from("PK-backup"), filename: "EnergyMonitor_Database_Backup_05-Sep-2026_22-30_GMT+7.zip", rowCount: 12, tableCount: 4 }; } };
  const server = createServer(createApp({ repository: unusedRepository, config, authService: auth, rateLimitStore: new InMemoryRateLimitStore(), backupExporter }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const csrf = createCsrfToken(config.csrfSecret, sessionToken);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/admin/database-backup`, { method: "POST", headers: { origin: "http://test", cookie: `em_session=${sessionToken}; em_csrf=${csrf}`, "x-csrf-token": csrf } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/zip/);
    assert.match(response.headers.get("content-disposition") ?? "", /EnergyMonitor_Database_Backup_.*GMT\+7\.zip/);
    assert.equal(response.headers.get("x-energy-backup-tables"), "4");
    assert.equal(response.headers.get("x-energy-backup-rows"), "12");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "PK-backup");
    assert.equal(backupCalls.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
