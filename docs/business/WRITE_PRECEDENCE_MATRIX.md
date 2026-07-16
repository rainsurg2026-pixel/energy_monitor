# Write Precedence Matrix (v3.1, ADR-037)

**Status: new document.** This milestone asks for a *domain-level*
precedence ranking (Operational > Factory > Service > Quality),
distinct from `docs/architecture/BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`
§5's *field-level* precedence matrix (which fixed one specific
Tractor-IN-vs-NTR conflict). This document generalizes that into a
platform-wide rule for any future conflict, not just the one already
found.

## Stated precedence (highest to lowest)

```
Operational Data (NTR)
        ↓
Factory Data (Tractor IN)
        ↓
Service Data (PM)
        ↓
Quality Data (MQR)
```

## What this precedence means in practice

**This is not "who writes more recently wins" - it is "whose data, once
written, may never be overwritten by a lower-precedence domain."** A
higher domain may *extend* a lower domain's data (add a fact the lower
domain didn't have); it must never *overwrite* a fact the lower domain
already recorded correctly. Concretely:

| Write attempt | Allowed? | Reasoning |
|---|---|---|
| Operational (NTR) sets `dealer_id`/`delivery_date`/customer | **Allowed, always** | NTR is the top of the precedence order for these fields - it is their Source of Truth |
| Factory (Tractor IN) sets `serial`/`engine_number`/`model`/`product_code`/`wh_arrival_date`/`factory_pdi_status` | **Allowed, always** | These are Factory Data's own fields - no other domain writes them. `factory_pdi_status` (Production Pilot, PR #63) is Tractor IN's Factory/Logistics PDI readiness signal, independent of Import Inspection's own `inspections` table - neither is ever written by the other's module |
| Factory (Tractor IN) sets `dealer_id`/`delivery_date` **after** Operational (NTR) has already set them | **Not allowed, enforced (PR #60)** | Factory Data must never overwrite Operational Data - `TractorInSyncService` now guards against this |
| Factory (Tractor IN) sets `dealer_id` **before** any NTR exists | **Allowed** | No Operational Data exists yet to be overwritten - per ADR-037's "narrow, not remove" amendment |
| Service (PM) writes its own `pm_records` fields | **Allowed, always** | PM is Service Data's own Source of Truth for those fields |
| Service (PM) writes back into `ntr_records`/`vehicles` | **Not allowed** | Service Data may never overwrite Operational or Factory Data - confirmed no code path does this today |
| Quality (MQR) writes its own `records` fields | **Allowed, always** | MQR is Quality Data's own Source of Truth for those fields |
| Quality (MQR) writes back into `pm_records`/`ntr_records`/`vehicles` | **Not allowed** | Quality Data may never overwrite Service, Operational, or Factory Data - confirmed no code path does this today |
| Quality (MQR) reads Operational Data to auto-fill Dealer/Delivery Date/Customer | **Allowed (not yet built)** | Reading a higher-precedence domain to *extend* your own record is the "Operational Data may extend Factory Data" pattern, generalized - this is exactly the MQR NTR-auto-fill gap named in `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md` |

## Every allowed write path (confirmed against current code)

| Writer | Table(s) | Confirmed by |
|---|---|---|
| `TractorInSyncService` | `vehicles` (Factory fields incl. `factory_pdi_status`; `dealer_id`/`delivery_date` per ADR-037's transition rule) | `tractorInSyncService.ts` |
| `InspectionService` | `inspections` only - never `vehicles.factory_pdi_status` | `features/inspection/repository.ts` |
| NTR (`ntrPostCreateOrchestration.ts`, `SupabaseNtrRepository`) | `ntr_records`; `vehicles.delivery_date`/`product_family_id` only | `lib/db.ts`'s `updateVehicleDeliveryInfo()` |
| PM (`SupabaseMaintenanceRepository`) | `pm_records` only | No PM write path touches `vehicles`/`ntr_records` |
| MQR (`api/records/route.ts` and friends) | `records` only | No MQR write path touches `vehicles`/`ntr_records`/`pm_records` |
| Customer (ADR-033, `CustomerService`, not yet built) | `customers`/`customer_ownership_history` (future); `vehicles.customer_id` (future) | Schema exists (Phase 1), no write path exists yet |
| Knowledge (`KnowledgeService`) | `knowledge_cases`/`knowledge_evidence` only | Independent domain, ADR-018, unaffected by this pass |

**No violation of this precedence was found beyond the one already
named** (Factory overwriting Operational's `dealer_id`/`delivery_date`
fields) - every other domain's write path stays inside its own tables,
confirmed by grep across every writer of `vehicles`/`ntr_records`/
`pm_records`/`records` in this session and the prior two audits.

## Verification

Cross-referenced against `docs/architecture/BUSINESS_WORKFLOW_
CONSOLIDATION_AUDIT.md` §5 (the field-level instance of this same rule)
and `docs/adr/ADR-037-Tractor-IN-Field-Scope-Amendment.md` (the decision
this precedence order justifies).
