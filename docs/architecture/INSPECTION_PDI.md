# Import Inspection Domain (MSEAL PDI) - Architecture

ADR-017. Reconciles `docs/architecture/blueprint/04-INSPECTION-DOMAIN.md`
(frozen Architecture Baseline).

> **Business-domain correction (2026-07-14, architecture-review pass):**
> the original build of this domain modeled "PDI" as a Dealer-facing
> capability gated by Dealer Approval, and optionally linked to an NTR
> record. That was wrong. **Import Inspection is an internal MSEAL
> quality process performed by MSEAL technicians before a machine is
> Released to Dealer** - it is never dealer-visible in detail, never
> linked to an NTR record, and Dealer Approval does not exist as a
> concept in this domain. The corrected Business Process:
>
> `Factory -> Import -> Stock Yard -> Import Inspection (MSEAL) ->
> Released to Dealer -> Dealer Stock -> NTR -> Warranty (automatic) ->
> PM -> Quality -> Knowledge`
>
> "PDI" is one **inspection event** type, not the name of the whole
> capability - a machine may have several (`PDI -> RE_PDI -> RE_PDI ->
> ...`), each immutable and chained via `previous_inspection_id`. This
> document is updated in place to describe the corrected model; sections
> below no longer describe Dealer Approval or the NTR link, which were
> removed. See `docs/architecture/DELIVERY_PLATFORM.md` for the corrected
> Business Process and Machine Lifecycle diagrams.

## 1. Domain Model

One aggregate, one table: `inspections`. Inspection records own only
inspection information - Machine identity (Serial Number, Engine Number,
Model, Variant, Manufacturing Year) always comes from Machine Registry
(`vehicles`, via `vehicle_id`); `serial` here is a denormalized reverse-
lookup convenience only, never a second source of machine identity.

| Field | Notes |
|---|---|
| `inspection_ref` | `PDI-<year>-######`, dealer-scoped `next_job_seq()` bucket |
| `inspection_type` | `PDI` (first inspection event) / `RE_PDI` (any subsequent one) - structural, not a business reason |
| `inspection_reason` | `INITIAL` / `STORAGE_EXPIRED` / `REPAIR_VERIFICATION` / `FACTORY_REQUEST` / `OTHER` - why this particular event happened, independent of `inspection_type` |
| `inspection_sequence` | 1, 2, 3, ... - the position of this event in the machine's chain |
| `previous_inspection_id` | FK to the inspection this one follows (`null` for the first) - immutable chain, never an overwrite |
| `vehicle_id` + `serial` | FK `vehicles.id`, plus denormalized `serial` for reverse lookup |
| `dealer_id` | FK `dealers.id` |
| `status` | `Scheduled` / `InProgress` / `Completed` / `Cancelled` |
| `result` | `Pass` / `Fail` / `Conditional` - set on `completeInspection()`, never hand-picked |
| `release_status` | `Pending` / `ReleasedToDealer` / `RequiresRePdi` / `Expired` - the release/workflow state, independent of `result` |
| `next_re_pdi_due_date` | Set on a Pass, `inspection_date + 180 days` (configurable, `INSPECTION_EXPIRATION_DAYS`) |
| `checklist_version` | e.g. `PDI-CL-v1` - one seeded default template ships this epoch |
| `checklist` (JSONB) | `[{id, category, label, result: Pass\|Fail\|NA\|null, remark}]` |
| `findings` (JSONB) | `[{id, severity, system, description, disposition, factoryFeedbackStatus, correctiveActionReference, knowledgeCaseId}]` - `severity` reuses the platform's existing `Severity` type, no second vocabulary |
| `factory_feedback` | Inspection-level narrative sent back to the factory/import side - distinct from each finding's own structured `factoryFeedbackStatus` |
| `measurements` (JSONB) | `[{id, parameter, value, unit, specMin, specMax, inRange}]` |
| `parts_replaced` (JSONB) | `[{id, partName, partNumber, qty, reason}]` |
| `technician_name`/`technician_certification_ref` | Certification is a free-text reference only - no certification-management module |
| `signed_off_by`/`signed_off_at` | Digital Sign-off - open to the performing technician |

Removed by the business-domain correction: `dealer_approved_by`/
`dealer_approved_at` (Dealer Approval does not exist in this domain -
Release to Dealer is an MSEAL-only decision) and `related_ntr_id` (Import
Inspection is never linked to an NTR record - NTR happens later, at the
dealer, after Release to Dealer).

## 2. Lifecycle

`Scheduled -> InProgress -> Completed` (or `Cancelled` at any point).
`completeInspection()` requires every checklist item to have a non-null
`result` before allowing completion, and derives `result` from the
checklist/findings (`Fail` if any checklist item fails and a Finding was
recorded; `Conditional` if a checklist item fails with no Finding;
`Pass` otherwise) - never silently `Pass` on a failed item. On a Pass,
`next_re_pdi_due_date` is computed and `release_status` stays `Pending`;
on a Fail, `release_status` becomes `RequiresRePdi` immediately.

Sign-off requires `status === 'Completed'`. **Release to Dealer**
(`releaseToDealer()`) is a separate, explicit action - requires a
Completed, Passed, signed-off, non-expired inspection - gated exclusively
to MSEAL (`canAccessImportInspection`, `lib/scope.ts`: SuperAdmin/
CentralAdmin - the same boundary as `seesAllDealers`). **RE-PDI**
(`createRePdi()`) starts a brand-new, chained inspection event
(`inspection_sequence` + 1, `previous_inspection_id` set) - the previous
inspection is never overwritten.

## 3. Evidence (Attachments)

Reuses the existing Attachment Platform directly - `AttachmentService`
with `module: 'pdi'`, `entityType: 'Inspection'`. The `'pdi'` retention
policy (365 days) was pre-seeded in `attachment_retention_policies`
before this epoch existed, anticipating exactly this build.

## 4. Knowledge Integration

"Structured Findings may become Knowledge Candidates... do not duplicate
entry" (task brief). `InspectionService.promoteFindingToKnowledge()`
calls `KnowledgeService.createCandidate()` then `.addEvidence()`
directly - `source_type: 'Inspection'`, `source_module: 'pdi'` - and
stores the resulting `knowledgeCaseId` back onto the Finding. There is no
second Knowledge-entry form anywhere in this module.

## 5. Factory Feedback Model

Two distinct layers, both first-class:

- **Per-finding** (`disposition`, `factoryFeedbackStatus`,
  `correctiveActionReference`) - MSEAL's own engineering judgment on one
  finding and the state of communicating it back to the factory/supplier.
  `correctiveActionReference` is a free-text pointer today (a real 8D/CAPA
  reference, once such a system exists to reference) - not a fabricated
  FK to a system that doesn't exist yet (Supplier Quality integration is
  future work).
- **Inspection-level** (`factory_feedback`) - the overall narrative
  summary sent back for this inspection as a whole.

## 6. Machine Passport Integration

Machine Passport displays the complete, immutable Import Inspection
history (`InspectionService.listInspectionsForSerial()`, oldest first) -
count, dates, technician, result, findings count, factory feedback
status, release status per event. This read is **not** gated by
`canAccessImportInspection` (unlike every other Inspection action) - the
Passport is dealer-visible platform-wide, and showing *that* inspections
occurred is not the same as exposing full findings/evidence, which stays
behind the MSEAL-only detail screen. Reuses the shared Activity Timeline
(`PDI_COMPLETED`/`RELEASED_TO_DEALER` platform events) for the milestone
view - never a second timeline.

## 7. Screen Contract

- **`/delivery/pdi`** (list, MSEAL-only) - filters: status/serial/
  technician search; columns include Type (PDI/RE-PDI + sequence) and
  Release Status.
- **`/delivery/pdi/new`** (create, MSEAL-only) - serial + technician +
  certification reference -> Initial Inspection (`PDI`, sequence 1,
  reason `INITIAL`), seeded checklist.
- **`/delivery/pdi/[id]`** (detail, MSEAL-only) - Checklist editor
  (Pass/Fail/N/A + remark per item), Findings (add + per-finding Factory
  Feedback status + Promote to Knowledge), Measurements (add, auto
  in-range check), Parts Replacement (add), Evidence (`AttachmentViewer`),
  Complete/Sign-off/Release to Dealer/Start RE-PDI actions,
  inspection-level Factory Feedback panel, `<ActivityTimeline
  entityLabel="Import Inspection">`.
- **`/delivery/pdi/dashboard`** (Import Inspection Dashboard, MSEAL-only)
  - see §8.

## 8. Import Inspection Dashboard Contract

Renamed/scoped from the general internal dashboard (business-domain
correction). MSEAL-only. Official KPI set:

| KPI | Status |
|---|---|
| Pending Import Inspection | Live (`status` in Scheduled/InProgress) |
| Pending RE-PDI | Live (`releaseStatus === 'RequiresRePdi'`) |
| Expired Inspection | Live (`isInspectionExpired()`, never a stored/stale flag) |
| Released to Dealer | Live |
| Critical Findings | Live (`findings.severity === 'Critical'` count) |
| Factory Feedback Pending | Live (`findings.factoryFeedbackStatus === 'NotSent'` count) |
| Average Inspection Time | Live, approximated (`createdAt` -> `updatedAt` of Completed inspections - no distinct started/completed timestamp pair exists) |
| Inspection Pass Rate | Live |
| Findings by Model | **Reserved for Future Capability** - no denormalized model field on `Inspection` |
| Findings by Factory | **Reserved for Future Capability** - no factory/supplier identity field exists anywhere in this schema |

## 9. Governance

Owned by the Inspection domain (this ADR), not by Quality, Delivery, or
Machine. Delivery links an Inspection by ID; it never queries or writes
`inspections` directly (`DeliveryService`/`DeliveryRepository` never
reference the table). Exactly one nav entry (`/delivery/pdi`, under the
Delivery nav group), gated to MSEAL roles only, never duplicated under
Quality or Engineering Intelligence.

## 10. Architecture Notes

Relationship to ch.04: same generic `Inspection` entity/table shape. This
build adds what ch.04 left unspecified (findings/measurements/parts
replacement/sign-off/checklist version/RE-PDI chaining/Factory Feedback)
as additive JSONB/text columns on the same row - no second table, no
forked model. `IMPORT_PDI` as a distinct `inspection_type` value (ch.04's
own enum) is superseded by the corrected model's `PDI`/`RE_PDI`
structural distinction - every inspection in this table already *is* an
Import Inspection.

## 11. Production Readiness Recommendation

**PASS WITH WARNINGS.** Core Import Inspection workflow (checklist ->
findings -> measurements -> parts -> sign-off -> Release to Dealer / RE-
PDI -> Knowledge promotion) is real, tested, and wired into the Delivery
lifecycle, Machine Passport, and Machine Timeline. Explicitly deferred:
Import PDI UI for the manufacturer/import side (schema-ready, no separate
screen), checklist template builder/admin UI (one seeded default ships),
Technician Certification management beyond a free-text reference,
Supplier Quality integration for Factory Feedback (free-text corrective
action reference only), Findings by Model/Findings by Factory KPIs (no
data model yet).
