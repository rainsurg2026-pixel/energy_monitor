# Module Development Standard

Binding checklist for every future MASP module (NTR, PDI, Warranty, Campaign,
Dashboard, AI Copilot). Grounded in how MQR and PM actually ship in
production today (`src/app/(app)/records/`, `src/app/(app)/pm-records/`,
`src/features/maintenance/`), not the aspirational `modules/`/`shared/`
folder layout described in `docs/ARCHITECTURE.md` §4 — that migration has
not happened, and a new module is not blocked on it. Build inside `src/`
using the layered structure below until an explicit migration sprint says
otherwise.

This document indexes; it does not re-derive detail already owned by
another standard. Each checklist item links to the doc or existing file
that defines how to satisfy it.

## The layered structure every module follows

PM (`src/features/maintenance/`) is the reference implementation of this
layering — a new module should look structurally identical, not just
similar in spirit:

```
src/features/<module>/
  repositories/   — the only code that talks to Supabase for this module
                    (constructor must be side-effect free - lazy client
                    init only, see docs/standards/
                    SERVICE_CONSTRUCTION_STANDARD.md)
  services/       — business logic, orchestrates repository + audit + PDF/CSV
  utils/          — validation helpers, pure calculators (e.g. lock/due engines)
  components/     — module-specific UI; promote to src/components/shared/ once
                    a second module needs the same thing (see UI_COMPONENT_STANDARD.md)
  schemas/        — zod request-body schemas (see API_STANDARD.md §Validation)
  types/          — this module's TypeScript interfaces
src/app/(app)/<module>/        — Server Component pages (list, detail, edit)
src/app/api/<module>/          — API routes, thin wrappers around services/
```

## Checklist

A module is not complete until every item below is checked. This is the
same completeness gate `docs/MODULE_CHECKLIST.md` describes for the
target architecture; the items below are the same substance, restated
against the structure that actually exists in `src/` today.

- [ ] **Repository.** One class/module per business entity, the only code
  that issues Supabase queries for it (`SupabaseMaintenanceRepository` is
  the reference). No page, component, or API route queries Supabase
  directly — see `DATABASE_STANDARD.md`.
- [ ] **Service.** A service class sits between routes and the repository,
  owns audit-event emission, and is the single enforcement point for any
  business rule that must not be bypassable by trusting client input
  (`MaintenanceService` is the reference — see its lock-enforcement and
  `touchesLockAffectingFields()` pattern).
- [ ] **Validation.** A zod schema per create/update body
  (`src/features/maintenance/schemas/index.ts` is the reference), built as
  a function of `locale` so validation messages are localized, validated
  server-side in the route regardless of what client-side form validation
  already checked. See `API_STANDARD.md` §Validation.
- [ ] **Authorization.** Role checks via `src/lib/scope.ts` predicates only
  — no inline `if (role === 'X')`. Every route re-validates dealer scope
  server-side (`record.dealer_id !== session.dealerId` → 403), independent
  of the page's own UI-level gating. See `SECURITY_STANDARD.md`. Note that
  every role boundary in this app — including a module-specific one like
  Import Inspection's `canAccessImportInspection()` (`seesAllDealers`-only)
  — is an application-layer control, not an RLS control, since this app
  has no Supabase Auth; see `SECURITY_STANDARD.md` §Application-layer
  authorization before assuming RLS enforces a new module's role
  restriction.
- [ ] **Audit.** Every create/update/delete/lock-state-change call is
  logged via `logAuditEvent()`/`logAuditEvents()`/`diffFieldsForAudit()`
  (`src/lib/db.ts`) with a module-specific `module` tag, never a bespoke
  audit table.
- [ ] **Timeline.** The record's audit log is rendered read-only on its
  detail page via the shared `Timeline`/`TimelineItem` components
  (`src/components/shared/timeline/`).
- [ ] **Attachment.** Any photo/file goes through the existing
  `/api/upload` (≤4MB direct) / `/api/upload/init`+`chunk`+`finalize`
  (>4MB, Google Drive relay) pipeline — never a new upload path — and
  renders via the shared `AttachmentGallery` component
  (`src/components/shared/attachments/`).
- [ ] **Localization.** Every user-facing string routes through `t()`
  (Server Components, `@/lib/i18n/server`) or `useTranslation()` (Client
  Components, `@/lib/i18n/LocaleProvider`) against `src/locales/th.json`
  and `en.json` — no hardcoded Thai or English string in JSX, a
  `placeholder`, or a `swalError`/`swalConfirm` message. See
  `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` for approved terminology.
- [ ] **PDF.** Export via `@react-pdf/renderer`, reusing
  `src/lib/pdf/sharedStyles.ts` for every style property that is
  byte-identical to an existing module's PDF, adding only genuinely
  module-specific styles locally (see `exportPdf.tsx` /
  `maintenancePdf.tsx` for the pattern).
- [ ] **CSV.** UTF-8 BOM, Excel-safe, formula-injection-neutralized export
  (`src/lib/exportCsv.ts` / `maintenanceCsv.ts` is the reference), with
  localized column headers.
- [ ] **Search.** Server-side (not client-fetch-then-filter) search over
  the fields a user of that role would reasonably search by, applied
  through the same query the list view already uses — never a second,
  parallel filtering implementation (see `API_STANDARD.md` §Filtering and
  the MQR export-filter-parity fix in `docs/releases/archive/RC1_RELEASE_NOTES.md`
  as the cautionary example of what happens when it drifts).
- [ ] **History.** A record's lifecycle/status changes and field edits are
  visible as a timeline on the record itself (Audit + Timeline above),
  not only inferable by reading the audit table directly.
- [ ] **Permission.** Enforced twice, independently: a UI-level gate in
  the page/component (hide the button/field), and a server-level gate in
  the API route (reject the request) — the two must never be collapsed
  into a single shared check. See `docs/PERMISSION_MODEL.md` and
  `SECURITY_STANDARD.md`.
- [ ] **Tests.** Unit tests for services/utils, integration tests for API
  routes, including at minimum one permission-denied test and one
  cross-tenant-scope test per mutating route. See `TESTING_STANDARD.md`.
- [ ] **Documentation.** The module's own short spec (what it does, its
  status/lifecycle model, its report-number format per the Dealer
  Standard) lives under `docs/` or `docs/standards/`, and is linked from
  `docs/INDEX.md`.

## Report numbers

Every module that generates a business document number follows the
Dealer Standard format already adopted by MQR/PM:
`<Module>-<DealerCode>-<Year>-<Running>` (e.g. `NTR-KTV-2026-000001`),
generated via the shared `next_job_seq()` Postgres RPC with a
module-prefixed bucket key (the same pattern that resolved the MQR/PM
counter-collision — see `docs/releases/archive/RC1_RELEASE_NOTES.md`). A module
does not invent its own numbering scheme or counter table.

## What "reuse before building" means in practice

Before writing a new component, query, or validation helper, check:
`src/components/shared/` (UI), `src/lib/scope.ts` (permissions),
`src/lib/db.ts` (query helpers, `applyScope()`, audit helpers),
`src/lib/i18n/` (localization), `src/lib/pdf/sharedStyles.ts` (PDF theme),
`src/lib/swal.ts` (the only UI feedback mechanism — no `alert()`, no
inline banners), `docs/COMPONENT_CATALOG.md`. A module's own
`components/`/`utils/` folder is for genuinely module-specific code only;
anything a second module would also need is promoted to the shared layer,
never duplicated.

## Verification

Documentation only. Does not implement, scaffold, or modify any module.
