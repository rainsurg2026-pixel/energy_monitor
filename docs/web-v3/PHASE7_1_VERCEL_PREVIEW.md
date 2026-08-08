# Phase 7.1 Vercel Preview Contract

The Vercel deployment serves the Vite frontend and the existing Express API
through the single Node.js function at `api/[...path].ts`. The adapter does
not duplicate business routes or create a second authorization boundary.

## Runtime boundary

- `DATABASE_URL` is the pooled PostgreSQL connection for the non-superuser
  `energy_monitor_runtime` membership used by the API.
- `DIRECT_DATABASE_URL` is for operator-only migrations/bootstrap. It is not
  read by the Vercel request handler and must not be configured as a browser
  variable.
- A small `pg.Pool` is created once per warm function instance and reused.
  The runtime role assertion remains mandatory.
- Vercel Preview must use the confirmed development/test Supabase project,
  never a production database.
- Missing runtime database configuration or a failed runtime-role check fails
  database-dependent requests closed with a generic HTTP 503. The process
  health endpoint remains database-independent; readiness still checks the
  database.

## Environment contract

| Variable | Development | Preview | Production |
| --- | --- | --- | --- |
| `DATABASE_URL` | Local/runtime database when API is used | Required; development Supabase pooled runtime URL | Not configured by this phase |
| `DIRECT_DATABASE_URL` | Required only for local migration/bootstrap commands | Not used by the request function | Operator-only, outside this phase |
| `NODE_ENV` | `development` or `test` | `production` | `production` |
| `SESSION_SECRET` | Optional local fallback | Required, server-only, at least 32 characters | Required, server-only |
| `CSRF_SECRET` | Optional local fallback | Required, server-only, at least 32 characters | Required, server-only |
| `APP_ORIGIN` | Local origin | Exact Preview origin | Exact production origin |
| `APP_ORIGINS` | Explicit local origin list | Exact allowed origins | Exact allowed origins |
| `APP_PREVIEW_ORIGINS` | Optional | Exact Preview origins only; never a wildcard suffix | Not used by this phase |
| `TRUST_PROXY` | `false` unless local proxy is intentionally used | Explicitly `true` after the Vercel proxy contract is confirmed | Explicit deployment value |
| `READ_ONLY_MODE` | Local policy choice | `true` for the Phase 7 pilot | Production policy is outside this phase |
| `DB_POOL_MAX` | Small local value | Small value appropriate for pooled/serverless use | Deployment-specific |

`BOOTSTRAP_ADMIN_*`, `DEV_ADMIN_PASSWORD`, and `DEV_USER_PASSWORD` are
one-time operator inputs only. They are never frontend variables, build
variables, or committed configuration. Preview account seeding remains a
separate controlled deployment gate.

## Routing

The catch-all function owns `/api/v1/*`. The SPA rewrite excludes both `/api/`
and the bare `/api` path, so API failures cannot be replaced with
`index.html`. Browser routes remain client-side SPA routes.

## Security expectations

Preview uses the existing HttpOnly Secure session cookie, SameSite=Lax, and
session-bound CSRF token. CORS accepts exact configured origins only. The API
uses PostgreSQL-backed rate limiting in hosted production mode; process-memory
state is not a security boundary for Vercel.

This document does not authorize production deployment, live account seeding,
or Phase 8 work.
