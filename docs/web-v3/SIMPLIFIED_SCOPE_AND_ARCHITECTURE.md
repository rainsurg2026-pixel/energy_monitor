# Energy Monitor Simplified Scope and Architecture

**Date:** 2026-08-10  
**Source of truth:** Energy Monitor Desktop v2.3.1.  
**Important:** Google Apps Script is not part of this product. It is only a simplicity reference.

## Required release features

Core user workflow:

1. Secure login and logout.
2. Enter, validate, save, reload, and edit permitted Energy Monitor data.
3. View Desktop-compatible Dashboard and History.
4. Export Excel, CSV, and PDF.

Admin workflow:

1. Add user.
2. Disable and enable user.
3. Delete user safely.
4. Reset user password.

Desktop v2.3.1 remains the source of truth for layout, calculations, dashboard KPIs/charts/filters, data-entry behavior, history, number/date formatting, and report layout. No redesign is authorized.

## Current implementation audit

- Browser uses the custom `/api/v1` server API. It does not access PostgreSQL directly and does not contain a Supabase client or service-role key.
- `server/runtime.ts` creates one server-side PostgreSQL pool, custom Auth service, RBAC, rate-limit store, domain repository, and report service.
- `server/db/pool.ts` verifies a hosted runtime connection uses Transaction Pooler port `6543` and a member of `energy_monitor_runtime` with `BYPASSRLS` disabled.
- Existing RLS policies and grants target `energy_monitor_runtime`; client-role Data API access is not currently configured.
- Monthly data saves and admin changes use parameterized SQL, optimistic row versions, transactions, row locks, session revocation, and audit events.
- Excel report export already exists through the shared Desktop-compatible workbook builder.
- CSV builders already exist in `src/utils/exportData.ts`; the Web Reporting Center now exposes CSV and the focused export contract test passes.
- Admin create/disable/enable/password-reset already exist. Admin delete-user is now implemented in the API, repository, and UI with transactional safety checks.

### Direct database audit

- Six server files reference `pg`/pool primitives: runtime pool/repository/auth repository plus migration/import tooling. Only the runtime pool and repositories are on the hosted request path; migration/import references are not browser code.
- Seven files mention `DATABASE_URL`, including tests and migration tooling. The hosted request path consumes it only through `server/config/env.ts` and `server/db/pool.ts`.
- Four active Web files use the server API client. No Web source file references `pg`, `DATABASE_URL`, Supabase client SDK, or a service-role key.
- Normal data reads/writes require the existing server repository because live RLS policies/grants target `energy_monitor_runtime`, not `anon`/`authenticated` Data API roles. Replacing this with Supabase Auth/Data API/RPC would require an authorization and policy migration and is not a safe scope simplification.

## Remove from active Web scope / defer

These features are outside the intentionally small release workflow and create meaningful deployment or maintenance cost:

- Google Sheets Sync and Google OAuth.
- Workbook upload/import and complex workbook migration.
- Excel round-trip/source-workbook reconstruction and macro/VBA/pivot preservation.
- Workbook source retention, backup/restore UI, and workbook-package inspection.
- Source workbook download.
- PNG, ZIP, HTML, and PowerPoint report export. Keep only Excel, CSV, and PDF in the active Web UI.
- Rack-unit image upload and object-storage integration. Keep existing rack data/dashboard fields needed for Desktop parity; image storage remains deferred.

Deferral means the existing database tables and isolated source modules are not dropped or migrated. They are removed from the active Web route/runtime composition so they cannot block core deployment. Re-activation requires a separate scope decision and tests.

Keep audit-event persistence for security and operational traceability. The optional audit-history screen may remain available to administrators but is not required for the core acceptance workflow.

## Required architecture

```text
Browser
  -> Vercel Web/API
  -> Supabase PostgreSQL
```

Rules:

- Browser never connects to PostgreSQL.
- Server API owns authentication, authorization, validation, calculations, transaction boundaries, and response shaping.
- Keep local secure session handling for this release: Argon2id credentials, HttpOnly/SameSite cookies, CSRF protection, lockout, revocation, and RBAC.
- Keep PostgreSQL RLS and least-privilege grants. Do not use `postgres` or a `BYPASSRLS` runtime identity.
- Keep one dedicated non-bypass runtime login role as a member of `energy_monitor_runtime`; do not create `energy_monitor_preview` unless a future deployment design proves it necessary.
- Keep Supabase Transaction Pooler `6543` and CA verification while the server repository uses `pg`. Removing them now would require a new server-side Supabase API/RPC design and new policies, not a simple configuration cleanup.
- `SUPABASE_SERVICE_ROLE_KEY`, Supabase Storage buckets, and object-storage code are not required by the reduced active workflow after image/source-workbook routes are deferred. Keep any remaining service key out of the frontend and remove it from the active Preview contract.
- Keep `DIRECT_DATABASE_URL` migration-only; never use it as the hosted runtime connection.

## Data model decision

Keep the existing Supabase database and migrations. Do not recreate or redesign the schema. The current model already supports sites/facilities, meter/configuration data, monthly records, rack data, users, roles, sessions, and audit events. Existing optional tables remain for compatibility and future migration; no data migration is needed for this scope reduction.

## Migration risk

**Low to medium for route/runtime deferral; high for changing the database/Auth architecture.**

Low-risk changes:

- Remove non-core routes and navigation from active Web composition.
- Stop constructing Google/OAuth, workbook-import, workbook-retention, backup, integrity-upload, and Storage services in the hosted runtime.
- Remove non-core environment requirements from the hosted runtime contract.
- Add CSV export using the existing shared CSV builder.
- Add transactional admin delete with last-admin protection and session revocation.

High-risk changes not included:

- Replacing direct server PostgreSQL with Supabase Data API/RPC.
- Migrating local users/sessions to Supabase Auth.
- Rewriting RLS around `auth.uid()`.
- Dropping existing tables or migrating production data.

## Current blockers

1. Preview runtime configuration is invalid: current deployed health is public, but readiness, session, and authenticated data routes return `503` for configuration.
2. A dedicated non-bypass login role for the hosted pooler connection must be provisioned and authorized; `energy_monitor_runtime` is a `NOLOGIN` group role.
3. Preview requires an approved admin/UAT account and populated test data before acceptance testing.
4. The local core implementation gaps (CSV UI exposure and Admin Delete User) are now implemented and covered by focused tests. They still require authenticated Preview UAT.
5. The linked Vercel CLI session cannot perform deployment/configuration: the installed Vercel entrypoint rejects the stored session with `The specified token is not valid. Use vercel login to generate a new token.` The PowerShell wrapper separately fails with `The value of "err" is out of range`.
6. No Supabase CLI is installed in this environment, so the required dedicated non-bypass database login role and verified CA/connection values cannot be provisioned or retrieved here.

## Local implementation status

- Active Web composition now exposes authenticated data entry, Dashboard, History, numeric rack views, Site Comparison, PDF/Excel/CSV reporting, settings, and user administration.
- Google Sheets, workbook lifecycle, source-workbook download, backup/restore, and rack-image routes are no longer composed by the hosted runtime or active Web navigation.
- Existing database migrations, tables, RLS, and deferred service modules remain untouched for compatibility; no data migration was performed.
- Admin deletion is transactional, blocks self-deletion and last-active-admin removal, revokes sessions, and records a safe audit event before deleting the user.
- Preview deployment remains blocked by invalid runtime configuration and the missing authorized dedicated non-bypass pooler login role.

## Acceptance boundary

Production is not ready until a real Preview user can complete login, data entry, save/reload, Dashboard, History, Excel, CSV, PDF, logout, and login again with the saved data. An administrator must also complete add, disable, enable, delete, and password-reset flows. Every security, data-integrity, visual-parity, Preview, Production, smoke, and rollback gate remains required.
