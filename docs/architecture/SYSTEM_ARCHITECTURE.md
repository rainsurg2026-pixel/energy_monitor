# System Architecture (RC1)

Status as of the Production Stabilization Sprint / Release Candidate 1
(branch `feature/pm-record-workflow-redesign`). This document describes
the system **as it actually runs**, not an aspirational target — see
`docs/ARCHITECTURE.md` for the separate, still-documentation-only
`modules/`/`shared/` migration initiative, which this RC does not touch.

## 1. What this system is

The "Mahindra After Sales Platform" is a Next.js app with two production
modules today:

- **MQR (Market Quality Report)** — dealers/technicians file a quality
  incident report (serial, problem code/severity, photos, video, GPS,
  root cause, repair outcome); Central/regional admins review, filter,
  export, and track via a KPI dashboard.
- **PM (Preventive Maintenance)**, technical name `maintenance` — a
  search-first workflow for recording a tractor's scheduled maintenance
  visit (hour meter, interval, photos, GPS), with a deterministic
  Maintenance Due/Compliance/Health calculation engine and a History
  Center for search/export.

Both modules sit on shared platform infrastructure: session/auth, RBAC,
Supabase data access, Google Drive file storage, PDF/CSV export, GPS
capture, and — new in this sprint — an immutable audit trail. A third,
lightweight aggregation layer, **Vehicle 360**, presents a unified view of
one vehicle's lifecycle across both modules without owning any data
itself.

## 2. Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.35, App Router, TypeScript |
| Styling | Tailwind CSS 3 |
| Database | Supabase (Postgres 17, project `lhlzzxjayywqhqtjzfiu`, region `ap-northeast-2`), RLS enabled on every table |
| Auth | Custom JWT (`jose`, HS256) — **not** Supabase Auth |
| File storage | Google Drive, OAuth2 real-account client |
| Vehicle master feed | Public Google Sheet ("Tractor IN"), read via `gviz` CSV export |
| Email | Resend |
| PDF | `@react-pdf/renderer` (Sarabun Thai font, TTF) |
| Testing | Vitest (service/repository/API-layer coverage; no UI test coverage yet) |
| Hosting | Vercel (Hobby plan), auto-deploy on push to `main` |

## 3. Module map

```
src/
  app/
    (app)/                      route group — pages behind the session check
      dashboard/                 KPI dashboard (MQR only, unchanged this sprint)
      report/                    MQR: new-QIR form (report-form.tsx)
      records/                   MQR: list + [jobId] detail/edit/print
      pm-records/                PM: list/History Center, new/, [id]/ detail+edit
      vehicles/                  Vehicle 360: search + [serial] aggregated view
      admin/                     master data (dealers/branches/technicians/users/
                                  problem-codes/pm-intervals/product-families/
                                  product-family-models/maintenance-programs)
    api/
      records/, records/[jobId]/                MQR CRUD + export (pdf/xlsx/csv)
      pm-records/, pm-records/[id]/              PM CRUD + export, lock/, unlock/
      pm-records/history/, history/export/       PM History Center query + export
      platform/events/                           Platform Event Framework (built, not
                                                   wired to any real call-site yet)
      upload/, upload/init|chunk|finalize/        size-routed Google Drive upload
      vehicles/, admin/*                          master data
  lib/                            shared platform code, imported by both modules
    db.ts                         ALL Supabase queries for MQR + shared platform
                                   tables (2000+ lines — see §6 "Known debt")
    auth.ts, scope.ts             session + RBAC
    supabase.ts                   Supabase client factory
    types.ts                      shared types (SessionUser, MqrRecord, audit log,
                                   Product Family, Maintenance Program Version, ...)
    exportPdf.tsx, exportCsv.ts   MQR's PDF/CSV documents (CSV builder is shared)
    pdf/                          SHARED PDF infra: fonts.ts, fetchImage.ts,
                                   PdfBrandLogo.tsx, brand.ts — both modules'
                                   PDFs import from here, neither redefines it
    googleDrive.ts, email.ts, tractorSheet.ts, thaiDate.ts, warranty.ts
  components/shared/
    upload/uploadFileSmart.ts     SHARED size-routed upload (both modules)
    gps/                          SHARED GPS picker (both modules)
  features/
    maintenance/                  PM's technical domain — properly layered:
      types/ schemas/ repositories/ services/ utils/ components/ providers/ tests/
      services/maintenanceService.ts   the ONLY enforcement point for PM business
                                        rules (lock policy, audit logging)
      services/maintenancePdf.tsx      PM's PDF (reuses lib/pdf/)
      services/maintenanceCsv.ts       PM's CSV (reuses lib/exportCsv.ts)
    maintenance-due/               Due/Compliance Engine — pure calculator, no
                                    Supabase access, computed once and displayed
    vehicle-health/                Health Score Engine — deterministic 0-100
                                    rule table, explicitly NOT AI
    vehicle/                       Vehicle 360 aggregation layer — reads via the
                                    VehicleSummaryProvider registry, never a
                                    business repository directly
    mqr/providers/                 one adapter file (MqrSummaryProvider) - MQR
                                    itself was never moved into features/
    vehicle-event/                 Platform Event Framework (schema+repo+service+
                                    publisher, infrastructure only, unwired)
```

## 4. Request lifecycle

1. `middleware.ts` checks the `mqr_session` cookie; redirects to `/login`
   if absent (excludes `/fonts/*` so react-pdf's server-side font read
   still works — note: PDF fonts are read from disk, not fetched over
   HTTP, so this exclusion is now mostly a legacy safety net, not load-bearing).
2. Server Component pages call `getSession()`, then read through
   `lib/db.ts` (MQR) or a `Repository`→`Service` pair (PM), each of which
   applies dealer/branch/role scoping in application code
   (`applyScope()` for MQR, equivalent checks in
   `SupabaseMaintenanceRepository`) — independent of and in addition to
   Postgres RLS.
3. Mutations happen through Client Components calling same-origin
   `/api/...` routes via `fetchJson.ts`. Every route re-validates the
   session and re-checks scope server-side, never trusting the request body.
4. All user-visible feedback goes through `lib/swal.ts` (SweetAlert2) —
   no `alert()`, no ad-hoc banners, app-wide.
5. Every timestamp shown to a user is formatted through
   `formatThaiDateTime()` (`lib/thaiDate.ts`), forcing `Asia/Bangkok` —
   Vercel's runtime clock is UTC.

## 5. Shared platform infrastructure (built during the Production Stabilization Sprint)

These exist specifically so MQR and PM never re-implement the same logic
twice — verify any new module reuses these before writing something new:

- **Audit trail** — `record_audit_log` (module-scoped `'mqr'|'pm'`, no
  UPDATE/DELETE RLS policy at all, immutable by database construction) +
  `logAuditEvent`/`logAuditEvents`/`listAuditLog`/`diffFieldsForAudit` in
  `lib/db.ts`. Wired into every MQR/PM create/update/delete/lock/unlock
  path. Read via `listAuditLog(module, recordId)`, capped at 300 entries.
- **PDF** — `lib/pdf/fonts.ts` (`ensureFontsRegistered()` — on-disk Sarabun
  TTF, sidesteps Vercel Deployment Protection blocking a self-fetch),
  `lib/pdf/fetchImage.ts` (`fetchImageAsDataUri()` — resolves a remote
  Drive photo to a base64 data URI with a timeout and graceful
  placeholder-on-failure, since react-pdf's own `<Image src={url}>`
  fetches with no error handling), `lib/pdf/PdfBrandLogo.tsx` (logo slot
  reading `public/assets/branding/mahindra-logo.png` — reserves a
  correctly-sized blank space if the file doesn't exist yet, never
  crashes), `lib/pdf/brand.ts` (`PDF_BRAND_RED` color constant).
- **CSV** — `lib/exportCsv.ts`'s `buildCsv()` (UTF-8 BOM for Excel
  Thai-text compatibility, CRLF, proper quote/comma/newline escaping,
  and — since this RC — formula-injection neutralization for any cell
  starting with `=`/`+`/`-`/`@`).
- **Upload** — `components/shared/upload/uploadFileSmart.ts` — size-routed
  (≤4MB direct proxy via `/api/upload`; >4MB chunked relay through
  `/api/upload/init|chunk|finalize` to a Google Drive resumable session,
  since Drive sends no CORS headers and Vercel caps request bodies at
  4.5MB).
- **GPS** — `components/shared/gps/` — Leaflet + Esri satellite tiles +
  Nominatim geocoding, "use current location," EXIF photo-GPS offer,
  direct lat/lng-or-Google-Maps-URL paste.
- **Vehicle 360 aggregation** — `features/vehicle/types.ts`'s
  `VehicleSummaryProvider` interface + `features/vehicle/providers/registry.ts`.
  Each module implements its own provider
  (`MaintenanceSummaryProvider`, `MqrSummaryProvider`); Vehicle 360 never
  imports a business repository directly. Health Score is computed once,
  in `vehicle/service.ts`, since it's the one genuinely cross-module
  calculation (needs both modules' signals).

## 6. Data model highlights

- **Soft delete everywhere** for business data (`record_status`
  Active/Deleted + `deleted_by`/`deleted_at`) — MQR `records`, PM
  `pm_records`. Hard delete is reserved for `users`, SuperAdmin-only.
- **Two-layer tenant isolation** — Postgres RLS (deliberately permissive,
  since there's no Supabase Auth / per-request Postgres identity to
  filter on) **and** application-layer scoping (`applyScope()` for MQR,
  equivalent repository-level checks for PM). Neither layer alone is
  sufficient; this is a known, accepted, documented architectural
  tradeoff, not an oversight — see `docs/PROJECT_STATE.md`.
- **Maintenance Program Versioning** — `maintenance_program_versions`/
  `_stages` are immutable snapshots; `vehicles.maintenance_program_version_id`
  permanently pins a vehicle to whichever version was effective at its
  retail date. The Due/Compliance/Health engines never recompute against
  today's live Product Family configuration — editing a Product Family's
  stages later cannot retroactively change history.
- **PM Lock Policy** — `pm_records.locked_at`/`locked_reason`/
  `unlocked_until`/`unlocked_by`/`unlock_reason`/`deleted_reason`.
  Calculation-affecting fields (serial/performed_date/hour_meter/
  pm_interval_id) become read-only 24h after creation, or immediately
  once a newer record exists for the same vehicle (supersession) —
  enforced exclusively in `MaintenanceService`, never trusted from the
  client.

## 7. Known architectural debt (not fixed in this RC — see release notes)

- `lib/db.ts` is ~2,050 lines and growing — all MQR + shared-platform
  Supabase access lives in one file with no repository abstraction (MQR
  predates that pattern; PM was built with it from the start). A
  decomposition is a legitimate future refactor, not RC1 hardening scope.
- Two Supabase admin routes (`api/admin/technicians/[id]`,
  `api/admin/branches/[id]`) call `getSupabase()` directly rather than
  going through `lib/db.ts`, inconsistent with this repo's own "all
  Supabase access goes through the shared db layer" rule. Pre-existing,
  not introduced by this sprint.
- No UI-layer automated test coverage (React components/pages) — only
  service/repository/API-route layers are tested. See
  `docs/DEVELOPMENT_GUIDE.md` §6.
