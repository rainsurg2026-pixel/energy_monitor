import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { appendSetCookie, csrfCookieOptions, CSRF_COOKIE_NAME, parseCookieHeader, SESSION_COOKIE_NAME, serializeCookie, type CookieOptions } from "./cookies";

const TOKEN_VERSION = "v1";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfOptions {
  readonly secret: string;
  readonly sessionCookieName?: string;
  readonly csrfCookieName?: string;
  readonly headerName?: string;
  readonly cookieOptions?: CookieOptions;
  readonly failureStatus?: number;
}

function bindingForSession(sessionToken: string | undefined): string {
  return sessionToken ?? "anonymous";
}

function signature(secret: string, nonce: string, sessionToken: string | undefined): string {
  return createHmac("sha256", secret).update(`${TOKEN_VERSION}.${nonce}.${bindingForSession(sessionToken)}`, "utf8").digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfToken(secret: string, sessionToken?: string): string {
  if (!secret || secret.length < 32) throw new TypeError("CSRF secret must be at least 32 characters.");
  const nonce = randomBytes(32).toString("base64url");
  return `${TOKEN_VERSION}.${nonce}.${signature(secret, nonce, sessionToken)}`;
}

export function verifyCsrfToken(token: string | undefined, secret: string, sessionToken?: string): boolean {
  if (!token || !secret || secret.length < 32) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !/^[A-Za-z0-9_-]{16,128}$/u.test(parts[1]) || !/^[A-Za-z0-9_-]{32,128}$/u.test(parts[2])) return false;
  const expected = Buffer.from(signature(secret, parts[1], sessionToken));
  const actual = Buffer.from(parts[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueCsrfCookie(res: Response, options: CsrfOptions, sessionToken?: string): string {
  const token = createCsrfToken(options.secret, sessionToken);
  appendSetCookie(res, serializeCookie(options.csrfCookieName ?? CSRF_COOKIE_NAME, token, options.cookieOptions ?? csrfCookieOptions("production")));
  return token;
}

export function createCsrfMiddleware(options: CsrfOptions): RequestHandler {
  const sessionCookieName = options.sessionCookieName ?? SESSION_COOKIE_NAME;
  const csrfCookieName = options.csrfCookieName ?? CSRF_COOKIE_NAME;
  const headerName = options.headerName ?? "x-csrf-token";
  const failureStatus = options.failureStatus ?? 403;
  if (!options.secret || options.secret.length < 32) throw new TypeError("CSRF secret must be at least 32 characters.");
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }
    const cookies = parseCookieHeader(req.header("cookie"));
    const cookieToken = cookies[csrfCookieName];
    const headerToken = req.header(headerName);
    const sessionToken = cookies[sessionCookieName];
    const valid = cookieToken !== undefined && headerToken !== undefined && constantTimeEqual(cookieToken, headerToken) && verifyCsrfToken(cookieToken, options.secret, sessionToken);
    if (!valid) {
      res.status(failureStatus).json({ ok: false, error: { code: "CSRF_FAILED", message: "A valid CSRF token is required for this request." } });
      return;
    }
    next();
  };
}
