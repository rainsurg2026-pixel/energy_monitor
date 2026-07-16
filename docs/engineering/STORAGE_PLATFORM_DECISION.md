# Storage Platform — Architecture Decision (Freeze)

Companion to `STORAGE_PLATFORM_FINAL.md` (the structural reference) -
this document is the *why*: what was decided, what was deliberately left
undecided, and what would need to happen next if either changes.

## Final architecture

`AttachmentService` is the sole entry point for every business module;
`StorageProvider` is the sole abstraction a storage backend implements;
`StorageProviderFactory` is the sole seam that chooses which backend is
active, from configuration. Primary storage defaults to Supabase
Storage, archive storage defaults to Google Drive - both unchanged from
before this platform existed. Cloudflare R2 is implemented and fully
tested as a third `StorageProvider` but is not selected anywhere by
default. A maintenance layer (`OrphanCleanupService`,
`StorageHealthService`, `StorageMetricsService`, `StorageAuditService`,
`StorageScheduler`) operates on top of the same primitives, callable but
not scheduled. This is the frozen shape - see `STORAGE_PLATFORM_FINAL.md`
for the full component/dependency/lifecycle detail.

## Design rationale

- **One door, not per-module storage code** (ADR-010): before this
  platform, upload/archive logic was duplicated per feature. Centralizing
  it behind `AttachmentService` means a provider migration, a metadata
  fix, or a new orphan-detection rule is one change, not N.
- **Provider abstraction over a specific SDK**: `StorageProvider` was
  designed narrow (six required methods, two optional) specifically so a
  provider swap is a config change (`StorageProviderFactory`), not a
  rewrite of `AttachmentService` or any caller. This paid off exactly as
  intended when Cloudflare R2 was added as a third implementation without
  touching a single business module.
- **R2 implemented but not adopted by default**: the R2 Production
  Readiness Review found real infrastructure blockers (a publicly
  readable bucket, missing CORS) that were partly application-code fixes
  (never return a public URL - done) and partly Cloudflare-dashboard
  configuration (resolved for the public-URL blocker; CORS was the one
  remaining gap as of the last live check). Switching the *default*
  primary provider is a separate, deliberate decision this freeze does
  not make - the seam exists, the decision doesn't need to be forced.
- **Archive provider can't yet be Cloudflare R2**: `AttachmentService.getUrl()`
  only resolves an `ARCHIVED` row's URL from its stored `driveUrl` column.
  Teaching it to call a generic archive provider's `getSignedUrl()`
  instead is a real, scoped feature - `StorageProviderFactory` rejects
  `ARCHIVE_PROVIDER=CLOUDFLARE_R2` outright rather than leaving a silent
  runtime gap.
- **Maintenance services read providers/repository directly**, unlike
  business modules: `OrphanCleanupService` exists specifically to detect
  when `AttachmentService`'s own invariants have already broken (a row
  with no object, an object with no row) - it cannot detect that through
  `AttachmentService`'s own abstraction, since that abstraction assumes
  the invariant holds. This is a deliberate, narrow exception to "only
  `AttachmentService`," not a crack in the boundary.
- **Never fabricate what isn't tracked**: `downloadsPerDay`/
  `deletesPerDay` are `null`, not estimated or zero-filled - the schema
  has no event log for either. Growth/failed-job trends in
  `StorageAuditReport` are `null`/empty unless a caller supplies its own
  prior snapshot. This was a repeated, deliberate choice across this
  session rather than inventing numbers to satisfy a requirement's shape.

## Known limitations

- **`downloadsPerDay`/`deletesPerDay` are not derivable** - no per-request
  event log exists; deletes remove the row entirely (no tombstone).
- **No persisted audit-report or job-run history** - `StorageAuditService`/
  `StorageScheduler` don't write their own results anywhere; a caller
  wanting a trend must keep it themselves.
- **`FAILED_RESTORE` is only partially detectable** - `restore()` has no
  intermediate status the way archiving has `ARCHIVING`; a genuinely
  interrupted restore usually surfaces as `ORPHAN_OBJECT` instead (see
  `STORAGE_HYGIENE.md`).
- **No automatic scheduling exists anywhere** - `StorageScheduler` and
  `/api/attachments/orphan-cleanup` are both callable-but-unscheduled by
  explicit decision across multiple milestones; a real cron integration
  still needs a service-to-service credential (a cron job has no browser
  session cookie, and today's routes only accept the same SuperAdmin
  session check every other admin route uses).
- **Cloudflare R2 CORS was the last known open infrastructure blocker**
  as of the last live verification (`R2_PRODUCTION_READINESS.md`) -
  browser-direct uploads to R2 would fail preflight until Cloudflare
  dashboard CORS configuration is applied. This is infrastructure, not
  application code, and does not block anything on the currently-active
  Supabase/Google Drive path.
- **Deletions performed by `OrphanCleanupService.cleanup({ dryRun: false })`
  are irreversible** - no soft-delete/trash exists for storage objects in
  this platform.

## Future roadmap

Explicitly not decided or scheduled by this freeze - listed here as
known, real options, not commitments:

1. **Adopt Cloudflare R2 as default primary storage** - once CORS is
   configured and a rollout is explicitly approved (`STORAGE_PROVIDER=CLOUDFLARE_R2`
   in production). Requires no `AttachmentService`/business-module change.
2. **Teach `AttachmentService.getUrl()` to resolve a signed URL from any
   archive provider**, not just Google Drive's stored `driveUrl` - would
   unblock `ARCHIVE_PROVIDER=CLOUDFLARE_R2`.
3. **Add a `RESTORING` status** (mirroring `ARCHIVING`) to fully detect
   `FAILED_RESTORE` as its own orphan case, rather than the current
   partial signal.
4. **Add real event tracking** (a lightweight append-only log, or reuse
   of the existing platform event stream referenced in
   `docs/engineering/PLATFORM_SERVICES.md`/`ADR-004`) to make
   `downloadsPerDay`/`deletesPerDay` genuinely derivable, and to give
   `StorageAuditService` real growth/failed-job trends without relying on
   a caller to keep its own history.
5. **Wire an actual cron trigger** for `StorageScheduler`
   (`vercel.json` cron or equivalent) with a service credential distinct
   from the SuperAdmin session check, once archive/orphan-cleanup
   automation is explicitly approved - "do not enable automatic
   scheduling"/"do not enable automatic cleanup" have applied to every
   milestone so far and remain in force until a future instruction lifts
   them.
6. **`PURGED` status / a real retention-purge feature** - `AttachmentStatus`
   already reserves the value; nothing transitions into it yet.

None of these are implied to happen next - each requires its own explicit
milestone, the same way every step of this platform's build-out has.
