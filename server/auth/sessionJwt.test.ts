import assert from "node:assert/strict";
import { test } from "node:test";
import { signSessionJwt, verifySessionJwt } from "./sessionJwt";

const SECRET_A = "sessionJwt-test-secret-sessionJwt-test-secret-1";
const SECRET_B = "sessionJwt-test-secret-sessionJwt-test-secret-2";

test("signs and verifies a session JWT round-trip", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const token = await signSessionJwt({ sid: "opaque-secret-value", userId: "user-1", role: "admin" }, SECRET_A, expiresAt);
  const claims = await verifySessionJwt(token, SECRET_A);
  assert.deepEqual(claims, { sid: "opaque-secret-value", userId: "user-1", role: "admin" });
});

test("rejects a token signed with a different secret", async () => {
  const token = await signSessionJwt({ sid: "s", userId: "user-1", role: "user" }, SECRET_A, new Date(Date.now() + 60_000));
  assert.equal(await verifySessionJwt(token, SECRET_B), null);
});

test("rejects an expired token even with the correct secret", async () => {
  const token = await signSessionJwt({ sid: "s", userId: "user-1", role: "user" }, SECRET_A, new Date(Date.now() - 1_000));
  assert.equal(await verifySessionJwt(token, SECRET_A), null);
});

test("rejects garbage input instead of throwing", async () => {
  assert.equal(await verifySessionJwt("not-a-jwt", SECRET_A), null);
  assert.equal(await verifySessionJwt("", SECRET_A), null);
});
