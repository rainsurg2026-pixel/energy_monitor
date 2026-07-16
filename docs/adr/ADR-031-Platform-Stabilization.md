# ADR-031: Platform Stabilization

## Status

Accepted. A consolidation pass after ADR-028/ADR-029/ADR-030 - no new
business feature, no architecture redesign. Every change below is either a
deletion of already-dead code/routes/translations, a documentation-only
correction, or a transparent, behavior-preserving performance fix
(request-scoped memoization).

## Problem

Three consecutive corrections (ADR-028 Import Inspection domain
correction, ADR-029 Quality Inspection nav consolidation, ADR-030 Vehicle
360 consolidation) each deliberately deferred cleanup of what they made
obsolete, to keep their own diffs focused:

- ADR-029 explicitly left the General Delivery lifecycle-tracking UI
  (`/delivery/dashboard`, `/delivery/records`, `/delivery/reports`)
  unlinked from navigation but undeleted, "left to a future,
  explicitly-scoped task."
- Every terminology/consolidation pass left its own now-orphaned
  translation keys behind rather than chasing them down mid-PR.
- Machine Passport accumulated five independent sections
  (Attachments/Warranty/Quality/Activity/Related Records) that each
  independently re-derive the same "MQR/PM/NTR records for this serial"
  reads, without ever being consolidated once the pattern repeated a
  fourth and fifth time.

This ADR is that future task.

## Decision

**Route cleanup.** The General Delivery lifecycle-tracking UI is removed:
`delivery/dashboard/page.tsx`, `delivery/records/page.tsx`,
`delivery/records/[id]/page.tsx`, `delivery/records/new/page.tsx` +
`NewDeliveryForm.tsx`, `delivery/reports/page.tsx`, and the three
components exclusively imported by them
(`DeliveryStageTracker`/`DeliveryActionsPanel`/`DeliveryFutureAiPanel`).
Verified before deletion: zero remaining runtime imports, zero lazy
imports, zero string route references, zero test coverage. Import
Inspection (`/delivery/pdi/**`) and `DeliveryService`/`DeliveryRepository`
(still called directly by Vehicle 360's `MachineDeliverySection` and by
`activateWarrantyFromNtr()`) are unaffected.

**API cleanup.** The ten `/api/delivery-records/**` and `/api/delivery/**`
route handlers whose only caller was the now-deleted UI are removed
alongside it (list/create, `[id]` detail, `acceptance`, `dealer-prep`,
`link-inspection`, `link-ntr`, `stock-yard`, `training`, `dashboard`,
`report`). `DeliveryService`'s own methods (`getDashboardStats`,
`getDeliveryReport`, `createDeliveryRecord`, `receiveAtStockYard`,
`completeDealerPrep`, `recordTraining`, `recordAcceptance`) are untouched -
still tested, still the ADR-027-documented service contract; only their
now-dead HTTP wrappers are gone.

A separate sweep found additional callerless routes unrelated to Delivery
(`product-families`, `ntr-records/history`, `pm-records/[id]/lock`,
`attachments/[id]` GET/DELETE, `attachments/[id]/restore`,
`knowledge-cases` GET routes - each a case of a server component bypassing
its own API route and calling the service directly). These are **reported
as candidates, not removed** - they're pre-existing and unrelated to this
stabilization's actual scope, several carry "manual/future" framing in
their own doc comments, and batch-removing a wider, unrelated set of
routes in the same PR raises the blast radius past what this pass is for.
See the PR's Final Audit for the full list.

**Translation cleanup.** 150 orphaned keys removed from `en.json`/`th.json`
(key-set parity re-verified after every pass: 980 -> 916 -> 830, matching
in both locales). Two batches: (1) 64 leftover UI-terminology keys with
zero remaining reference anywhere (generic `common.*` words, stale
`vehicle360.*`/`machine360.*` keys from the page ADR-030 removed, unused
`csv.*`/`validation.*`/`nav.*` entries); (2) the entire `delivery.*`
namespace (86 keys) plus `unit.days`, orphaned in full by the route
cleanup above. Verified via a scripted flatten-and-grep check that also
detects the codebase's dynamic `t(\`prefix.${var}\`)` key pattern, so
dynamically-referenced keys (e.g. `pdi.status.${x}`, `ntr.outcome_${x}`)
were never miscounted as orphans.

**Performance - Machine Passport query deduplication.** Machine Passport's
Attachments/Warranty/Quality/Activity/Related Records sections (and the
new NTR section from ADR-030) each independently call
`fetchMqrRecords`/`fetchMaintenanceHistoryForSerial`/`fetchNtrRecordsForSerial`
for the same serial - up to 5 redundant re-reads of the identical record
set per single page load. All three functions are now wrapped in React's
`cache()` (request-scoped memoization, the standard Next.js App Router
pattern for exactly this "same data, multiple components" case) at their
one definition site - every existing call site is unchanged, the returned
data is identical, and each section's independent `<Suspense>` streaming
boundary is preserved (this is deliberately *not* a consolidation into one
blocking fetch - that would regress perceived load time by making every
section wait for the slowest one). Verified: mocked in
`service.test.ts` (the only test touching these functions), so the
`cache()` wrapper is never exercised by tests either way - no behavioral
test dependency.

**Machine Passport audit** (no changes beyond the dedup above): every
section already reads through `MachineService`, a thin facade with zero
duplicated repositories/DTOs - each section delegates to the owning
module's own service (`InspectionService`, `DeliveryService`,
`KnowledgeService`) or a shared "records for this serial" utility, never a
second implementation of another module's query.

**Database cleanup (report only, nothing dropped).** See the PR's Final
Audit for the full table. Summary: `pm_programs`, `parts`,
`districts_raw`/`provinces_raw`/`subdistricts_raw` have zero code
references (superseded/staging tables); `inspections.technician_certification_ref`
and `ntr_records.retail_date` are deprecated-but-holding-real-historical-data
columns (UI no longer collects them, per ADR-028/the NTR terminology
cleanup, but existing rows are never touched).

## Consequences

- Exactly one entry point per business domain in navigation now holds:
  Vehicle 360 (`/machines`), Quality Inspection (Import Inspection
  Dashboard + list), NTR, PM, MQR/Quality, Knowledge.
- Every remaining `/delivery/**` route is either still nav-linked
  (`/delivery/pdi/**`) or a still-functioning, still-tested service/API
  surface with no orphaned UI in front of it.
- No behavior change anywhere - every deletion was of code with zero
  remaining callers, and the one performance change is a transparent
  memoization with an identical return contract.

## Verification

`tsc --noEmit` clean; `eslint .` 0 errors (12 pre-existing warnings,
unchanged baseline); `vitest run` pass (see PR for final count); `next
build` succeeds; `architecture-check` 6/6 PASS.
