import assert from "node:assert/strict";
import { test } from "node:test";
import { maskSensitive } from "./redactLog";

test("passes through ordinary messages unchanged", () => {
  assert.equal(maskSensitive("PASS Admin login"), "PASS Admin login");
  assert.equal(maskSensitive("PREVIEW_HTTP_CHECK_FAILED: Secondary user login (status=401)"), "PREVIEW_HTTP_CHECK_FAILED: Secondary user login (status=401)");
});

test("fully redacts an Authorization header, not just the label", () => {
  const masked = maskSensitive("Authorization: Bearer abc.def.ghi123");
  assert.equal(masked.includes("abc.def.ghi123"), false);
  assert.equal(masked.includes("Bearer"), false);
});

test("fully redacts a Set-Cookie header", () => {
  const masked = maskSensitive("Set-Cookie: em_csrf=v1.abcdefghijklmnopqrstuvwxyz.signaturepart123456");
  assert.equal(masked.includes("v1.abcdefghijklmnopqrstuvwxyz"), false);
});

test("fully redacts a bare cookie-shaped key=value pair", () => {
  const masked = maskSensitive("em_csrf=v1.abcdefghijklmnopqrstuvwxyz.signaturepart123456; Path=/");
  assert.equal(masked.includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(masked.includes("Path=/"), true, "unrelated trailing content is preserved");
});

test("fully redacts a bare JWT-shaped value with no key= prefix", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzaWQiOiJhYmMifQ.c2lnbmF0dXJlaGVyZTEyMzQ1";
  const masked = maskSensitive(jwt);
  assert.equal(masked.includes(jwt), false);
  assert.equal(masked, "[REDACTED]");
});

test("never leaves a secret fragment even when over-redaction swallows trailing text", () => {
  const masked = maskSensitive("dump: authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzaWQiOiJhYmMifQ.c2lnbmF0dXJl and cookie: em_csrf=v1.xxxx.yyyy; other=1");
  assert.equal(masked.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(masked.includes("v1.xxxx.yyyy"), false);
});
