import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp, databaseFailureCode } from "./app";
import { InMemoryRateLimitStore } from "./security";
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
