# ADR-028: Import Inspection Domain Correction

## Status

Accepted. Reopens the **Inspection Domain (PDI)** frozen layer (ADR-017,
`docs/releases/FOUNDATION_FREEZE_v1.1.md`) - a deliberate, documented,
approved reopening, the same precedent ADR-011 set reopening the Address
Platform (v1 -> v2) and ADR-014 set reopening Authentication Platform.
Does not reopen ADR-027 (Machine Delivery Platform)'s own frozen layer -
that ADR's lifecycle-orchestration decision is unchanged; only its
Warranty-trigger wiring is amended (see Decision, below).

## Problem

PR #45's original build of ADR-017 modeled "PDI" as a Dealer-facing
capability: a completed inspection required **Dealer Approval**
(`canApproveDelivery`, open to DealerAdmin) before Delivery could
proceed, and an inspection could optionally link to an NTR record
(`related_ntr_id`). ADR-027's Delivery lifecycle treated Delivery
Acceptance as the trigger for Warranty Activation, with a `'Manual'`
fallback source.

This does not match the real MSEAL business process. **Import Inspection
is an internal MSEAL quality process**, performed by MSEAL technicians,
before a machine is released to a dealer - it is not "Dealer PDI," it is
never dealer-visible in detail, and it is never linked to an NTR record
(NTR is the ownership-transfer event that happens later, at the dealer).
The corrected process:

```
Factory -> Import -> Stock Yard -> Import Inspection (MSEAL) ->
Released to Dealer -> Dealer Stock -> NTR -> Warranty (automatic) ->
PM -> Quality -> Knowledge
```

Two concrete defects this corrects:

1. **Authorization**: Dealer roles could view/approve a process that
   should be MSEAL-exclusive.
2. **Warranty trigger**: Warranty activated on Delivery Acceptance (a
   Delivery-lifecycle event) or manually - not on NTR (the real
   ownership-transfer event), and a manual path existed at all, which the
   corrected model prohibits entirely.

## Decision

**Import Inspection domain model** (`inspections` table, ADR-017's
aggregate - not replaced, corrected in place):

- Removed: `dealer_approved_by`/`dealer_approved_at` (Dealer Approval),
  `related_ntr_id` (NTR link).
- Added: `inspection_reason` (business reason, independent of type),
  `inspection_sequence` + `previous_inspection_id` (immutable RE-PDI
  chaining - "PDI is one inspection event, not the whole capability"),
  `release_status` + `next_re_pdi_due_date` (Release to Dealer as an
  explicit MSEAL decision, with a configurable 180-day expiration
  window), `factory_feedback` (inspection-level narrative) and
  per-finding `disposition`/`factoryFeedbackStatus`/
  `correctiveActionReference` (structured Factory Feedback Model).
- `inspection_type` narrowed to `PDI` / `RE_PDI` (structural: first event
  vs. a repeat) - `DEALER_PDI`/`IMPORT_PDI` (a dealer-vs-manufacturer
  distinction that doesn't exist in the corrected model, since every
  inspection here already is an Import Inspection) is removed.

**Authorization**: new `canAccessImportInspection` predicate
(`lib/scope.ts`), reusing the `seesAllDealers` boundary (SuperAdmin/
CentralAdmin) - Dealer roles get 403 server-side on every Import
Inspection route, and the nav entry/detail screens are hidden/blocked
accordingly. Machine Passport's own summary read
(`listInspectionsForSerial`) stays dealer-visible (count/dates/
technician/result/release status) - only the full detail screen
(findings/evidence) is MSEAL-only, per the Passport's existing "everyone
sees that something happened, only the owner sees the full record"
convention (same shape as other cross-domain Passport sections).

**Warranty Activation** (ADR-027's `delivery_records` - amended, not
reopened as its own frozen layer): `warranty_activation_source` narrowed
to `'NTR'` only. `DeliveryService.recordAcceptance()` no longer calls
`activateWarranty()`; a new `activateWarrantyFromNtr()` is the sole
activation path, called exclusively from the NTR creation route's own
non-blocking side-effect (mirroring that route's existing
attachments-reassign pattern) - find-or-creating the machine's Delivery
record so activation is never blocked on prior Delivery-stage
bookkeeping. The manual activation route/UI is deleted entirely, not
merely hidden - "Warranty must never be activated manually" removes the
capability, not just its visibility.

**NTR -> Downstream reuse, no new domain logic**: the same route also
(a) sets `vehicles.delivery_date`/`product_family_id` from the NTR
record (closing a pre-existing gap - NTR creation never wrote these, so
`calcWarranty()`'s live computation had nothing to read), and (b) calls
the pre-existing `resolveVehicleProgramVersionStages()` (previously only
triggered lazily by the Maintenance Summary provider) to proactively
generate the PM schedule. Zero new business logic - both are calls to
functions that already existed for other reasons.

**Explicitly not built** (schema/domain gaps, not silently glossed over):
"creates Customer ownership" - `vehicles` has no Customer/Ownership FK,
and inventing one is out of scope for a domain-correction pass; "triggers
Notifications" - no Notification service exists yet
(`NotificationBell` is a static placeholder). Both are Reserved for
Future Capability in `docs/architecture/DELIVERY_PLATFORM.md`, not
fabricated here.

## Consequences

- Import Inspection detail (findings, evidence, factory correspondence)
  is no longer visible to any Dealer role - a real, intentional
  authorization tightening, not a regression (it corrects a boundary that
  should never have been open).
- Warranty activation is now honest about its own trigger: reading
  `delivery_records.warranty_activation_source` always means "this
  machine has an NTR record," never "a Delivery Acceptance happened" or
  "someone clicked a manual button."
- A machine's Import Inspection history is fully reconstructable and
  immutable (`inspection_sequence`/`previous_inspection_id`), supporting
  an arbitrary number of RE-PDI cycles without ever overwriting a prior
  record - a real gap the original model didn't support at all (no
  RE-PDI concept existed).
- The Import Inspection Dashboard is now a distinct, MSEAL-only surface
  (`/delivery/pdi/dashboard`) rather than sharing KPIs with the
  Dealer-visible general Delivery Dashboard.

## Alternatives considered

**Keep Dealer Approval, just rename it** was rejected - the business
process is explicit that Dealer Approval does not exist as a concept;
renaming without removing the capability would leave a real authorization
hole open under a different label.

**Trigger Warranty from "Released to Dealer" instead of NTR** was
rejected - the corrected Business Process explicitly places NTR as the
ownership-transfer event and names Warranty as automatic *from* NTR;
Released to Dealer is an Import Inspection state change, not an
ownership event.

**A new `customers`/`ownership` table to make "creates Customer
ownership" real** was rejected as disproportionate scope for this
correction pass - it is a genuine future capability, not something this
ADR's problem statement asks for, and inventing schema for it here would
outrun the task's own stated boundaries.
