import { GENERIC_LOGIN_FAILURE } from "./credentialVerifier";
import type { LoginAccountState } from "./types";

export interface LoginProtectionPolicy {
  maxFailedAttempts: number;
  lockoutDurationMs: number;
}

export const DEFAULT_LOGIN_PROTECTION_POLICY: Readonly<LoginProtectionPolicy> = Object.freeze({
  maxFailedAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000
});

export type LoginDecision = LoginAcceptedDecision | LoginRejectedDecision;

export interface LoginAcceptedDecision {
  outcome: "accepted";
  publicCode: "OK";
  failedAttemptCount: 0;
  lockedUntil: null;
}

export interface LoginRejectedDecision {
  outcome: "rejected";
  publicCode: typeof GENERIC_LOGIN_FAILURE.code;
  failure: typeof GENERIC_LOGIN_FAILURE;
  failedAttemptCount: number;
  lockedUntil: Date | null;
  lockoutApplied: boolean;
  persistFailureState: boolean;
}

function assertPolicy(policy: LoginProtectionPolicy): void {
  if (!Number.isSafeInteger(policy.maxFailedAttempts) || policy.maxFailedAttempts < 1) throw new Error("Maximum failed attempts is invalid.");
  if (!Number.isSafeInteger(policy.lockoutDurationMs) || policy.lockoutDurationMs <= 0) throw new Error("Lockout duration is invalid.");
}

function reject(
  failedAttemptCount: number,
  lockedUntil: Date | null,
  lockoutApplied: boolean,
  persistFailureState: boolean
): LoginRejectedDecision {
  return { outcome: "rejected", publicCode: GENERIC_LOGIN_FAILURE.code, failure: GENERIC_LOGIN_FAILURE, failedAttemptCount, lockedUntil, lockoutApplied, persistFailureState };
}

/**
 * Produces one public failure shape for missing, inactive, wrong-password,
 * and locked accounts. Only the returned state transition is account-local.
 */
export function decideLogin(
  account: LoginAccountState | null,
  credentialsMatch: boolean,
  now = new Date(),
  policy: LoginProtectionPolicy = DEFAULT_LOGIN_PROTECTION_POLICY
): LoginDecision {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("now must be a valid Date.");
  assertPolicy(policy);

  if (!account) return reject(0, null, false, false);
  if (!account.active) return reject(Math.max(0, account.failedAttemptCount), account.lockedUntil, false, false);
  if (account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime()) return reject(account.failedAttemptCount, account.lockedUntil, true, false);
  if (credentialsMatch) return { outcome: "accepted", publicCode: "OK", failedAttemptCount: 0, lockedUntil: null };

  const previousFailures = account.lockedUntil !== null ? 0 : Math.max(0, account.failedAttemptCount);
  const failedAttemptCount = previousFailures + 1;
  if (failedAttemptCount >= policy.maxFailedAttempts) {
    return reject(failedAttemptCount, new Date(now.getTime() + policy.lockoutDurationMs), true, true);
  }
  return reject(failedAttemptCount, null, false, true);
}
