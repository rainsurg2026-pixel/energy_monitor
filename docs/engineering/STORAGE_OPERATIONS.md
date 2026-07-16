# Storage Operations

The operational layer over the Attachment Platform's storage
infrastructure - `StorageScheduler`, `StorageHealthService`,
`StorageMetricsService`, `StorageAuditService`
(`src/shared/attachments/`). Nothing here changes upload, archive, or
restore behavior; every class composes `AttachmentService`,
`AttachmentRepository`, `OrphanCleanupService`, and `StorageProvider`
implementations as they already exist. See
`docs/engineering/ATTACHMENT_FRAMEWORK.md` for the platform this
operates on and `docs/engineering/STORAGE_HYGIENE.md` for the orphan
detection this reuses.

## Scheduler

`StorageScheduler` is a callable surface, not a running scheduler - it
has no timer, no `vercel.json` cron entry, and registers nothing on
import. It supports three job types, each just a thin wrapper recording
`{ jobType, module, startedAt, finishedAt, success, summary, error }`
around an existing service call:

| Job | Delegates to | Notes |
|---|---|---|
| `runArchiveJob(module)` | `AttachmentService.enqueueArchiveEligible()` + `.processArchiveQueue()` | `processArchiveQueue()` itself still processes every `ARCHIVE_PENDING` row globally (existing, unchanged behavior) - `module` only scopes the enqueue step. |
| `runOrphanCleanupJob(module, { dryRun, retentionHours })` | `OrphanCleanupService.generateReport()` + `.cleanup()` | Defaults to `dryRun: true`. |
| `runHealthCheckJob(provider, module)` | `StorageHealthService.checkHealth()` | Live probe against the given provider. |

**No automatic scheduling is enabled anywhere in this milestone.** A
real cron trigger (`vercel.json` cron, an external scheduler, etc.)
calling these methods is a deliberately separate, future step - exactly
the same deferral already documented for `OrphanCleanupService`'s API
route in `STORAGE_HYGIENE.md`.

## Monitoring

`StorageHealthService.checkHealth(provider, module)` round-trips a small
throwaway object (`_health-check/<timestamp>.probe`) through the given
provider - upload, download, delete - to measure real latency, and
reports:

- `status`: `UP` (probe succeeded within `3000ms`), `DEGRADED` (succeeded
  but slower), or `DOWN` (the probe itself threw).
- `uploadLatencyMs` / `downloadLatencyMs`.
- `archiveErrorRate`: the fraction of rows currently `ARCHIVE_PENDING`/
  `ARCHIVING` that have a non-null `archive_error` - the one error signal
  the existing schema actually persists. **Not** a general
  upload/download/delete error rate - this platform has no per-request
  event log, so that broader rate can't be computed without a schema
  change (see "What this doesn't do" below). `null` when nothing is
  currently in the archive queue.
- `storageUsageBytes`: bytes used by that provider, scoped to the given
  module (an aggregate over `attachments` rows, not something the probe
  itself measures).

`StorageMetricsService.getMetrics(module)` aggregates, per module, over
`AttachmentRepository.listAllForModule()` (no new SQL):

- `totalObjects`, `totalStorageBytes`, `byProvider` (count + bytes per
  `StorageProviderName`).
- `uploadsPerDay`: rows created in the last 24 hours.
- `archiveCount`: rows with `status: 'ARCHIVED'`.
- `orphanCount`: `OrphanCleanupService.generateReport(module)`'s
  `orphanObjectCount + orphanRowCount`.
- `downloadsPerDay` / `deletesPerDay`: **always `null`.** Neither is
  tracked anywhere in the current schema - deletes remove the row
  entirely (no tombstone/event log) and `getSignedUrl()` calls
  (downloads) are never recorded. Returned as `null` rather than a
  fabricated number; see "What this doesn't do" below.

## Daily Audit

`StorageAuditService.generateDailyAuditReport(modules, options?)`
composes the above into one `StorageAuditReport`:

- `providerHealth`: one entry per primary + archive provider (from
  `StorageProviderFactory`), probed once via `StorageHealthService`.
- `orphanSummary.orphanCount`: summed across all given modules.
- `archiveSummary.archiveCount`: summed across all given modules.
- `storageGrowth`: `currentBytes` is always computed; `previousBytes`/
  `deltaBytes`/`deltaPercent` are `null` unless the caller passes
  `options.previousReport` (yesterday's report, if something is already
  keeping it around) - this service has no audit-history table of its
  own to compare against.
- `failedJobs`: `options.recentJobResults` filtered to `success: false`
  - empty unless the caller supplies job history from elsewhere; there
    is no persisted job-run log yet.

Run it once a day, per the set of modules in active use (`pm`, `mqr`,
...) - nothing currently calls this automatically (see Scheduler above).

## Alerting

No alerting integration exists yet - `StorageAuditReport` and
`ProviderHealthReport` are plain data, returned to whatever calls
`generateDailyAuditReport()`/`checkHealth()` directly (a script, an
admin API route, a future cron handler). Wiring these into an actual
alert channel (email, Slack, PagerDuty) is a future step; in the
meantime, treat `providerHealth[].status !== 'UP'` or a non-empty
`failedJobs` array as the conditions worth a human looking at the report.

## Incident Response

1. **A provider reports `DOWN`**: check `error` on that
   `ProviderHealthReport` first - it's the raw exception message from the
   failed probe (e.g. an R2 `AccessDenied`, a network timeout). Cross-check
   against `docs/engineering/R2_PRODUCTION_READINESS.md` if the provider is
   Cloudflare R2 - several known infrastructure-level gaps are already
   documented there.
2. **A provider reports `DEGRADED`**: not urgent by itself, but worth
   comparing `uploadLatencyMs`/`downloadLatencyMs` against prior runs (once
   audit reports are actually being kept somewhere) to see if it's a trend
   or a one-off blip.
3. **`archiveErrorRate` is high**: query `attachments` directly for
   `status IN ('ARCHIVE_PENDING','ARCHIVING')` with `archive_error IS NOT
   NULL` to see the actual error messages and `archive_attempts` per row;
   `StorageScheduler.runOrphanCleanupJob(module, { dryRun: false })` will
   pick up any that have exhausted `MAX_ARCHIVE_ATTEMPTS` as
   `FAILED_ARCHIVE` / `MANUAL_REVIEW` findings (see `STORAGE_HYGIENE.md`).
4. **`orphanCount` is unexpectedly high**: run
   `OrphanCleanupService.generateReport(module)` directly (dry-run first,
   always) via `/api/attachments/orphan-cleanup?module=<module>` before
   assuming anything needs cleaning up - a spike right after a bulk
   operation is often just the retention window catching up, not a defect.

## Recovery

- None of the services in this milestone perform destructive actions on
  their own - `StorageScheduler.runOrphanCleanupJob()` still defaults to
  `dryRun: true`, and `runArchiveJob()`/`runHealthCheckJob()` only read or
  move data through `AttachmentService`'s own, already-verified archive
  flow (checksum/size verification before `ARCHIVED`, never deleting the
  source copy first - see `AttachmentService.processArchiveQueue()`).
- If a health probe leaves a stray `_health-check/*` object behind (the
  `finally` block's own delete attempt failed), it is safe to delete
  manually - nothing in this platform ever creates an `attachments` row
  referencing that prefix, so it can never appear as anything other than
  a genuine `ORPHAN_OBJECT` in a hygiene scan.
- Recovering from a `DOWN` provider is entirely a Cloudflare
  dashboard/infrastructure question, not an application-code one - see
  `R2_PRODUCTION_READINESS.md`'s own Rollback Checklist.

## Configuration

No new environment variables - this milestone only composes existing
configuration (`STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` via
`StorageProviderFactory`, `ORPHAN_RETENTION_HOURS` via
`OrphanCleanupService`).

## What this milestone deliberately does not do

- No automatic/scheduled execution of any job - `StorageScheduler` is
  callable, not scheduled.
- No automatic cleanup - `runOrphanCleanupJob()` still defaults to
  `dryRun: true`, matching `OrphanCleanupService` itself.
- No production rollout of anything - this is infrastructure for
  operating the storage platform, not a change to which provider is
  active in any environment.
- No real download/delete event tracking, no persisted job-run history,
  no persisted audit-report history - all three would need a new table
  (an event log / job-history table), which is a schema change and out of
  scope for "do not redesign the storage architecture." `downloadsPerDay`/
  `deletesPerDay` are honestly `null`, and growth/failed-job trend data
  only exists when a caller supplies its own prior snapshot.
- No alert-channel integration (email/Slack/PagerDuty) - reports are
  plain data today.
