import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GoogleSheetsService } from "../server/services/googleSheetsService";
import type { ServerConfig } from "../server/config/env";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { HttpError } from "../server/errors";

const baseConfig: ServerConfig = {
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
  readOnlyMode: false,
  googleClientId: "client-id.apps.googleusercontent.com",
  googleClientSecret: "google-client-secret",
  googleRedirectUri: "http://test/api/v1/google-sheets/auth/callback",
  googleTokenEncryptionKey: "test-google-token-encryption-key-1234567890",
  googleSuccessRedirect: "http://test/settings/google-sheets"
};

const repository = new InMemoryRepository({ sites: [{ id: 1, code: "TEST", name: "Test Facility", active: true }] });
const service = new GoogleSheetsService(repository, baseConfig);
const authorizationUrl = await service.startAuthorization(7, "42");
const parsed = new URL(authorizationUrl);
assert.equal(parsed.origin, "https://accounts.google.com");
assert.equal(parsed.searchParams.get("client_id"), baseConfig.googleClientId);
assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
assert.equal(parsed.searchParams.get("access_type"), "offline");
assert.equal(parsed.searchParams.get("scope"), "https://www.googleapis.com/auth/spreadsheets openid email");
const state = parsed.searchParams.get("state");
assert.ok(state);
const stored = await repository.consumeGoogleOAuthState(createHash("sha256").update(state, "utf8").digest("hex"), 7, "42");
assert.ok(stored);
assert.notEqual(stored.encryptedCodeVerifier, parsed.searchParams.get("code_challenge"));
assert.equal((await service.status(7)).connected, false);
await assert.rejects(() => service.syncMonth(7, "sheet-id", { month: "bad", ups: [], air: {}, dc: [], energyCost: {} }), (error: unknown) => error instanceof HttpError && error.code === "INVALID_LOGS");
await assert.rejects(() => service.syncMonth(7, "sheet-id", { month: "2026-01", ups: [], air: {}, dc: [], energyCost: {} }), (error: unknown) => error instanceof HttpError && error.code === "GOOGLE_AUTH_REQUIRED");
const unconfigured = new GoogleSheetsService(repository, { ...baseConfig, googleClientId: null, googleClientSecret: null, googleRedirectUri: null, googleTokenEncryptionKey: null });
await assert.rejects(() => unconfigured.status(7), (error: unknown) => error instanceof HttpError && error.code === "GOOGLE_SHEETS_NOT_CONFIGURED");
console.log("web Google Sheets: PASS (OAuth PKCE state binding, encrypted verifier storage, fail-closed configuration and auth boundary verified)");
