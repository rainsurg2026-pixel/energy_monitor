# ADR-010: Attachment Platform

## Problem

Every module today (MQR, PM) that handles files re-implements its own
upload path against Google Drive directly (`report-form.tsx`'s
`/api/upload*` routes, PM's create form reusing the same routes). Phase 5B
requires a permanent, shared Attachment & Media Platform for every current
and future module (PM, PDI, NTR, MQR, Campaign, Parts, Knowledge Platform,
AI Copilot), with Google Drive demoted from primary storage to
archive/external-sharing only, and Supabase Storage promoted to primary.

## Decision

Built `src/shared/attachments/` around three pieces:

1. **`StorageProvider`** interface (`upload`/`delete`/`download`/`getUrl`),
   implemented by `SupabaseStorageProvider` (primary) and
   `GoogleDriveStorageProvider` (archive) - see
   `docs/engineering/MEDIA_PLATFORM.md`.
2. **`attachments` + `attachment_retention_policies`** tables (migration
   `create_attachments_platform`) - the former holds every file's identity,
   lifecycle status, and provider location; the latter holds each module's
   configurable (never hardcoded) retention window.
3. **`AttachmentService`** - the single entry point every module and
   Machine 360 call for Upload/Delete/List/GetSignedUrl/Archive/Restore/
   VerifyChecksum. See `docs/engineering/ATTACHMENT_FRAMEWORK.md` for the
   full method-by-method account and the Archive Flow/Lifecycle.

### Why Supabase Storage (primary)

Same Postgres project as every other table; signed URLs give time-limited
access instead of Drive's permanent "anyone with the link" share model,
which matters more for a file still tied to an active, potentially
sensitive business record (customer signatures, invoices) than for an
archived one.

### Why Google Drive (archive)

Already the proven, working file store for MQR/PM (`lib/googleDrive.ts`,
ADR-002) - reusing it for the archive tier means no new vendor
integration, and its existing "anyone with the link" share model is
exactly what "External Sharing" needs.

### Why Provider Independence

A module (or Machine 360) that called Supabase Storage or Google Drive
directly would need to change every call site if a provider were ever
swapped or added (S3, R2, Azure Blob - all named as future work in the
brief). Routing everything through `AttachmentService`/`StorageProvider`
means that change happens in `src/shared/attachments/` alone.

## Alternatives Considered

- **Keep Google Drive as primary, add Attachment Platform on top of it** —
  rejected: the brief is explicit ("Google Drive is no longer primary
  storage"), and Drive's per-file-permission model is a worse fit than
  Supabase's RLS-plus-signed-URL model for an *active* file a module might
  delete/re-sign frequently.
- **Migrate MQR/PM's existing upload pipelines onto `AttachmentService` in
  this same pass** — rejected for this pass: `report-form.tsx` is
  explicitly flagged in root `CLAUDE.md` as "the most complex file in the
  repo," and rewriting two modules' live, production upload paths without
  its own dedicated review is a materially bigger risk than building the
  platform itself. The platform is built and tested standalone; adoption
  is each module's own follow-up. See ATTACHMENT_FRAMEWORK.md's "What's
  deliberately deferred."
- **A single `StorageService` god-class instead of provider interface +
  orchrating service** — rejected in favor of the current split
  (`StorageProvider` implementations own provider mechanics,
  `AttachmentService` owns lifecycle/orchestration/retention) so a new
  provider is additive, never a change to existing provider code.

## Trade-offs

- No existing module has adopted `AttachmentService` yet - the platform
  is real, tested infrastructure with zero production callers today. This
  mirrors the Universal Import Framework's own documented trade-off
  (built ahead of its second real consumer) - the difference here is the
  need itself (multiple modules, TODAY, upload files) is proven, not
  speculative; only the *migration* of existing code onto it is deferred.
- Google Drive's archive tier has no true time-limited signed URL (this
  app's OAuth2-as-a-real-account auth model doesn't support Drive's
  service-account-based signed URLs) - `getUrl()` on an archived
  attachment returns Drive's permanent share link instead. Documented in
  `ATTACHMENT_FRAMEWORK.md`, not silently approximated as equivalent to a
  Supabase signed URL.
- `mqr-files` Supabase Storage bucket previously had only an `INSERT`
  policy for `anon` (a leftover from an earlier, abandoned attempt at
  using Supabase Storage directly, before the app moved to Drive). Added
  `SELECT`/`DELETE`/`UPDATE` policies scoped to `bucket_id = 'mqr-files'`,
  matching this app's existing permissive-RLS-plus-app-layer-scoping model
  (no dealer-level scoping inside `storage.objects` itself - same pattern
  as every other table).

## Consequences

- A new module onboards file storage by writing an
  `attachment_retention_policies` row and calling `AttachmentService`
  methods - no storage-provider code of its own, ever.
- Machine 360 can show a real Attachments section (`AttachmentService.list()`)
  the moment any module starts writing rows - no further platform changes
  needed at that point.
- MQR/PM's existing Drive-only upload pipelines keep working exactly as
  they do today; migrating them onto this platform is explicitly future,
  scoped work, not bundled into this ADR.
