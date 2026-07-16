# MASP Platform Foundation v1.0.0

> **ARCHIVED — superseded by
> [`MASP_PLATFORM_FOUNDATION_V1.1.md`](../MASP_PLATFORM_FOUNDATION_V1.1.md)
> (2026-07-08).** Kept, not deleted, as the accurate historical record of
> this milestone — its own `v1.0.0` tag and GitHub Release remain
> published and untouched. Content below is unmodified from the original
> release.

**Release date:** 2026-07-06
**Version:** v1.0.0
**Branch:** `feature/pm-record-workflow-redesign`
**Status:** Verified and accepted.

This is the official baseline record for the MASP (Mahindra After Sales
Platform) Foundation - every business module the platform ships today,
running on a shared, provider-agnostic Attachment/Storage layer, plus a
production-grade historical data import framework. `PROJECT_STATE.md`
remains the complete chronological build log; this document is the
release snapshot for v1.0.0 specifically.

## Architecture overview

One Next.js 14 application (App Router, TypeScript) on Vercel, with
Supabase (Postgres + RLS) as the single source of truth. Every business
module accesses file storage through exactly one door:

```
NTR / PM / QIR(MQR) / Machine360
              |
              v
       AttachmentService
              |
       AttachmentRepository
              |
      StorageProviderFactory
              |
       +------+-------+
       v              v
   Supabase      Cloudflare R2
```

No business module imports a storage provider, an SDK, or Google Drive
directly - enforced by `scripts/architecture-check.ts`, wired into CI
(`.github/workflows/ci.yml`) as a required step ahead of typecheck/lint/
test/build. Full detail: `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`
(permanent policy), `docs/architecture/STORAGE_PLATFORM.md` (Storage
Platform architecture), `docs/engineering/ATTACHMENT_FRAMEWORK.md`
(Attachment Platform data model and module adoption).

## Core Modules

- **NTR** (New Tractor Registration) - search-first registration
  workflow, Historical Import (see Core Platforms below), Tractor
  Registry/Profile, delete via the SECURITY DEFINER RPC workaround (see
  Known External Items).
- **PM** (Preventive Maintenance) - search-first maintenance recording,
  Maintenance Due/Health/Compliance engines, calculation-protection
  locking. Create and Edit both upload through the same
  `uploadAttachment()` pipeline.
- **QIR/MQR** (Quality Incident Report / Market Quality Report - one
  module, two names: "QIR" is the business/dealer-facing name, "MQR" is
  this codebase's internal naming, e.g. `records`/`report-form.tsx`) -
  quality-incident reporting, investigation workflow, audit trail.
- **Machine360** - per-tractor aggregation view (summary, timeline,
  attachments) across every module that has adopted the Attachment
  Platform: MQR, PM, and NTR today.

## Core Platforms

### Attachment Platform — **Foundation (feature-frozen)**

`src/shared/attachments/` - `AttachmentService` is the sole entry point
every business module uses for file storage (upload/get/preview/
download/delete/reassignEntity). Feature-frozen as of this release:
further work is bug fixes and security hardening only, not new
capability, until an explicit future decision reopens it.

### Storage Platform — **Foundation (feature-frozen)**

`StorageProviderFactory` + interchangeable `StorageProvider`
implementations (Supabase Storage primary, Google Drive archive,
Cloudflare R2 available and live-verified). Provider selection is
config-only (`STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` env vars) - switching
providers requires zero business-module code changes, enforced by
architecture-check Rule 4 (only `StorageProviderFactory` constructs
providers). Feature-frozen as of this release, same terms as above.

### Historical Import Framework — **Foundation (feature-frozen)**

Generic 5-step import wizard (`src/shared/import/`) plus NTR's own
concrete implementation (`docs/import/NTR_HISTORICAL_IMPORT.md`):
alias-based column mapping, Legacy/Strict serial-number validation
modes, Thailand address hierarchy validation, dry-run preview → atomic
per-row commit, downloadable corrected-and-reimportable Excel result
report, full audit trail. Feature-frozen as of this release, same terms
as above.

## Verification

All re-run fresh at release time, on this exact commit:

| Check | Result |
|---|---|
| Build | PASS - `next build` succeeds |
| Lint | PASS - 0 errors, 9 pre-existing warnings (`<img>`/alt-text, unrelated to this release) |
| Typecheck | PASS - `tsc --noEmit` clean |
| Tests | **PASS - 413/413** (44 test files) |
| Architecture Check | **PASS - 5/5** rules + CI integration check |
| Preview UAT | PASS - fresh Preview deployment at this exact commit; live-verified: NTR/PM/QIR upload (Cloudflare R2, confirmed via `storageProvider` in the API response), NTR delete (the SECURITY DEFINER RPC fix), Historical Import template download, all module pages (`/dashboard`, `/ntr`, `/pm-records`, `/records`, `/report`, `/vehicles`) load correctly |

## Known External Items

These are the only two open items blocking full production closure, and
both require action outside this codebase:

1. **Cloudflare R2 CORS configuration** - this application's own R2 API
   token cannot read or write the bucket's CORS policy (`AccessDenied`
   on both `GetBucketCorsCommand` and `PutBucketCorsCommand`, confirmed
   live). Requires a Cloudflare dashboard action by whoever holds
   separate Cloudflare account access. See
   `docs/engineering/R2_PRODUCTION_READINESS.md` for the exact
   configuration needed. Blocks a real browser's direct large-file PUT
   to R2 specifically; does not affect any currently-relied-upon flow.
2. **Supabase RLS platform anomaly (workaround applied)** - NTR/PM
   record deletion (`record_status: Active → Deleted`) was blocked by
   an unexplained Postgres/Supabase-level RLS enforcement anomaly,
   reproduced in a minimal SQL case with no application logic and with
   every plausible database-side mechanism (triggers, rules,
   inheritance, views, generated columns, grants, hidden policies, the
   RLS policy's own content) ruled out with direct evidence. Resolved
   via two narrow `SECURITY DEFINER` RPCs
   (`soft_delete_ntr_record()`/`soft_delete_pm_record()`) that perform
   only the intended soft-delete write, with all authorization (role,
   ownership, scope, `canDelete()`) still enforced in application code
   beforehand - not a replacement for RLS, a targeted bypass for a
   confirmed platform anomaly. Revisit if Supabase ever identifies the
   true root cause; the repository methods' public contract does not
   change either way, so reverting to a plain `.update()` is a one-file
   change per module.

## Superseded documents

- `docs/releases/PILOT_v1.0.0.md` - an earlier, narrower-scope
  (MQR+PM only) pilot release record, written before this branch's
  Attachment Platform/NTR migration work; superseded by this document.
  Moved to `docs/releases/archive/`.
- `docs/releases/RC1_RELEASE_NOTES.md` - the release-candidate notes for
  an earlier, 22-commit-scoped snapshot of this same branch; superseded
  by this document. Moved to `docs/releases/archive/`.

Not superseded (distinct, still-valid scope): `docs/releases/RELEASE_CHECKLIST_V1.md`
(MQR+PM production deployment checklist - a reusable procedure, not a
one-off snapshot) and `docs/releases/RELEASE_CHECKLIST_STORAGE_PLATFORM_V2.1.md`
(same, for the Storage Platform sub-release). `RELEASE_NOTES_v2.1.md`
and `CHANGELOG_STORAGE_PLATFORM.md` (root) remain valid, already-final
records of the Storage Platform sub-release within this larger v1.0.0
story - not release-candidate drafts, not archived.
