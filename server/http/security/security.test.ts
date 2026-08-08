import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { createOriginPolicy, createCorsMiddleware } from "./cors";
import { createCsrfMiddleware, createCsrfToken, verifyCsrfToken } from "./csrf";
import { parseCookieHeader, serializeCookie, sessionCookieOptions } from "./cookies";
import { InMemoryRateLimitStore } from "./rateLimit";
import { sanitizeRequestMetadata } from "./requestMetadata";

function mockRequest(method: string, headers: Record<string, string> = {}, remoteAddress = "127.0.0.1"): Request {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { method, headers: normalized, header: (name: string) => normalized[name.toLowerCase()], get: (name: string) => normalized[name.toLowerCase()], socket: { remoteAddress } } as unknown as Request;
}

function mockResponse(): Response & { readonly headers: Map<string, string>; readonly body?: unknown; readonly statusCode: number; readonly ended: boolean } {
  const headers = new Map<string, string>();
  const state = { statusCode: 200, body: undefined as unknown, ended: false };
  const response = {
    headers,
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
    get ended() { return state.ended; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); return response; },
    append(name: string, value: string) { const key = name.toLowerCase(); headers.set(key, headers.has(key) ? `${headers.get(key)}, ${value}` : value); return response; },
    vary(name: string) { headers.set("vary", name); return response; },
    status(code: number) { state.statusCode = code; return response; },
    json(value: unknown) { state.body = value; state.ended = true; return response; },
    end() { state.ended = true; return response; }
  } as unknown as Response & { readonly headers: Map<string, string>; readonly body?: unknown; readonly statusCode: number; readonly ended: boolean };
  return response;
}

test("CORS allows only exact configured origins and never emits wildcard credentials", () => {
  assert.throws(() => createOriginPolicy({ allowedOrigins: ["*"] }));
  const policy = createOriginPolicy({ allowedOrigins: ["http://localhost:3000"], allowedPreviewOrigins: ["https://energy-monitor-git-feat-web-v3.vercel.app"] });
  const allowedResponse = mockResponse();
  let called = false;
  createCorsMiddleware(policy)(mockRequest("GET", { origin: "http://localhost:3000" }), allowedResponse, () => { called = true; });
  assert.equal(called, true);
  assert.equal(allowedResponse.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(allowedResponse.headers.get("access-control-allow-credentials"), "true");
  assert.equal(allowedResponse.headers.has("access-control-allow-origin") && allowedResponse.headers.get("access-control-allow-origin") === "*", false);

  const rejectedResponse = mockResponse();
  createCorsMiddleware(policy)(mockRequest("GET", { origin: "https://evil.example" }), rejectedResponse, () => { throw new Error("disallowed origin reached route"); });
  assert.equal(rejectedResponse.statusCode, 403);
  assert.equal(rejectedResponse.headers.has("access-control-allow-origin"), false);
});

test("cookie and CSRF helpers use a signed double-submit token bound to the session cookie", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const session = "session-token-for-test";
  const token = createCsrfToken(secret, session);
  assert.equal(verifyCsrfToken(token, secret, session), true);
  assert.equal(verifyCsrfToken(token, secret, "different-session"), false);
  const cookie = serializeCookie("em_session", session, sessionCookieOptions("production"));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(parseCookieHeader(`${cookie}; em_csrf=${encodeURIComponent(token)}`).em_session, session);

  const middleware = createCsrfMiddleware({ secret });
  const response = mockResponse();
  let called = false;
  middleware(mockRequest("PUT", { cookie: `${cookie}; em_csrf=${encodeURIComponent(token)}`, "x-csrf-token": token }), response, () => { called = true; });
  assert.equal(called, true);
  const rejected = mockResponse();
  middleware(mockRequest("PUT", { cookie: cookie, "x-csrf-token": token }), rejected, () => { throw new Error("missing CSRF cookie reached route"); });
  assert.equal(rejected.statusCode, 403);
});

test("request metadata removes unsafe input and trusts forwarding headers only when configured", () => {
  const request = mockRequest("GET", { "x-forwarded-for": "203.0.113.10, 10.0.0.1", "user-agent": "browser\r\nforged: value", origin: "https://energy.example", referer: "https://energy.example/path" }, "192.0.2.10");
  const trusted = sanitizeRequestMetadata(request, { trustProxy: true, requestId: "safe-id" });
  assert.equal(trusted.ip, "203.0.113.10");
  assert.equal(trusted.userAgent, "browserforged: value");
  assert.equal(trusted.refererOrigin, "https://energy.example");
  const untrusted = sanitizeRequestMetadata(request, { trustProxy: false, requestId: "unsafe id" });
  assert.equal(untrusted.ip, "192.0.2.10");
  assert.notEqual(untrusted.requestId, "unsafe id");
  assert.equal(sanitizeRequestMetadata(mockRequest("GET", { referer: "not-a-url" })).refererOrigin, null);
});

test("in-memory rate limiting is deterministic with an injectable clock", async () => {
  let now = 1_000;
  const store = new InMemoryRateLimitStore({ now: () => now });
  const policy = { limit: 2, windowMs: 1_000 };
  assert.equal((await store.consume("ip:test", policy)).allowed, true);
  assert.equal((await store.consume("ip:test", policy)).allowed, true);
  const blocked = await store.consume("ip:test", policy);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  now = 2_000;
  assert.equal((await store.consume("ip:test", policy)).allowed, true);
});
