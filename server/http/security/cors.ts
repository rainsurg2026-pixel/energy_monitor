import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface OriginPolicyOptions {
  readonly allowedOrigins: readonly string[];
  /** Exact, explicitly configured preview origins. Never pass a bare .vercel.app suffix. */
  readonly allowedPreviewOrigins?: readonly string[];
}

export interface OriginPolicy {
  readonly allowedOrigins: ReadonlySet<string>;
  isAllowed(origin: string | undefined): boolean;
}

export interface CorsOptions {
  readonly allowedMethods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAgeSeconds?: number;
}

const HTTP_ORIGIN = /^https?:$/u;

export function normalizeOrigin(value: string): string {
  const input = value.trim();
  if (!input || input === "*") throw new TypeError("An explicit HTTP(S) origin is required; wildcard origins are not supported.");
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new TypeError("Invalid application origin.");
  }
  if (!HTTP_ORIGIN.test(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== input) {
    throw new TypeError("Origins must be exact HTTP(S) origins without credentials or paths.");
  }
  return parsed.origin;
}

export function createOriginPolicy(options: OriginPolicyOptions): OriginPolicy {
  const values = [...options.allowedOrigins, ...(options.allowedPreviewOrigins ?? [])];
  if (values.length === 0) throw new TypeError("At least one explicit allowed origin is required.");
  const allowedOrigins = new Set(values.map(normalizeOrigin));
  return { allowedOrigins, isAllowed: (origin) => origin === undefined || allowedOrigins.has(normalizeOrigin(origin)) };
}

function headerValue(values: readonly string[]): string {
  if (values.some((value) => value.trim() === "*")) throw new TypeError("Wildcard CORS headers are not supported.");
  return values.join(", ");
}

function requestedHeadersAllowed(requested: string | undefined, allowed: readonly string[]): boolean {
  if (!requested) return true;
  const allowedSet = new Set(allowed.map((value) => value.toLowerCase()));
  return requested.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).every((value) => allowedSet.has(value));
}

export function createCorsMiddleware(policy: OriginPolicy, options: CorsOptions = {}): RequestHandler {
  const methods = (options.allowedMethods ?? ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).map((method) => method.toUpperCase());
  if (methods.includes("*")) throw new TypeError("Wildcard CORS methods are not supported.");
  const headers = (options.allowedHeaders ?? ["accept", "content-type", "x-csrf-token", "x-request-id"]).map((header) => header.toLowerCase());
  const exposed = options.exposedHeaders ?? ["x-request-id", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"];
  const credentials = options.credentials ?? true;
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawOrigin = req.header("origin");
    if (rawOrigin !== undefined) {
      let allowed = false;
      try { allowed = policy.isAllowed(rawOrigin); } catch { allowed = false; }
      if (!allowed) {
        res.status(403).json({ ok: false, error: { code: "ORIGIN_NOT_ALLOWED", message: "The request origin is not allowed." } });
        return;
      }
      res.vary("Origin");
      res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(rawOrigin));
      if (credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
      if (exposed.length > 0) res.setHeader("Access-Control-Expose-Headers", headerValue(exposed));
    }
    if (req.method.toUpperCase() === "OPTIONS") {
      const requestedMethod = req.header("access-control-request-method")?.toUpperCase();
      if (requestedMethod && !methods.includes(requestedMethod)) {
        res.status(405).json({ ok: false, error: { code: "CORS_METHOD_NOT_ALLOWED", message: "The requested CORS method is not allowed." } });
        return;
      }
      if (!requestedHeadersAllowed(req.header("access-control-request-headers"), headers)) {
        res.status(400).json({ ok: false, error: { code: "CORS_HEADERS_NOT_ALLOWED", message: "The requested CORS headers are not allowed." } });
        return;
      }
      res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
      res.setHeader("Access-Control-Allow-Headers", headerValue(headers));
      if (options.maxAgeSeconds !== undefined) {
        if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) throw new TypeError("CORS maxAgeSeconds must be a non-negative integer.");
        res.setHeader("Access-Control-Max-Age", String(options.maxAgeSeconds));
      }
      res.status(204).end();
      return;
    }
    next();
  };
}
