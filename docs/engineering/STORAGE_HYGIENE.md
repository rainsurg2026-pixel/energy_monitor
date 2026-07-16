# Storage Hygiene

`src/shared/attachments/OrphanCleanupService.ts` - detects and (only when
explicitly told to) cleans up the ways the Attachment Platform's
upload/archive/restore flows can leave storage and the database
out of sync with each other. A maintenance tool alongside
`AttachmentService`, not a change to it - nothing about upload, archive,
or restore behavior is different because this exists. See
`docs/engineering/ATTACHMENT_FRAMEWORK.md` for the platform this
maintains, `docs/architecture/STORAGE_PLATFORM.md` for the provider
abstraction it scans against.

## Orphan Lifecycle

Five detectable cases (a sixth, `FAILED_RESTORE`, is defined but only
partially detectable - see below):

| Kind | What it means | How it's found |
|---|---|---|
| `ORPHAN_OBJECT` | An object exists in storage with no `attachments` row referencing it | `provider.list(module)` minus every row's `storage_path` |
| `ORPHAN_ROW` | An `ACTIVE` row's `storage_path` points at an object that no longer exists | `provider.exists(row.storagePath)` returns `false` |
| `ABANDONED_UPLOAD` | A direct-upload placeholder row (`initDirectUpload()`'s `sizeBytes: 0`/`checksum: null`) that `finalizeDirectUpload()` never completed | Row is `ACTIVE` with `sizeBytes === 0 && checksum === null`, older than the retention window |
| `FAILED_ARCHIVE` | A row stuck in `ARCHIVE_PENDING`/`ARCHIVING`, either past its retry budget or just stuck too long | `archiveAttempts >= MAX_ARCHIVE_ATTEMPTS`, or age past the retention window since `lastArchiveAttemptAt` |
| `FAILED_RESTORE` | An `ARCHIVED` row missing the Drive reference it should always have | `status === 'ARCHIVED' && !driveFileId` |

**Why every case needs an age check, not just a mismatch check:** a
brand-new placeholder row, or an object whose DB insert hasn't committed
yet, is not a defect - it's normal, momentary state during a real upload
in progress. `ORPHAN_RETENTION_HOURS` (default 24) is the grace period
before a mismatch is treated as abandoned rather than in-flight. Every
detection rule in `OrphanCleanupService` checks age before flagging
anything (except `FAILED_RESTORE`, which is inherently already terminal -
an `ARCHIVED` row is never "in progress").

### Why `FAILED_RESTORE` can't be fully detected

`AttachmentService.restore()` has no intermediate status the way
archiving has `ARCHIVING` - if it fails after re-uploading a fresh copy
to primary storage but before `AttachmentRepository.restoreToActive()`
persists that, the result is an **untracked duplicate object with no DB
reference at all** - which surfaces as an `ORPHAN_OBJECT`, not a distinct
`FAILED_RESTORE` finding. The `ARCHIVED`-without-`driveFileId` check above
catches a different, narrower inconsistency (data corruption on the row
itself). Building true restore-failure detection would mean adding a
`RESTORING` status to the schema, mirroring `ARCHIVING` - a real feature,
out of scope for this milestone ("do not redesign the storage platform").

## Cleanup Strategy

`OrphanCleanupService.generateReport(module, retentionHours?)` only ever
**reads** - it never deletes anything, regardless of what it finds.
`OrphanCleanupService.cleanup(report, { dryRun })` is the only method that
can act, and:

- `dryRun: true` (the default anywhere a caller doesn't explicitly ask for
  the opposite) - every finding is recorded as `SKIPPED`, nothing is
  touched. This is "safe cleanup mode" in report-only form.
- `dryRun: false` ("safe cleanup mode") - each finding's
  `recommendedAction` is executed:
  - `DELETE_OBJECT` → `provider.delete(objectKey)`
  - `DELETE_ROW` → `repo.delete(attachmentId)`
  - `RETRY_ARCHIVE` → `repo.markArchivePending(attachmentId)` (re-queues
    it for `AttachmentService.processArchiveQueue()`'s next run - this
    service never re-implements the archive logic itself)
  - `MANUAL_REVIEW` → **always skipped, even with `dryRun: false`**. This
    is the one hard rule: nothing this service couldn't classify with
    confidence is ever auto-actioned, no matter which mode is running.

There is no third, "fully automatic" mode, and no persistent
configuration flag that changes this - every cleanup run is an explicit,
one-time choice by whoever/whatever calls `cleanup()`.

## Recovery Strategy

- An `ORPHAN_OBJECT` deleted in error (a false positive, e.g. a
  hand-uploaded test object matching the key convention by coincidence)
  is unrecoverable once deleted - there's no soft-delete/trash for
  storage objects in this platform. This is exactly why cleanup defaults
  to dry-run and requires an explicit opt-in.
- An `ORPHAN_ROW` deleted in error is similarly unrecoverable via this
  tool - but since by definition its object doesn't exist either, the
  attachment was already unusable; deleting the row just stops it
  cluttering queries.
- A `FAILED_ARCHIVE` requeued via `RETRY_ARCHIVE` is fully recoverable -
  `processArchiveQueue()` will simply attempt the archive again on its
  next run, with `archiveAttempts` already reflecting prior tries.
- `MANUAL_REVIEW` findings require a human to look at the specific row
  (via `AttachmentRepository.getById()`/a direct DB query) and decide -
  this service deliberately provides no automated path for these.

## Operational Procedure

1. Run a dry-run scan for a module: `GET /api/attachments/orphan-cleanup?module=pm`
   (SuperAdmin session required). Review the returned report's `findings`
   and `summary` before doing anything else.
2. If the findings look correct, re-run with `dryRun=false`:
   `GET /api/attachments/orphan-cleanup?module=pm&dryRun=false`. This
   actually deletes/requeues per finding, per the Cleanup Strategy above.
3. Override the retention window per-call if needed:
   `&retentionHours=48` (or set `ORPHAN_RETENTION_HOURS` in the
   environment for a persistent default - see Configuration below).
4. Repeat per module (`pm`, `mqr`, ...) - a report is always scoped to one
   module at a time, matching how `attachment_retention_policies` and
   every other cross-cutting attachment operation in this platform are
   already module-scoped.

**Manual execution** is exactly the above - an authenticated SuperAdmin
hitting the route. **Cron execution** is *supported* by this route (it's
a plain, idempotent `GET`, safe to call repeatedly) but **no actual cron
trigger is wired up** ("do not implement archive scheduling yet"). A real
cron integration still needs a service-to-service credential - a cron job
has no browser session cookie, and this route currently only accepts the
same SuperAdmin session check every other admin route uses. Documented
here as a known gap, not silently worked around.

## Configuration

`ORPHAN_RETENTION_HOURS` (default `24`) - read by
`getOrphanRetentionHours()` (`src/shared/attachments/orphanConfig.ts`).
Unset or invalid falls back to the default rather than throwing, since
this only affects a maintenance scan, never the upload/archive/restore
paths themselves (unlike `r2Config.ts`'s `getR2Config()`, which throws
loudly for a missing var that *would* break a real upload).

## Observability

Every `OrphanCleanupReport`/`OrphanCleanupResult` carries:

- `summary.orphanObjectCount`
- `summary.orphanRowCount`
- `summary.cleanupCount`
- `summary.skippedCount`
- `summary.failedCleanupCount`

These are returned as plain JSON from `/api/attachments/orphan-cleanup` -
exposed for now via the API response itself (log it, pipe it to whatever
this app's operators already watch), not wired into a dashboard/metrics
system of its own. Building that integration is a future step, consistent
with `docs/engineering/R2_PRODUCTION_READINESS.md`'s own deferred
monitoring recommendations.

## What this milestone deliberately does not do

- No automatic/scheduled cleanup runs anywhere - every cleanup is a
  manually-triggered API call.
- No cron trigger, no `vercel.json` cron entry, no service-credential auth
  path for the API route - "do not implement archive scheduling yet."
- No change to `AttachmentService`'s upload/archive/restore behavior, and
  no business module was touched.
- No true `RESTORING`-status detection for `FAILED_RESTORE` - a schema
  change, out of scope.
