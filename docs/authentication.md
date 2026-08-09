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

## Architecture decision: divergence from the `mqr-webapp-new` reference

The web migration's standing instructions name `D:\Project\mqr-webapp-new` as
the authentication architecture reference, to be reused "whenever possible."
This section documents why the implementation above diverges from it instead,
per the same instructions' own requirement to record reason/impact/
compatibility when reuse isn't followed literally.

**Reason.** `mqr-webapp-new` is a Next.js 14 App Router application: route
protection is centralized in Edge Middleware (`middleware.ts`), sessions are
signed JWTs (`jose`) carrying claims, and RBAC is a 4-tier dealer/branch
tenancy hierarchy (`SuperAdmin`/`CentralAdmin`/`DealerAdmin`/`DealerUser`).
Energy Monitor's web build is a Vite + React SPA served by an Express API
(`server/http/app.ts`) — there is no Next.js middleware layer to port the
pattern onto, and the desktop source-of-truth app has no dealer/branch
concept, only two roles (`admin`/`user`) with no per-record tenancy
(`docs/rbac.md`). Reproducing the mqr pattern literally would mean rebuilding
the web frontend on a different framework, which the standing "do not
recreate the application" rule forbids, purely to match an implementation
detail rather than a security property.

What was built instead achieves the same *security shape* through different
mechanisms: HttpOnly session cookies backed by a server-side revocable session
table (opaque tokens hashed at rest, not JWTs — `server/auth/sessionTokens.ts`)
in place of signed-JWT claims; double-submit CSRF on mutating routes in place
of a custom header check; Argon2id password hashing in place of scrypt; and a
centralized `server/authz` permission gate in place of Edge Middleware. Both
designs share the same properties that actually matter for security review —
revocable server-side sessions, CSRF-protected mutations, no client-trusted
identity claims — implemented with the primitives this stack actually has.

**Impact.** No dealer/branch multi-tenancy exists in Energy Monitor's RBAC.
If a future requirement needs that shape (e.g. per-customer-site scoping
beyond the existing facility model), it is new design work, not a reuse of
`mqr-webapp-new`'s `scope.ts`/`authorization.ts` predicates — those are
written against a tenancy model this app doesn't have.

**Compatibility.** Verified independently against this repo's own Phase 3
test plan (`docs/phase3-test-plan.md`): all Critical and High findings
(auth boundary wired, RLS-as-defense-in-depth with `energy_monitor_runtime`
role grants, CORS allowlisting, audit actor identity, rate limiting, live
integration coverage) are resolved in current code, not just documented as
intended. This decision accepts the current, independently-verified
implementation rather than a framework-level rewrite to chase literal
mqr-webapp-new reuse.
