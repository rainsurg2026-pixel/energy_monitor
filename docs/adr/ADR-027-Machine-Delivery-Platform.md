# ADR-027: Machine Delivery Platform v1.0

## Status

Accepted (PR #45, merged 2026-07-13, SHA `de4d8cd`). See
`docs/releases/FOUNDATION_FREEZE_v1.1.md` for what this ADR's
architecture froze on merge.

> **Amendment (2026-07-14): ADR-028 (Import Inspection Domain
> Correction) amends this ADR's Warranty Activation trigger.** Delivery
> Acceptance no longer auto-activates Warranty; NTR is the sole
> legitimate trigger (`DeliveryService.activateWarrantyFromNtr()`), and
> the `'Manual'` activation source/route/UI is deleted entirely. This
> ADR's own lifecycle-orchestration decision (the nine `delivery_records`
> stages) is otherwise unchanged and not reopened as its own frozen
> layer - see ADR-028 for the full correction and
> `docs/architecture/DELIVERY_PLATFORM.md` for the corrected, current
> architecture.

**Numbering note**: this is not one of the seven numbers
`16-ADR-RECOMMENDATIONS.md` reserved (015 Machine Domain v2, 016 Event
Model, 017 Inspection Domain, 018 Knowledge Model, 019 Engineering
Intelligence, 020 Analytics Domain, 021 Machine Digital Passport - 021
consumed by ADR-026, 018 by the Knowledge Platform). "Machine Delivery
Platform" as a whole - the lifecycle orchestration wrapping Tractor
In/Stock Yard/PDI/Dealer Preparation/Customer Delivery/Operator Training/
Delivery Acceptance/Warranty Activation - is not the narrower topic any
of those seven reservations names; it depends on ADR-017 (Inspection
Domain, PDI) as one stage, without re-deriving it. `026` is the highest
ADR that exists on disk; this is `027`, the next available number.

## Problem

The task asks for the complete digital delivery lifecycle - Tractor In
through Warranty Activation - as one platform capability, with PDI as
one stage inside it, not a PDI redesign.

Grounding audit found the pieces already exist in fragments:
- **Tractor In** already exists (ADR-012, `TractorInSyncService` syncing
  a Google Sheet into `vehicles`) - a real, working sync, not a gap.
- **Customer Delivery** already has NTR (`ntr_records` - full customer/
  machine/photos/delivery-date capture) - a real, working module.
- **Stock Yard, Dealer Preparation, Operator Training, Delivery
  Acceptance** have no representation anywhere - genuine gaps.
- **Warranty Activation** is a documented, named gap:
  `docs/architecture/blueprint/03-MACHINE-LIFECYCLE-AND-TIMELINE.md`
  states the chain `Factory -> Import -> Import PDI -> Released to Dealer
  -> Dealer Receive -> Dealer PDI -> Customer Delivery -> NTR -> Warranty
  Activated -> PM...` and explicitly flags: "warranty status is computed
  on read, never emitted as a point-in-time event." `src/lib/warranty.ts`
  confirms this - `calcWarranty()` computes live off `vehicles.
  delivery_date`; there is no dedicated Warranty table anywhere
  (`docs/architecture/MACHINE_DATA_OWNERSHIP.md`).

Nothing ties these fragments into one trackable lifecycle per machine -
there is no way today to answer "where is this machine in its delivery
journey" without manually checking three different modules.

## Decision

A new lifecycle-tracking aggregate, `delivery_records`, that
**orchestrates** every stage without duplicating any domain that already
owns a piece of it:

| Stage | Owner | This aggregate's role |
|---|---|---|
| 1. Tractor In | `vehicles` (ADR-012) | Reads it; creates the Delivery record referencing it. Never re-syncs or duplicates vehicle fields |
| 2. Stock Yard | Delivery (new) | Owns `stock_yard_received_at`/`stock_yard_location` |
| 3. PDI | Inspection (ADR-017) | Links an `inspections` row (`pdi_inspection_id`); never duplicates checklist/findings/evidence |
| 4. Dealer Preparation | Delivery (new) | Owns `dealer_preparation_completed_at`/`_notes` |
| 5. Customer Delivery | Service > Registration/NTR | Links an `ntr_records` row (`ntr_id`); never duplicates Customer/Machine/Photos/Delivery Date |
| 6. Operator Training | Delivery (new) | Owns `delivery_trainings` (Training Topics/Operator/Trainer/Duration/Customer Satisfaction); Photos/Videos designed to reuse the Attachment Platform, capture UI deferred - see `docs/architecture/DELIVERY_PLATFORM.md` §4 |
| 7. Delivery Acceptance | Delivery (new) | Owns `acceptance_signed_at`/`_by`/`_notes`, gated by `canApproveDelivery` |
| 8. Warranty Activation | Delivery (new) | Owns `warranty_activated_at`/`warranty_activation_source` - **the point-in-time event ch.03 names as a gap**, auto-triggered by Delivery Acceptance or manually activatable. Not a claims/policy ledger - `calcWarranty()`'s live computation is unchanged; this only adds the missing activation *moment* |
| 9. Machine Passport sync | Machine (ADR-009/ADR-026) | Reads a Delivery summary via `MachineService.getMachineDeliverySummary()` -> `DeliveryService`; Machine owns none of this data |

**One Aggregate, One Owner**: `delivery_records` + `delivery_trainings`
are the only new tables (one repository, two tables of one aggregate -
the same pattern Knowledge used for case+evidence); `DeliveryRepository`/
`DeliveryService` are their only writers. Every other stage's real data
(`vehicles`, `inspections`, `ntr_records`) is referenced by FK, never
copied.

**Reuse over rebuild** for every cross-cutting concern:
- **Attachments**: zero new tables - `AttachmentService` with `module:
  'delivery'` (training photos/videos, acceptance signature) and
  `module: 'pdi'` (Inspection evidence - the retention policy for `'pdi'`
  was already pre-seeded in `attachment_retention_policies`, unused until
  this PR - see ADR-017).
- **Timeline**: zero new table - `AuditModule` widened to add `'pdi'`/
  `'delivery'`; `<ActivityTimeline>` needs zero component changes
  (module-agnostic, confirmed).
- **Knowledge**: Inspection Findings promote to Knowledge Candidates via
  the existing `KnowledgeService.createCandidate()`/`.addEvidence()` -
  see ADR-017. `source_type: 'Inspection'` is the Knowledge Foundation
  Freeze v1.0's own documented Extension path ("adding a new Evidence
  source type"), not a violation of it.
- **Dashboard/Reports**: `dashboardStats()`/`buildLeaderboard()`'s
  JS-aggregation shape (`lib/db.ts`) and `buildCsv()` (`lib/exportCsv.ts`)
  are reused directly - no second reporting engine. The task's 7 named
  report types (Dealer/Technician/Model/Checklist Version/Delivery
  Duration/Training Completion/Warranty Activation) are filters/columns
  of **one** consolidated `DeliveryReportRow` dataset, not 7 pipelines -
  Reuse-before-Build.
- **Navigation**: one new top-level "Delivery" nav group (Dashboard/PDI/
  Deliveries/Reports), all real routes - the Platform Constitution's
  "Navigation represents business capability." PDI keeps exactly one nav
  entry, here, never duplicated under Quality or Engineering Intelligence.
- **AI**: reserved only - `DeliveryFutureAiPanel`, 4 Coming Soon tiles (AI
  Delivery Review/Risk/Readiness/Recommendation), same `Card`+`EmptyState
  comingSoon` shape as `KnowledgeFutureAiPanel`, captioned with "AI must
  always cite Evidence."

## Data model

See `docs/architecture/DELIVERY_PLATFORM.md` for the full column list.
Summary: `delivery_records` (id, `delivery_ref` `DEL-<year>-######`,
`vehicle_id`/`serial`/`dealer_id`, `stage` - the 9-value enum above,
`overall_status`, plus one set of columns per stage 2/4/5/6/7/8 above);
`delivery_trainings` (id, `delivery_record_id`, operator/trainer/topics/
date/duration/satisfaction).

## Consequences

- Warranty Activation becomes a real, queryable event for the first time
  - closing a gap the frozen Blueprint itself named, without touching
    `calcWarranty()` or building a claims/policy domain.
- Every future epic that needs "where is this machine in delivery" (a
  future AI Delivery Review, a future Dealer Portal) reads
  `DeliveryService`, never re-derives lifecycle state from three modules.
- A full Warranty claims/policy ledger, Technician Certification
  management, and a checklist template builder remain explicitly
  deferred - named, not silently dropped (see
  `docs/architecture/DELIVERY_PLATFORM.md`'s Explicitly Deferred section).

## Alternatives considered

**Extending `ntr_records` with delivery-lifecycle columns** (Stock Yard
date, training fields, acceptance signature) was rejected - NTR is
Customer Delivery specifically (stage 5 of 9); a vehicle enters Stock
Yard and gets a PDI before an NTR record necessarily exists, and Customer
Delivery's own event (Warranty Activation) happens well after NTR is
created. Cramming the whole lifecycle onto NTR would make NTR own data
it has no natural claim to and couldn't represent chronologically.

**One single `inspections`-style table for the whole lifecycle** (folding
PDI's own checklist/findings directly into `delivery_records`) was
rejected - it would violate One Aggregate/One Owner by making Delivery
also own Inspection's data, and would make ADR-017's reserved number
(Inspection Domain) meaningless. Delivery orchestrates; Inspection owns
PDI.
