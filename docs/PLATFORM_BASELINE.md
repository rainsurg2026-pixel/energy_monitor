# MASP Platform Baseline — v1.0

The official baseline record for the MASP platform's Storage Platform
work, frozen at this milestone. Read this first for current state; go to
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` for permanent policy,
`docs/engineering/STORAGE_PLATFORM_FINAL.md`/`STORAGE_PLATFORM_DECISION.md`
for full architecture/rationale, and `PROJECT_STATE.md` for the complete
chronological build log (this document is a snapshot, that one keeps
growing).

## Platform overview

MASP (Mahindra After Sales Platform) is one Next.js 14 application
(TypeScript, App Router) on Vercel, with Supabase (Postgres + RLS) as the
single source of truth. Two business modules are production-ready today:
MQR (dealer quality-incident reporting) and PM/Maintenance (search-first
preventive-maintenance recording, with Due/Health/Compliance engines and
calculation-protection locking). Machine 360 aggregates both into a
per-tractor timeline/health view. This baseline specifically freezes the
**Storage Platform** (`src/shared/attachments/`) - the shared file-storage
layer both business modules consume - as governed infrastructure, plus
the automated tooling that now enforces its boundaries.

## Architecture summary

One entry point, `AttachmentService`, is the only door a business module
uses for file storage. Two roles (primary, archive) are each backed by
an interchangeable `StorageProvider` implementation, chosen entirely via
`StorageProviderFactory` configuration (`STORAGE_PROVIDER`/
`ARCHIVE_PROVIDER`) - never a code change. Full detail, component
diagram, and dependency graph: `docs/engineering/STORAGE_PLATFORM_FINAL.md`.
Layer definitions and dependency rules for the whole platform (not just
storage): `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`.

## Implemented services

| Service | Role |
| --- | --- |
| `AttachmentService` | The sole business-module-facing entry point - upload, list, resolve URL, delete, restore, business-completion, archive queue. |
| `AttachmentRepository` | All persistence against the `attachments` table. |
| `SupabaseStorageProvider` | Primary storage (default), in production use since Phase 5B.1. |
| `GoogleDriveStorageProvider` | Archive storage (default), in production use since Phase 5B.1. |
| `CloudflareR2Provider` | Implemented, fully unit- and live-tested; **not selected by default anywhere**. |
| `StorageProviderFactory` | Config-driven provider selection; the only place a concrete provider is constructed. |
| `AttachmentErrors` | Business-friendly error translation at the API boundary. |

## Operational services

| Service | Role |
| --- | --- |
| `OrphanCleanupService` | Detects five orphan-attachment cases; dry-run by default, `MANUAL_REVIEW` never auto-actioned. |
| `StorageHealthService` | Live, on-demand upload/download/delete probe; archive-error rate; module-scoped storage usage. |
| `StorageMetricsService` | Per-module counts/bytes/uploads-per-day/archive-count/orphan-count. `downloadsPerDay`/`deletesPerDay` honestly `null` (untracked). |
| `StorageAuditService` | Composes the above into a daily `StorageAuditReport`. |
| `StorageScheduler` | Callable job surface (archive/orphan-cleanup/health-check) for a future cron - not itself scheduled. |

None of the operational layer runs automatically anywhere.

## Governance

`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` is the permanent,
repo-wide architecture policy: layer definitions, dependency rules,
platform service boundaries, infrastructure rules, domain language,
event rules, storage rules, and future-extension rules. Every future
module/service is expected to be checked against it before writing code.

## CI enforcement

`scripts/architecture-check.ts` (`npm run architecture`) automates five
of the Storage Platform's boundary rules (business modules never import
platform internals or raw SDKs; only `AttachmentService` + the
documented operational exception access providers; only
`StorageProviderFactory` constructs one; no circular dependency inside
`src/shared/attachments`) plus a sixth self-check confirming it is
actually wired into CI. `.github/workflows/ci.yml` runs it immediately
after `npm ci`, before typecheck/lint/test/build - a boundary violation
fails the pipeline before any other step runs. Full detail, including
the documented allowlist for the operational-surface exception:
`docs/engineering/ARCHITECTURE_ENFORCEMENT.md`.

## Release status

**MASP Platform Foundation v1.1.0 - STATUS: ACCEPTED.** Originally
frozen and released as v1.0.0 (v2.1 sub-release for Storage Platform
specifically - see `CHANGELOG_STORAGE_PLATFORM.md`,
`RELEASE_NOTES_v2.1.md`, `docs/releases/STORAGE_PLATFORM_RELEASE.md`),
then accepted following a real Vercel Preview deployment + live UAT
(upload/preview/download/delete/signed-URL/CORS/large-file/error-handling,
all VERIFIED against the deployed Preview and independently
cross-checked in Supabase; no regression found, no code changed). The
freeze on this section (Storage Platform) is unchanged and reaffirmed at
v1.1.0 - see `docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md` for the
current full-platform release record, which additionally freezes the
new **DealerBranchScope** authorization standard alongside Attachment
Platform, Storage Platform, and Historical Import Framework.

- **Current Storage Platform - Supabase Storage + Google Drive
  Archive: Production Ready.** In production use since Phase 5B.1,
  unchanged by anything since, and the path just live-UAT-verified.
- **Cloudflare R2: Implementation Complete, Production Cutover
  Pending (Preview Environment Configuration)** - fully built and
  unit-tested; the Preview UAT confirmed `R2_ACCOUNT_ID`/
  `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` are not yet
  configured there, so the R2-specific rollback/object-metadata checks
  were MISSING, not FAIL. Cutover still requires everything under
  Production Prerequisites below.

Verification as of this baseline: `npm run architecture` 5/5 rules PASS
plus the CI-integration check PASS; `npm run lint` 0 errors (7
pre-existing unrelated warnings); `npm run typecheck` clean; `npm test`
308/308 passing; `npm run build` succeeds. Nothing has been committed,
tagged, or pushed as part of this work - see each milestone's own report
and `.claude/rules/git.md`.

## Production prerequisites

Before any environment sets `STORAGE_PROVIDER=CLOUDFLARE_R2`/
`ARCHIVE_PROVIDER=CLOUDFLARE_R2`:

1. Configure CORS on the R2 bucket via the Cloudflare dashboard (the
   application's own API token cannot read or write bucket CORS config -
   confirmed via `AccessDenied`).
2. Re-run a live end-to-end verification against that environment's real
   bucket.
3. Explicit, separate approval to switch the default.
4. For archive-side R2 specifically: implement
   `AttachmentService.getUrl()`'s missing signed-URL path for a
   non-Google-Drive archive provider first.

No prerequisite blocks the parts of the platform already live (Supabase
primary / Google Drive archive) - in production use since Phase 5B.1
with no open blocker.

## Known limitations

- **Cloudflare R2 CORS** - last confirmed-open infrastructure blocker
  (Cloudflare-dashboard-level, not application code).
- **`downloadsPerDay`/`deletesPerDay`** - always `null`; no per-request
  event log exists.
- **No persisted audit-report or job-run history** - `StorageAuditService`
  trend fields need a caller-supplied prior snapshot.
- **`FAILED_RESTORE` orphan detection is partial** - `restore()` has no
  intermediate status the way archiving has `ARCHIVING`.
- **No automatic scheduling anywhere** - every operational job requires a
  manual/admin-triggered call.
- **`scripts/architecture-check.ts` is scoped to Storage Platform rules
  only** - it does not yet enforce `PLATFORM_ARCHITECTURE_STANDARDS.md`'s general
  module-to-module isolation rules repo-wide.
- **This repository's own `CLAUDE.md` (§3) still describes deployment as
  "no git CLI / local clone... uploaded through the GitHub web UI"** -
  confirmed inconsistent with the actual current environment, which has a
  working git CLI, a real `origin` remote, and a checked-out working tree
  (used throughout this platform's build-out for `git status`/`git diff`).
  Flagged here and in `TECHNICAL_DEBT.md`; not corrected as part of this
  freeze since it concerns MQR's general deployment process, outside the
  Storage Platform's own scope.
- ~~Two differently-scoped release checklists now exist...~~ **Resolved**:
  the Storage Platform checklist was renamed to
  `docs/releases/RELEASE_CHECKLIST_STORAGE_PLATFORM_V2.1.md` (alongside
  `docs/releases/RELEASE_CHECKLIST_V1.md`, the original MQR/PM release) to
  remove the naming collision with the root-level file that used to exist
  here.

## Roadmap

See `docs/engineering/STORAGE_PLATFORM_DECISION.md`'s Future Roadmap
section and `NEXT_PHASE.md` (this freeze's own Phase 6 recommendation).
Summary: adopt Cloudflare R2 as default primary storage (once CORS is
configured and approved); teach `getUrl()` to resolve a signed URL from
any archive provider; add a `RESTORING` status for full `FAILED_RESTORE`
detection; add real event tracking for download/delete metrics; wire an
actual cron trigger for `StorageScheduler`; extend
`scripts/architecture-check.ts` to the rest of the Platform Architecture Standards.
None of these are scheduled - each requires its own explicit milestone.
