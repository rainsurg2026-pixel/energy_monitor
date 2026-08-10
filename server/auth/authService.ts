import { hashNewPassword, type PasswordHasher } from "./passwordHasher";
import { CredentialVerifier, GENERIC_LOGIN_FAILURE } from "./credentialVerifier";
import { decideLogin, DEFAULT_LOGIN_PROTECTION_POLICY, type LoginProtectionPolicy } from "./loginProtection";
import { checkSession, createSessionMaterial, DEFAULT_SESSION_POLICY, type SessionPolicy } from "./sessions";
import { hashSessionToken } from "./sessionTokens";
import { signSessionJwt, verifySessionJwt } from "./sessionJwt";
import { normalizeUsername, type PasswordPolicy } from "./passwordPolicy";
import type { AuthenticatedPrincipal, Role } from "../authz";
import { requireScope, actorIdentityFromPrincipal } from "../authz";
import { canListUsers, canCreateUsers, canUpdateUsers, canActivateUsers, canDeleteUsers, canAssignRoles, canResetPasswords, canReadAuditHistory } from "../authz/scope";
import { HttpError } from "../errors";
import type { AuditRecord, AuthAccountRecord, AuthRepository, SafeUserRecord } from "./repository";

export interface AuthServiceOptions {
  readonly passwordHasher: PasswordHasher;
  readonly dummyPasswordHash: string;
  /** Signs/verifies the session JWT (see sessionJwt.ts). Reused from the
   *  existing SESSION_SECRET config value - never wired to anything until
   *  now. */
  readonly sessionSecret: string;
  readonly sessionPolicy?: SessionPolicy;
  readonly loginProtectionPolicy?: LoginProtectionPolicy;
  readonly passwordPolicy?: PasswordPolicy;
  readonly now?: () => Date;
}

export interface SafePrincipalUser { id: string; username: string; displayName: string; role: Role; active: true; }
export interface LoginResult { user: SafePrincipalUser; sessionToken: string; expiresAt: Date; sessionId: string; }
export interface LoginRequestMetadata { ip?: string | null; userAgent?: string | null; correlationId?: string; }

function safeUser(account: AuthAccountRecord | SafeUserRecord): SafePrincipalUser {
  return { id: String(account.id), username: account.username, displayName: account.displayName, role: account.role, active: true };
}

function genericCredentialsError(): HttpError { return new HttpError(401, GENERIC_LOGIN_FAILURE.code, GENERIC_LOGIN_FAILURE.message); }

export class AuthService {
  private readonly verifier: CredentialVerifier;
  private readonly sessionPolicy: SessionPolicy;
  private readonly loginPolicy: LoginProtectionPolicy;
  private readonly now: () => Date;

  constructor(private readonly repository: AuthRepository, private readonly options: AuthServiceOptions) {
    this.verifier = new CredentialVerifier(options.dummyPasswordHash, options.passwordHasher);
    this.sessionPolicy = options.sessionPolicy ?? DEFAULT_SESSION_POLICY;
    this.loginPolicy = options.loginProtectionPolicy ?? DEFAULT_LOGIN_PROTECTION_POLICY;
    this.now = options.now ?? (() => new Date());
  }

  async login(username: unknown, password: unknown, request: LoginRequestMetadata = {}): Promise<LoginResult> {
    let normalized = "";
    try { normalized = normalizeUsername(username); } catch {
      await this.verifier.verify(password, null);
      await this.repository.audit({ actorUserId: null, action: "LOGIN_FAILED", entityType: "auth", entityId: "unknown", correlationId: request.correlationId ?? "login" });
      throw genericCredentialsError();
    }
    const record = await this.repository.findLoginByNormalizedUsername(normalized);
    const now = this.now();
    if (record?.account.lockedUntil && record.account.lockedUntil.getTime() > now.getTime()) {
      await this.repository.audit({ actorUserId: null, action: "ACCOUNT_LOCKED", entityType: "user", entityId: record.account.id, correlationId: request.correlationId ?? "login" });
      throw new HttpError(423, "ACCOUNT_LOCKED", "This account is temporarily locked. Please try again later.");
    }
    const verified = await this.verifier.verify(password, record?.account.active ? record.credential : null);
    const decision = decideLogin(record?.account ?? null, verified.authenticated, now, this.loginPolicy);
    if (!record || decision.outcome !== "accepted") {
      if (record && decision.outcome === "rejected" && decision.persistFailureState) {
        const failureState = await this.repository.recordLoginFailure(record.account.id, now, this.loginPolicy);
        if (failureState.lockoutApplied && !decision.lockoutApplied) decision.lockoutApplied = true;
      }
      await this.repository.audit({ actorUserId: null, action: decision.outcome === "rejected" && decision.lockoutApplied ? "ACCOUNT_LOCKED" : "LOGIN_FAILED", entityType: record ? "user" : "auth", entityId: record?.account.id ?? "unknown", correlationId: request.correlationId ?? "login", newValue: decision.outcome === "rejected" && decision.lockoutApplied ? { lockout: true } : undefined });
      throw genericCredentialsError();
    }
    await this.repository.resetLoginFailures(record.account.id);
    if (verified.needsRehash && typeof password === "string") await this.repository.replacePasswordHash(record.account.id, await hashNewPassword(password, this.options.passwordHasher, this.options.passwordPolicy), now);
    const material = createSessionMaterial(record.account.id, now, this.sessionPolicy);
    const session = await this.repository.createSession({ userId: record.account.id, tokenHash: material.tokenHash, createdAt: material.createdAt, expiresAt: material.expiresAt, createdIp: request.ip ?? null, userAgent: request.userAgent ?? null });
    await this.repository.audit({ actorUserId: record.account.id, action: "LOGIN_SUCCESS", entityType: "user", entityId: record.account.id, correlationId: request.correlationId ?? "login" });
    await this.repository.audit({ actorUserId: record.account.id, action: "SESSION_CREATED", entityType: "session", entityId: session.id, correlationId: request.correlationId ?? "login" });
    const sessionToken = await signSessionJwt({ sid: material.token, userId: String(record.account.id), role: record.account.role }, this.options.sessionSecret, material.expiresAt);
    return { user: safeUser(record.account), sessionToken, expiresAt: material.expiresAt, sessionId: session.id };
  }

  async authenticateSession(rawToken: string | undefined): Promise<{ principal: AuthenticatedPrincipal; user: SafePrincipalUser } | null> {
    if (!rawToken) return null;
    const claims = await verifySessionJwt(rawToken, this.options.sessionSecret);
    if (!claims) return null;
    let tokenHash: string;
    try { tokenHash = hashSessionToken(claims.sid); } catch { return null; }
    const lookup = await this.repository.findSessionByTokenHash(tokenHash);
    if (!lookup) return null;
    const now = this.now();
    if (!lookup.account.active || !checkSession(lookup.session, now, this.sessionPolicy).active) {
      const reason = !lookup.account.active ? "user_deactivated" : "expired";
      await this.repository.revokeSessionByTokenHash(lookup.session.tokenHash, reason);
      await this.repository.audit({ actorUserId: lookup.account.id, action: "SESSION_REVOKED", entityType: "session", entityId: lookup.session.id, newValue: { reason }, correlationId: "session-validation" });
      return null;
    }
    await this.repository.touchSession(lookup.session.id, now);
    return { principal: { userId: lookup.account.id, role: lookup.account.role, active: true, authMethod: "local", sessionId: lookup.session.id }, user: safeUser(lookup.account) };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const claims = await verifySessionJwt(rawToken, this.options.sessionSecret);
    if (!claims) return;
    let tokenHash: string;
    try { tokenHash = hashSessionToken(claims.sid); } catch { return; }
    const lookup = await this.repository.findSessionByTokenHash(tokenHash);
    await this.repository.revokeSessionByTokenHash(tokenHash, "logout");
    if (lookup) await this.repository.audit({ actorUserId: lookup.account.id, action: "SESSION_REVOKED", entityType: "session", entityId: lookup.session.id, newValue: { reason: "logout" }, correlationId: "logout" });
  }

  async changePassword(principal: AuthenticatedPrincipal, currentPassword: unknown, newPassword: unknown, correlationId: string): Promise<void> {
    const record = await this.repository.findLoginByNormalizedUsername((await this.repository.findUserById(principal.userId))?.normalizedUsername ?? "");
    const verified = await this.verifier.verify(currentPassword, record?.credential ?? null);
    if (!record || !verified.authenticated) throw genericCredentialsError();
    const hash = await hashNewPassword(newPassword, this.options.passwordHasher, this.options.passwordPolicy);
    await this.repository.changePassword(principal.userId, hash, this.now(), principal.sessionId ?? null, actorIdentityFromPrincipal(principal).actorUserId, correlationId);
  }

  async listUsers(principal: AuthenticatedPrincipal): Promise<SafeUserRecord[]> { requireScope(principal, canListUsers); return this.repository.listUsers(); }
  async listAuditHistory(principal: AuthenticatedPrincipal, limit = 100): Promise<AuditRecord[]> { requireScope(principal, canReadAuditHistory); return this.repository.listAuditHistory(Math.max(1, Math.min(200, Math.trunc(limit)))); }
  async createUser(principal: AuthenticatedPrincipal, input: { username: unknown; displayName: unknown; password: unknown; role: Role; active?: unknown }, correlationId: string): Promise<SafeUserRecord> {
    requireScope(principal, canCreateUsers);
    const normalizedUsername = normalizeUsername(input.username);
    if (typeof input.displayName !== "string" || input.displayName.trim().length === 0 || input.displayName.trim().length > 256) throw new HttpError(400, "INVALID_DISPLAY_NAME", "display_name is invalid.");
    if (input.active !== undefined && typeof input.active !== "boolean") throw new HttpError(400, "INVALID_ACTIVE", "active must be boolean.");
    const hash = await hashNewPassword(input.password, this.options.passwordHasher, this.options.passwordPolicy);
    return this.repository.createUser({ username: input.username as string, normalizedUsername, displayName: input.displayName.trim(), passwordHash: hash, role: input.role, active: input.active as boolean | undefined, actorUserId: principal.userId }, correlationId);
  }
  async setUserDisplayName(principal: AuthenticatedPrincipal, targetUserId: string, displayName: unknown, correlationId: string): Promise<SafeUserRecord> {
    requireScope(principal, canUpdateUsers);
    if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.trim().length > 256) throw new HttpError(400, "INVALID_DISPLAY_NAME", "display_name is invalid.");
    return this.repository.setUserDisplayName(targetUserId, displayName.trim(), principal.userId, correlationId);
  }
  async setUserActive(principal: AuthenticatedPrincipal, targetUserId: string, active: boolean, correlationId: string): Promise<SafeUserRecord> {
    requireScope(principal, canActivateUsers);
    if (!active && targetUserId === principal.userId) throw new HttpError(409, "SELF_DEACTIVATION_NOT_ALLOWED", "An administrator cannot deactivate the current account.");
    return this.repository.setUserActive(targetUserId, active, principal.userId, correlationId);
  }
  async setUserRole(principal: AuthenticatedPrincipal, targetUserId: string, role: Role, correlationId: string): Promise<SafeUserRecord> { requireScope(principal, canAssignRoles); return this.repository.setUserRole(targetUserId, role, principal.userId, correlationId); }
  async resetUserPassword(principal: AuthenticatedPrincipal, targetUserId: string, newPassword: unknown, correlationId: string): Promise<SafeUserRecord> { requireScope(principal, canResetPasswords); const hash = await hashNewPassword(newPassword, this.options.passwordHasher, this.options.passwordPolicy); return this.repository.resetUserPassword(targetUserId, hash, principal.userId, correlationId); }
  async deleteUser(principal: AuthenticatedPrincipal, targetUserId: string, correlationId: string): Promise<void> {
    requireScope(principal, canDeleteUsers);
    if (targetUserId === principal.userId) throw new HttpError(409, "SELF_DELETE_NOT_ALLOWED", "An administrator cannot delete the current account.");
    await this.repository.deleteUser(targetUserId, principal.userId, correlationId);
  }
  async cleanupExpiredSessions(): Promise<number> { return this.repository.cleanupExpiredSessions(this.now()); }
}
