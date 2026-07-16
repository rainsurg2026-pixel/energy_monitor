# Storage Platform — Final Architecture (Freeze)

This document is the frozen reference for `src/shared/attachments/` as of
this milestone. It supersedes nothing - `docs/engineering/ATTACHMENT_FRAMEWORK.md`,
`STORAGE_HYGIENE.md`, `STORAGE_OPERATIONS.md`, `R2_PRODUCTION_READINESS.md`,
and `docs/architecture/STORAGE_PLATFORM.md` all remain the detailed
references for the areas they each cover; this document is the single
place that shows how all of it fits together, end to end.

## Architecture

The Storage Platform is one door (`AttachmentService`) in front of two
swappable roles (primary storage, archive storage), each backed by an
interchangeable `StorageProvider` implementation, plus a maintenance
layer (orphan detection, health, metrics, audit, scheduling) that reads
and repairs what the platform itself produced. No business module (MQR,
PM/Maintenance, Machine 360) talks to a provider, the repository, or an
SDK directly - every one of them goes through `AttachmentService` only
(verified below).

```
                          ┌────────────────────────────┐
                          │      Business modules       │
                          │  MQR · PM/Maintenance ·      │
                          │  Machine 360                 │
                          └──────────────┬───────────────┘
                                         │  only this
                                         ▼
                          ┌────────────────────────────┐
                          │      AttachmentService       │  upload / list / getUrl
                          │                              │  delete / restore /
                          │                              │  markBusinessComplete /
                          │                              │  enqueueArchiveEligible /
                          │                              │  processArchiveQueue
                          └───────┬──────────────┬────────┘
                                  │              │
                     ┌────────────┘              └────────────┐
                     ▼                                        ▼
          ┌────────────────────┐                 ┌────────────────────────┐
          │  AttachmentRepository │               │  StorageProviderFactory  │
          │  (Supabase `attachments` table)        │  reads STORAGE_PROVIDER/ │
          └────────────────────┘                 │  ARCHIVE_PROVIDER        │
                                                   └──────────┬───────────────┘
                                                              │ constructs
                                       ┌──────────────────────┼──────────────────────┐
                                       ▼                      ▼                      ▼
                            ┌──────────────────┐   ┌──────────────────────┐  ┌──────────────────┐
                            │ SupabaseStorage-  │   │ GoogleDriveStorage-   │  │ CloudflareR2      │
                            │ Provider (primary,│   │ Provider (archive,    │  │ Provider          │
                            │ default)          │   │ default)              │  │ (implemented,     │
                            │                   │   │                       │  │ not selected by   │
                            │                   │   │                       │  │ default)          │
                            └──────────────────┘   └──────────────────────┘  └──────────────────┘
                                       ▲                      ▲                      ▲
                                       └──────────── implements StorageProvider ──────┘

                          ┌────────────────────────────────────────────────────┐
                          │              Maintenance / Operations layer          │
                          │  OrphanCleanupService · StorageHealthService ·       │
                          │  StorageMetricsService · StorageAuditService ·       │
                          │  StorageScheduler (callable, not scheduled)          │
                          │  - reads AttachmentRepository + StorageProvider      │
                          │    directly (an operational exception - never a      │
                          │    business module)                                  │
                          └────────────────────────────────────────────────────┘
```

## Component diagram

| Component | File | Responsibility |
|---|---|---|
| `AttachmentService` | `AttachmentService.ts` | The only door business modules use - upload, list, resolve a URL, delete, restore, business-completion, archive queue. |
| `AttachmentRepository` | `AttachmentRepository.ts` | All persistence against the `attachments` table. Owns no business decisions. |
| `StorageProvider` (interface) | `StorageProvider.ts` | The contract every backend implements: `upload`/`download`/`delete`/`exists`/`getSignedUrl`/`list`, optional `createSignedUploadUrl`/`statObject`. |
| `SupabaseStorageProvider` | `SupabaseStorageProvider.ts` | Primary storage (default). |
| `GoogleDriveStorageProvider` | `GoogleDriveStorageProvider.ts` | Archive storage (default). Wraps `lib/googleDrive.ts` - never duplicates its logic. |
| `CloudflareR2Provider` | `CloudflareR2Provider.ts` | Implemented, fully tested, **not selected by default anywhere**. Never returns a public/permanent URL. |
| `StorageProviderFactory` | `StorageProviderFactory.ts` | Chooses a provider from `STORAGE_PROVIDER`/`ARCHIVE_PROVIDER`; rejects `ARCHIVE_PROVIDER=CLOUDFLARE_R2` (no signed-URL path for it yet). |
| `AttachmentErrors` | `AttachmentErrors.ts` | Translates any provider/SDK error into one of five fixed, business-friendly messages at the API boundary. |
| `OrphanCleanupService` | `OrphanCleanupService.ts` | Detects the five orphan-attachment cases; cleans up only when explicitly told to (`dryRun: false`), never `MANUAL_REVIEW` findings. |
| `StorageHealthService` | `StorageHealthService.ts` | Live upload/download/delete probe against one provider; archive-error rate; module-scoped storage usage. |
| `StorageMetricsService` | `StorageMetricsService.ts` | Per-module aggregate counts/bytes/uploads-per-day/archive-count/orphan-count. |
| `StorageAuditService` | `StorageAuditService.ts` | Composes the above into one daily `StorageAuditReport`. |
| `StorageScheduler` | `StorageScheduler.ts` | Callable job surface (archive / orphan cleanup / health check) for a future cron - not itself scheduled. |

## Dependency graph

```
business modules ──▶ AttachmentService ──▶ AttachmentRepository ──▶ Supabase (attachments table)
                                     └────▶ StorageProviderFactory ──▶ StorageProvider impls ──▶ Supabase Storage / Google Drive API / R2 (S3 API)

OrphanCleanupService ──▶ AttachmentRepository, StorageProvider (via StorageProviderFactory)
StorageHealthService ──▶ AttachmentRepository, StorageProvider (passed in by caller)
StorageMetricsService ──▶ AttachmentRepository, OrphanCleanupService
StorageAuditService ──▶ StorageHealthService, StorageMetricsService, StorageProviderFactory
StorageScheduler ──▶ AttachmentService, OrphanCleanupService, StorageHealthService
```

One-way only: nothing under `StorageProvider`/`AttachmentRepository`
imports back up toward `AttachmentService` or a business module. The
maintenance layer depends downward on the same primitives
`AttachmentService` uses, never on `AttachmentService` itself (it needs
raw repository/provider access to detect exactly the kind of drift
`AttachmentService`'s own abstraction would hide).

**Verified this milestone**: every business-facing import of
`@/shared/attachments` (`features/machine/service.ts`,
`features/maintenance/components/maintenance-form.tsx`,
`components/shared/attachments/uploadAttachment.ts`, every `pm-records`/
`records`/`vehicles` page and API route) imports only `AttachmentService`,
plain types (`Attachment`, `AttachmentType`), or
`toUserFacingAttachmentError` - never `AttachmentRepository`,
`StorageProvider`, a concrete provider class, or `StorageProviderFactory`.
The one exception is `/api/attachments/orphan-cleanup`, which imports
`OrphanCleanupService` - an operational/admin route, not a business
module.

## Lifecycle

```
upload()              ──▶ ACTIVE
markBusinessComplete() ──▶ ACTIVE (business_completed_at set; retention clock starts)
enqueueArchiveEligible() (past retention_days) ──▶ ARCHIVE_PENDING
processArchiveQueue()  ──▶ ARCHIVING ──▶ (verify checksum+size) ──▶ ARCHIVED
                                       └─ (on failure) ──▶ ARCHIVE_PENDING (archive_attempts++, retry up to MAX_ARCHIVE_ATTEMPTS)
restore()              ──▶ ARCHIVED ──▶ ACTIVE (fresh copy re-uploaded to primary)
delete()               ──▶ row removed (hard delete of the attachment row + underlying object)
```

`PURGED` exists in `AttachmentStatus` for a future retention-purge feature
- nothing in this platform transitions a row into it yet.

Direct (browser-to-storage) large-file uploads run a two-step variant of
the same lifecycle: `initDirectUpload()` pre-creates an `ACTIVE` row with
`sizeBytes: 0`/`checksum: null`, then `finalizeDirectUpload()` confirms
the object actually landed (via `statObject()`) before anything downstream
trusts it.

## Provider model

Three `StorageProvider` implementations exist; two are wired by default:

| Provider | Role | Selected by default | Notes |
|---|---|---|---|
| Supabase Storage | Primary | Yes | `mqr-files` bucket. |
| Google Drive | Archive | Yes | Wraps `lib/googleDrive.ts`; flat `attachment-archive` folder. |
| Cloudflare R2 | Neither | No | Fully implemented and tested; adopting it as primary is a separate, explicit, not-yet-made decision (`STORAGE_PLATFORM_DECISION.md`). Rejected outright as an archive provider (`StorageProviderFactory` throws) since `AttachmentService.getUrl()` has no path to sign a URL against a non-Drive archive provider. |

Provider selection is entirely configuration (`STORAGE_PROVIDER`/
`ARCHIVE_PROVIDER`), never a code change to `AttachmentService` or any
caller - see `docs/architecture/STORAGE_PLATFORM.md` for the full
env-var reference.

## Operational model

- **Hygiene**: `OrphanCleanupService` (`STORAGE_HYGIENE.md`) - dry-run by
  default, `MANUAL_REVIEW` findings never auto-actioned.
- **Health**: `StorageHealthService` - a live, on-demand probe, never a
  cached/background status.
- **Metrics**: `StorageMetricsService` - `uploadsPerDay`/`archiveCount`/
  `orphanCount` are real; `downloadsPerDay`/`deletesPerDay` are honestly
  `null` (no event log exists to derive them from).
- **Audit**: `StorageAuditService` - one `StorageAuditReport` per run;
  growth/failed-job trends require the caller to supply its own prior
  snapshot (no audit-history table exists).
- **Scheduling**: `StorageScheduler` - callable, **not** wired to any
  timer or cron entry anywhere in this codebase.

None of the operational layer runs automatically. Every entry point
(`/api/attachments/orphan-cleanup`, and any future caller of
`StorageScheduler`/`StorageAuditService`) requires an explicit, manual
invocation today.
