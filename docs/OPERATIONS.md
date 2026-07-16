# MQR Platform — Production Operations Handbook

The single entry point for "how does this system run in production and
what do I do when something goes wrong." This document consolidates and
cross-references the detailed operational docs that already exist
(`docs/operations/OPERATIONS_RUNBOOK.md`, `docs/deployment/DEPLOYMENT_GUIDE.md`,
`docs/adr/ADR-012-Tractor-IN-Master-Data.md`, `docs/MASTER_DATA.md`,
`docs/releases/*`) rather than duplicating them — read this first, follow
the link for the full detail.

Written at the close of **Phase 1** of the Post-v2.3.1 roadmap
(`docs/ROADMAP.md`). Update this document whenever architecture changes,
per that roadmap's Working Rule 10.

## 1. System Overview

**MQR (Market Quality Report)** is Mahindra's dealer quality/service
platform. Two business modules are production-ready today:

- **MQR** (a.k.a. QIR) — dealer quality-incident reporting: serial
  number, problem code/severity, photos/video, GPS, root cause, parts,
  repair outcome. Every report generates a PDF (QR code) and a
  notification email.
- **NTR (New Tractor Registration)** — a search-first form a dealer fills
  when a new tractor is delivered to a customer. As of v2.3.0/v2.3.1
  (ADR-012), Product Family and Sub Model are read-only, auto-filled from
  `vehicles` — never chosen manually.
- **PM (Preventive Maintenance)** — search-first maintenance recording,
  with Due/Health/Compliance engines and calculation-protection (lock)
  policy.
- **Vehicle 360 / Machine 360** (`/vehicles/[serial]`) — a read-only,
  aggregated timeline view merging NTR, PM/Maintenance, and MQR
  contributions per tractor (`src/features/vehicle/providers/registry.ts`).

**Not yet built as modules**: Warranty, ORC (see Phase 5/6 below and
`docs/ROADMAP.md`'s historical Phase 3 list) — any document or code
comment referencing them describes a target, not current state.

## 2. Architecture

- **Stack**: Next.js 14 (App Router, TypeScript) on Vercel; Supabase
  (Postgres 17 + RLS) as the single source of truth; Google Drive
  (OAuth2, not a service account) for photo/video attachments; Resend for
  transactional email; `react-pdf` for PDF generation.
- **Layering** (`.claude/rules/01-architecture-boundaries.md`,
  `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`): `lib/*` = Infrastructure
  (external system integration) → `src/shared/*` = Platform services →
  `src/features/*`/`src/app/*` = Business modules. Dependency direction is
  one-way; enforced in CI by `npm run architecture`
  (`scripts/architecture-check.ts`, 5 rules + a CI-integration self-check
  — see `docs/engineering/ARCHITECTURE_ENFORCEMENT.md`).
- **Auth/RBAC**: no Supabase Auth — custom JWT session (`jose`), four
  roles (`SuperAdmin > CentralAdmin > DealerAdmin > DealerUser`), all
  predicates in `lib/scope.ts`. Dealer/branch scoping goes through
  `lib/dealerBranchScope.ts` (`resolveDealerScope`, `resolveBranchScope`,
  `assertBranchAccess`, `canAccessDealerBranch`) — the **Foundation
  Freeze** platform (see root `CLAUDE.md` §3.6): every module's
  authorization is expected to route through it, not reimplement scoping
  inline. **Known gap, tracked in §10**: `getVehicleBySerial()` doesn't
  yet go through this pattern (see Phase 2 below).
- **Vehicle master data**: `vehicles` is the *application master*
  (`docs/MASTER_DATA.md` §2.1) — synced from the Tractor IN Google Sheet
  by `TractorInSyncService`, the only writer of `product_family_id`/
  `sub_model`/`last_synced_at`/`sync_source`. Full data flow: §5 below.
- **Frozen platforms** (feature-frozen, bug/security/perf fixes only):
  Attachment Platform, Storage Platform, DealerBranchScope, Historical
  Import Framework — see `docs/PLATFORM_BASELINE.md` and root `CLAUDE.md`
  §3.6. Do not build a parallel implementation of any of these.

## 3. Production Environment

- **Hosting**: Vercel, team `MSEAL`. Production auto-deploys on every
  push to `main` — no branch/PR-gated deploy exists.
- **Database**: Supabase project `lhlzzxjayywqhqtjzfiu` (Postgres 17,
  `ap-northeast-2`). **One shared project for all environments** — there
  is no separate staging database. Preview deployments (via `vercel
  deploy`, no `--prod`) point at this same production database, which is
  why every live-UAT step in this project's history is deliberate and
  read-first, write-with-care.
- **File storage**: Google Drive (OAuth2 user account, not service
  account) — one root folder, one subfolder per dealer. See
  `docs/deployment/DEPLOYMENT_GUIDE.md` §6 for the full folder structure.
- **Environment variables**: full table in
  `docs/deployment/DEPLOYMENT_GUIDE.md` §2 (`SESSION_SECRET`,
  `SUPABASE_URL`/`SUPABASE_ANON_KEY`, Google OAuth trio,
  `TRACTOR_SHEET_ID`/`GID`, Resend trio). All fail loudly at first use,
  not at build time.

## 4. Release Process

1. One branch per issue/feature (`feature/<name>` or `docs/<name>`), one
   logical change per branch/commit series — root `CLAUDE.md` §3.5.
2. Before opening a PR: `npm run lint`, `npx tsc --noEmit`, `npm test`,
   `npm run build`, `npm run architecture` — all must pass (this is also
   exactly what `.github/workflows/ci.yml` runs, in that order, on every
   push/PR).
3. Open a PR describing the change, its architecture/API/DB impact, and
   verification evidence. **Never merge automatically** — every merge in
   this project's history has waited for explicit human review and an
   explicit merge instruction (see `.claude/rules/git.md`).
4. Squash-merge (this project's established convention), delete the
   feature branch.
5. Confirm the production deployment reaches `Ready` (Vercel dashboard or
   GitHub's Deployments tab on the merge commit's SHA).
6. **Live-verify** the changed flow against the deployed site for any
   user-facing change — a green build is necessary, not sufficient (root
   `CLAUDE.md` §7).
7. If the change included a Supabase migration: apply it to the live
   project *before* shipping code that depends on it (never the reverse),
   confirm via `list_tables`/`list_migrations`, then run `get_advisors`.
8. Update documentation in the same PR whenever architecture changes
   (this handbook, the relevant ADR, `docs/MASTER_DATA.md`, the release
   checklist) — see `docs/ROADMAP.md`'s Working Rules.

Full detail: `docs/deployment/DEPLOYMENT_GUIDE.md`.

## 5. Tractor IN Sync

Full design: `docs/adr/ADR-012-Tractor-IN-Master-Data.md`. Data flow
(current, implemented — see `docs/MASTER_DATA.md` §2.1):

```
Google Sheet (Tractor IN)
        ↓
Sync Service (src/features/vehicle/services/tractorInSyncService.ts)
        ↓
vehicles (Application Master: product_family_id, sub_model,
          last_synced_at, sync_source)
        ↓
NTR
PM
Warranty   (not yet built)
ORC        (not yet built)
Reports    (not yet built)
```

- **`TractorInSyncService`** is the *only* writer of
  `vehicles.product_family_id`/`sub_model`/`last_synced_at`/
  `sync_source`. No business module derives or writes these columns
  itself, and no lookup/search route triggers a sync as a side effect
  (no read-through upsert).
- **INSERT + UPDATE** (v2.3.1): a sheet row with no matching `vehicles`
  row is inserted; an existing serial is updated. Idempotent and
  duplicate-proof (`vehicles_serial_key` UNIQUE constraint is the hard
  backstop; a race unique-violation is treated as `skipped`, never
  `failed`).
- **Trigger**: `POST /api/admin/tractor-in/sync` (SuperAdmin-only,
  manual — no scheduler platform exists yet, see
  `docs/SCHEDULER_ARCHITECTURE.md`). `?dryRun=true` computes the same
  insert/update/skip decisions without writing anything — use this before
  any production execution.
- **Manual prerequisite, still outstanding**: the Tractor IN Google
  Sheet needs its own `Product Family`/`Sub Model` columns added by the
  sheet owner (outside this codebase, no write access exists) before the
  sync can populate real values instead of just metadata. As of the
  first production run (2026-07-09), the sheet still doesn't have them —
  see §10.
- **Every run persists a log row** to `tractor_in_sync_runs` (inserted,
  updated, skipped, failed, duration, failures, unmatched Product Family
  rows) and is readable via the health endpoint (§6).
- **First production execution**: 2026-07-09, 0 inserted / 330 updated /
  0 skipped / 0 failed, 102,385ms — full evidence in
  `docs/releases/RELEASE_CHECKLIST_V2.3.1_SYNC_HARDENING.md`.

## 6. Monitoring

- **`GET /api/admin/tractor-in/health`** (SuperAdmin-only) — the first
  place to check "did the last sync work": last sync time, last run's
  inserted/updated/failed, live total vehicle count, sync status
  (`success` / `partial_failure` / `never_run`).
- **`tractor_in_sync_runs`** table — the durable log behind the health
  endpoint; query directly for a specific run's `failures`/
  `unmatched_product_family` detail.
- **Application logs**: every route in this app `console.error`s before
  returning an error response — Vercel function logs are the first place
  to look for any route-level failure (see `docs/operations/
  OPERATIONS_RUNBOOK.md` §4).
- **No dashboard/alerting exists yet** for sync health, error rates, or
  vehicle-count drift — tracked as roadmap work (Phase 3/7 below, and
  §10).
- **Architecture drift**: `npm run architecture` in CI is the automated
  guard against a new module violating the layering rules in §2 — a
  failure here blocks the pipeline before typecheck/lint/test/build run.

## 7. Troubleshooting

Full playbook: `docs/operations/OPERATIONS_RUNBOOK.md` §3 — covers Google
Drive upload failures, large-file/chunked-upload failures, PDF export
failures, CSV/Excel encoding issues, the PM Lock Policy ("ถูกล็อก" is not
a bug), Tractor IN sheet staleness, `SESSION_SECRET` rotation effects,
and the **P0 treatment** for any dealer/branch-scope leak.

Tractor IN sync specific:

- **Sync reports `failed > 0`**: check `tractor_in_sync_runs.failures`
  for the specific serial + error message. A single row's failure never
  aborts the run (v2.3.1 hardening) — re-running the sync retries only
  what's still wrong (idempotent for already-succeeded rows).
- **A vehicle's Product Family shows "not linked" on Vehicle 360 despite
  `vehicles.product_family_id` being set**: check the viewing session's
  role and `dealerId` first — see the known bug in §10 before assuming
  a data problem.
- **Sync `unmatchedProductFamily` is non-empty**: the sheet's `Product
  Family` text doesn't exactly match any `product_families.code`/`.name`
  (case-insensitive). The sync never guesses — fix the mismatch in
  either the sheet or `product_families`, then re-run.

## 8. Security

- **No Supabase Auth** — every table uses the Supabase **anon** key
  (`lib/supabase.ts`); tenant isolation is enforced entirely in
  application code (`lib/scope.ts` role predicates +
  `lib/dealerBranchScope.ts`), not via a privileged key or per-row
  Postgres role. RLS is enabled on every table per
  `.claude/rules/03-data-access-security.md`, but policies are
  permissive by design (`get_advisors`' `rls_policy_always_true` warning
  is expected, not a regression) — the real boundary is server-side
  scope-checking code.
- **Every write re-validates ownership/scope server-side**, never trusts
  a client-sent `dealer_id`/`branch_id`.
- **A dealer/branch-restricted user seeing data outside their scope is a
  P0 security incident**, not a routine bug — see
  `docs/operations/OPERATIONS_RUNBOOK.md` §3.10.
- **Known, tracked gap**: `getVehicleBySerial()` doesn't check
  `seesAllDealers(role)` before its dealer-match filter — see §10 and
  Phase 2 (Permission Hardening) in `docs/ROADMAP.md`. This is an
  *over-restrictive* bug (a privileged role incorrectly denied data), not
  a leak (no under-restriction/cross-tenant exposure found) — still
  tracked with the same seriousness as any authorization defect.
- **Credentials**: never entered into a command, field, or file — see
  root `CLAUDE.md`'s narrow, explicit carve-outs for authenticated-session
  artifacts (GitHub raw-content tokens, Drive resumable-session URLs via
  header) before assuming a new exception exists.

## 9. Backup & Rollback

- **Database**: Supabase-managed automatic backups; Point-in-Time
  Recovery availability depends on the project's plan tier — verify in
  the Supabase dashboard before relying on a specific window. No custom
  backup job exists in this codebase.
- **Files (Google Drive)**: no separate backup — Drive is the system of
  record; Google Workspace's own trash/version history (30-day default)
  is the only recovery path for an accidentally-deleted file.
- **Application rollback**: no automated tooling — use Vercel's dashboard
  to "Promote" the previous known-good deployment (instant, no rebuild).
  This project's migrations are additive-only by convention, so an
  application-code rollback usually doesn't require a schema rollback.
- **Tractor IN sync rollback**: see ADR-012's per-version rollback
  sections (v2.3.0's `product_family_id`/`sub_model` columns; v2.3.1's
  `last_synced_at`/`sync_source`/`tractor_in_sync_runs`) — both additive,
  both reversible via a `DROP COLUMN`/`DROP TABLE` migration with zero
  impact on `ntr_records`/Legacy Import.
- **Full rollback runbook for the sync specifically** (dry-run → execute
  → verify → rollback triggers → root-cause-before-retry discipline):
  `docs/releases/RELEASE_CHECKLIST_V2.3.1_SYNC_HARDENING.md` §4.
- Full detail: `docs/operations/OPERATIONS_RUNBOOK.md` §1–2,
  `docs/deployment/DEPLOYMENT_GUIDE.md` §8.

## 10. Technical Debt

Current, as of the close of Phase 1 (this document) — see
`docs/ROADMAP.md` Phase 9 for the tracking list this feeds:

1. **Dealer scope bug** — `getVehicleBySerial()` in `lib/db.ts` filters
   by `session.dealerId !== vehicle.dealer_id` without checking
   `seesAllDealers(role)`, incorrectly blocking a SuperAdmin/CentralAdmin
   session (whose own `dealerId` is non-null) from Vehicle 360/PM data
   for a different dealer's vehicle. Found during the v2.3.1 production
   rollout verification. **Scheduled: Phase 2.**
2. **PM's `getProductFamilyIdForModel()` fallback** — still required.
   290/333 vehicles have `product_family_id` (unchanged since the sheet
   still lacks its own Product Family column); the remaining 43 have no
   entry in `product_family_models` either. Exact removal condition is in
   the code comment (`maintenanceSummaryProvider.ts`) and ADR-012.
   **Scheduled: Phase 4**, after the sheet rollout.
3. **No targeted "retry just the failed rows" path** for the Tractor IN
   sync — a partial failure is recovered by re-running the full sheet
   (cheap at ~330 rows today). **Scheduled: Phase 3.**
4. **Sub Model / Product Family sheet columns** are still a manual
   prerequisite outside this codebase — the sync logic is ready, the
   sheet isn't. **Scheduled: Phase 4.**
5. **No scheduler platform exists** — every sync trigger today is manual
   (`POST /api/admin/tractor-in/sync`). Documented in
   `docs/SCHEDULER_ARCHITECTURE.md`; not scheduled to a specific phase.
6. **No dashboard/alerting** for sync health or error rates beyond the
   health endpoint itself. **Scheduled: Phase 7.**
7. **Unused locale keys and a "Variant"→"Sub Model" terminology sweep**
   (`address.searchProvince`/`searchDistrict`/`searchSubdistrict`,
   `ntr.videoUploaded`, and any remaining "Variant" label) — opened as
   low-priority cleanup during the v2.3.0 work, not yet actioned.
   **Scheduled: Phase 8.**
8. **Cloudflare R2 cutover** — implemented and unit-tested, not selected
   as default anywhere; CORS configuration is a Cloudflare-dashboard-level
   blocker, not application code. See `docs/PLATFORM_BASELINE.md`. Not
   scheduled in the current 10-phase roadmap.

## 11. Roadmap

Full detail, phase-by-phase: `docs/ROADMAP.md`'s "Post-v2.3.1 Roadmap"
section (current, supersedes the older "Next Development Phase (Post
v1.1.0)" planning as the active plan). Summary:

| Phase | Focus |
|---|---|
| 1 | Documentation — this handbook (complete) |
| 2 | Permission Hardening (v2.3.2) — fix `getVehicleBySerial()`, Permission Matrix, regression tests |
| 3 | Sync Improvements — retry-failed-rows, single-vehicle sync, richer health endpoint |
| 4 | Google Sheet Master Data — sheet rollout, Sub Model backfill, PM fallback removal |
| 5 | Vehicle 360 — full lifecycle timeline (Tractor IN → NTR → PM → Warranty → Complaint → ORC → Parts → Campaign → Owner History) |
| 6 | Workflow — Draft → Submitted → Approved → Delivered → Warranty Active, with audit trail + role approval |
| 7 | Reporting — cross-module KPI dashboard |
| 8 | Engineering Quality — ADRs, coding standards, dead code/translation cleanup, API docs, performance/error/security review |
| 9 | Technical Debt — close everything tracked in §10 |
| 10 | v3.0 — Digital Tractor Passport (one tractor, one lifetime record, QR-code entry point) |

Per the roadmap's Working Rules: every phase is inspected and planned
before implementation, opens its own PR, runs the full verification gate
(lint/typecheck/tests/build/architecture), and waits for explicit review
before merging — nothing here is merged automatically.
