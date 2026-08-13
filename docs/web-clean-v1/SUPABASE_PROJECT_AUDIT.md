# Supabase Project Audit — Clean Web v1

Date: 2026-08-10  
Scope: `feat/web-clean-v1` only; no Production change

## Authoritative project identity

The intended Supabase project is:

- Name: `energy_monitor`
- Region: `ap-southeast-1`
- Project reference: `tofdgndrrpnnyhbuurbx`

`dnnufamiwxapqibdhwyj` is stale configuration and must not be used for clean
web Preview, database URLs, project URLs, or Supabase CLI linking.

## Repository findings

- No clean-v1 source or clean-v1 documentation contains the stale project
  reference.
- `docs/phase3-test-plan.md` already names `tofdgndrrpnnyhbuurbx`.
- Historical `docs/web-v3/*` evidence files mention the stale project. They
  are retained as historical evidence and must not be used as deployment
  instructions.
- A local ignored `.phase7-db-url` artifact matched the stale reference. Its
  contents were deliberately not read or changed because it may contain a
  credential. An authorized operator must replace or remove that local secret
  artifact outside source control.

## Schema compatibility status

The clean repository requires migrations `001` through `007`, including core
operational tables, local-auth tables, sessions, audit events, and RLS policies
for `energy_monitor_runtime`.

The authenticated Supabase connector available to this task currently exposes
only the unrelated stale project; it cannot read project
`tofdgndrrpnnyhbuurbx`. Therefore current schema, migration, RLS, grants,
runtime role, TLS, and storage state for the actual project are **not yet
verified**. They must be read-only audited after the owner grants this session
access to the actual Supabase organization/project. No migration may be applied
until that audit completes.

## Runtime architecture decision

The present clean-web runtime requires direct PostgreSQL access because:

1. `server/runtime.ts` creates one `pg` pool and injects it into the
   operational repository and local authentication repository.
2. The database's expected RLS/grant model targets the non-BYPASSRLS
   `energy_monitor_runtime` role rather than Supabase `anon`,
   `authenticated`, or `service_role` identities.
3. The app uses its own Argon2id `users` / `local_credentials` / `sessions`
   model. Replacing it with Supabase Auth/Data API would require a separately
   designed identity, grant, RLS-policy, session, and data-authorization
   migration.

Consequently, Supabase Data API/Auth is not a drop-in replacement today. It is
an optional future simplification project, not a safe project-reference fix.

## Required Preview-only variables

For `feat/web-clean-v1`, all values must target
`tofdgndrrpnnyhbuurbx` and remain server-only where applicable:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Actual project's Transaction Pooler, port `6543`, non-BYPASSRLS login; never `postgres`. |
| `SUPABASE_DB_CA_CERT` | Yes | Actual project's valid PostgreSQL CA PEM; runtime normalizes escaped newlines. |
| `SESSION_SECRET` | Yes | Independent random server-only value, 32+ characters. |
| `CSRF_SECRET` | Yes | Independent random server-only value, 32+ characters. |
| `NODE_ENV` | Yes | `production` for a Vercel-hosted runtime. |
| `APP_ORIGIN` | Yes | Exact clean Preview origin. |
| `TRUST_PROXY` | Yes | `true` for Vercel. |
| `READ_ONLY_MODE` | Yes under current code | The current Preview guard requires `true`, which prevents write/admin UAT; this conflicts with full Preview UAT and must be explicitly redesigned before acceptance testing. |
| `DB_POOL_MAX` | Optional | Defaults to 3; hosted runtime rejects values above 10. |
| `APP_ORIGINS`, `APP_PREVIEW_ORIGINS` | Optional | Current deployment self-origin is automatically allow-listed from Vercel-provided hostnames. |
| `SUPABASE_URL` | Conditional | Server-only Supabase Storage URL for Rack Unit Capacity images. |
| `SUPABASE_SERVICE_ROLE_KEY` | Conditional | Server-only Storage credential for Rack Unit Capacity images; never expose to the browser. |
| `RACK_UNIT_IMAGE_BUCKET` | Conditional | Existing Storage bucket; defaults to `rack-unit-capacity`. |

Production values and configuration are out of scope for this correction.
