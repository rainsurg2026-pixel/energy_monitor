import type { Pool, PoolClient } from "pg";
import { withTransaction, type DbExecutor, query } from "../db/pool";
import { HttpError } from "../errors";
import type { Role } from "../authz";
import type { LocalCredential, SessionRecord } from "./types";

export interface AuthAccountRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  displayName: string;
  active: boolean;
  failedAttemptCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
  role: Role;
}

export interface AuthLoginRecord {
  account: AuthAccountRecord;
  credential: LocalCredential;
}

export interface AuthSessionLookup {
  session: SessionRecord;
  account: AuthAccountRecord;
}

export interface SafeUserRecord {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  role: Role;
  failedAttemptCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
}

export interface CreateUserInput {
  username: string;
  normalizedUsername: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  actorUserId: string | null;
}

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  correlationId: string;
}

export interface AuthRepository {
  findLoginByNormalizedUsername(normalizedUsername: string): Promise<AuthLoginRecord | null>;
  findUserById(userId: string): Promise<AuthAccountRecord | null>;
  createSession(input: { userId: string; tokenHash: string; createdAt: Date; expiresAt: Date; createdIp?: string | null; userAgent?: string | null }): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionLookup | null>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string, reason: string): Promise<void>;
  revokeOtherSessions(userId: string, keepSessionId: string | null, reason: string): Promise<void>;
  revokeAllSessions(userId: string, reason: string): Promise<void>;
  recordLoginFailure(userId: string, failedAttemptCount: number, lockedUntil: Date | null): Promise<void>;
  resetLoginFailures(userId: string): Promise<void>;
  replacePasswordHash(userId: string, passwordHash: string, changedAt: Date): Promise<void>;
  changePassword(userId: string, passwordHash: string, changedAt: Date, keepSessionId: string | null, actorUserId: string, correlationId: string): Promise<void>;
  listUsers(): Promise<SafeUserRecord[]>;
  createUser(input: CreateUserInput, correlationId: string): Promise<SafeUserRecord>;
  setUserActive(targetUserId: string, active: boolean, actorUserId: string, correlationId: string): Promise<SafeUserRecord>;
  setUserRole(targetUserId: string, role: Role, actorUserId: string, correlationId: string): Promise<SafeUserRecord>;
  resetUserPassword(targetUserId: string, passwordHash: string, actorUserId: string, correlationId: string): Promise<SafeUserRecord>;
  audit(input: AuditInput): Promise<void>;
  countUsers(): Promise<number>;
  cleanupExpiredSessions(now: Date): Promise<number>;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredDate(value: unknown, field: string): Date {
  const date = toDate(value);
  if (!date) throw new Error(`Invalid ${field} returned by database.`);
  return date;
}

function roleOf(value: unknown): Role {
  if (value === "admin" || value === "user") return value;
  throw new Error("Database returned an unsupported role.");
}

function accountFromRow(row: Record<string, unknown>): AuthAccountRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    normalizedUsername: String(row.normalized_username),
    displayName: String(row.display_name),
    active: Boolean(row.active),
    failedAttemptCount: Number(row.failed_attempt_count),
    lockedUntil: toDate(row.locked_until),
    passwordChangedAt: toDate(row.password_changed_at),
    role: roleOf(row.role)
  };
}

function safeUserFromAccount(account: AuthAccountRecord): SafeUserRecord { return { ...account }; }

function sessionFromRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.session_id ?? row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    createdAt: requiredDate(row.created_at, "created_at"),
    expiresAt: requiredDate(row.expires_at, "expires_at"),
    lastSeenAt: toDate(row.last_seen_at),
    revokedAt: toDate(row.revoked_at)
  };
}

const ACCOUNT_SQL = `
  SELECT u.id::text, u.username, u.normalized_username, u.display_name, u.active,
         u.failed_attempt_count, u.locked_until, u.password_changed_at,
         r.name AS role
  FROM public.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.roles r ON r.id = ur.role_id
`;

const ADMIN_INVARIANT_LOCK_KEY = "736515828225";

export class PostgresAuthRepository implements AuthRepository {
  private readonly executor: DbExecutor;

  constructor(private readonly pool: Pool | null, executor?: DbExecutor) {
    this.executor = executor ?? pool ?? (() => { throw new Error("A PostgreSQL executor is required."); })();
  }

  private async inTransaction<T>(work: (repository: PostgresAuthRepository) => Promise<T>): Promise<T> {
    if (!this.pool) return work(this);
    return withTransaction(this.pool, client => work(new PostgresAuthRepository(null, client)));
  }

  async findLoginByNormalizedUsername(normalizedUsername: string): Promise<AuthLoginRecord | null> {
    const result = await query<Record<string, unknown>>(this.executor, `${ACCOUNT_SQL.replace("r.name AS role", "r.name AS role, lc.password_hash, lc.password_version, lc.created_at AS credential_created_at, lc.updated_at AS credential_updated_at")}
      JOIN public.local_credentials lc ON lc.user_id = u.id
      WHERE u.normalized_username = $1`, [normalizedUsername]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      account: accountFromRow(row),
      credential: {
        userId: String(row.id),
        passwordHash: String(row.password_hash),
        passwordVersion: String(row.password_version),
        createdAt: requiredDate(row.credential_created_at, "credential_created_at"),
        updatedAt: requiredDate(row.credential_updated_at, "credential_updated_at")
      }
    };
  }

  async findUserById(userId: string): Promise<AuthAccountRecord | null> {
    const result = await query<Record<string, unknown>>(this.executor, `${ACCOUNT_SQL} WHERE u.id = $1::bigint`, [userId]);
    return result.rows[0] ? accountFromRow(result.rows[0]) : null;
  }

  async createSession(input: { userId: string; tokenHash: string; createdAt: Date; expiresAt: Date; createdIp?: string | null; userAgent?: string | null }): Promise<SessionRecord> {
    const result = await query<Record<string, unknown>>(this.executor,
      `INSERT INTO public.sessions(user_id, token_hash, created_at, expires_at, created_ip, user_agent)
       VALUES ($1::bigint, $2, $3, $4, $5::inet, $6)
       RETURNING id::text, user_id::text, token_hash, created_at, expires_at, last_seen_at, revoked_at`,
      [input.userId, input.tokenHash, input.createdAt, input.expiresAt, input.createdIp ?? null, input.userAgent ?? null]);
    return sessionFromRow(result.rows[0]);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionLookup | null> {
    const result = await query<Record<string, unknown>>(this.executor, `${ACCOUNT_SQL.replace("r.name AS role", "r.name AS role, s.id AS session_id, s.user_id, s.token_hash, s.created_at, s.expires_at, s.last_seen_at, s.revoked_at")}
      JOIN public.sessions s ON s.user_id = u.id
      WHERE s.token_hash = $1`, [tokenHash]);
    const row = result.rows[0];
    return row ? { session: sessionFromRow(row), account: accountFromRow(row) } : null;
  }

  async touchSession(sessionId: string, at: Date): Promise<void> { await query(this.executor, "UPDATE public.sessions SET last_seen_at = $2 WHERE id = $1::bigint AND revoked_at IS NULL", [sessionId, at]); }
  async revokeSessionByTokenHash(tokenHash: string, reason: string): Promise<void> { await query(this.executor, "UPDATE public.sessions SET revoked_at = COALESCE(revoked_at, now()), revocation_reason = COALESCE(revocation_reason, $2) WHERE token_hash = $1", [tokenHash, reason]); }
  async revokeOtherSessions(userId: string, keepSessionId: string | null, reason: string): Promise<void> { await query(this.executor, "UPDATE public.sessions SET revoked_at = COALESCE(revoked_at, now()), revocation_reason = COALESCE(revocation_reason, $3) WHERE user_id = $1::bigint AND ($2::bigint IS NULL OR id <> $2::bigint) AND revoked_at IS NULL", [userId, keepSessionId, reason]); }
  async revokeAllSessions(userId: string, reason: string): Promise<void> { await query(this.executor, "UPDATE public.sessions SET revoked_at = COALESCE(revoked_at, now()), revocation_reason = COALESCE(revocation_reason, $2) WHERE user_id = $1::bigint AND revoked_at IS NULL", [userId, reason]); }
  async recordLoginFailure(userId: string, failedAttemptCount: number, lockedUntil: Date | null): Promise<void> { await query(this.executor, "UPDATE public.users SET failed_attempt_count = $2, locked_until = $3, updated_at = now(), row_version = row_version + 1 WHERE id = $1::bigint", [userId, failedAttemptCount, lockedUntil]); }
  async resetLoginFailures(userId: string): Promise<void> { await query(this.executor, "UPDATE public.users SET failed_attempt_count = 0, locked_until = NULL, updated_at = now(), row_version = row_version + 1 WHERE id = $1::bigint", [userId]); }
  async replacePasswordHash(userId: string, passwordHash: string, changedAt: Date): Promise<void> { await query(this.executor, "UPDATE public.local_credentials SET password_hash = $2, password_version = password_version + 1, updated_at = now() WHERE user_id = $1::bigint", [userId, passwordHash]); await query(this.executor, "UPDATE public.users SET password_changed_at = $2, updated_at = now(), row_version = row_version + 1 WHERE id = $1::bigint", [userId, changedAt]); }

  async changePassword(userId: string, passwordHash: string, changedAt: Date, keepSessionId: string | null, actorUserId: string, correlationId: string): Promise<void> {
    await this.inTransaction(async repository => {
      await repository.replacePasswordHash(userId, passwordHash, changedAt);
      await repository.revokeOtherSessions(userId, keepSessionId, "password_changed");
      await repository.audit({ actorUserId, action: "password_change", entityType: "user", entityId: userId, correlationId });
    });
  }

  async listUsers(): Promise<SafeUserRecord[]> {
    const result = await query<Record<string, unknown>>(this.executor, `${ACCOUNT_SQL} ORDER BY u.normalized_username`);
    return result.rows.map(row => safeUserFromAccount(accountFromRow(row)));
  }

  async createUser(input: CreateUserInput, correlationId: string): Promise<SafeUserRecord> {
    return this.inTransaction(async repository => {
      try {
        const inserted = await query<Record<string, unknown>>(repository.executor, `INSERT INTO public.users(username, normalized_username, display_name, password_changed_at) VALUES ($1,$2,$3,now()) RETURNING id::text`, [input.username, input.normalizedUsername, input.displayName]);
        const userId = String(inserted.rows[0].id);
        await query(repository.executor, "INSERT INTO public.local_credentials(user_id, password_hash) VALUES ($1::bigint,$2)", [userId, input.passwordHash]);
        const role = await query<Record<string, unknown>>(repository.executor, "SELECT id FROM public.roles WHERE name = $1", [input.role]);
        await query(repository.executor, "INSERT INTO public.user_roles(user_id, role_id, assigned_by_user_id) VALUES ($1::bigint,$2::bigint,$3::bigint)", [userId, role.rows[0].id, input.actorUserId]);
        await query(repository.executor, "INSERT INTO public.auth_identities(user_id, provider, provider_subject) VALUES ($1::bigint, 'local', $2)", [userId, input.normalizedUsername]);
        await repository.audit({ actorUserId: input.actorUserId, action: "user_create", entityType: "user", entityId: userId, newValue: { username: input.username, display_name: input.displayName, role: input.role }, correlationId });
        const account = await repository.findUserById(userId);
        if (!account) throw new Error("Created user could not be loaded.");
        return safeUserFromAccount(account);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") throw new HttpError(409, "USER_ALREADY_EXISTS", "A user with that username already exists.");
        throw error;
      }
    });
  }

  async setUserActive(targetUserId: string, active: boolean, actorUserId: string, correlationId: string): Promise<SafeUserRecord> {
    return this.inTransaction(async repository => {
      await query(repository.executor, "SELECT pg_advisory_xact_lock($1::bigint)", [ADMIN_INVARIANT_LOCK_KEY]);
      const before = await repository.findUserById(targetUserId);
      if (!before) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
      if (before.active && before.role === "admin" && !active) {
        const admins = await query<Record<string, unknown>>(repository.executor, "SELECT count(*)::int AS count FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id JOIN public.roles r ON r.id=ur.role_id WHERE u.active AND r.name='admin' AND u.id <> $1::bigint", [targetUserId]);
        if (Number(admins.rows[0].count) === 0) throw new HttpError(409, "LAST_ADMIN", "At least one active admin must remain.");
      }
      await query(repository.executor, "UPDATE public.users SET active = $2, updated_at = now(), row_version = row_version + 1 WHERE id = $1::bigint", [targetUserId, active]);
      if (!active) await repository.revokeAllSessions(targetUserId, "user_deactivated");
      await repository.audit({ actorUserId, action: active ? "user_activate" : "user_deactivate", entityType: "user", entityId: targetUserId, previousValue: { active: before.active }, newValue: { active }, correlationId });
      const after = await repository.findUserById(targetUserId); if (!after) throw new Error("Updated user could not be loaded."); return safeUserFromAccount(after);
    });
  }

  async setUserRole(targetUserId: string, role: Role, actorUserId: string, correlationId: string): Promise<SafeUserRecord> {
    return this.inTransaction(async repository => {
      await query(repository.executor, "SELECT pg_advisory_xact_lock($1::bigint)", [ADMIN_INVARIANT_LOCK_KEY]);
      const before = await repository.findUserById(targetUserId); if (!before) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
      if (before.role === "admin" && role !== "admin") {
        const admins = await query<Record<string, unknown>>(repository.executor, "SELECT count(*)::int AS count FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id JOIN public.roles r ON r.id=ur.role_id WHERE u.active AND r.name='admin' AND u.id <> $1::bigint", [targetUserId]);
        if (Number(admins.rows[0].count) === 0) throw new HttpError(409, "LAST_ADMIN", "At least one active admin must remain.");
      }
      const roleRow = await query<Record<string, unknown>>(repository.executor, "SELECT id FROM public.roles WHERE name = $1", [role]);
      await query(repository.executor, "UPDATE public.user_roles SET role_id = $2::bigint, assigned_by_user_id = $3::bigint, assigned_at = now() WHERE user_id = $1::bigint", [targetUserId, roleRow.rows[0].id, actorUserId]);
      await repository.audit({ actorUserId, action: "role_change", entityType: "user", entityId: targetUserId, previousValue: { role: before.role }, newValue: { role }, correlationId });
      const after = await repository.findUserById(targetUserId); if (!after) throw new Error("Updated user could not be loaded."); return safeUserFromAccount(after);
    });
  }

  async resetUserPassword(targetUserId: string, passwordHash: string, actorUserId: string, correlationId: string): Promise<SafeUserRecord> {
    return this.inTransaction(async repository => {
      const before = await repository.findUserById(targetUserId); if (!before) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
      await repository.replacePasswordHash(targetUserId, passwordHash, new Date());
      await repository.revokeAllSessions(targetUserId, "admin_password_reset");
      await repository.audit({ actorUserId, action: "password_reset", entityType: "user", entityId: targetUserId, newValue: { password_changed: true }, correlationId });
      const after = await repository.findUserById(targetUserId); if (!after) throw new Error("Reset user could not be loaded."); return safeUserFromAccount(after);
    });
  }

  async audit(input: AuditInput): Promise<void> {
    await query(this.executor, `INSERT INTO public.audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id) VALUES ($1,$2::bigint,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`, [input.actorUserId ? "user" : "system", input.actorUserId, input.action, input.entityType, input.entityId, input.previousValue === undefined ? null : JSON.stringify(input.previousValue), input.newValue === undefined ? null : JSON.stringify(input.newValue), input.correlationId]);
  }

  async countUsers(): Promise<number> { const result = await query<Record<string, unknown>>(this.executor, "SELECT count(*)::int AS count FROM public.users"); return Number(result.rows[0].count); }
  async cleanupExpiredSessions(now: Date): Promise<number> { const result = await query<Record<string, unknown>>(this.executor, "DELETE FROM public.sessions WHERE expires_at <= $1 OR revoked_at < $1 - interval '1 day' RETURNING id", [now]); return result.rows.length; }
}

interface MemoryUser extends AuthAccountRecord { passwordHash: string; passwordVersion: string; }

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, MemoryUser>();
  private readonly sessions = new Map<string, SessionRecord>();
  readonly audits: AuditInput[] = [];
  private nextId = 1;

  seedUser(input: { id?: string; username: string; normalizedUsername: string; displayName: string; passwordHash: string; role: Role; active?: boolean }): string {
    const id = input.id ?? String(this.nextId++);
    this.users.set(id, { id, username: input.username, normalizedUsername: input.normalizedUsername, displayName: input.displayName, active: input.active ?? true, failedAttemptCount: 0, lockedUntil: null, passwordChangedAt: new Date(), role: input.role, passwordHash: input.passwordHash, passwordVersion: "argon2id-v1" });
    return id;
  }
  async findLoginByNormalizedUsername(normalizedUsername: string): Promise<AuthLoginRecord | null> { const user = [...this.users.values()].find(item => item.normalizedUsername === normalizedUsername); return user ? { account: { ...user }, credential: { userId: user.id, passwordHash: user.passwordHash, passwordVersion: user.passwordVersion, createdAt: new Date(), updatedAt: new Date() } } : null; }
  async findUserById(userId: string): Promise<AuthAccountRecord | null> { const user = this.users.get(userId); return user ? { ...user } : null; }
  async createSession(input: { userId: string; tokenHash: string; createdAt: Date; expiresAt: Date; createdIp?: string | null; userAgent?: string | null }): Promise<SessionRecord> { const session: SessionRecord = { id: String(this.nextId++), userId: input.userId, tokenHash: input.tokenHash, createdAt: input.createdAt, expiresAt: input.expiresAt, lastSeenAt: null, revokedAt: null }; this.sessions.set(session.id, session); return { ...session }; }
  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionLookup | null> { const session = [...this.sessions.values()].find(item => item.tokenHash === tokenHash); const account = session ? this.users.get(session.userId) : undefined; return session && account ? { session: { ...session }, account: { ...account } } : null; }
  async touchSession(sessionId: string, at: Date): Promise<void> { const session = this.sessions.get(sessionId); if (session && !session.revokedAt) session.lastSeenAt = at; }
  async revokeSessionByTokenHash(tokenHash: string, reason: string): Promise<void> { const session = [...this.sessions.values()].find(item => item.tokenHash === tokenHash); if (session) session.revokedAt = new Date(); void reason; }
  async revokeOtherSessions(userId: string, keepSessionId: string | null, reason: string): Promise<void> { for (const session of this.sessions.values()) if (session.userId === userId && session.id !== keepSessionId && !session.revokedAt) session.revokedAt = new Date(); void reason; }
  async revokeAllSessions(userId: string, reason: string): Promise<void> { await this.revokeOtherSessions(userId, null, reason); }
  async recordLoginFailure(userId: string, failedAttemptCount: number, lockedUntil: Date | null): Promise<void> { const user = this.users.get(userId); if (user) { user.failedAttemptCount = failedAttemptCount; user.lockedUntil = lockedUntil; } }
  async resetLoginFailures(userId: string): Promise<void> { const user = this.users.get(userId); if (user) { user.failedAttemptCount = 0; user.lockedUntil = null; } }
  async replacePasswordHash(userId: string, passwordHash: string, changedAt: Date): Promise<void> { const user = this.users.get(userId); if (user) { user.passwordHash = passwordHash; user.passwordChangedAt = changedAt; } }
  async changePassword(userId: string, passwordHash: string, changedAt: Date, keepSessionId: string | null, actorUserId: string, correlationId: string): Promise<void> { await this.replacePasswordHash(userId, passwordHash, changedAt); await this.revokeOtherSessions(userId, keepSessionId, "password_changed"); await this.audit({ actorUserId, action: "password_change", entityType: "user", entityId: userId, correlationId }); }
  async listUsers(): Promise<SafeUserRecord[]> { return [...this.users.values()].sort((a,b) => a.normalizedUsername.localeCompare(b.normalizedUsername)).map(user => ({ ...user })); }
  async createUser(input: CreateUserInput, correlationId: string): Promise<SafeUserRecord> { if ([...this.users.values()].some(user => user.normalizedUsername === input.normalizedUsername)) throw new HttpError(409, "USER_ALREADY_EXISTS", "A user with that username already exists."); const id = this.seedUser({ username: input.username, normalizedUsername: input.normalizedUsername, displayName: input.displayName, passwordHash: input.passwordHash, role: input.role }); await this.audit({ actorUserId: input.actorUserId, action: "user_create", entityType: "user", entityId: id, newValue: { username: input.username, display_name: input.displayName, role: input.role }, correlationId }); return (await this.findUserById(id))!; }
  async setUserActive(targetUserId: string, active: boolean, actorUserId: string, correlationId: string): Promise<SafeUserRecord> { const user = this.users.get(targetUserId); if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found."); if (user.active && user.role === "admin" && !active && [...this.users.values()].filter(item => item.active && item.role === "admin" && item.id !== targetUserId).length === 0) throw new HttpError(409, "LAST_ADMIN", "At least one active admin must remain."); const before = user.active; user.active = active; if (!active) await this.revokeAllSessions(targetUserId, "user_deactivated"); await this.audit({ actorUserId, action: active ? "user_activate" : "user_deactivate", entityType: "user", entityId: targetUserId, previousValue: { active: before }, newValue: { active }, correlationId }); return { ...user }; }
  async setUserRole(targetUserId: string, role: Role, actorUserId: string, correlationId: string): Promise<SafeUserRecord> { const user = this.users.get(targetUserId); if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found."); const before = user.role; if (before === "admin" && role !== "admin" && [...this.users.values()].filter(item => item.active && item.role === "admin" && item.id !== targetUserId).length === 0) throw new HttpError(409, "LAST_ADMIN", "At least one active admin must remain."); user.role = role; await this.audit({ actorUserId, action: "role_change", entityType: "user", entityId: targetUserId, previousValue: { role: before }, newValue: { role }, correlationId }); return { ...user }; }
  async resetUserPassword(targetUserId: string, passwordHash: string, actorUserId: string, correlationId: string): Promise<SafeUserRecord> { const user = this.users.get(targetUserId); if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found."); await this.replacePasswordHash(targetUserId, passwordHash, new Date()); await this.revokeAllSessions(targetUserId, "admin_password_reset"); await this.audit({ actorUserId, action: "password_reset", entityType: "user", entityId: targetUserId, newValue: { password_changed: true }, correlationId }); return { ...user }; }
  async audit(input: AuditInput): Promise<void> { this.audits.push(structuredClone(input)); }
  async countUsers(): Promise<number> { return this.users.size; }
  async cleanupExpiredSessions(now: Date): Promise<number> { let count = 0; for (const [id, session] of this.sessions) if (session.expiresAt <= now || session.revokedAt) { this.sessions.delete(id); count++; } return count; }
}
