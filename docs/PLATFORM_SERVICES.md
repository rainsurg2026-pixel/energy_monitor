# Platform Services

`shared/services/` hosts cross-cutting capabilities that every business module depends on but no module should own individually. This document defines each service's responsibility, dependencies, boundaries, reuse strategy, and naming standard. It is the companion to `shared/services/README.md`, which lists the folders; this document explains what belongs in each one.

None of these services are implemented as part of this sprint (documentation and architecture only — see Safety Rules). Where a service already has a real, partial implementation elsewhere in the codebase, that is noted under "Current State" so this document doesn't overstate what exists today.

## auth

**Responsibility:** Identity and session management — who is signed in, what their session contains, and how that session is validated on each request.
**Dependencies:** Supabase (as the underlying user/credential store), `jose` (session token signing/verification).
**Boundaries:** Owns session creation/validation only. Does not own permission/role logic (see `shared/admin/PERMISSION_GUIDE.md`, which sits on top of this service).
**Reuse strategy:** Every module calls this service to get the current session; no module reads cookies or verifies tokens itself.
**Current state:** `src/lib/auth.ts` and `src/lib/supabase.ts` already implement a working version of this. Formalizing it as `shared/services/auth` is a future migration, not a rewrite.

## upload

**Responsibility:** Generic file upload handling — receiving a file from a client, validating it (size/type), and handing it to the appropriate storage backend.
**Dependencies:** `google-drive` service (the storage backend used today), `heic-convert` (image normalization).
**Boundaries:** Owns the upload pipeline (validation, conversion, handoff). Does not own where files end up long-term — that's `google-drive`'s responsibility.
**Reuse strategy:** A module never talks to Google Drive directly for an upload; it calls `upload`, which delegates to `google-drive`.

## google-drive

**Responsibility:** All interaction with Google Drive — creating folders, uploading files, generating shareable links, applying the folder structure and naming convention in `docs/GOOGLE_DRIVE_ARCHITECTURE.md`.
**Dependencies:** `googleapis`, OAuth2 credentials (see `scripts/get-google-refresh-token.mjs`).
**Boundaries:** Owns Drive operations only. Does not decide what should be uploaded — `upload` and the calling module decide that.
**Reuse strategy:** Single integration point for Drive across all modules, so a credential or API change is a one-place fix.
**Current state:** `src/lib/googleDrive.ts` already exists with a working OAuth2-based integration. This service formalizes and centralizes that existing work for use by modules beyond MQR.

## pdf

**Responsibility:** Generating PDF documents (records, certificates, reports) from structured data.
**Dependencies:** `@react-pdf/renderer`.
**Boundaries:** Owns PDF rendering only. Does not own where the resulting PDF is stored (that's `upload`/`google-drive`).
**Reuse strategy:** Modules supply data and a template; they do not each build their own PDF rendering pipeline.
**Current state:** `src/lib/exportPdf.tsx` already implements this for MQR.

## synchronization

**Responsibility:** Mirroring Supabase data into Google Sheets on the schedule and pattern defined in `docs/DATA_SYNCHRONIZATION.md`.
**Dependencies:** Supabase, `googleapis`, `scheduler` (to trigger the daily run).
**Boundaries:** Owns the one-way Supabase → Sheets data flow. Does not own report formatting/business logic inside the destination sheet beyond what's needed for the snapshot.
**Reuse strategy:** One sync engine configured per data set, not a bespoke export script per module.
**Current state:** Does not exist yet. `src/lib/tractorSheet.ts` is a separate, narrower, read-only integration (reads one existing reference sheet) and is not the basis for this service — see `docs/DATA_SYNCHRONIZATION.md` for the distinction.

## scheduler

**Responsibility:** Running recurring platform jobs at defined times (sync, backups, cleanup, health checks) — see `docs/SCHEDULER_ARCHITECTURE.md`.
**Dependencies:** None of the other services depend on the scheduler existing for normal request handling; it is purely for time-triggered jobs.
**Boundaries:** Owns "when" a job runs, not "what" the job does — the job logic lives in the relevant service (e.g. `synchronization`, `audit`).
**Reuse strategy:** A new recurring job is registered with the scheduler, not implemented as a one-off cron script outside the platform.

## notification

**Responsibility:** Outbound notifications — email today, with room for in-app and push notifications later — and the in-app notification center described in `docs/DESIGN_SYSTEM.md`.
**Dependencies:** `resend` (email delivery).
**Boundaries:** Owns delivery and the notification data model. Does not own deciding business-level "when should this fire" logic, which stays in the calling module (the module decides to notify; the service handles how).
**Reuse strategy:** Any module that needs to email or notify a user calls this service rather than calling `resend` directly.
**Current state:** `src/lib/email.ts` already implements Resend-based email sending for MQR; this service generalizes that for platform-wide use.

## audit

**Responsibility:** Recording who did what, when, to which record — the audit trail referenced throughout `docs/OBSERVABILITY.md`.
**Dependencies:** Supabase (audit log storage), `auth` (to know who the actor is).
**Boundaries:** Owns capturing and storing audit events. Does not own displaying them — a module's UI (using `shared/ui/` Timeline component) renders audit data this service provides.
**Reuse strategy:** A module emits an audit event through this service rather than writing its own log rows.

## logging

**Responsibility:** Structured application logging for debugging and operational visibility.
**Dependencies:** None outside the platform.
**Boundaries:** Owns log capture/formatting. Does not own alerting on log content — that's `monitoring`/`notification`.
**Reuse strategy:** One logging interface and format used across all modules so logs are searchable consistently.

## monitoring

**Responsibility:** Health checks and operational metrics — see `docs/SCHEDULER_ARCHITECTURE.md`'s health-check job and `docs/OBSERVABILITY.md`.
**Dependencies:** `logging`, `scheduler` (for periodic checks), `notification` (to alert on failures).
**Boundaries:** Owns detecting and surfacing problems. Does not own fixing them automatically.
**Reuse strategy:** New services register a health check with this service rather than building their own ad-hoc status endpoint.

## cache

**Responsibility:** Short-lived caching for expensive or frequently-repeated reads (e.g. reference/master data that changes rarely).
**Dependencies:** None outside the platform.
**Boundaries:** Owns cache storage/invalidation strategy. Does not own being a source of truth — Supabase remains authoritative; cache entries are always invalidatable/rebuildable from it.
**Reuse strategy:** Modules read through this service for cacheable data rather than each implementing their own in-memory cache.

## search

**Responsibility:** Cross-entity and within-entity search behavior (e.g. searching dealers, vehicles, records) consistent with the Search pattern in `docs/DESIGN_SYSTEM.md`.
**Dependencies:** Supabase (as the underlying queryable data).
**Boundaries:** Owns query construction/matching behavior (e.g. partial match, common aliasing). Does not own UI rendering of results — that's the module's UI, built from `shared/ui/`.
**Reuse strategy:** A consistent search experience across modules is achieved by sharing this service's matching logic, not by each module writing its own `ILIKE` queries with slightly different behavior.

## Naming Standards for Services

Each service directory is named after its responsibility (a noun describing what it does), in kebab-case, matching `docs/NAMING_STANDARD.md`. A service's exported functions are named as verb phrases describing the action performed (e.g. `uploadFile()`, `sendNotification()`, `recordAuditEvent()`).
