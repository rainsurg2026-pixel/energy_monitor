import type { Response } from "express";

export const SESSION_COOKIE_NAME = "em_session";
export const CSRF_COOKIE_NAME = "em_csrf";

export type CookieSameSite = "lax" | "strict" | "none";

export interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: CookieSameSite;
  readonly path?: string;
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly domain?: string;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertCookieName(name: string): void {
  if (!COOKIE_NAME.test(name)) throw new TypeError("Invalid cookie name.");
}

function assertCookieValue(value: string): void {
  if (/[\r\n;]/u.test(value)) throw new TypeError("Invalid cookie value.");
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieName(name);
  assertCookieValue(value);
  if (options.sameSite === "none" && options.secure !== true) {
    throw new TypeError("SameSite=None cookies must be Secure.");
  }
  if (options.maxAge !== undefined && (!Number.isInteger(options.maxAge) || options.maxAge < 0)) {
    throw new TypeError("Cookie maxAge must be a non-negative integer.");
  }
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) {
    if (/[^\u0021-\u007e]/u.test(options.domain) || /[;,\s]/u.test(options.domain)) throw new TypeError("Invalid cookie domain.");
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path) {
    if (!options.path.startsWith("/") || /[\r\n;]/u.test(options.path)) throw new TypeError("Invalid cookie path.");
    parts.push(`Path=${options.path}`);
  }
  if (options.expires) {
    if (Number.isNaN(options.expires.getTime())) throw new TypeError("Invalid cookie expiration.");
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  return parts.join("; ");
}

export function appendSetCookie(res: Response, cookie: string): void {
  res.append("Set-Cookie", cookie);
}

export function setCookie(res: Response, name: string, value: string, options: CookieOptions = {}): void {
  appendSetCookie(res, serializeCookie(name, value, options));
}

export function clearCookie(res: Response, name: string, options: Omit<CookieOptions, "maxAge" | "expires"> = {}): void {
  setCookie(res, name, "", { ...options, maxAge: 0, expires: new Date(0) });
}

export function parseCookieHeader(header: string | undefined): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!COOKIE_NAME.test(name) || Object.prototype.hasOwnProperty.call(cookies, name)) continue;
    const encoded = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(encoded);
    } catch {
      // Ignore malformed cookie values rather than treating undecodable input as trusted.
    }
  }
  return cookies;
}

export function getCookie(res: Response, name: string): string | undefined {
  assertCookieName(name);
  const value = res.req?.headers.cookie;
  return parseCookieHeader(typeof value === "string" ? value : undefined)[name];
}

function cookieMaxAgeSeconds(lifetimeMs: number): number {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1) throw new TypeError("Cookie lifetime must be a positive integer.");
  return Math.max(1, Math.ceil(lifetimeMs / 1000));
}

export function sessionCookieOptions(nodeEnv: "development" | "test" | "production", lifetimeMs = 8 * 60 * 60 * 1000): CookieOptions {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: "/", maxAge: cookieMaxAgeSeconds(lifetimeMs) };
}

export function csrfCookieOptions(nodeEnv: "development" | "test" | "production", lifetimeMs = 8 * 60 * 60 * 1000): CookieOptions {
  return { httpOnly: false, secure: nodeEnv === "production", sameSite: "lax", path: "/", maxAge: cookieMaxAgeSeconds(lifetimeMs) };
}
