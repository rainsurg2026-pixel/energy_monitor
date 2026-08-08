import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sanitizeRequestMetadata } from "./requestMetadata";

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}

export interface RateLimitMiddlewareOptions {
  readonly trustProxy?: boolean;
  readonly keyGenerator?: (req: Request) => string;
}

function validatePolicy(policy: RateLimitPolicy): void {
  if (!Number.isInteger(policy.limit) || policy.limit < 1) throw new TypeError("Rate-limit limit must be a positive integer.");
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 1) throw new TypeError("Rate-limit windowMs must be a positive integer.");
}

function decision(count: number, policy: RateLimitPolicy, resetAtMs: number, nowMs: number): RateLimitDecision {
  return { allowed: count <= policy.limit, limit: policy.limit, remaining: Math.max(0, policy.limit - count), resetAtMs, retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)) };
}

/** Development/test only. Process-local state is not a security boundary on Vercel. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { windowStartMs: number; count: number }>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: { readonly now?: () => number; readonly maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    validatePolicy(policy);
    const nowMs = this.now();
    const windowStartMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs;
    const current = this.entries.get(key);
    const entry = current && current.windowStartMs === windowStartMs ? current : { windowStartMs, count: 0 };
    entry.count += 1;
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return decision(entry.count, policy, windowStartMs + policy.windowMs, nowMs);
  }

  async reset(key: string): Promise<void> { this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
}

export interface SqlExecutor {
  query<T extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly T[] }>;
}

/** Durable strategy. It expects the documented public.http_rate_limit_buckets table. */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly db: SqlExecutor) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    validatePolicy(policy);
    const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
    const result = await this.db.query<{ hit_count: number; reset_at_ms: number }>(`
      WITH bucket AS (
        SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp()) / ($2::double precision / 1000.0)) * ($2::double precision / 1000.0)) AS window_start
      ), upsert AS (
        INSERT INTO public.http_rate_limit_buckets (key_hash, window_start, hit_count)
        SELECT $1, window_start, 1 FROM bucket
        ON CONFLICT (key_hash, window_start)
        DO UPDATE SET hit_count = public.http_rate_limit_buckets.hit_count + 1
        RETURNING hit_count, window_start
      )
      SELECT hit_count, extract(epoch FROM (window_start + ($2::double precision * interval '1 millisecond'))) * 1000 AS reset_at_ms
      FROM upsert
    `, [keyHash, policy.windowMs]);
    const row = result.rows[0];
    if (!row) throw new Error("Rate-limit store did not return a bucket decision.");
    const resetAtMs = Number(row.reset_at_ms);
    const nowMs = Date.now();
    return decision(Number(row.hit_count), policy, resetAtMs, nowMs);
  }

  async reset(key: string): Promise<void> {
    const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
    await this.db.query<Record<string, unknown>>("DELETE FROM public.http_rate_limit_buckets WHERE key_hash = $1", [keyHash]);
  }
}

export function createRateLimitMiddleware(store: RateLimitStore, policy: RateLimitPolicy, options: RateLimitMiddlewareOptions = {}): RequestHandler {
  validatePolicy(policy);
  const keyGenerator = options.keyGenerator ?? ((req: Request) => {
    const metadata = sanitizeRequestMetadata(req, { trustProxy: options.trustProxy });
    return `ip:${metadata.ip ?? "unknown"}`;
  });
  return (req: Request, res: Response, next: NextFunction): void => {
    void store.consume(keyGenerator(req), policy).then((result) => {
      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAtMs / 1000)));
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.status(429).json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } });
        return;
      }
      next();
    }).catch(next);
  };
}
