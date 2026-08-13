# Energy Monitor Web v3 Supabase security model

This document describes the Phase 3 Agent 3 database-security boundary. It is
limited to schema, RLS, and PostgreSQL privileges. It does not implement the
HTTP authentication middleware, RBAC service, CSRF protection, or Vercel
deployment code.

## Architecture boundary

The intended path is:

```text
Browser -> Energy Monitor API -> PostgreSQL on Supabase
```

The browser must not use `supabase-js`, a Supabase publishable/anon key, or a
service-role key to read or write Energy Monitor tables. Local
username/password authentication belongs to the application API, not Supabase
Auth. API RBAC is the authoritative `admin`/`user` decision; PostgreSQL RLS is
defense in depth.

The Phase 2 schema currently has 28 public tables. Migration
`002_phase3_auth_security.sql` enables RLS on all 28, on six new
authentication tables:

- `users`
- `local_credentials`
- `auth_identities`
- `roles`
- `user_roles`
- `sessions`

It also adds nullable `audit_events.actor_user_id` so existing `system` audit
rows remain valid while authenticated API mutations can reference the stable
application user identity.

## Authentication data model

### `users`

`users.id` is the stable business identity. It is not an email address,
username string, Supabase Auth UUID, or future Entra object ID.

The stored username is display-preserving. `normalized_username` is required to
be lower-case, trimmed, and unique. The API must apply Unicode NFKC,
trim, and lower-case normalization before writing or looking up a username; the
database check and unique constraint prevent an inconsistent normalized value
from being stored. The database is the final enforcement point, not the UI.

`active`, `failed_attempt_count`, `locked_until`, `password_changed_at`,
`row_version`, and UTC timestamps support lockout, account disablement,
password lifecycle, and safe concurrent updates. The API must re-check
`active` when validating every session.

### `local_credentials`

There is at most one local credential row per user. `password_hash` must begin
with the Argon2id encoding `$argon2id$`; plaintext passwords, password reset
secrets, and password hashes must never be logged or returned in normal DTOs.
The Argon2id parameters are an application responsibility and must be selected
for the Node.js production workload. This migration stores no default password.

### `auth_identities`

The identity mapping is unique on (`provider`, `provider_tenant`,
`provider_subject`) and points to `users.id`.

- `local` is reserved for local-provider identity mappings; local password
  authentication may resolve through `users` + `local_credentials` directly.
- `entra` is reserved for a future Microsoft Entra/OIDC integration. Store the
  Entra `oid` as `provider_subject` and tenant `tid` as `provider_tenant`, then
  map to an existing `users.id`.

Adding Entra later therefore changes the login adapter and identity rows, not
business foreign keys, roles, audit ownership, or operational data.

### `roles`, `user_roles`

Only normalized role names `admin` and `user` are accepted in v3.0.0 and the
migration seeds those two role rows without creating a user. `user_roles` has
one effective role row per user for this phase. Role assignment is still an
API authorization decision and must be performed transactionally with a real
authenticated actor; `assigned_by_user_id` is nullable only for the initial
bootstrap path.

### `sessions`

The API generates a cryptographically random session token, sends it only in a
secure HttpOnly cookie, and stores only its SHA-256 lowercase hexadecimal hash
in `sessions.token_hash`. The unique constraint and shape check reject a raw
token or a different unreviewed hash format. `expires_at` is an absolute
expiry; `revoked_at` is checked on every authenticated request. `last_seen_at`,
coarse `created_ip`, and bounded `user_agent` metadata support operations
without storing the cookie value.

Logout, deactivation, password change, and administrative reset must revoke
the applicable session rows. Session creation must always produce a fresh
session identifier after login; no pre-authentication identifier is reused.

## RLS and direct-role exposure

The migration revokes table and schema privileges from `PUBLIC`, `anon`,
`authenticated`, and `service_role` where those roles exist. It creates no
policies for those roles. This is intentional: the exposed public schema is not
a browser data API for this application.

The migration creates only this PostgreSQL group role:

```text
energy_monitor_runtime
NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS
```

The role has explicit DML grants only for normal application tables, auth
tables, audit append/read, and provenance append/read. It has no `TRUNCATE`,
`REFERENCES`, `TRIGGER`, DDL, or migration-metadata access. Runtime grants do
not include `schema_migrations`, `legacy_cached_evidence`,
`migration_batches`, or `migration_errors`.

RLS policies targeted to `energy_monitor_runtime` remain as defense in depth.
Their predicates require PostgreSQL membership in `energy_monitor_runtime`; they
are not unconditional `USING (true)`/`WITH CHECK (true)` policies and cannot be
used by a browser role after the revokes.

This is a deliberate trust boundary: the API runtime may access shared
operational data, but it must enforce session authentication, `admin`/`user`
RBAC, `READ_ONLY_MODE`, Global Settings/Display Period authorization, safe
input handling, and actor attribution. RLS cannot call `auth.uid()` for these
local application sessions and must not be treated as a substitute for API
authorization. The supported Supabase-managed `postgres` connection used by
the small internal Vercel deployment has `BYPASSRLS`; therefore the API/service
layer is the primary authorization boundary. Browser roles still have no table
grants and cannot directly access application tables.

Tables without a runtime grant or runtime policy remain migration/admin-only.
RLS is enabled on every Phase 2 table, including the migration metadata table.
The separate migration/admin connection can record `schema_migrations`; the
Vercel runtime never runs migrations on startup.

## Role provisioning and connection separation

No login role password is present in tracked SQL or documentation.

1. Apply migrations and controlled bootstrap/import operations with an
   operator-only database connection. A direct admin URL is optional; the
   server-only managed `DATABASE_URL` is an approved development fallback when
   used with the verified Supabase CA. Keep either credential unavailable to
   browser/build variables.
2. Give Vercel only the server-side `DATABASE_URL` generated from the
   Supabase-managed PostgreSQL connection identity. Never expose it to browser
   code or use a Supabase service-role key in the frontend.
3. For Vercel/serverless runtime, use the Supabase Shared transaction pooler (port
   6543) with a small pool appropriate to the function lifecycle. Use the
   direct database connection (port 5432) for migrations or persistent admin
   operations. Current `pg` queries use text plus values and no named prepared
   statements, which is compatible with transaction pooling.

The server keeps this separation operationally: the API process uses only
`DATABASE_URL` and does not run migrations on web startup. `npm run db:migrate`
and `npm run auth:bootstrap-admin` are separate operator commands using
`DIRECT_DATABASE_URL`; both URLs remain server-side and must never be exposed
to browser/build variables.

## Audit actor integration

`audit_events.actor_user_id` is a nullable FK to `users.id` with `ON DELETE SET
NULL`. Null remains valid for legacy `system`/import events. New authenticated
operations must derive the actor from the validated server session, never from
`actor_user_id` in a request body. Relevant data mutation and audit insertion
must remain in the same transaction. Audit JSON may contain before/after
business values, but never passwords, password hashes, raw session tokens,
cookies, CSRF secrets, or database credentials.

## Operational authorization matrix

The database role is shared by API requests; it does not distinguish an
application admin from an application user. The API must enforce this matrix:

| Operation | `user` | `admin` |
|---|---:|---:|
| Read shared operational data and effective Display Period | yes | yes |
| Create/edit shared operational data | yes, unless read-only | yes, unless read-only |
| Read own safe session information | yes | yes |
| Manage users, activation, roles, password reset | no | yes |
| Mutate Global Settings/Display Period | no | yes |
| View administrative audit history | no | yes |
| Migration metadata / database restore / DDL | no | no; migration admin only |

`READ_ONLY_MODE` remains authoritative even for admins. Login, logout, session
validation, and safe reads may remain available according to the API policy;
operational and administrative mutations must be rejected according to the
Phase 3 HTTP contract.

## Verification expectations

Before applying this migration to a shared environment, verify from the clean
Phase 2 schema that:

- 35 application tables have RLS enabled, with no direct `anon`,
  `authenticated`, or browser service-role table access;
- only the dedicated runtime login can perform the explicitly granted backend
  operations;
- a runtime login cannot read/write migration metadata or perform DDL;
- user, credential, identity, role, user-role, session, and audit FKs reject
  orphaned rows;
- duplicate normalized usernames, identity subjects, token hashes, and role
  assignments are rejected;
- a rollback removes both a business mutation and its audit row;
- API tests, not direct browser SQL, verify the local-auth/RBAC boundary.

This migration is schema-only. It does not create an initial admin, connect to
Supabase Auth, configure OAuth/Entra, change the HTTP server, or commit any
credential.
