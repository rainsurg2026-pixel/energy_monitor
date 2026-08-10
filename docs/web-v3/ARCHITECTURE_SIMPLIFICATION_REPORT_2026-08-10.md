# Energy Monitor Web Architecture Simplification Report

**Date:** 2026-08-10  
**Scope:** Energy Monitor v2.3.1 Desktop parity, current Web v3 branch, and authenticated Preview Supabase project `dnnufamiwxapqibdhwyj`.

## Decision

Do not replace the current server-side repository/authentication path with direct browser Supabase Data API access in this release.

That migration is not a safe simplification of the existing application. It would require a new Supabase Auth identity model, new grants and `auth.uid()`-based RLS policies, RPC/Edge Functions for atomic writes, storage object policies, and a complete regression/UAT cycle. It would also risk Desktop behavior and existing production data.

The simplest safe release architecture is:

```text
Browser
  -> Vercel Web API
  -> Supabase PostgreSQL and private Storage
```

The Vercel API remains the policy and transaction boundary. Supabase remains the database and object-storage platform. No data migration or remote schema mutation was performed for this decision.

## Current architecture

- The browser calls the custom `/api/v1` API. It does not use `@supabase/supabase-js` or a Supabase client.
- `server/runtime.ts` composes one PostgreSQL pool, `PostgresRepository`, `PostgresAuthRepository`, rate-limit store, report services, workbook services, and private Storage adapters.
- `server/db/pool.ts` uses Supabase Transaction Pooler port `6543`, validates the runtime database identity, and requires a non-bypass-RLS role.
- `server/auth/authService.ts` implements local Argon2id credentials, signed sessions, revocation, lockout, CSRF support, and RBAC through application tables.
- `server/db/postgresRepository.ts` preserves Desktop data behavior, including multi-table writes, optimistic row versions, `RETURNING`, conflict handling, and transactions.
- Reports and Excel/CSV/PDF artifacts reuse Desktop/shared calculation and rendering code. Chromium is required for server PDF/PNG artifacts.
- `server/storage/objectStorage.ts` uses the Supabase Storage HTTP API with the service-role key only on the server. Buckets remain private.
- Google Sheets is a Desktop feature present in the current web settings surface; it is not part of the minimum core workflow, but removing it would reduce parity and needs an explicit product scope decision.

## Direct PostgreSQL audit

- `DATABASE_URL` or the CA certificate is referenced by 8 files, including configuration, tests, and operational scripts.
- `pg` is used by 6 server files, covering pool creation, the business repository, authentication repository, migration, importer, and runtime composition.
- Runtime pool creation has one composition point: `server/runtime.ts` calls `createPool()`.
- The business repository is 581 lines and implements the 29-operation repository contract. It contains parameterized SQL and transaction-backed writes.
- The authentication repository is 390 lines and contains session, lockout, password, user-admin, audit, row-lock, and transaction behavior.
- The API exposes 51 route declarations. Replacing the data path therefore affects the complete authenticated surface, not one isolated query.
- No application code currently imports Supabase JS or calls the Supabase Data API for normal data.

## Live Supabase security evidence

Read-only inspection of Preview returned:

- 40 public tables; all 40 have RLS enabled.
- 38 public policies; all 38 target `energy_monitor_runtime`.
- 0 policies target `authenticated`; 0 target `anon`; 0 use `auth.uid()`.
- 36 public tables grant `SELECT/INSERT/UPDATE/DELETE` to `energy_monitor_runtime`; no client-role grants were found.
- `energy_monitor_runtime` exists and has `rolbypassrls = false`.
- `auth.users` exists, but the application also owns `public.users` and `public.sessions`.
- `storage.objects` has 0 policies in the inspected project metadata.

Migration `002_phase3_auth_security.sql` explicitly defines local application authentication and a server-only PostgreSQL role. It revokes client-role access and does not model Supabase Auth identities. Therefore current RLS and grants do not support a browser Supabase client.

Supabase documents the same security separation: normal client access requires Data API grants plus RLS, while service-role/secret keys bypass RLS and must remain server-only. See [Supabase secure data](https://supabase.com/docs/guides/database/secure-data) and [Supabase Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-api-automatically).

## What can move to Supabase client/API

Simple read paths such as sites, periods, settings, and dashboard data could technically use the Data API after an Auth/RLS redesign. They cannot be switched safely by changing imports because the current API also applies permission checks, validation, scope, calculations, and response shaping.

The following operations must remain server-side for the current release:

- Local login, Argon2id verification, lockout, session lookup/touch/revocation, password changes, RBAC, and audit events.
- Monthly log, rack, settings, and workbook-import writes that require atomic multi-table transactions, row-version checks, row locks, or invariant enforcement.
- Privileged user administration and migration/import tooling.
- Google OAuth token exchange and encrypted refresh-token persistence.
- Private workbook and rack-image access through server-side Storage adapters.
- PDF/PNG rendering and binary workbook/report generation.

Using the service-role key for normal browser data access would bypass RLS and violate the security requirement. Exposing raw tables would also bypass the current API’s permission and validation boundary.

## Removal assessment

| Item | Remove now? | Finding |
|---|---:|---|
| `energy_monitor_preview` | Already absent | No role exists to remove. |
| `energy_monitor_runtime` | No | Current RLS/grants and runtime identity depend on it; it is NOBYPASSRLS. |
| `DATABASE_URL` | No | Required by current repository, auth, rate limiting, and atomic writes. |
| `SUPABASE_DB_CA_CERT` | No | Required for verified TLS to the hosted PostgreSQL connection. |
| Transaction Pooler `6543` | No | Appropriate for Vercel/serverless pool connections. |
| Custom DB runtime authentication | No | Current Auth/session/RBAC model is PostgreSQL-backed. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Required only for trusted server-side private Storage operations. |
| Google Sheets | Not in this release | Present in Desktop and current Web settings; removal needs an explicit parity/scope decision. |

`DIRECT_DATABASE_URL` is migration/admin-only and should remain absent from Vercel runtime environments. It may remain in controlled local/operator configuration for migrations and imports.

## Migration risk

**High and breaking for this release.** A Supabase Auth/Data API cutover would require, at minimum:

1. Mapping bigint `public.users` identities to UUID `auth.users` identities without breaking audit, role, or ownership references.
2. Replacing local credential, session, lockout, password-reset, and revocation behavior with Supabase Auth equivalents or new server logic.
3. Granting only required tables to `authenticated` and designing explicit `auth.uid()`/role policies for all read/write paths.
4. Adding safe server-side RPC or Edge Functions for every cross-table atomic workflow.
5. Adding Storage RLS policies for private objects and proving object ownership/access boundaries.
6. Re-running Desktop parity, calculation, export, integrity, multi-user concurrency, security, browser, Preview UAT, and rollback gates.

This is a separate architecture migration. Combining it with the production parity launch would increase failure surface and conflict with the requirement to avoid unnecessary data migration.

## Recommended production architecture

For the v2.3.1 parity release, retain:

- Vercel-hosted web UI and server API.
- Supabase PostgreSQL through Transaction Pooler `6543`.
- Dedicated `energy_monitor_runtime` with `BYPASSRLS` disabled.
- Server-only `DATABASE_URL`, `SUPABASE_DB_CA_CERT`, `SESSION_SECRET`, and `CSRF_SECRET`.
- Server-only Preview/Production-specific Supabase service-role keys, used only by privileged Storage paths.
- Existing RLS, grants, validation, repository transactions, shared calculations, Excel/CSV/PDF paths, and private buckets.

Future simplification may be pursued as a separately gated migration: Supabase Auth first, then a read-only Data API pilot, then narrowly scoped RLS/RPC cutovers with rollback. No current release code change is justified by the audit.

## Release status

Local verification completed in this audit:

- `npm.cmd run lint`
- `npm.cmd run vercel-build`
- `npm.cmd run test:phase3`, `test:phase35`, `test:phase6`, and `test:vercel-adapter`
- Web reporting, PDF/PNG/ZIP, workbook import/export/round-trip/integrity, history/rack edit, section-save, Google Sheets security, domain-parity, Excel, and Dashboard-FAC tests
- `npm.cmd audit --audit-level=high` — 0 vulnerabilities
- Browser-bundle scan — no service-role, database, session, or CSRF secret matches

Preview remains unhealthy: `/api/v1/health` returns `200`, while `/api/v1/readiness`, `/api/v1/auth/session`, and `/api/v1/dashboard` return `503` with `SERVICE_UNAVAILABLE` / `reason: configuration`. No secret was printed, generated secret was committed, or Production setting was changed during this audit. Production deployment and acceptance testing remain blocked until owner-managed Preview configuration is corrected.
