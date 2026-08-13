# Energy Monitor Web v3 Authentication Core

This document describes the Phase 3 Agent 1 authentication-core boundary. It
does not add HTTP routes, RBAC, Supabase Auth, Entra/OIDC flows, database
migrations, cookies, CSRF, or rate limiting. Those concerns belong to the
integration agents and must call these primitives rather than reimplementing
them in controllers.

## Authentication model

Phase 3 uses local username/password authentication. The application user ID
is the stable business identity. It must not be derived from an email address,
username, Supabase Auth ID, or future Entra object ID.

`server/auth/types.ts` defines the provider-neutral `AuthIdentity` mapping:

```text
users.id <- auth_identities.user_id
auth_identities(provider, provider_tenant, provider_subject) -> users.id
```

The supported conceptual providers are `local` and `entra`. Only `local` is
active in this phase. A future Entra implementation can resolve the Entra
`oid`/`sub` plus tenant to an existing `users.id` without changing business
records or role assignments. No OAuth/OIDC or Supabase Auth code is present.

## Username and password policy

Username normalization is server-side and must be used before lookup and before
database uniqueness checks:

1. Apply Unicode NFKC normalization.
2. Trim leading and trailing whitespace.
3. Convert using the stable `en-US` lower-case locale.
4. Reject blank values, control characters, and values over 128 Unicode code
   points.

The default password policy is intentionally compatible with password-manager
generated values:

- minimum 12 Unicode code points;
- maximum 1,024 Unicode code points;
- reject blank or whitespace-only passwords;
- no arbitrary composition rule for symbols, case, or digits.

Password values are not trimmed or logged. Policy validation is for password
creation/change; login verification must still perform credential verification
for an invalid submitted value so that the public response remains generic.

## Argon2id credentials

`Argon2idPasswordHasher` uses the `argon2` package with these defaults:

- algorithm: Argon2id;
- memory cost: 64 MiB;
- time cost: 3;
- parallelism: 1;
- derived key length: 32 bytes;
- random salt length: 16 bytes.

The encoded PHC string is the only password credential value that should be
stored. `ARGON2ID_PASSWORD_VERSION` is `argon2id-v1`. Plaintext passwords,
password hashes, and reset secrets must never appear in logs, audit payloads,
normal DTOs, or client responses.

`hashNewPassword` applies the policy before hashing. `CredentialVerifier`
accepts a startup-created Argon2id dummy hash and verifies unknown/malformed
credentials against it. This reduces username-enumeration timing differences;
the login service must still return the same `INVALID_CREDENTIALS` response for
missing, inactive, and wrong-password accounts. An already locked account is
rejected before password verification with the explicit temporary-lock status
required by the HTTP contract (`423 ACCOUNT_LOCKED`).

The dummy hash is not a user credential and must remain in process memory. It
must be created with the same Argon2id parameters during server startup and
must not be printed or committed.

## Server-side sessions

`generateSessionToken()` creates 32 cryptographically random bytes encoded as
base64url. `hashSessionToken()` returns a SHA-256 hexadecimal digest. Store
only that digest in PostgreSQL; return the raw token only to the HTTP layer so
it can place it in an HttpOnly cookie. Do not put it in localStorage, a JWT, a
URL, an audit record, or a log. `sessionTokenHashesEqual()` is available for
constant-time comparison when a direct comparison is required.

The default absolute session lifetime is 8 hours. Idle expiry is optional and
disabled by default in this core; if enabled, `checkSession()` enforces it
without extending the absolute expiry. A session is unusable when its stored
expiry has passed or it has any revocation timestamp. `revokeSession()` is
idempotent, and `touchSession()` never extends the absolute expiry.

The later repository/migration layer should persist a record equivalent to:

```text
sessions(id, user_id, token_hash, created_at, expires_at,
         last_seen_at, revoked_at)
```

The login path must always create fresh session material after successful
authentication; it must never reuse a pre-authentication identifier. Logout
must revoke the server row as well as clear the cookie. Password changes and
administrative security events should rotate/revoke sessions according to the
policy chosen by the integration layer.

## Generic failure and lockout decisions

`decideLogin()` provides account-local state transitions with these defaults:

- five failed attempts;
- a 15-minute temporary lockout;
- successful login resets the failure count and lockout state;
- a locked account remains rejected until the lockout expires;
- missing and inactive accounts do not create account-state mutations.

Unknown, inactive, and wrong-password attempts use `401 INVALID_CREDENTIALS`
with the message `Invalid username or password.`. An account that is already
locked returns `423 ACCOUNT_LOCKED`; this is the only deliberate lock-state
distinction in the public contract. Per-IP rate limiting is implemented by the
HTTP/security layer as 30 attempts per 15 minutes using a PostgreSQL-backed
store for production (the in-memory store is test/development-only).

## Integration contract and security boundary

The next agents must:

- load the normalized username from server-side parsing, never from a trusted
  frontend-normalized value;
- keep credential fields out of user DTOs;
- use the returned `AuthUserId` as the authenticated actor identity for audit;
- enforce roles and `READ_ONLY_MODE` in the server/service layer;
- use HttpOnly, Secure-in-production, appropriately SameSite cookies;
- add CSRF and explicit-origin checks for cookie-authenticated mutations;
- keep all database access server-side and use least-privilege PostgreSQL
  connections;
- add migrations and repository implementations without changing this core's
  provider-neutral identity model.

The core intentionally contains no Supabase client, Supabase Auth dependency,
RLS policy, database query, HTTP response, cookie operation, or secret
configuration.

## Development accounts and integrated authorization

The one-time `auth:bootstrap-dev-accounts` command can create the development
accounts `admin` (`admin` role) and `usertest` (`user` role). It is disabled in
production, requires `DEV_ACCOUNT_BOOTSTRAP=true`, and reads both passwords
only from the local process environment. It never prints or persists them.

The command uses the migration/admin database path, hashes passwords with
Argon2id, creates accounts as active, and refuses to modify an existing
account with an unexpected role or inactive status. Existing accounts and
passwords are never overwritten. Its shorter development-only password
policy is available only behind the explicit non-production bootstrap gate;
normal API account creation and password reset retain the 12-character policy.

Example PowerShell flow (enter secrets locally; do not put them in source or
chat):

```powershell
$env:DEV_ACCOUNT_BOOTSTRAP = "true"
$env:DEV_ADMIN_PASSWORD = "<local secret>"
$env:DEV_USER_PASSWORD = "<local secret>"
npm run auth:bootstrap-dev-accounts
```

The API must still be configured with the appropriate server-side database
environment. Live Supabase verification is a separate deployment gate.

## Phase 3.5 and Phase 5 gates

Local parity and Web read-path work are covered by the repository regression
suites. The following remain explicit pre-production gates until a secure live
database URL is injected into the local process:

- `LIVE_AUTH_SUPABASE_VERIFICATION_PENDING`
- `DEVELOPMENT_ACCOUNTS_LIVE_SEED_PENDING`
- `LIVE_PHASE4_IMPORT_PENDING`

Only active administrators can access `/settings/users` and the admin user
management API. Active users receive `403` for that route/API. Deactivation
and password reset revoke sessions, audit events omit credential material, and
the last active administrator cannot be deactivated or demoted.

## Architecture decision: alignment with the `mqr-webapp-new` reference

The web migration's standing instructions name `D:\Project\mqr-webapp-new` as
the authentication architecture reference: reuse its design, RBAC model,
session lifecycle, authorization rules, and security patterns, replacing
only framework-specific implementation where the target stack genuinely
requires it. This section records what was ported as-is, what was ported as
a pattern (same design, different framework-native mechanism), and the one
piece of the reference architecture with no analog in this app's business
domain to attach to.

**Session lifecycle — ported.** Sessions are now signed JWTs (`jose`,
HS256), matching mqr's `lib/auth.ts`/`middleware.ts` hybrid model exactly:
the JWT is never trusted as sole authority. It wraps the same opaque session
secret this app already hashed and stored in `public.sessions.token_hash`
(`server/auth/sessionJwt.ts`, `server/auth/authService.ts`), so the
pre-existing DB-backed revocation check — the real authority, exactly as in
mqr's `user_sessions` design — still runs on every request. The JWT adds a
fast, stateless signature/expiry check ahead of that lookup and
self-describes `userId`/`role`, the way mqr's `SessionUser` claims do. The
signing secret is `SESSION_SECRET` — already present in `server/config/env.ts`
(32-byte minimum, enforced), previously defined but unwired until now.
Session revocation itself (`revokeSessionByTokenHash`, `revokeOtherSessions`,
`revokeAllSessions`, `cleanupExpiredSessions` in `server/auth/repository.ts`)
already had full parity with mqr's `sessionService.ts` lifecycle before this
change; only the token *format* changed.

**RBAC model — ported as a pattern.** `server/authz/scope.ts` adds named,
documented capability predicates (`canManageGlobalSettings`, `canListUsers`,
`canCreateUsers`, `canAssignRoles`, `canResetPasswords`, etc.), mirroring the
call-site ergonomics of mqr's `lib/scope.ts` (`canManageUsers`, `canDelete`,
`canExport`, ...). Each predicate wraps the existing `PERMISSIONS`/
`ROLE_PERMISSIONS` table in `permissions.ts` rather than duplicating role
logic — that table remains the single source of truth, now exposed through
the same named-boundary style mqr uses. `authService.ts`'s user-management
methods call these predicates via the new `requireScope()` primitive
(`server/authz/policies.ts`) instead of raw permission-string checks.

**Security patterns — ported where they add something, kept where the
existing primitive is already the stronger choice.** HttpOnly cookies,
double-submit CSRF, and centralized `server/authz` route gating already
matched mqr's design in shape before this change. Argon2id password hashing
is kept rather than switched to mqr's scrypt: it is a strictly stronger,
already-verified primitive (Phase 3 test plan), and swapping it would
invalidate every stored credential for zero security gain — not a framework
constraint, a deliberate exception to a mechanical port that would make the
system worse for no reason.

**Not ported — no framework gap, a business-domain gap.** mqr's
`authorization.ts` enforces per-record ownership across a 4-tier
dealer/branch tenancy hierarchy (`SuperAdmin`/`CentralAdmin`/`DealerAdmin`/
`DealerUser`, `dealerId`/`branchId` scoping). Energy Monitor has two roles
(`admin`/`user`) and, by explicit documented design, no per-record ownership
at all — `docs/rbac.md`: "Operational data is shared across authorized
users. There is no per-user ownership rule." This is not a Next.js-vs-Express
difference; mqr's tenancy predicates are written against a business concept
(dealers and branches) this app's domain does not have. Fabricating dealer/
branch-shaped scoping here would be new, unrequested business logic, not a
port of an existing rule. If a real per-site tenancy requirement ever
emerges, it is new design work against Energy Monitor's own facility model,
using `scope.ts`'s established pattern — not a copy of mqr's dealer/branch
fields.

**Verification.** All of the above is covered by `server/auth/sessionJwt.test.ts`
(JWT round-trip, wrong-secret rejection, expiry rejection) and the extended
`server/authz/authz.test.ts` (every `scope.ts` predicate checked against both
roles, `requireScope`'s authenticate-then-check-then-throw behavior), on top
of the pre-existing Phase 3 suite (`npm run test:phase3`, `test:phase35`,
`test:phase6`) — all passing after this change. Independently verified
against this repo's own Phase 3 security review (`docs/phase3-test-plan.md`):
all Critical and High findings (auth boundary wired, RLS-as-defense-in-depth
with `energy_monitor_runtime` role grants, CORS allowlisting, audit actor
identity, rate limiting, live integration coverage) remain resolved after
this change.
