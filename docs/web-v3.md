# Energy Monitor Web v3 read shell

## Current parity implementation update (2026-08-10)

Desktop per-section save timestamps and historical-month save confirmation are
implemented in migration `006_section_save_timestamps.sql`, the API,
repositories and the structured Web editor. Evidence: `npm.cmd run
test:web-section-save-parity` passed, together with `npm.cmd run lint` and
`npm.cmd run vercel-build`. Live Supabase migration/UAT and visual verification
remain required; project status remains **BLOCKED — NOT PRODUCTION READY**.

The source audit also closed Web Historical Logs (`/history`) and Web Rack
Capacity/Rack Unit Capacity editing, including optimistic version checks,
Rack Capacity history snapshots and validated image storage. Evidence:
`npm.cmd run test:web-history-rack-edit` passed. The Web now uses the shared
Desktop Rack Capacity executive surface and retains the Desktop `2. UPS Group
History` rows through migration `007_ups_group_history.sql`; hosted and
authenticated UAT verification remains required.

## Current deployment evidence override (2026-08-10)

Latest objective probe: Vercel account `rainsurg2026-pixel`, linked project
`dcm15/energy-monitor`, READY Preview `dpl_4bBMXFV1JuJ44nex138UjQkqGLZg` at
`https://energy-monitor-brdjulzp4-dcm15.vercel.app`. Root, `/dashboard` and `/login` and public
health return 200; readiness returns 503 `reason=configuration`. Production
was not deployed and the existing Production API paths return 404. This
override supersedes older deployment identifiers in historical rows.

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
- `/reports`
- `/import` (administrator only)

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
PHASE7_1_VERCEL_PREVIEW.md`) are represented in the current working tree; this
session has not created or pushed a commit.

## Status (as of 2026-08-10)

Final readiness audit: [FINAL_READINESS_AUDIT_2026-08-10.md](web-v3/FINAL_READINESS_AUDIT_2026-08-10.md).
Current gate evidence: [PRODUCTION_GATE_EVIDENCE_2026-08-10.md](web-v3/PRODUCTION_GATE_EVIDENCE_2026-08-10.md).
The local build and test gates pass, but Desktop equivalence, live Supabase
verification, authenticated UAT and Production deployment remain open. Vercel
authentication and Preview artifact deployment are now verified; Preview
readiness still fails on runtime configuration.

| Feature | Status | Progress | Priority |
|---|---|---|---|
| Current Preview evidence override (2026-08-10) | **READY; readiness blocked** | Latest deployment `dpl_4bBMXFV1JuJ44nex138UjQkqGLZg` at `https://energy-monitor-brdjulzp4-dcm15.vercel.app`; root, `/dashboard`, `/login` and `/api/v1/health` return 200, while readiness and dashboard API return 503 `reason=configuration`. | Blocking external dependency |
| Postgres schema + API foundation (Phase 2) | Done | Committed, migrated via `db/migrations/001_phase2_foundation.sql` | â€” |
| Local auth + RBAC + Supabase security (Phase 3) | Code/test verified; live gate pending | Auth boundary, RLS/grants, CORS allowlist, audited actor identity and durable rate limiting are covered by local tests; live Supabase verification remains pending | High |
| Web read shell (Phase 5) | Done | `/login`, `/dashboard`, `/energy`, `/racks`, `/settings`, etc. live, cookie-auth only | â€” |
| Operational writes & settings (Phase 6) | Done | Committed | â€” |
| Workbook migration tooling | Done | Transactional, hash-verified, idempotent by source hash (`docs/data-migration.md`) | â€” |
| Vercel Preview runtime (Phase 7.1) | **Deployed; readiness blocked; full UAT pending** | Superseded Preview candidate; the authoritative current deployment is `dpl_4bBMXFV1JuJ44nex138UjQkqGLZg` at `https://energy-monitor-brdjulzp4-dcm15.vercel.app`. | High â€” Runtime configuration and UAT |
| Auth architecture reuse from `mqr-webapp-new` | Done | Session lifecycle ported (JWT via `jose` wrapping the existing DB-revocable session, `server/auth/sessionJwt.ts`); RBAC ported as a named-predicate pattern (`server/authz/scope.ts`); Argon2id kept over scrypt (stronger, already verified, no upgrade to gain); dealer/branch tenancy not ported â€” no analog in this app's domain. See `docs/authentication.md` Â§ "Architecture decision: alignment with the mqr-webapp-new reference" | â€” |
| Rack-capacity image embedding | Implemented/tested in current working tree | OOXML embed, legacy migration and multi-month history tests pass for both production workbook fixtures; tracked changes are preserved for handoff | â€” |
| Production deployment | **Not completed â€” Preview/live/UAT gates pending** | `npm.cmd run vercel-build` passes locally. The existing Production alias is an older deployment, its API health/session paths return 404, and Production application runtime variables are not verified. | Blocking external dependency |

Current release override (2026-08-10): Vercel authentication and project
linkage are verified. Preview deployment
`dpl_4bBMXFV1JuJ44nex138UjQkqGLZg` is READY at
`https://energy-monitor-brdjulzp4-dcm15.vercel.app`; `/api/v1/health` returns
200, but `/api/v1/health/ready` returns 503 with reason `configuration`. The
current Production deployment remains an older release and returns 404 for
the application/API paths. This override supersedes the historical
Preview/Production wording in the table above.

No production deployment has occurred. The migration is not yet declared
Desktop-equivalent; remaining parity items and the external UAT/deployment
gates must close before production sign-off.

## Current parity additions

- Web Reporting Center is partial: `/reports` reuses the Desktop HTML renderer,
  Desktop Reporting Center UI/shared calculation domain, selected sections and
  current/single/range/history period options, with HTML preview/download,
  server-side PDF/PNG/ZIP artifacts, retained-source workbook download, and
  core XLSX export. Rack Capacity History and Rack Unit image metadata/bytes
  now flow from import/storage through the report renderer; live Storage and
  populated Desktop/Web visual comparison remain open.
- Web workbook import is administrator-only and uses the Desktop reader and
  validator, transactional upsert of monthly logs plus Rack Capacity/Rack Unit
  Capacity snapshots, Rack Capacity History, legacy image-history extraction and
  persisted `2. UPS Group History` rows, SHA-256 provenance, and source-hash
  idempotency.
  `/import` is the corresponding Web route. The browser upload is bounded at
  10 MB and the API uses a bounded base64 JSON envelope.
- Web operational entry reuses the Desktop UPS, Air, DC and Energy Cost section
  editors, Sticky Entry Toolbar/completion workflow, save/reset-all behavior,
  required-field checks, and Srinakarin phase/PPC editor. `/integrity` reports
  missing months and empty core sections for the Postgres monthly-log projection,
  with its scope stated in the UI.
- Web `/dashboard` now returns and renders the shared Engineering Dashboard
  snapshot (UPS group status, Air meter deltas, DC panel loads, and energy/cost
  KPIs) instead of exposing calculation cards alone.
- Administrator-only `/settings/audit` exposes the existing scrubbed audit
  event stream as a bounded read-only history.
- Server-side PDF/PNG/ZIP are implemented with a server-side Chromium renderer
  and Desktop ZIP member contract; hosted runtime and populated visual parity
  still require Preview/Production evidence.
- Workbook source retention, OOXML-preserving round-trip, workbook-level
  integrity inspection, retained-workbook backup listing and transactional
  restore are implemented and locally tested. The Web `/rack-units` route now
  serves the selected month's verified image from object storage; live object
  storage, approved workbook-set comparison and Excel/UAT remain open.
- Google Sheets now has a server-side OAuth/PKCE boundary, encrypted refresh
  token storage, four-tab diff/patch/verify sync, export-all and import/persist
  routes/UI. Real Google Cloud consent and spreadsheet reconciliation remain
  external verification gates.
