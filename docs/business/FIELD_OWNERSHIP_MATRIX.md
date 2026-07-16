# Field Ownership Matrix (v3.1, ADR-037)

**Status: new document.** Extends `docs/architecture/
BUSINESS_INVARIANTS.md` (PR #58, field-level Holds/VIOLATED verdicts)
with the specific who-may-write/who-may-read/when-immutable detail this
milestone asked for by name. Does not restate that document's
verdicts - see it for the "why."

**Update (2026-07-15, PR #60):** the `dealer_id`/`delivery_date` rows
below described a then-current violation ("Today: ... only (violation)").
That guard is now implemented - see the rows' inline update.

| Field | Owner Domain | Source of Truth | Who may write | Who may read | Immutable when |
|---|---|---|---|---|---|
| `vehicles.serial` | Factory | Tractor IN | `TractorInSyncService` only | Every domain | Always (natural key, never reassigned) |
| `vehicles.engine_number` | Factory | Tractor IN | `TractorInSyncService` only | Every domain | Never (factory data may be corrected on re-sync) |
| `vehicles.model` | Factory | Tractor IN | `TractorInSyncService` only | Every domain | Never |
| `vehicles.product_code` | Factory | Tractor IN | `TractorInSyncService` only | Every domain | Never |
| `vehicles.wh_arrival_date` | Factory | Tractor IN | `TractorInSyncService` only | Every domain | Never |
| `vehicles.dealer_id` | Operational | Latest NTR | **Implemented (PR #60):** `TractorInSyncService` only until an NTR exists for that serial; NTR orchestration never writes `dealer_id` directly, but Tractor IN stops writing it once an NTR exists | Every domain | Once an NTR exists for that serial (per ADR-037, enforced) |
| `vehicles.delivery_date` | Operational | Latest NTR | `NTR` orchestration (`ntrPostCreateOrchestration.ts`) - **implemented (PR #60): `TractorInSyncService` can no longer overwrite it once a real NTR exists** | Every domain (feeds `calcWarranty()`) | Once an NTR exists for that serial (per ADR-037, enforced) |
| `vehicles.factory_pdi_status` | Factory | Tractor IN | `TractorInSyncService` only (Production Pilot) - synced only when the sheet's value changes, never touches `dealer_id`/`delivery_date`/`inspections` | Every domain; Import Inspection Dashboard's "Pending Import Inspection" KPI, Import Inspection list's Factory PDI Status filter | Never (Factory/Logistics readiness signal, may legitimately change over a machine's pre-inspection life) - **independent of `inspections.status`/`.result`, which remain exclusively `InspectionService`-owned; neither table is ever written by the other's module** |
| Customer name/phone (per record) | Operational (NTR) / independent snapshot (PM, MQR) | NTR at delivery; PM/MQR keep their own per-visit copy | NTR (`ntr_records`), PM (`pm_records`), MQR (`records`) - each writes only its own table | Same domain that wrote it, plus read-only display elsewhere (e.g. Machine Passport's Ownership panel) | Never (a later visit may record a different customer without altering an earlier record) |
| `customers`/`customer_ownership_history` | Customer (ADR-033) | Not yet wired to any read/write path (Phase 1 schema only) | Nobody yet - schema exists, unused | Nobody yet | N/A - not live |
| `pm_records.*` (own fields) | Service | PM | `PmService`/`SupabaseMaintenanceRepository` only | Every domain (Machine Passport aggregation) | Per `MAINTENANCE_LOCK_AFFECTING_FIELDS` (`serial`/`performed_date`/`hour_meter`/`pm_interval_id`) - locked 24h after creation or once superseded, per `evaluateMaintenanceLock()` |
| `records.*` (MQR, own fields) | Quality | MQR | MQR's own write path (`api/records/route.ts`) only | Every domain (Machine Passport aggregation, Knowledge candidate creation) | Per `StatusValue` transitions (`Closed` records still editable today - no immutability rule found for closed MQR records; flagged as an open question, not a defect, since no such rule was stated) |
| Warranty status (computed) | Service (no dedicated table) | `calcWarranty()` over `vehicles.delivery_date` | Nobody - always computed, never stored | Every domain | N/A - not a stored field |
| Knowledge Case / Evidence | Knowledge (independent, ADR-018) | Knowledge's own tables | `KnowledgeService` only | Engineering Intelligence (via Knowledge only, never raw Quality Cases) | Per Knowledge's own Maturity lifecycle (Draft/Review/Published/Deprecated/Archived) - unchanged by this pass |

## Fields named in this milestone that do not exist yet

| Field | Needed by | Status |
|---|---|---|
| Machine classification (Customer Machine/Dealer Stock/MSEAL Stock/Demo Machine) | MQR | Not built - `BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`'s Roadmap item P5 |
| "Approved" status on `ntr_records` | Field Ownership's own "Latest NTR" concept | Not built - `ntr_records.record_status` is only `Active`/`Deleted`; open business question (P3) |
| Repair Type | Future Parts-Used/Troubleshooting rule | Not built - explicitly out of phase |
| Parts Used | Future Parts-Used/Troubleshooting rule | Not built - explicitly out of phase |
| Troubleshooting record | Future automation | Not built - explicitly out of phase |

## Verification

Every row cross-checked against `tractorInSyncService.ts`,
`ntrPostCreateOrchestration.ts`, `lib/db.ts`, `maintenanceLock.ts`
(`MAINTENANCE_LOCK_AFFECTING_FIELDS`, `evaluateMaintenanceLock()`),
`api/records/route.ts`, and `docs/architecture/BUSINESS_INVARIANTS.md`.
No row asserts a write/read/immutability rule without a corresponding
code check performed in this session.
