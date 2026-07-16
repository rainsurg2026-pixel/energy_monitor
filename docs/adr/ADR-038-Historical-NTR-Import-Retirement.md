# ADR-038: Historical NTR Import Retirement

## Status

Accepted, implemented. **Product Owner decision**, effective 2026-07-16 -
supersedes every prior ADR, design document, capability map, module
maturity document, and Playbook reference that classified Historical NTR
Import (formerly "Legacy Import") as Production/active/supported. This is
an intentional product simplification, not a correction of a prior
engineering mistake - the capability worked as designed; the business no
longer wants it offered.

## Decision

Historical NTR Import is **permanently retired**. Production Pilot must
not expose or support it, in any form, for any role.

This directly supersedes:

- **ADR-008** (Google Drive Decoupling for NTR Legacy Import) - its
  Drive-archiving pipeline no longer has a feature to serve.
- **ADR-024** (Universal Import Framework) - NTR was its only real
  adopter; the framework itself is not retired by this ADR (see Scope,
  below), but its one production consumer is gone.
- `docs/governance/MODULE_MATURITY_MATRIX.md`'s "Import Platform |
  Production (v1, NTR)" row.
- `docs/governance/CAPABILITY_MAP.md`'s Import History gap note.
- `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s navigation table entry
  ("Legacy Import's nav entry ... route and Import History still work,
  reachable directly").
- `docs/governance/AI_ENGINEERING_PLAYBOOK.md`'s "Currently blocked"
  list's framing of Legacy Import's route as an accepted, kept-reachable
  exception.
- `docs/architecture/PROJECT_STATE.md`'s domain ownership table (Import
  Platform row).

## Scope: what is retired vs. what is kept

**Retired (removed entirely, no code path remains):**

- The Dashboard's "Legacy Import" Quick Action and "Pending Imports" KPI
  (the platform's one entry point into the feature).
- `/admin/legacy-import` (the import wizard page) and `/admin/import-history`
  (the session-history page) - routes, pages, and their Administration nav
  entries.
- `/api/ntr/import/*` (preview, commit, template, sessions, sessions/[id]/
  result, archive) - the entire API surface.
- `NtrImportService`, `ntrImportFields.ts`, `ntrImportParser.ts`,
  `ntrImportResultExcel.ts`, `legacy-import-tool.tsx`,
  `ImportSessionHistoryTable.tsx`, `NtrImportSessionRepository`/
  `SupabaseNtrImportSessionRepository`.
- `NtrRepository.commitLegacyImportRow()` / `findActiveBySerials()` and the
  `NtrLegacyImportVehicleInput` type - the atomic-commit and bulk-lookup
  methods that existed only to serve the import wizard.
- `canManageLegacyImport()` (`lib/scope.ts`) - the permission predicate.
- `createNtrImportService()` (`features/ntr/factory.ts`).
- The `NtrImportSession`/`NtrImportRow`/`NtrImportPreview`/etc. wizard
  types (`features/ntr/types/index.ts`).
- All associated translation keys (`nav.legacyImport`,
  `nav.adminImportHistory`, `dashboard.legacyImport`,
  `dashboard.importHistoricalNtrData`, `dashboard.pendingImports`,
  `dashboard.viewImportHistory`, `validation.unauthorizedLegacyImport`,
  `validation.importFileRequired`, `validation.importFileUnreadable`,
  `validation.importSessionNotFound`, the entire `importHistory.*`
  namespace) and tests (`ntrImportService.test.ts`,
  `ntrImportFields.test.ts`, `ntrImportParser.test.ts`,
  `api/ntr/import/import-permissions.test.ts`).
- The now-pointless CSRF exemption for `/api/ntr/import` in
  `middleware.ts` (a dead carve-out for routes that no longer exist).

**Kept (historical audit metadata and data, not feature implementation):**

- Every `ntr_records` row previously created via Historical NTR Import -
  no production data modified, no migration run.
- `ntr_records.source`/`import_session_id` and `vehicles.import_session_id`
  columns and their existing values - read-only provenance now (the write
  path that ever populated them for new rows is gone; nothing depends on
  writing them going forward).
- `NtrSource`'s `'legacy_import'` value and the `sourceLabel()`/
  `ntr.sourceLegacyImport` display label on NTR detail pages/PDF exports -
  still needed to correctly label already-imported records.
- `NtrRecordCreateInput`'s `receiving_person`/`pdi_date`/
  `manufacturing_year`/`video_url`/`retail_date` fields - still needed by
  the repository/read paths for existing rows; the manual creation route
  already nulls them explicitly and never did (and now never will) accept
  them from a request body.
- `docs/import/NTR_HISTORICAL_IMPORT.md`, `docs/standards/
  NTR_IMPORT_MANUAL.md`, `docs/engineering/IMPORT_FRAMEWORK.md` -
  operational manuals for the retired feature, kept as historical record
  with a retirement banner added, not deleted (they document how existing
  data got into the system).

**Explicitly not retired by this ADR** - a separate architectural layer,
out of scope for this product decision:

- `src/shared/import/` (the Universal Import Framework, ADR-024's actual
  code, ADR-022's Import Platform v2). NTR was its only adopter, so it is
  now fully unconsumed except `TransformationLibrary.normalizeDate()`
  (used independently by `TractorInSyncService`) - flagged as technical
  debt for a future architecture decision (retire the framework itself, or
  keep it for the next module that needs bulk import), not decided here.
  Deleting a different ADR's platform infrastructure was not part of the
  Product Owner's instruction and is not a mechanical consequence of it.
- The `commit_ntr_legacy_import_row` Postgres RPC function and the
  `ntr_import_sessions` table. No migration was run (out of scope per "do
  not modify production data" / no schema change requested) - these are
  now unreachable from any application code path, flagged as debt for a
  future cleanup migration, not dropped here.

## Consequences

- Bulk historical NTR data import is no longer possible through this
  platform, by any role, through any path. A future need to bulk-import
  NTR data (e.g. a merger, a new dealer onboarding with existing records)
  would require a new ADR and new implementation - not a revival of this
  code.
- `docs/architecture/BUSINESS_ARCHITECTURE_CONSOLIDATION.md`'s row
  describing Tractor IN sync's manual-trigger gate (`canManageLegacyImport`
  = SuperAdmin only) is now stale in the same way; not rewritten by this
  ADR (out of the named documentation list) but the predicate it names no
  longer exists.

## Verification

Confirmed via code trace (not grep alone): no remaining import of
`canManageLegacyImport`, `createNtrImportService`, `NtrImportService`, or
any `/api/ntr/import`/`/admin/legacy-import`/`/admin/import-history` route
anywhere in `src/`. `navConfig.ts` has no entry pointing at either retired
route. `architecture-check`/`tsc`/`eslint`/`vitest`/`next build` all pass
on the resulting tree.
