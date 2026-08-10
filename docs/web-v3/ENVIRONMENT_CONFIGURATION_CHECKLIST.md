# Simplified Web Runtime Configuration Checklist

Date: 2026-08-10
Scope: Vercel Preview first; Production is not changed during Preview repair.

Never place secret values in chat, source control, browser code, or logs.

## Required runtime variables

The reduced Web application requires only these application secrets/configuration values:

| Variable | Requirement | Validation |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Transaction Pooler URL on port `6543`, using a dedicated `LOGIN` role that is `NOBYPASSRLS` and a member of `energy_monitor_runtime`. Never use `postgres`, `supabase_admin`, `authenticator`, `pgbouncer`, or the `NOLOGIN` group role itself. | Hosted startup verifies the URL, role membership, `bypass_rls = false`, and a pooled database query. |
| `SUPABASE_DB_CA_CERT` | Valid Supabase PostgreSQL CA certificate in PEM form. Literal `\\n` sequences must be converted to newlines by the server. | TLS connection uses certificate verification and the live session must report TLS 1.3. |
| `SESSION_SECRET` | Cryptographically random, server-only, at least 32 characters. | Hosted configuration validation and authenticated session UAT. |
| `CSRF_SECRET` | Cryptographically random, server-only, at least 32 characters, and different from `SESSION_SECRET`. | Hosted configuration validation and authenticated mutation UAT. |

`DIRECT_DATABASE_URL` is optional and migration/admin-only. It must never be used by hosted request handling or browser code.

## Deliberately deferred variables and infrastructure

These are not part of the reduced Web runtime contract:

- `SUPABASE_SERVICE_ROLE_KEY`: absent unless a specifically approved, server-only privileged route is reintroduced.
- `SUPABASE_URL`: not required by the active direct-Postgres API runtime; retain only for deferred legacy service code if needed.
- `SUPABASE_WORKBOOK_BUCKET` and `SUPABASE_IMAGE_BUCKET`: workbook lifecycle and rack-unit image Storage are deferred.
- Google OAuth/Sheets variables: deferred.
- `energy_monitor_preview`: not required.
- `energy_monitor_runtime`: keep as the least-privilege group role while direct PostgreSQL remains; it is not an application login identity.

## Required hosted settings

Keep `NODE_ENV=production`, `VERCEL_ENV=preview` for Preview deployments,
`TRUST_PROXY=true`, an exact HTTPS `APP_ORIGIN`, exact allowed origins, and a
hosted `DB_POOL_MAX` no greater than 10. Preview remains read-only until the
release/UAT procedure explicitly enables safe writes in an isolated test path.

## Verification sequence

1. Inspect variable names and metadata without printing values.
2. Redeploy Preview after valid configuration is supplied.
3. Verify `/api/v1/readiness` returns HTTP 200.
4. Verify pooled connectivity, TLS, runtime identity, RLS/policies, session/auth, and populated data.
5. Execute the core UAT: login, save, reload, dashboard, history, Excel, CSV, PDF, logout, and login again.
6. Execute admin UAT: add, disable, enable, delete, and reset password.
7. Run the Production Gate Matrix before any Production change.
