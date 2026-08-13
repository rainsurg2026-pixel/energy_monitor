/**
 * Provider-neutral authentication contracts.
 *
 * These types deliberately keep the application user ID separate from
 * usernames, email addresses, and external identity subjects. The database
 * layer is responsible for choosing the concrete storage type.
 */

export type AuthUserId = string;

export type AuthProvider = "local" | "entra";

export interface LocalCredential {
  userId: AuthUserId;
  passwordHash: string;
  passwordVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthIdentity {
  id: string;
  userId: AuthUserId;
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string | null;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthIdentityKey {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant?: string | null;
}

export interface AuthIdentityRepository {
  findByProviderSubject(key: AuthIdentityKey): Promise<AuthIdentity | null>;
  linkIdentity(input: Omit<AuthIdentity, "id" | "createdAt" | "updatedAt">): Promise<AuthIdentity>;
  unlinkIdentity(identityId: string): Promise<void>;
}

export interface LoginAccountState {
  active: boolean;
  failedAttemptCount: number;
  lockedUntil: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: AuthUserId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}
