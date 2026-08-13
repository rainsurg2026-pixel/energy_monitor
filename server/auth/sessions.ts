import { generateSessionToken, hashSessionToken } from "./sessionTokens";
import type { AuthUserId, SessionRecord } from "./types";

export interface SessionPolicy {
  absoluteLifetimeMs: number;
  idleLifetimeMs?: number;
}

export const DEFAULT_SESSION_POLICY: Readonly<SessionPolicy> = Object.freeze({
  absoluteLifetimeMs: 8 * 60 * 60 * 1000
});

export type SessionStatus = "active" | "expired" | "revoked";

export interface SessionCheckResult {
  active: boolean;
  status: SessionStatus;
}

export interface NewSessionMaterial {
  token: string;
  tokenHash: string;
  userId: AuthUserId;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: null;
  revokedAt: null;
}

function assertDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${field} must be a valid Date.`);
}

function assertPolicy(policy: SessionPolicy): void {
  if (!Number.isSafeInteger(policy.absoluteLifetimeMs) || policy.absoluteLifetimeMs <= 0) throw new Error("Session absolute lifetime is invalid.");
  if (policy.idleLifetimeMs !== undefined && (!Number.isSafeInteger(policy.idleLifetimeMs) || policy.idleLifetimeMs <= 0)) throw new Error("Session idle lifetime is invalid.");
}

export function calculateSessionExpiry(
  createdAt: Date,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY
): Date {
  assertDate(createdAt, "createdAt");
  assertPolicy(policy);
  return new Date(createdAt.getTime() + policy.absoluteLifetimeMs);
}

export function createSessionMaterial(
  userId: AuthUserId,
  now = new Date(),
  policy: SessionPolicy = DEFAULT_SESSION_POLICY
): NewSessionMaterial {
  assertDate(now, "now");
  const token = generateSessionToken();
  return { token, tokenHash: hashSessionToken(token), userId, createdAt: new Date(now), expiresAt: calculateSessionExpiry(now, policy), lastSeenAt: null, revokedAt: null };
}

export function checkSession(
  session: Pick<SessionRecord, "createdAt" | "expiresAt" | "lastSeenAt" | "revokedAt">,
  now = new Date(),
  policy: SessionPolicy = DEFAULT_SESSION_POLICY
): SessionCheckResult {
  assertDate(now, "now");
  assertDate(session.createdAt, "createdAt");
  assertDate(session.expiresAt, "expiresAt");
  if (session.revokedAt !== null) return { active: false, status: "revoked" };
  if (session.expiresAt.getTime() <= now.getTime()) return { active: false, status: "expired" };
  if (policy.idleLifetimeMs !== undefined) {
    const lastSeenAt = session.lastSeenAt ?? session.createdAt;
    assertDate(lastSeenAt, "lastSeenAt");
    if (lastSeenAt.getTime() + policy.idleLifetimeMs <= now.getTime()) return { active: false, status: "expired" };
  }
  return { active: true, status: "active" };
}

export function isSessionActive(session: Pick<SessionRecord, "createdAt" | "expiresAt" | "lastSeenAt" | "revokedAt">, now = new Date(), policy?: SessionPolicy): boolean {
  return checkSession(session, now, policy).active;
}

export function revokeSession(session: SessionRecord, now = new Date()): SessionRecord {
  assertDate(now, "now");
  if (session.revokedAt !== null) return session;
  return { ...session, revokedAt: new Date(now) };
}

export function touchSession(session: SessionRecord, now = new Date(), policy?: SessionPolicy): SessionRecord {
  if (!isSessionActive(session, now, policy)) return session;
  return { ...session, lastSeenAt: new Date(now) };
}
