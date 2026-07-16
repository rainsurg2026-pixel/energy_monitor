# Machine Lifecycle State Machine (v3.1, ADR-037)

**Status: new document.** No prior document modeled the tractor's full
lifecycle as an explicit state machine - `docs/architecture/
MACHINE_LIFECYCLE.md` (pre-existing, Machine Passport's own lifecycle
badges) documents nine Passport-facing lifecycle badges
(Imported/Registered/Delivered/Warranty/PM/Quality/PIP/Recall/Retired)
for a different purpose (what to show on a screen); this document
states the underlying business states and their transition rules,
independent of any one screen.

No field in `vehicles` or `delivery_records` currently stores a single
"current machine state" value matching this table directly - state
today is *inferred* per domain (e.g., "has an NTR" implies Delivered).
This document does not propose adding a `machine_state` column (that
would be a schema change, out of scope this pass) - it makes the
already-implied state machine explicit so a future implementation has
an unambiguous target.

## States

| State | Meaning |
|---|---|
| Factory | Unit exists at the factory, not yet in this platform |
| Imported | `vehicles` row exists (Tractor IN sync has run) |
| Import Inspected | An `inspections` row exists and is completed for this serial |
| MSEAL Stock | Unit received into MSEAL's own stock (no UI today - see Gap, below) |
| Shipped | Unit shipped from MSEAL toward a dealer (no model today - see Gap, below) |
| Dealer Stock | Unit received into dealer stock, pre-delivery (no UI today - see Gap, below) |
| Delivered | An `ntr_records` row exists for this serial |
| Warranty Active | `vehicles.delivery_date` is set and within the warranty window (`calcWarranty()`) |
| In Service | Warranty Active or expired, machine has PM/MQR history accumulating |
| Retired (Future) | Not modeled - reserved, no table/field exists |

## Transitions

| Current State | Trigger | Next State | Responsible Module | Responsible Role | Validation Rule |
|---|---|---|---|---|---|
| Factory | Tractor IN sync run | Imported | Import Platform (`TractorInSyncService`) | System (scheduled/manual sync) | Serial must be unique (`vehicles.serial` unique constraint) |
| Imported | Import Inspection completed | Import Inspected | Import Inspection (`InspectionService`) | MSEAL (`canAccessImportInspection` - SuperAdmin/CentralAdmin only) | Inspection `status = 'Completed'` |
| Import Inspected | Received at MSEAL warehouse | MSEAL Stock | **Gap - no service, no UI** (`delivery_records.stage = 'StockYard'` exists, unreachable) | MSEAL | Not enforced today |
| MSEAL Stock | Shipped toward dealer | Shipped | **Gap - not modeled at all** | MSEAL | Not enforced today |
| Shipped | Received at dealer | Dealer Stock | **Gap - no service, no UI** (`delivery_records.stage = 'DealerPreparation'` exists, unreachable) | Dealer | Not enforced today |
| Dealer Stock (or, today, directly from Imported) | NTR registered | Delivered | NTR (`ntrPostCreateOrchestration.ts`) | Dealer (creates NTR) | NTR requires `dealer_id`/`delivery_date`/`customer` per Field Ownership Matrix |
| Delivered | Automatic, same transaction as NTR creation | Warranty Active | NTR orchestration (writes `vehicles.delivery_date`) | System (automatic) | Delivery Date must come from NTR only - **enforced (PR #60)**, see `docs/architecture/BUSINESS_INVARIANTS.md` |
| Warranty Active | First PM/MQR record created | In Service | PM / MQR | Dealer / MSEAL | None additional - PM/MQR already independently scoped |
| In Service | *(reserved)* | Retired | **Not built** | **Not decided** | **Not built** |

## Gaps this table makes explicit

- **MSEAL Stock → Shipped → Dealer Stock** has no enforced transition
  rule today because two of the three states have no UI (dead since
  ADR-031) and the middle one ("Shipped") has no model at all - restated
  from `BUSINESS_WORKFLOW_UX_AUDIT.md`, not re-discovered here.
- **Delivered → Warranty Active is automatic** (a genuine strength -
  no manual step, no screen needed) but its validation rule ("Delivery
  Date must come from NTR only") is exactly the rule ADR-037 amends
  ADR-029 to restore.
- **Retired** has no owner, no table, no rule - correctly left as
  "Future," not designed here.

## Verification

Cross-referenced against `delivery/types.ts`'s `DeliveryStage` enum
(`TractorIn`/`StockYard`/`PDI`/`DealerPreparation`/`CustomerDelivery`/
`OperatorTraining`/`DeliveryAcceptance`/`WarrantyActivation`/`Completed`),
`ntrPostCreateOrchestration.ts`, `calcWarranty()`, and
`docs/architecture/MACHINE_LIFECYCLE.md`'s pre-existing Passport-badge
model (a different artifact, not superseded by this document).
