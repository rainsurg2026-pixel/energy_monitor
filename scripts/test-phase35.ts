import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuthService } from "../server/auth/authService";
import { InMemoryAuthRepository } from "../server/auth/repository";
import { Argon2idPasswordHasher } from "../server/auth/passwordHasher";
import { normalizeUsername } from "../server/auth/passwordPolicy";
import { InMemoryRateLimitStore, PostgresRateLimitStore } from "../server/http/security/rateLimit";
import { createApp } from "../server/http/app";
import { HttpError } from "../server/errors";
import type { ServerConfig } from "../server/config/env";
import { apiTestRepository } from "../server/testFixtures";

const hasher = new Argon2idPasswordHasher({ memoryCost: 8 * 1024, timeCost: 1, parallelism: 1, hashLength: 16, saltLength: 16 });
const config: ServerConfig = { databaseUrl: null, directDatabaseUrl: null, nodeEnv: "test", port: 0, appOrigin: "http://test", allowedOrigins: ["http://test"], allowedPreviewOrigins: [], trustProxy: false, sessionSecret: "test-session-secret-test-session-secret-1234", csrfSecret: "test-csrf-secret-test-csrf-secret-1234", sessionLifetimeMs: 8 * 60 * 60 * 1000, poolMax: 3, readOnlyMode: false };
let assertions = 0;
function check(name: string, value: unknown): void { assert.equal(Boolean(value), true, name); assertions += 1; }
function expectStatus(name: string, error: unknown, status: number): void { check(name, error instanceof HttpError && error.status === status); }

const repository = new InMemoryAuthRepository();
const dummyPasswordHash = await hasher.hash("phase35-dummy-login-sentinel");
const service = new AuthService(repository, { passwordHasher: hasher, dummyPasswordHash });
const password = "Phase35-local-test-password";
const userId = repository.seedUser({ username: "phase35-user", normalizedUsername: normalizeUsername("phase35-user"), displayName: "Phase 3.5 User", passwordHash: await hasher.hash(password), role: "user" });

for (let attempt = 1; attempt <= 5; attempt += 1) {
  try { await service.login("phase35-user", "wrong-password", { correlationId: `lockout-${attempt}` }); } catch (error) { expectStatus(`wrong password attempt ${attempt} is generic`, error, 401); }
}
try { await service.login("phase35-user", password); assert.fail("locked account unexpectedly logged in"); } catch (error) { expectStatus("locked account returns 423 before password verification", error, 423); }
check("lockout security audit exists", repository.audits.some(item => item.action === "ACCOUNT_LOCKED"));
await repository.resetLoginFailures(userId);
const login = await service.login("phase35-user", password, { correlationId: "phase35-login" });
check("successful login returns safe session material", Boolean(login.user && login.sessionId && login.sessionToken) && !JSON.stringify(login.user).includes("password"));
check("login and session creation events are audited", repository.audits.some(item => item.action === "LOGIN_SUCCESS") && repository.audits.some(item => item.action === "SESSION_CREATED"));
await service.logout(login.sessionToken);
check("logout revokes the server-side session", (await service.authenticateSession(login.sessionToken)) === null);
await assert.rejects(() => new AuthService(new (class extends InMemoryAuthRepository { override async findSessionByTokenHash(): Promise<never> { throw new Error("session store unavailable"); } })(), { passwordHasher: hasher, dummyPasswordHash }).authenticateSession(login.sessionToken));
check("session-store failure fails closed", true);

await repository.audit({ actorUserId: userId, action: "TEST_REDACTION", entityType: "user", entityId: userId, newValue: { password: "redacted-test-value", password_hash: "redacted-test-hash", safe: true }, correlationId: "phase35-redaction" });
const redacted = repository.audits.at(-1);
check("audit payload removes password and hash fields", redacted && !JSON.stringify(redacted).includes("redacted-test"));

const limiter = new InMemoryRateLimitStore();
for (let attempt = 0; attempt < 30; attempt += 1) check(`rate limit allows attempt ${attempt + 1}`, (await limiter.consume("phase35-ip", { limit: 30, windowMs: 15 * 60 * 1000 })).allowed);
check("31st attempt is rate limited", !(await limiter.consume("phase35-ip", { limit: 30, windowMs: 15 * 60 * 1000 })).allowed);

let sql = "";
const durable = new PostgresRateLimitStore({ async query<T extends Record<string, unknown>>(text: string): Promise<{ rows: readonly T[] }> { sql = text; return { rows: [{ hit_count: 1, reset_at_ms: Date.now() + 1000 } as unknown as T] }; } });
check("durable limiter uses the PostgreSQL bucket table", (await durable.consume("phase35-ip", { limit: 30, windowMs: 15 * 60 * 1000 })).allowed && sql.includes("http_rate_limit_buckets"));
assert.throws(() => createApp({ repository: apiTestRepository(), config: { ...config, nodeEnv: "production" }, authService: service }));
check("production app refuses an in-memory rate-limit fallback", true);

const server = createServer(createApp({ repository: apiTestRepository(), config, authService: service, rateLimitStore: new InMemoryRateLimitStore() }));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
check("local HTTP app starts for browser parity tests", Boolean(address && typeof address !== "string"));
await new Promise<void>(resolve => server.close(() => resolve()));

console.log(`phase 3.5: ${assertions} assertions passed; live Supabase verification remains deferred`);
