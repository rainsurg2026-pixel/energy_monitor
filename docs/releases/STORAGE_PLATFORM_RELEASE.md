# Storage Platform — Release Audit

Release audit for `src/shared/attachments/` as the frozen MASP Storage
Platform baseline. Companion documents: `docs/engineering/STORAGE_PLATFORM_FINAL.md`
(structural reference), `docs/engineering/STORAGE_PLATFORM_DECISION.md`
(design rationale/roadmap), `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`
(the permanent policy this release freezes into).

## Completed milestones

In build order:

1. **Attachment & Media Platform** (ADR-010) — `AttachmentService`,
   `AttachmentRepository`, `StorageProvider` interface,
   `SupabaseStorageProvider` (primary), `GoogleDriveStorageProvider`
   (archive). New `attachments`/`attachment_retention_policies` tables.
2. **Attachment Platform Adoption** — MQR and PM/Maintenance migrated
   their upload paths onto the platform; Machine 360 gained a real
   Attachments section (`AttachmentViewer`).
3. **Cloudflare R2 provider** — `CloudflareR2Provider` (S3-compatible API),
   built and unit-tested standalone, not selected by default.
   `StorageProvider` gained `exists()`/`list()`; `getUrl` renamed to
   `getSignedUrl`.
4. **StorageProviderFactory** — config-driven provider selection
   (`STORAGE_PROVIDER`/`ARCHIVE_PROVIDER`); `AttachmentService` no longer
   hardcodes a provider class.
5. **Cloudflare R2 enabled in dev, live-verified** — full lifecycle
   (upload → persist → signed URL → preview → download → exists → list →
   delete) confirmed against a real R2 bucket + Supabase DB.
6. **Metadata integrity fix** — a live-testing-caught regression
   (`AttachmentRepository.create()` hardcoding `storage_provider: 'SUPABASE'`
   regardless of the actual provider) fixed; the real provider name is now
   threaded through every repository write.
7. **R2 Production Readiness Review** — 12-category audit
   (`R2_PRODUCTION_READINESS.md`); found the bucket was publicly readable
   (critical).
8. **Final Production Hardening** — removed every permanent/public URL
   code path from `CloudflareR2Provider`; object-key sanitization added to
   `AttachmentService.buildStoragePath()`.
9. **Production Gate Review / infrastructure investigation** — verified
   GO/NO-GO items with live evidence; identified two remaining
   infrastructure-only blockers (public dev URL, CORS).
10. **Production Infrastructure Hardening** — live-reconfirmed the public
    URL blocker resolved (dashboard-level fix, confirmed 200→401); CORS
    confirmed still open via live preflight.
11. **Storage Hygiene** — `OrphanCleanupService` (five detectable orphan
    cases), dry-run-by-default cleanup, `/api/attachments/orphan-cleanup`.
12. **Storage Operations** — `StorageHealthService`, `StorageMetricsService`,
    `StorageAuditService`, `StorageScheduler` (callable, not scheduled).
13. **Platform Freeze (architecture review)** — confirmed no dead code,
    no legacy paths, every business module depends only on
    `AttachmentService`.
14. **Platform Freeze & Release** (this milestone) — release audit,
    Platform Architecture Standards, architecture-test coverage review, changelog,
    project status update.

## Architecture summary

One entry point (`AttachmentService`) in front of two roles (primary,
archive), each backed by an interchangeable `StorageProvider`. Provider
choice is a configuration seam (`StorageProviderFactory`), never a code
change. A maintenance layer (hygiene, health, metrics, audit, scheduling)
operates on the same primitives, callable but never automatically
triggered. Full detail: `docs/engineering/STORAGE_PLATFORM_FINAL.md`.

## Implemented components

| Component | Status |
| --- | --- |
| `AttachmentService` | Complete, in production use (MQR + PM). |
| `AttachmentRepository` | Complete. |
| `SupabaseStorageProvider` | Complete, primary (default), in production use. |
| `GoogleDriveStorageProvider` | Complete, archive (default), in production use. |
| `CloudflareR2Provider` | Complete, unit-tested, **not** selected by default anywhere. |
| `StorageProviderFactory` | Complete. |
| `AttachmentErrors` | Complete. |
| `OrphanCleanupService` | Complete, dry-run default, manual-trigger only. |
| `StorageHealthService` | Complete, on-demand probe only. |
| `StorageMetricsService` | Complete; `downloadsPerDay`/`deletesPerDay` intentionally `null` (untracked). |
| `StorageAuditService` | Complete; growth/failed-job trends require caller-supplied history. |
| `StorageScheduler` | Complete; not wired to any cron/timer. |

## Verification summary

Every milestone in this list was independently verified
(lint/typecheck/test/build) before being reported complete. Current
state as of this release:

- `eslint` (full project) → 0 errors, 7 pre-existing unrelated warnings
  (`<img>`/alt-text, none in the Storage Platform).
- `tsc --noEmit` → clean.
- `vitest run` → 308/308 passing (attachments-platform tests span
  `AttachmentService`, `AttachmentRepository` behavior via
  `AttachmentService`/integration tests, `CloudflareR2Provider`,
  `StorageProviderFactory`, `OrphanCleanupService`,
  `StorageHealthService`, `StorageMetricsService`, `StorageScheduler`,
  `StorageAuditService`, `AttachmentErrors`).
- `next build` → succeeds.

Live E2E verification (real Cloudflare R2 bucket + Supabase DB, dev
environment only) was performed across milestones 5, 6, 9, and 10 above -
never fabricated, always cleaned up afterward (test rows deleted, probe
objects removed).

## Known limitations

- **Cloudflare R2 CORS** was the last confirmed-open infrastructure
  blocker as of the last live check (`R2_PRODUCTION_READINESS.md`) -
  browser-direct uploads to R2 would fail preflight until Cloudflare
  dashboard CORS is configured. Does not affect the currently-active
  Supabase/Google Drive path.
- **`downloadsPerDay`/`deletesPerDay`** are not derivable from the
  current schema (no event log; deletes remove the row entirely).
- **No persisted audit-report or job-run history** - trend data in
  `StorageAuditReport` requires the caller to supply its own prior
  snapshot.
- **`FAILED_RESTORE` orphan detection is partial** - `restore()` has no
  intermediate status; a genuinely interrupted restore usually surfaces
  as `ORPHAN_OBJECT` instead.
- **No automatic scheduling anywhere** - `StorageScheduler` and the
  orphan-cleanup API route are both callable-only; a real cron
  integration needs a service credential not yet built (today's routes
  only accept the same SuperAdmin session check every other admin route
  uses).
- **No architecture-enforcement tooling exists** - `scripts/architecture-check.ts`
  (referenced by this milestone's own instructions) does not exist in
  this repository. Dependency-direction rules
  (`.claude/rules/01-architecture-boundaries.md`) are enforced by
  convention/code review only, not by an automated check. See
  `PLATFORM_ARCHITECTURE_STANDARDS.md`'s Future Extension Rules and the
  Architecture Test section below.
- **Cloudflare R2 is not the active primary/archive provider anywhere** -
  fully implemented and tested, but adopting it is a distinct, unmade
  decision (`STORAGE_PLATFORM_DECISION.md`).

## Production prerequisites

Before `STORAGE_PROVIDER=CLOUDFLARE_R2` (or `ARCHIVE_PROVIDER`) is set in
any real environment:

1. Configure CORS on the R2 bucket via the Cloudflare dashboard (the
   application's own API token cannot read or write bucket CORS config -
   confirmed via `AccessDenied` on both `GetBucketCorsCommand` and
   `PutBucketCorsCommand`).
2. Re-run a live end-to-end verification against that environment's real
   bucket (this platform's established practice every time a provider
   config changes).
3. Explicit, separate approval to switch the default - this release does
   not change `STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` anywhere.
4. If archive-side R2 is ever wanted: implement
   `AttachmentService.getUrl()`'s missing signed-URL path for a non-Drive
   archive provider first (`StorageProviderFactory` currently rejects
   `ARCHIVE_PROVIDER=CLOUDFLARE_R2` specifically because this doesn't
   exist yet).

No other production prerequisite exists for the parts of the platform
already live (Supabase primary / Google Drive archive) - that path has
been in production use since Phase 5B.1 with no open blocker.

## Architecture test coverage

This milestone's own instructions asked to review `scripts/architecture-check.ts`.
**That file does not exist in this repository** - confirmed by a
repo-wide search (`scripts/` contains only `get-google-refresh-token.mjs`,
a pre-existing, unrelated Google OAuth setup helper). There is no
automated check anywhere in this repo - not in `scripts/`, not in
`.github/workflows/ci.yml` (which runs `tsc --noEmit` → `lint` → `build`
→ `test`, none of which enforce import-direction/boundary rules) - that
enforces:

- **Forbidden imports** (e.g. a business module importing
  `AttachmentRepository`/`StorageProvider`/a concrete provider class
  directly instead of `AttachmentService`).
- **Dependency direction** (`shared/` never importing from a business
  module; a module never importing another module's internals).
- **Platform boundaries** (the layer separation this release's
  `PLATFORM_ARCHITECTURE_STANDARDS.md` now documents formally).

Current coverage is **zero automated, code-reviewed only** -
`.claude/rules/01-architecture-boundaries.md` already states this
explicitly for the `modules`/`shared`/`templates` scaffolding ("none of
the above is enforced by tooling... treat it as binding anyway"), and
the same is true, in practice, for `src/shared/attachments/` - this
release's compliance findings (§"Completed milestones" #13, and
`STORAGE_PLATFORM_FINAL.md`'s dependency-graph verification) were
produced by manual `grep`/read-through, not a repeatable check.

Per this milestone's own instruction ("do not expand scope beyond
documentation unless a critical defect is found") - **no defect was
found to justify writing the missing script**. A missing tool is a gap,
not a defect in existing code; building `scripts/architecture-check.ts`
itself would be new feature work (tooling), explicitly out of scope for
a freeze/release milestone. It is recorded here, in
`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Future Extension Rules, and in this
document's Release Checklist as a real, open gap for a future, separate
milestone to close.

## Release checklist

- [x] Every business module depends only on `AttachmentService`.
- [x] No dead code, obsolete comments, or deprecated interfaces found in
      `src/shared/attachments/`.
- [x] No legacy/duplicate Google Drive upload logic inside the platform
      (the separate QIR `api/upload/*` pipeline is a distinct,
      intentionally-untouched pre-existing feature, not a leftover).
- [x] All three providers implement the same `StorageProvider` interface
      and are swappable via configuration only.
- [x] `lint`/`typecheck`/`test`/`build` all pass.
- [x] `docs/engineering/STORAGE_PLATFORM_FINAL.md` and
      `STORAGE_PLATFORM_DECISION.md` published.
- [x] `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` published.
- [x] `CHANGELOG_STORAGE_PLATFORM.md` published.
- [x] `PROJECT_STATE.md` updated - Storage Platform: COMPLETE.
- [ ] Cloudflare R2 CORS configured (Cloudflare dashboard - out of this
      repository's scope).
- [ ] Explicit approval + separate milestone to switch any environment's
      active `STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` away from today's
      defaults.
- [ ] `scripts/architecture-check.ts` (or equivalent CI-enforced check)
      does not exist - flagged as a gap, not created here (would be new
      feature work, out of this milestone's "documentation only" scope
      for that task).
