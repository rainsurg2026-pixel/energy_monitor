# Attachment Framework

> **Status: Foundation (feature-frozen), reaffirmed as of MASP Platform
> Foundation v1.1.0** (`docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md`;
> originally frozen at v1.0.0, see `docs/releases/archive/`). Further
> work on this framework is bug fixes and security hardening only, not
> new capability, until an explicit future decision reopens it.

`src/shared/attachments/` — the platform-wide file storage abstraction
every module (PM, PDI, NTR, MQR, Campaign, Parts, Machine 360, and beyond)
is meant to depend on for uploading, listing, signing, archiving, and
restoring files. See `docs/adr/ADR-010-Attachment-Platform.md` for the
full rationale; this document is the living reference for how it's built.

Unlike the Universal Import Framework (`src/shared/import/`, built with
only NTR as a real consumer), this framework satisfies
`.claude/rules/01-architecture-boundaries.md`'s "shared/ only when at
least two modules genuinely need it" with real evidence, not just intent:
**MQR and PM were migrated onto it in Phase 5B.1** (see "Module Adoption
Status" below) - the first framework in this codebase verified against a
second real caller before this pass, and now a third (Machine 360).

## Why Attachment, not `media_files`

"Attachment" is the platform's existing business term (see
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s General terminology table:
Attachment → ไฟล์แนบ) and already appears in `docs/standards/*` and the
audit-event vocabulary (`AttachmentAdded`/`AttachmentRemoved`). `attachments`
is the table name; there is no `media_files` table.

## Data model

`attachments` (migration `create_attachments_platform`):

| Column | Purpose |
|---|---|
| `module`, `entity_type`, `entity_id` | What business record this file belongs to - no FK (types vary per module: uuid vs. text), scoped in application code exactly like every other cross-module reference in this app |
| `attachment_type` | `MasterData`/`MeterPhoto`/`NameplatePhoto`/`ReportPhoto`/`DefectPhoto`/`RepairPhoto`/`CustomerSignature`/`Invoice`/`Warranty`/`Video`/`Audio`/`Pdf`/`Excel`/`Other` |
| `storage_provider` | `SUPABASE` \| `GOOGLE_DRIVE` - which backend currently holds the bytes |
| `storage_path` | Supabase Storage object path (null once archived and the source copy is deleted) |
| `drive_file_id`, `drive_url` | Populated only once archived |
| `status` | `ACTIVE` → `ARCHIVE_PENDING` → `ARCHIVING` → `ARCHIVED` → `PURGED` (future) |
| `archive_attempts`, `last_archive_attempt_at`, `archive_error` | Retry bookkeeping - mirrors the pattern used by NTR's own Drive archive queue (ADR-008 on `feature/ntr-legacy-import`) |
| `business_completed_at` | Set by the owning module when its record reaches a terminal state - starts the retention clock |
| `checksum`, `size_bytes` | Recorded at upload; re-verified at archive time and on demand via `verifyChecksum()` |

`attachment_retention_policies` (`module` primary key, `retention_days`
nullable): configurable per module, never hardcoded in application code.
Seeded today: PM 730 days, MQR 365 days, PDI 365 days, NTR `null` (never
auto-archive) - a new module adds its own row, no code change required.

Both tables use the same permissive-RLS-plus-app-layer-scoping model as
every other table in this app (see root `CLAUDE.md` §6) - `qual: true`
policies, authorization enforced in `AttachmentService`/its callers.

## Provider Independence

```ts
interface StorageProvider {
  readonly name: 'SUPABASE' | 'GOOGLE_DRIVE';
  upload(params): Promise<StoredObject>;
  delete(locator): Promise<void>;
  download(locator): Promise<Buffer>;
  getUrl(locator, mimeType, expiresInSeconds?): Promise<{ url; expiresAt }>;
}
```

`SupabaseStorageProvider` (primary) and `GoogleDriveStorageProvider`
(archive) both implement this - `AttachmentService` never branches on
which provider it's talking to beyond choosing which instance to call. A
future `AWS S3`/`Cloudflare R2`/`Azure Blob` provider is a new class
implementing the same interface; no existing code changes.

`SupabaseStorageProvider` uses the `mqr-files` bucket (`STORAGE_BUCKET` in
`lib/supabase.ts`) - previously declared but never referenced (the app
moved to Google Drive before ever using it for real). This is the first
real consumer. Two new storage-level RLS policies (`mqr_files_select`,
`mqr_files_delete`, plus `mqr_files_update`) were added - only an `INSERT`
policy existed before, left over from that earlier, abandoned attempt.

`GoogleDriveStorageProvider` reuses `lib/googleDrive.ts`'s existing
`uploadFileToDrive()`, adding two new exports it needed that didn't exist
yet: `downloadFileFromDrive()` (restore/checksum-verify) and
`deleteFileFromDrive()`.

## AttachmentService

The one door every module/UI calls (Machine 360 included) - never a
storage provider or SDK directly:

- `upload(input)` — uploads to Supabase (primary), records the row.
- `delete(id)` — deletes from whichever provider currently holds the
  bytes (`storageProvider` on the row), then the row itself.
- `list(module, entityType, entityId)`
- `getUrl(id)` — a Supabase signed URL while `ACTIVE`; the Drive share
  link directly once `ARCHIVED` (Drive doesn't support the same kind of
  time-limited signed URL via this app's OAuth2-as-a-real-account setup -
  documented, not silently approximated).
- `verifyChecksum(id)` — re-downloads from the active provider and
  re-hashes (SHA-256), compared against the `checksum` column.
- `markBusinessComplete(id, completedAt?)` — a module calls this once,
  when its own record reaches a terminal state; starts the retention
  clock. Never inferred by the platform itself.
- `enqueueArchiveEligible(module)` — Archive flow step 1: `ACTIVE` →
  `ARCHIVE_PENDING` for every attachment past its module's (non-null)
  retention window.
- `processArchiveQueue()` — Archive flow step 2: uploads each
  `ARCHIVE_PENDING` row to Drive, verifies checksum + size against the
  original, only then marks `ARCHIVED` and (if
  `DELETE_SOURCE_AFTER_VERIFIED_ARCHIVE`, on by default) deletes the
  Supabase copy. A failure leaves the row `ARCHIVE_PENDING` with
  `archiveAttempts` incremented for retry, up to 5 attempts - never
  deletes the source before a verified success.
- `restore(id)` — downloads an `ARCHIVED` attachment's bytes back from
  Drive into Supabase Storage, flips it back to `ACTIVE`/`SUPABASE`.
- `initDirectUpload(input)` / `finalizeDirectUpload(attachmentId)` — for a
  file too large for a single-shot POST through our own API route (see
  "Direct (large-file) upload" below).
- `reassignEntity(ids, entityId)` — re-tags a batch of attachments,
  uploaded against a temporary client-generated entity ID before their
  owning record existed, with the record's real ID once saved.

## Direct (large-file) upload

Vercel caps a serverless function's request body at 4.5MB regardless of
which storage backend the route then forwards to - the same constraint
that made Google Drive's resumable-upload dance necessary for MQR's video
attachment before this migration. `SupabaseStorageProvider.createSignedUploadUrl()`
is the Supabase-Storage equivalent: `initDirectUpload()` returns a signed
upload URL the browser PUTs bytes to directly (bypassing our API route
entirely), and `finalizeDirectUpload()` confirms the object actually
landed in storage (never trusts the client's word alone) before recording
its real size. Checksum is intentionally left `null` for this path - there
is no server-side copy of the bytes to hash at upload time;
`processArchiveQueue()` already treats a `null` checksum as "nothing to
verify against" rather than a mismatch, so archiving still works, just
without the extra integrity check for files uploaded this way. See
`src/components/shared/attachments/uploadAttachment.ts` for the client
side of this (mirrors the old `uploadFileSmart.ts`'s size-routing).

## Uploading before a record exists

MQR's report form and PM's create form both upload files before their
owning record (and its real `job_id`/id) exists yet - previously solved
with Google Drive's per-dealer `_pending` folder + `relocatePendingFiles()`.
The Attachment Platform's equivalent: the client generates a temporary
entity ID (`newPendingEntityId()`), uploads against that, and the create
API route calls `AttachmentService.reassignEntity(attachmentIds, realId)`
once the record is saved - only the `attachments.entity_id` column
changes; storage locations never move. PM's edit form (record already
exists) and MQR's record-update form skip this entirely and upload
straight against the real ID.

## Archive Lifecycle

```
ACTIVE → ARCHIVE_PENDING → ARCHIVING → ARCHIVED → PURGED (future)
```

Never delete a file before successful verification - `processArchiveQueue()`
checks both size and checksum against the original before marking
`ARCHIVED` or touching the Supabase copy.

## AttachmentViewer

`src/components/shared/attachments/AttachmentViewer.tsx` - the reusable
display component every module (and Machine 360) renders attachments
through, given only `{id, filename, mimeType, url}` (never a storage
provider, bucket, or signed-URL detail). Grid of tiles (image thumbnail or
a type icon for PDF/video/audio/Excel/other) with Open/Download/Delete
actions and a click-to-preview overlay (inline `<img>`/`<video>`/`<audio>`/
`<iframe>` for PDF; a download prompt for Excel/other, which can't be
previewed inline). Supersedes nothing - `AttachmentGallery.tsx` (the
older, image-only, URL-string-based component) still renders MQR/PM's
pre-migration photo grids unchanged; `AttachmentViewer` is what any new
rendering (Machine 360's Attachments section) uses going forward.

## Module Adoption Status

| Module | Status |
|---|---|
| **MQR** | Migrated (Phase 5B.1). `report-form.tsx` (new report) and the record-update form both upload via `uploadAttachment()`; `/api/records` reassigns pending uploads to the real `job_id` and marks attachments business-complete when a job closes (`Repaired`/`Closed`). `records.photo_links[].attachmentId`/`records.video_attachment_id` are additive columns - a pre-migration record's raw Drive `url` still renders unchanged; a post-migration record's URL is resolved fresh, server-side, on every page load (`records/[jobId]/page.tsx`), since a Supabase signed URL expires and is never trusted as a permanent value the way a Drive share link was. |
| **PM** | Migrated (Phase 5B.1). `maintenance-form.tsx` (create + edit, one shared component) uploads Meter/Nameplate/Report photos via `uploadAttachment()`; `/api/pm-records` reassigns pending uploads to the record's real `id` and marks them business-complete immediately (a maintenance visit is a single, already-complete event, unlike MQR's Open→Closed lifecycle). `pm_records.*_photo_attachment_id` are additive columns, same backward-compatible pattern as MQR. |
| **NTR** | Migrated (Phase 5 Final Consolidation). `ntr-search.tsx` (the search-first registration form) uploads the four required photos + optional video via `uploadAttachment()`; `POST /api/ntr-records` reassigns pending uploads to the record's real `id` and marks them business-complete immediately (a registration is a single, already-complete event, same as PM). `ntr_records.photo_*_attachment_id`/`video_attachment_id` are additive columns, same backward-compatible pattern as MQR/PM. New `AttachmentType` values: `CustomerTractorPhoto`/`SerialPlatePhoto`/`HourMeterPhoto`/`DeliverySheetPhoto` (video reuses the existing `Video` type). This module's own Google-Drive-only Legacy Import archive system (ADR-008) is unrelated and unchanged - it archives already-committed historical import data, not this real-time registration path. |
| **Machine 360** | Reads attachments via `MachineService.getMachineAttachments()` → `AttachmentService.list()`/`getUrl()` only - never a storage provider or module table directly. Aggregates across every module that has adopted the platform (today: MQR + PM + NTR) by reusing each module's own existing "records for this serial" utility (`fetchMqrRecords`/`fetchMaintenanceHistoryForSerial`/`fetchNtrRecordsForSerial` - the same dependency direction the Timeline/Summary aggregations already use), never a raw query of its own. |
| **PDI** | No PDI module exists in this branch (confirmed - no `src/features/pdi` or similar). Prepared, not implemented: `attachment_retention_policies` already has a `pdi` row (365 days) seeded from this same migration, so a future PDI module needs zero platform-side setup - just call `AttachmentService.upload()` per "Adopting this for a new module" below. |
| **Campaign / Parts** | No module exists yet in any branch. |

## Adopting this for a new module

1. Add an `attachment_retention_policies` row for the module (or leave
   `retention_days` null to never auto-archive) - already done for `pdi`.
2. Call `new AttachmentService().upload({ module, entityType, entityId,
   attachmentType, filename, mimeType, buffer, createdBy })` at the point
   a file is accepted - or `initDirectUpload()`/`finalizeDirectUpload()`
   for a file that might exceed 4MB (see "Direct (large-file) upload").
3. Call `markBusinessComplete(attachmentId)` once the owning record
   reaches a terminal state.
4. If uploads happen before the record exists, generate a temporary ID
   client-side (`newPendingEntityId()`) and call `reassignEntity()` once
   the record is saved (see "Uploading before a record exists").
5. Render attachments through `AttachmentViewer`, given `AttachmentService.list()` +
   `getUrl()` output - never a raw `<img src>` reading a stored URL column
   directly (a signed URL expires; resolve fresh, server-side, per request).
6. Run `enqueueArchiveEligible(module)` then `processArchiveQueue()`
   periodically (a scheduled route, following the existing Scheduler
   pattern in `docs/SCHEDULER_ARCHITECTURE.md`/ADR-007) - not yet wired to
   a route for MQR/PM either; both modules' attachments are eligible for
   archiving once `markBusinessComplete()`-and-retention-window criteria
   are met, but nothing currently triggers that periodic run. This is the
   one deliberately deferred piece of Phase 5B.1: building the scheduled
   trigger is its own, explicitly-scoped follow-up, not bundled into this
   migration pass.
