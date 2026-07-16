# RC1 — Release Candidate Notes

> **ARCHIVED — superseded by `docs/releases/MASP_PLATFORM_FOUNDATION_V1.0.md`.**
> This was the release-candidate snapshot for an earlier, 22-commit
> scope of this same branch. Kept as a historical record, not current
> status.

**Branch:** `feature/pm-record-workflow-redesign` → `main`
**Scope:** 22 commits since diverging from `main` at `32c4e29`. Not yet
merged — this document accompanies the merge request, pending explicit
approval.

## Summary

This release makes both MQR (Market Quality Report) and PM (Preventive
Maintenance) production-ready for daily dealer use. It comprises the
original PM Record production-UX redesign (Phases 1–5b), a technical
domain rename (`pm-record` → `maintenance`), a Platform Event Framework
(infrastructure only, not yet wired to a real call-site), and — the
majority of this release's diff — the **Production Stabilization Sprint**:
a full audit-and-complete pass on both modules against a Report
Creation/Investigation/Attachments/PDF/CSV/Search/Performance/Security
checklist, followed by 12 milestone commits closing every gap found.

## Features completed

### MQR (Market Quality Report)
- Search-first, size-routed attachment upload (≤4MB direct proxy, >4MB
  chunked Google Drive relay); auto business-number generation; QR code;
  full validation.
- **Investigation workflow**: extended status set (added
  `WaitingCustomer`/`Rejected` to the existing 6-state enum, no renames)
  with a real transition state machine (`MQR_STATUS_TRANSITIONS`) —
  SuperAdmin can override, every other role follows the graph.
- **Audit trail**: every status/severity/RCA-field change and every
  attachment add/remove is now recorded in an immutable, shared audit
  log and rendered as a read-only Timeline on the record detail page.
- **Search**: real server-side pagination (fixed a bug where the list
  silently truncated at 500 records with no indication to the user) plus
  a found-date range filter and broader free-text search.
- **PDF/CSV**: corporate logo slot (ready for the asset, see "Known
  Limitations"), photo sections now render only when photos exist, and a
  new CSV export (UTF-8 BOM, Excel-safe, formula-injection-neutralized).
- Unified GPS picker and upload logic with PM (previously two separate
  implementations).

### PM (Preventive Maintenance)
- Search-first vehicle lookup → auto-fill → GPS capture → 3 required
  photos → duplicate-check → save, matching MQR's attachment/GPS
  conventions exactly (shared components, not parallel implementations).
- **Product Family hierarchy**: maintenance behavior is inherited through
  Product Family, never directly from Tractor Model.
- **Maintenance Due / Compliance / Vehicle Health engines**: pure,
  deterministic calculators (Health Score is explicitly rule-based, not
  AI), computed once and displayed everywhere, never recomputed inline
  by a UI component.
- **Maintenance Program Versioning** (new this release): the engines
  above now evaluate against an immutable snapshot of a vehicle's
  Product Family program, pinned once at the vehicle's retail date.
  Editing a Product Family's stages later can never retroactively change
  an already-evaluated vehicle's history.
- **Lock Policy** (new this release): a PM record becomes
  calculation-protected (serial/performed_date/hour_meter/pm_interval_id
  read-only) 24h after creation, or immediately once superseded by a
  newer record for the same vehicle. Central/SuperAdmin may open a
  temporary unlock window or explicitly lock a record; a locked record
  can only be soft-deleted by SuperAdmin with a mandatory reason. Every
  lock/unlock/edit/delete event is audit-logged.
- **PDF/CSV export** (new this release — PM had neither before): single-
  record and History Center bulk export (current filter set, capped at
  2,000 records), reusing MQR's font/image/logo infrastructure rather
  than a second implementation.
- History Center: paginated/filtered/searchable, GIN-trigram-indexed
  universal search, saved filters, quick filters including
  Overdue/Upcoming PM.

### Vehicle 360
- Aggregation-only layer reading through a `VehicleSummaryProvider`
  registry — never a business repository directly. Displays Product
  Family, Maintenance Program (+ version number in effect), Due/
  Compliance/Health, and a unified Life Cycle Timeline sourced from both
  modules.

## Architecture changes

- Technical domain rename: `pm-record` → `maintenance`
  (`src/features/maintenance/`), restructured into
  `types/schemas/repositories/services/utils/components/providers/tests`.
  Business-facing wording ("PM Record", "PM History") is unchanged
  everywhere. Database table (`pm_records`) and API routes
  (`/api/pm-records/*`) are unchanged.
- `vehicle-360` → `vehicle`, introducing the `VehicleSummaryProvider`
  contract so Vehicle 360 never imports a business module's repository.
- New shared platform infrastructure (see
  `docs/architecture/SYSTEM_ARCHITECTURE.md` §5): immutable audit log,
  shared PDF font/image/logo modules, shared CSV builder, shared upload
  helper, shared GPS components — all consumed by both MQR and PM.
- Platform Event Framework (`vehicle_events`/`event_definitions`,
  `VehicleEventPublisher`) — schema, repository, service, and publisher
  are built and tested, but **not wired to any real call-site yet**
  (MQR/PM creation still doesn't call `publish*()`). Deliberately
  deferred, tracked in `docs/PROJECT_STATE.md`.

## Database migrations (this release, chronological)

All additive — no destructive migration in this release's history (no
`DROP TABLE`, no `DROP COLUMN`, no destructive rename).

`create_pm_records` → `align_pm_records_soft_delete_and_constraints` →
`harden_pm_records_rls_soft_delete_scoping` →
`create_pm_intervals_and_vehicle_engine_number` →
`add_vehicle_branch_and_pm_record_workflow_fields` →
`add_pm_records_photo_url_columns` → `add_pm_records_gps_columns` →
`add_pm_records_history_search_support` → `add_pm_records_next_pm_due` →
`create_pm_programs` (superseded, left in place unread) →
`create_event_definitions` → `create_vehicle_events` →
`create_product_families` → `create_product_family_models` →
`create_maintenance_program_assignments` → `create_record_audit_log` →
`extend_records_status_workflow` →
`add_records_gps_accuracy_and_maps_url` →
`create_maintenance_program_versioning` → `add_pm_records_lock_fields`.

## API additions (this release)

- `GET /api/pm-records/[id]/export`, `POST /api/pm-records/[id]/lock`,
  `POST /api/pm-records/[id]/unlock`
- `GET /api/pm-records/history/export?format=pdf|csv`
- `GET /api/records/export?format=csv` (added to the existing route)
- `GET /api/platform/events` (+ POST/PUT/DELETE) — infrastructure, unused
  by any UI yet

## Breaking changes

None. Zero URL changes, zero destructive schema changes across this
entire release. `listRecords()` (MQR bulk export) and the old
`STATUS_VALUES` enum values are both still valid — extended, not replaced.

## Known limitations

- **Mahindra logo image is not included in this release.** Every PDF
  document reserves a correctly-sized blank slot
  (`public/assets/branding/mahindra-logo.png`); dropping the real PNG in
  after this release requires no code change and no redeploy logic
  change, just a normal deploy.
- PM History Center's "export selected rows only" and bulk photo ZIP
  download remain disabled stubs — current PDF/CSV export covers "export
  everything matching the current filter," judged sufficient for this
  release's scope; selected-rows export and ZIP download are distinct,
  smaller features not yet built (ZIP would need a new `jszip`-class
  dependency).
- No UI-layer automated test coverage (React components/pages) — only
  service/repository/API-route layers are tested. See
  `docs/DEVELOPMENT_GUIDE.md` §6.
- `lib/db.ts` (~2,050 lines) remains a single flat file for MQR +
  shared-platform Supabase access; PM has proper repository layering,
  MQR predates that pattern. A decomposition is future work, not this
  release's scope.
- Two admin routes (`api/admin/technicians/[id]`,
  `api/admin/branches/[id]`) call Supabase directly rather than through
  `lib/db.ts`, inconsistent with this repo's own data-access rule —
  pre-existing, found during this release's Architecture Review, not
  introduced by it.
- A handful of pre-existing, minor Supabase performance-advisor findings
  predate this release and are not fixed by it (see Production Readiness
  Report's Performance section): a duplicate index on `vehicles.dealer_id`,
  and a few tables carrying two overlapping SELECT RLS policies for the
  `anon` role.

## Deferred items (explicitly out of this release's scope, per its own instructions)

Dashboard, Dealer KPI, Analytics, Knowledge Platform, AI/Copilot,
additional Platform Services, Offline/PWA, Notification, Calendar, Work
Order, Campaign, PDI, NTR, and any other new module. Wiring MQR/PM's
`create()` to the Platform Event Publisher, and migrating Vehicle 360's
Timeline to read from `vehicle_events` instead of live aggregation.

## Upgrade notes

- No environment variable changes required for this release — see
  `docs/deployment/DEPLOYMENT_GUIDE.md` §2 for the full current list.
- No manual data backfill required — all new columns/tables start empty
  and are populated going forward (e.g. `maintenance_program_versions`
  are created lazily the first time a Product Family's program is
  configured or edited, not backfilled).
- After merge, run the standard verification pass
  (`npm run typecheck && npm run lint && npm run build && npm test`)
  and live-verify the PDF/CSV export flows for both modules per
  `docs/deployment/DEPLOYMENT_GUIDE.md` §3 step 5, since PDF/font
  rendering has historically been the one class of issue that only
  surfaces in the real Vercel environment (Deployment Protection
  intercepting a font self-fetch), not in local `next build`.
