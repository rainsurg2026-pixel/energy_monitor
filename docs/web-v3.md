# Energy Monitor Web v3 read shell

Phase 5 adds a browser-only shell while retaining the Electron/Desktop entry
path. HTTP(S) routes are lazy-loaded separately from the Desktop application:

- `/login`
- `/dashboard`
- `/energy`
- `/cost`
- `/electrical`
- `/site-comparison`
- `/racks`
- `/rack-units`
- `/settings` and `/settings/users`

The browser uses `src/web/apiClient.ts` for cookie-authenticated API calls and
never receives a PostgreSQL or Supabase credential. Backend bootstrap data is
authoritative for sites, Display Period, allowed months, latest available
month, and `READ_ONLY_MODE`. A stale month selection is replaced by the
backend-provided latest available month; hidden months are not requested or
rendered by the web shell.

The read pages display API/domain outputs. They do not reproduce Energy Monitor
calculation formulas in React. Rack Capacity and Rack Unit Capacity remain in
the parity scope. `vercel.json` rewrites browser routes to `index.html` while
leaving `/api/` and static assets outside the rewrite.

Live auth/RLS and live migration remain deployment gates:

- `LIVE_AUTH_SUPABASE_VERIFICATION_PENDING`
- `DEVELOPMENT_ACCOUNTS_LIVE_SEED_PENDING`
- `LIVE_PHASE4_IMPORT_PENDING`

This document originally described Phase 5 only. Phase 6 (operational writes
and settings) and Phase 7.1 (Vercel Preview runtime, `docs/web-v3/
PHASE7_1_VERCEL_PREVIEW.md`) have since shipped on `feat/web-v3` — see the
Status table below for what that means in practice today.

## Status (as of 2026-08-09)

| Feature | Status | Progress | Priority |
|---|---|---|---|
| Postgres schema + API foundation (Phase 2) | Done | Committed, migrated via `db/migrations/001_phase2_foundation.sql` | — |
| Local auth + RBAC + Supabase security (Phase 3) | Done | All Critical/High findings in `docs/phase3-test-plan.md` verified resolved against current code (auth boundary wired end-to-end, RLS enabled with `energy_monitor_runtime` role grants, CORS allowlist, audited actor identity, durable rate limiting) | — |
| Web read shell (Phase 5) | Done | `/login`, `/dashboard`, `/energy`, `/racks`, `/settings`, etc. live, cookie-auth only | — |
| Operational writes & settings (Phase 6) | Done | Committed | — |
| Workbook migration tooling | Done | Transactional, hash-verified, idempotent by source hash (`docs/data-migration.md`) | — |
| Vercel Preview runtime (Phase 7.1) | **Build/typecheck verified locally; live deploy unverified** | `vercel-build` succeeds from a clean clone; pooler-fallback code path reviewed and internally consistent; no real Vercel Preview deploy has been run against it yet, no CI automates this | High — blocks calling Phase 7 done |
| Auth architecture reuse from `mqr-webapp-new` | Done | Session lifecycle ported (JWT via `jose` wrapping the existing DB-revocable session, `server/auth/sessionJwt.ts`); RBAC ported as a named-predicate pattern (`server/authz/scope.ts`); Argon2id kept over scrypt (stronger, already verified, no upgrade to gain); dealer/branch tenancy not ported — no analog in this app's domain. See `docs/authentication.md` § "Architecture decision: alignment with the mqr-webapp-new reference" | — |
| Rack-capacity image embedding (unrelated in-flight work) | In progress, unrelated to web migration | Untracked writer/test scripts (`src/excel/SheetImageWriter.ts`, `scripts/test-rack-capacity-image-*.ts`) reference write-side functions (`ensureRackUnitCapacityImageHistorySheet`, `upsertRackUnitCapacityImageHistoryRow`) that don't exist yet in `src/excel/RackUnitCapacityImageHistoryWriter.ts`/`RackCapacityWriter.ts` | Not started — needs its own scoped session, not part of this migration |
| Production deployment | **Not started** | Requires: (1) a human-triggered Vercel Preview deploy + `scripts/test-preview-http.ts` run with real dev credentials to close out Phase 7.1, then (2) explicit Product Owner approval to merge `feat/web-v3` into `main` per `.claude/rules/git.md` | Blocking — see `docs/web-v3/PHASE7_1_VERCEL_PREVIEW.md`'s own "does not authorize production deployment" line |

No production deployment has occurred. Phase 8 and beyond remain out of
scope until the above is closed out.
