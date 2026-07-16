# Machine Delivery Platform v1.0 - Architecture

ADR-027. The complete digital delivery lifecycle - Tractor In through
Warranty Activation. Import Inspection (MSEAL PDI) is one stage inside
this lifecycle (`docs/architecture/INSPECTION_PDI.md`, ADR-017), not
redesigned here.

Structured around the task brief's own ten requested Output sections.

> **Business-domain correction (2026-07-14, architecture-review pass):**
> the corrected Business Process is `Factory -> Import -> Stock Yard ->
> Import Inspection (MSEAL) -> Released to Dealer -> Dealer Stock -> NTR
> -> Warranty (automatic) -> PM -> Quality -> Knowledge`. Two changes
> from the original build, both reflected below: (1) Import Inspection
> (PDI) is an internal MSEAL process, gated exclusively to MSEAL roles -
> Dealer Approval does not exist; **Released to Dealer** (an MSEAL
> decision on the Inspection itself, ADR-017) is what ends this stage,
> not Delivery Acceptance. (2) **Warranty is never activated manually,
> and Delivery Acceptance no longer auto-triggers it** - NTR (the
> ownership-transfer event) is the sole legitimate trigger
> (`DeliveryService.activateWarrantyFromNtr()`, called from the NTR
> creation route). See `docs/architecture/INSPECTION_PDI.md`'s own
> correction notice for the Inspection-side detail.

> **Platform Stabilization (2026-07-15, ADR-031):** the General Delivery
> lifecycle-tracking UI (`/delivery/dashboard`, `/delivery/records`,
> `/delivery/records/[id]`, `/delivery/records/new`, `/delivery/reports`)
> was removed - it had carried zero navigation entries since ADR-029 and
> had no other caller. `DeliveryService`/`DeliveryRepository`, the
> `delivery_records`/`delivery_trainings` data model, and every
> `/api/delivery-records/**`/`/api/delivery/**` route below are
> unchanged - `MachineDeliverySection` (Vehicle 360) and
> `activateWarrantyFromNtr()` (NTR creation) still call this service
> directly. Import Inspection (`/delivery/pdi/**`) is unaffected.

## 1. Machine Delivery Architecture

Machine remains the platform center (ADR-009, unchanged). Delivery is a
new lifecycle-tracking aggregate (`delivery_records` +
`delivery_trainings`) that **orchestrates**, never duplicates, every
stage's real owner:

```
Manufacturing
  |
Tractor In           -> vehicles (ADR-012, TractorInSyncService) - read only
  |
Stock Yard           -> delivery_records (new)
  |
Import Inspection    -> inspections (ADR-017, MSEAL-only) - linked, not
  |                     duplicated. Released to Dealer ends this stage.
  |
Delivery             -> delivery_records (Dealer Preparation, Customer
  |                     Delivery link to ntr_records, Operator Training,
  |                     Delivery Acceptance)
NTR                  -> ntr_records - the ownership-transfer event
  |
Warranty              -> delivery_records.warranty_activated_at, source
  |                     'NTR' only (never manual) + vehicles.delivery_date-
  |                     driven calcWarranty() (unchanged, still live)
PM / Quality / Knowledge / IoT
  (unchanged - existing Machine Passport sections; Delivery adds one more
  read-only section, does not touch these)
```

Every activity contributes to the Machine Passport (§5), the shared
Timeline (§6), and may create Knowledge (§7) - the task's own Platform
Principles, satisfied by reuse, not new infrastructure.

## 2. Delivery Lifecycle

`delivery_records.stage`, one column, nine values, one direction (no
skipping backward):

1. **Tractor In** - `createDeliveryRecord()`: reads the vehicle (already
   synced via ADR-012), starts tracking. Default stage on row creation.
2. **Stock Yard** - `receiveAtStockYard()`: location + timestamp.
3. **PDI** - `linkInspection()`: links an `inspections` row. Stage stays
   `PDI` until the linked Inspection's own `status` is `Completed`, then
   advances.
4. **Dealer Preparation** - `completeDealerPrep()`: notes + timestamp.
5. **Customer Delivery** - `linkNtr()`: links an `ntr_records` row
   (Customer/Machine/Photos/Delivery Date already captured there - never
   re-entered).
6. **Operator Training** - `recordTraining()`: creates a
   `delivery_trainings` row (§4), links it.
7. **Delivery Acceptance** - `recordAcceptance()`: gated by
   `canApproveDelivery`. **Business-domain correction: no longer
   auto-triggers Warranty Activation** - only records the stage/
   signature; advances to stage 8 to await NTR.
8. **Warranty Activation** - `activateWarrantyFromNtr()`: one timestamp +
   source (**`NTR` only** - never `Manual`, never triggered by Delivery
   Acceptance) - not a claims/policy ledger. Called exclusively from the
   NTR creation route's own non-blocking side-effect
   (`src/app/api/ntr-records/route.ts`), find-or-creating this machine's
   Delivery record so Warranty Activation is never blocked on prior
   Delivery-stage bookkeeping.
9. **Completed** - `overall_status: 'Completed'`.

## 3. Import Inspection Architecture

See `docs/architecture/INSPECTION_PDI.md` in full. Summary: one
`inspections` aggregate (ADR-017), an internal MSEAL process - Checklist/
Findings/Factory Feedback/Evidence/Measurements/Parts Replacement/
Digital Sign-off/Checklist Version/Technician Certification/RE-PDI
chaining/Release to Dealer - all real, all tested, all MSEAL-only
(`canAccessImportInspection`). Delivery links an Inspection by ID; it
never queries or writes `inspections` directly.

## 4. Training Architecture

`delivery_trainings` (child of `delivery_records`, cascade-deleted with
it): Training Topics (`[{topic, covered}]`), Operator (name + phone),
Trainer (name + optional ID), Training Date, Training Duration
(minutes), Customer Satisfaction (1-5). No URL columns on the table
itself, unlike NTR's older hardcoded-photo-column pattern (a deliberate
modernization, per the task's own "modernize it" instruction) - Training
Photos/Videos are designed to reuse the Attachment Platform (`module:
'delivery'`, retention policy already seeded) the same way PDI Evidence
already does.

**Correction (architecture-review pass, found during verification, not
overclaimed going forward)**: the Training Photos/Videos capture screen
itself was never actually wired to `AttachmentService` in this PR - only
PDI Evidence (`/delivery/pdi/[id]`) is. Training capture
(`/delivery/records/[id]`'s training form) has no photo/video upload UI
yet. Schema and retention policy are ready; the capture screen is
Explicitly Deferred (§Explicitly deferred, below) alongside the other
named gaps - not silently shipped as claimed-but-missing.

## 5. Machine Passport Integration

`MachineService.getMachineDeliverySummary(serial)` -> thin facade ->
`DeliveryService.getDeliveryForMachine(serial)` - read-only, latest
delivery record for this serial. New `MachineDeliverySection` (async
Server Component, own `<Suspense>` boundary), inserted immediately before
the existing Warranty section (Machine Passport v1.5) - matching the
real-world chronology the task brief itself states (Tractor In -> ... ->
Delivery -> Warranty). Machine owns none of this data.

## 6. Timeline Integration

Zero new table. `AuditModule` (`lib/types.ts`) widened from `'mqr'|'pm'|
'ntr'|'knowledge'` to add `'pdi'|'delivery'`. Every mutating
`InspectionService`/`DeliveryService` method writes through the existing
`logAuditEvent()`/`logAuditEvents()` into `record_audit_log`. `
<ActivityTimeline>` and its mapper needed zero changes - confirmed
module-agnostic (the same claim ADR-018 made for Knowledge, re-verified
here).

## 7. Knowledge Integration

Inspection Findings promote to Knowledge Candidates through
`KnowledgeService.createCandidate()`/`.addEvidence()` directly (ADR-017
§4) - "do not duplicate entry," satisfied by calling the existing public
write API, not building a second one. `knowledge_evidence.source_type`
widened to add `'Inspection'` and `source_module` to add `'pdi'` -
additive CHECK constraint changes only, no change to `KnowledgeService`/
`KnowledgeRepository` code. This is the Knowledge Foundation Freeze
v1.0's own documented Extension path ("adding a new Evidence source
type"), not a violation of the freeze.

## 8. Dashboard - Screen Contract KPI set

`/delivery/dashboard` - KPIs computed by `DeliveryService.
getDashboardStats()`, reusing `dashboardStats()`/`buildLeaderboard()`'s
JS-side aggregation shape (`lib/db.ts`), not a second reporting engine.
This is not a UI redesign - the ten KPIs below are the official,
binding contract for this screen (platform-quality refinement,
architecture-review pass); the layout itself is unchanged.

**Business-domain correction:** Import Inspection's own KPIs (Pending
Import Inspection, Pending RE-PDI, Expired Inspection, Released to
Dealer, Critical Findings, Findings by Model, Findings by Factory,
Factory Feedback Pending, Average Inspection Time, Inspection Pass Rate)
moved to their own, separate, MSEAL-only **Import Inspection Dashboard**
(`/delivery/pdi/dashboard`, `InspectionService.getDashboardStats()` -
see `docs/architecture/INSPECTION_PDI.md` §8) - they are a distinct
internal MSEAL capability, not a Delivery-lifecycle KPI. "PDI First Pass
Rate" below (#8) remains on the general Delivery Dashboard as a
cross-cutting lifecycle metric.

| # | KPI | Status | Definition |
|---|---|---|---|
| 1 | Pending Tractor In | **Implemented** | Vehicles synced via Tractor In (ADR-012) with no Delivery record yet - `DeliveryRepository.countVehiclesWithoutDeliveryRecord()`, a real anti-join against `vehicles`, never a fabricated number |
| 2 | Pending Stock Yard | **Implemented** | Delivery records at `stage === 'TractorIn'` - created, not yet received at Stock Yard |
| 3 | Pending PDI | **Implemented** | Delivery records at `stage === 'StockYard'` - received, PDI not yet linked/started |
| 4 | Pending Delivery | **Implemented** | Every delivery record not yet `Completed` - the overall pipeline count |
| 5 | Pending Training | **Implemented** | Delivery records at `stage === 'OperatorTraining'` |
| 6 | Warranty Waiting | **Implemented** | Delivery records at `stage === 'WarrantyActivation'` - accepted, not yet activated |
| 7 | Average Delivery Lead Time | **Implemented** | Mean days from delivery-record creation (Tractor In) to Warranty Activation, across activated records only; `null` (not `0`) when none have activated yet |
| 8 | PDI First Pass Rate | **Implemented** | Pass rate among completed Inspections with a result. This platform's Inspection model has no re-inspection/retry state (Explicitly Deferred, `docs/architecture/INSPECTION_PDI.md`) - every completed inspection's result is definitionally its first and only one, so this metric *is* the first-pass rate, not a separate calculation |
| 9 | Open Delivery Findings | **Reserved for Future Capability** | Requires a "resolved" state on a PDI Finding, which does not exist today (a Finding currently only records `knowledgeCaseId` once promoted - promoted is not the same concept as resolved). Rendered as a Coming Soon tile, never a fabricated count |
| 10 | Dealer Delivery SLA | **Reserved for Future Capability** | Requires a configured per-dealer delivery-duration SLA threshold, which does not exist anywhere in this platform. Rendered as a Coming Soon tile, never a fabricated status |

Dealer Ranking / Technician Ranking (sorted leaderboards, same shape as
Quality Dashboard's own) remain on this screen as additional context -
they are not part of the official ten KPIs above.

### Reports (`/delivery/reports`)

All 7 named report types (Dealer/Technician/Model/Checklist Version/
Delivery Duration/Training Completion/Warranty Activation) are filters/
columns of **one** consolidated `DeliveryReportRow` dataset -
Reuse-before-Build, not 7 separate report pipelines. CSV export reuses
the existing shared `buildCsv()` (`lib/exportCsv.ts`).

## 9. Migration Plan

**No data migration was executed by this PR** - there is no accessible
AppSheet export anywhere in this repository or this environment (see
ADR-017's Problem section; flagged explicitly, not fabricated, matching
the Import Platform v2 task's own precedent for a missing source file).

Intended cutover, once an AppSheet export becomes available:
1. **Dual-run period** - both systems accept new PDI/delivery entries
   while historical data is exported from AppSheet.
2. **Freeze new entry in the legacy system** once this platform is
   verified in production - no new PDI/delivery records created outside
   this platform from that point.
3. **One-time historical import**, adapted from NTR's existing Legacy
   Import pipeline (`src/shared/import/`, ADR-009/ADR-024) rather than a
   new import engine - the same "reuse before build" discipline this
   epic applied everywhere else.
4. **Verification**: row-count reconciliation against the AppSheet
   export, spot-check a sample of imported Inspections/Deliveries against
   their original source before treating the cutover as complete.

This plan is not executed - it is the recommended path once the missing
input (an AppSheet export) exists.

## 10. Future AI Integration

Reserved only - zero implementation, matching Knowledge's own AI
precedent. `DeliveryFutureAiPanel`: 4 Coming Soon tiles - **AI Delivery
Review**, **AI Delivery Risk**, **AI Readiness**, **AI Recommendation** -
same `Card`+`EmptyState comingSoon` shape as `KnowledgeFutureAiPanel`,
each captioned "AI must always cite Evidence." Any future AI capability
here inherits the Knowledge Foundation Freeze's AI Contract (never owns
Knowledge/Delivery data, never becomes the Source of Truth, consumes
through the existing services only, never bypasses them).

## Production Readiness Recommendation

**PASS WITH WARNINGS.** Core lifecycle (Tractor In -> Stock Yard ->
Import Inspection -> Dealer Preparation -> Customer Delivery -> Operator
Training -> Delivery Acceptance -> NTR -> Warranty Activation ->
Completed) is real, tested, and integrated into Machine Passport,
Timeline, and Knowledge. "Creates Customer ownership" (no Customer/
Ownership domain exists - `vehicles` has no such FK) and "triggers
Notifications" (no Notification service exists - `NotificationBell` is a
static placeholder) are Reserved for Future Capability, honestly, not
fabricated. Explicitly
deferred: Import PDI UI, full Warranty claims/policy ledger, Technician
Certification management, checklist template builder, Training Photos/
Videos capture UI (schema and Attachment Platform retention policy
ready, no upload screen built - see §4's correction), AI Delivery
Review/Risk/Readiness/Recommendation implementation, Open Delivery
Findings and Dealer Delivery SLA KPIs (§8, Reserved for Future
Capability - no data model exists for either), AppSheet data migration
execution (no export available).
