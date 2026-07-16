# Media Platform

The storage-provider layer underneath the Attachment Framework
(`docs/engineering/ATTACHMENT_FRAMEWORK.md`) - this document covers *where
bytes physically live* and why; the Attachment Framework covers the
business-facing API on top of it.

## Storage roles

| Role | Provider | Why |
|---|---|---|
| Primary storage | **Supabase Storage** (`mqr-files` bucket) | Same project as every other table - no second vendor account for the common case (upload, list, sign, delete while a record is active). Previously dead code (`STORAGE_BUCKET` declared, never used) after the app moved fully to Drive; now the Attachment Platform's real, first consumer. |
| Archive | **Google Drive** | Already the app's long-lived file store (MQR/PM's existing upload pipeline, `lib/googleDrive.ts`) - proven OAuth2-as-real-account setup, no new vendor integration needed for the archive tier. |
| External sharing | **Google Drive** | Drive's "anyone with the link" share model is already how MQR/PM attachments are shared externally today (PDF exports, direct links) - reused as-is, not reinvented. |

## Why not Google Drive as primary anymore

Google Drive was adopted (ADR-002) specifically because Supabase Storage's
RLS-via-anon-key model made straightforward CRUD (list, delete) awkward
without a dedicated policy set, and Drive's resumable-upload path handles
files past Vercel's 4.5MB request cap well. Both of those are still true
for *why the archive tier exists on Drive*. But for **primary** storage -
where a file lives while its business record is still active and getting
read/deleted/re-signed frequently - Supabase Storage is now given
`SELECT`/`DELETE`/`UPDATE` policies (previously only `INSERT` existed) so
the Attachment Platform can use it directly, keeping bytes in the same
project as the record that owns them, with signed URLs for time-limited
access instead of Drive's permanent "anyone with the link".

## Storage Providers

Supported today: `SUPABASE`, `GOOGLE_DRIVE` (see
`src/shared/attachments/{SupabaseStorageProvider,GoogleDriveStorageProvider}.ts`).
Planned, not built: `AWS S3`, `Cloudflare R2`, `Azure Blob` - each would be
a new class implementing `StorageProvider` (`src/shared/attachments/StorageProvider.ts`);
no existing module or the Attachment Framework itself would change.

## Retention

Retention windows are per-module rows in `attachment_retention_policies`,
not hardcoded in application code - see ATTACHMENT_FRAMEWORK.md's data
model section for the seeded values (PM 730 days, MQR 365 days, PDI 365
days, NTR never). Adding or changing a module's window is a data change,
not a deploy.

## What a module must never do

Call `SupabaseStorageProvider`/`GoogleDriveStorageProvider` (or the
underlying Supabase Storage/Google Drive SDKs) directly. Every module,
including Machine 360, goes through `AttachmentService` - this is what
makes swapping or adding a storage provider later a change inside
`src/shared/attachments/` only.
