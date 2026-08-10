import assert from "node:assert/strict";
import { test } from "node:test";
import { CredentialVerifier } from "./credentialVerifier";
import { decideLogin } from "./loginProtection";
import { Argon2idPasswordHasher, isArgon2idEncodedHash } from "./passwordHasher";
import { assertPasswordPolicy, normalizeUsername } from "./passwordPolicy";
import { sessionTokenHashesEqual } from "./sessionTokens";
import { checkSession, createSessionMaterial, revokeSession, touchSession } from "./sessions";
import type { LocalCredential, SessionRecord } from "./types";
import { InMemoryAuthRepository } from "./repository";

const TEST_ARGON2_PARAMETERS = { memoryCost: 8 * 1024, timeCost: 1, parallelism: 1, hashLength: 32, saltLength: 16 };

test("normalizes usernames at the server boundary and applies password policy", () => {
  assert.equal(normalizeUsername("  ALICE\u0301  "), "alicé");
  assert.doesNotThrow(() => assertPasswordPolicy("manager-generated / passphrase"));
  assert.throws(() => assertPasswordPolicy("short"), /at least/);
  assert.throws(() => assertPasswordPolicy("\t\n"), /blank/);
});

test("hashes and verifies Argon2id credentials without accepting another Argon2 variant", async () => {
  const hasher = new Argon2idPasswordHasher(TEST_ARGON2_PARAMETERS);
  const encodedHash = await hasher.hash("correct horse battery staple");
  assert.equal(isArgon2idEncodedHash(encodedHash), true);
  assert.equal(await hasher.verify("correct horse battery staple", encodedHash), true);
  assert.equal(await hasher.verify("wrong password", encodedHash), false);
  assert.equal(hasher.needsRehash(encodedHash), false);
});

test("credential verification has one generic failure shape for unknown users", async () => {
  const hasher = new Argon2idPasswordHasher(TEST_ARGON2_PARAMETERS);
  const dummyHash = await hasher.hash("startup-only dummy sentinel");
  const verifier = new CredentialVerifier(dummyHash, hasher);
  const credential: LocalCredential = { userId: "user-1", passwordHash: await hasher.hash("secret passphrase"), passwordVersion: "argon2id-v1", createdAt: new Date(0), updatedAt: new Date(0) };
  const wrong = await verifier.verify("not the password", credential);
  const missing = await verifier.verify("not the password", null);
  assert.deepEqual(wrong, missing);
  assert.equal((await verifier.verify("secret passphrase", credential)).authenticated, true);
});

test("session material contains only a digest for persistence and expires/revokes correctly", () => {
  const createdAt = new Date("2026-08-08T00:00:00.000Z");
  const material = createSessionMaterial("user-1", createdAt, { absoluteLifetimeMs: 60_000 });
  assert.equal(material.tokenHash.length, 64);
  assert.equal(sessionTokenHashesEqual(material.tokenHash, material.tokenHash), true);
  assert.equal(material.tokenHash.includes(material.token), false);
  const record: SessionRecord = { id: "session-1", ...material };
  assert.equal(checkSession(record, new Date("2026-08-08T00:00:30.000Z"), { absoluteLifetimeMs: 60_000 }).active, true);
  assert.equal(checkSession(record, new Date("2026-08-08T00:01:00.000Z"), { absoluteLifetimeMs: 60_000 }).status, "expired");
  assert.equal(checkSession(revokeSession(record, new Date("2026-08-08T00:00:10.000Z")), createdAt).status, "revoked");
  assert.equal(touchSession(record, new Date("2026-08-08T00:00:10.000Z"), { absoluteLifetimeMs: 60_000 }).lastSeenAt?.getTime(), new Date("2026-08-08T00:00:10.000Z").getTime());
});

test("login protection locks after the threshold without account-state disclosure", () => {
  const now = new Date("2026-08-08T00:00:00.000Z");
  const policy = { maxFailedAttempts: 3, lockoutDurationMs: 60_000 };
  const first = decideLogin({ active: true, failedAttemptCount: 0, lockedUntil: null }, false, now, policy);
  const second = decideLogin({ active: true, failedAttemptCount: first.failedAttemptCount, lockedUntil: first.lockedUntil }, false, now, policy);
  const locked = decideLogin({ active: true, failedAttemptCount: second.failedAttemptCount, lockedUntil: second.lockedUntil }, false, now, policy);
  const inactive = decideLogin({ active: false, failedAttemptCount: 0, lockedUntil: null }, false, now, policy);
  if (locked.outcome !== "rejected" || inactive.outcome !== "rejected") throw new Error("Expected rejected login decisions.");
  assert.equal(first.publicCode, "INVALID_CREDENTIALS");
  assert.equal(locked.lockoutApplied, true);
  assert.equal(locked.persistFailureState, true);
  assert.deepEqual(inactive.failure, locked.failure);
  assert.equal(decideLogin({ active: true, failedAttemptCount: locked.failedAttemptCount, lockedUntil: locked.lockedUntil }, true, now, policy).outcome, "rejected");
});

test("user deletion preserves the active-admin invariant and writes a sanitized audit event", async () => {
  const repository = new InMemoryAuthRepository();
  const adminId = repository.seedUser({ username: "admin", normalizedUsername: "admin", displayName: "Admin", passwordHash: "hash", role: "admin" });
  const userId = repository.seedUser({ username: "user", normalizedUsername: "user", displayName: "User", passwordHash: "hash", role: "user" });
  await assert.rejects(() => repository.deleteUser(adminId, "99", "test"), { code: "LAST_ADMIN" });
  await repository.deleteUser(userId, adminId, "test");
  assert.equal(await repository.findUserById(userId), null);
  assert.equal(repository.audits.at(-1)?.action, "user_delete");
  assert.deepEqual(repository.audits.at(-1)?.previousValue, { username: "user", display_name: "User", role: "user", active: true });
});
