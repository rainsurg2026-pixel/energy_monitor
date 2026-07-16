# v3.0 Foundation Hardening — Architecture Audit

ADR-032. Architecture-hardening pass only, run after ADR-028 (Import
Inspection domain correction), ADR-029 (Quality Inspection nav
consolidation), ADR-030 (Vehicle 360 consolidation), and ADR-031
(Platform Stabilization). No new business feature, no redesign - this
document is the audit, and the only code changes in the accompanying PR
are the handful this audit itself recommends as safe, zero-risk
consolidations (named explicitly in each section, never implied).

Prepares the platform for the next wave (Customer Ownership, CRM, Service
Operations, Analytics) by confirming the foundation those capabilities
will be built on is sound - single ownership per domain, no duplicated
services, a documented dependency direction, and a named (not hidden)
debt register.

## Relationship to existing documents

This repository already has a governance framework
(`docs/governance/`) covering bounded-context ownership
(`DOMAIN_OWNERSHIP_MATRIX.md`), cross-domain dependency
(`CAPABILITY_DEPENDENCY_MAP.md`), maturity (`MODULE_MATURITY_MATRIX.md`),
repository layout (`REPOSITORY_STRUCTURE_MAP.md`), security boundaries
(`SECURITY_BOUNDARY.md`), and API conventions (`API_GOVERNANCE.md`). This
audit does not replace any of them - it operates one level more concrete
than those documents (feature-module grain: Vehicle, Machine Passport,
Import Inspection, NTR, Warranty, PM, MQR, Timeline, Documents; those
documents operate at bounded-context grain: Machine, Service, Quality).
Where an existing document has gone stale against the code merged since
ADR-017/018/027 (all predate it), this audit says so explicitly and
recommends the specific correction rather than silently duplicating a
fresher copy. `MODULE_MATURITY_MATRIX.md`'s Inspection/Delivery/Timeline
rows are corrected directly in this same PR (small, factual edits, not a
rewrite); `DOMAIN_OWNERSHIP_MATRIX.md`, `CAPABILITY_DEPENDENCY_MAP.md`,
`REPOSITORY_STRUCTURE_MAP.md` get a one-line amendment pointer each,
since bringing their full bounded-context-level prose current is a larger
task than this hardening pass's scope.

---

## 1. Architecture Audit — Single Ownership Verification

| Domain | Owner (code) | Table(s) | Status |
|---|---|---|---|
| **Vehicle** (master data) | `vehicles` table, read via `getVehicleBySerial()`/`getVehicleSummary()` (`src/lib/db.ts`, `src/features/vehicle/service.ts`) | `vehicles` | **Single owner, confirmed.** `TractorInSyncService` is the *only* writer of master fields (`model`/`engine_number`/`product_code`/`wh_arrival_date`/`delivery_date`/`dealer_id`/`product_family_id`/`sub_model`) - every other module reads, never writes these columns (ADR-012, ADR-029). |
| **Machine Passport / Vehicle 360** | `src/app/(app)/machines/[machineId]/page.tsx` + `MachineService` (thin facade, `src/features/machine/service.ts`) | none of its own - aggregates | **Single owner, confirmed** (ADR-030). `/vehicles` and `/vehicles/[serial]` are `redirect()`-only shells. No second Vehicle 360 implementation exists anywhere in `src/app`. |
| **Import Inspection** | `InspectionService`/`InspectionRepository` (`src/features/inspection/`) | `inspections` | **Single owner, confirmed.** No other module writes `inspections`; `MachineService.getMachineImportInspectionHistory()` and `DeliveryService.getDeliveryForMachine()` both read through `InspectionService`'s own public methods (`listInspectionsForSerial`/`listInspectionsByIds`), never a direct query. |
| **NTR** | `NtrService`/`SupabaseNtrRepository` (`src/features/ntr/`) | `ntr_records` | **Single owner, confirmed.** `NtrImportService` (Legacy Import) writes through the same repository, not a parallel one. |
| **Warranty** | No dedicated service/table - `calcWarranty()` (`src/lib/warranty.ts`), a pure function | none (computed) | **Single *calculation*, multiple *independent call sites*** - see Technical Debt §11.1. The one real stateful fact - **activation** - has a single owner: `DeliveryService.activateWarrantyFromNtr()` writes `delivery_records.warranty_activated_at`/`warranty_activation_source`, called only from NTR's post-create orchestration. |
| **PM** | `MaintenanceService`/`SupabaseMaintenanceRepository` (`src/features/maintenance/`) | `pm_records` | **Single owner, confirmed.** |
| **MQR** | `src/lib/db.ts` (81 exported functions, no dedicated class) + `src/app/(app)/records/**`/`src/app/api/records/**` | `records` | **Single owner in practice, but architecturally the odd one out** - see Technical Debt §11.2. |
| **Timeline** | Two distinct, intentionally separate things (see §5) - Machine Lifecycle (`getVehicleTimeline()`, `src/features/vehicle/registry.ts`) and field-level Activity (`shared/activity-timeline/`, fed per-module via `mapAuditLogToActivityEvents()`) | `vehicle_events`, `record_audit_log` | **Single owner each, confirmed** - no third timeline implementation found anywhere. |
| **Documents** | `AttachmentService` (`src/shared/attachments/`) | `attachments` | **Single owner, confirmed.** Every module (`MachineService.getMachineAttachments()`, Inspection, Delivery, Knowledge) calls the same service; no module queries `attachments` directly. |

**Conclusion**: every domain named has exactly one code owner and, where
it has state, exactly one table. No duplicate vehicle page, no duplicate
vehicle service, no duplicate timeline, no duplicate attachment path.

---

## 2. Domain Boundaries

- **`vehicles` is the only vehicle master**, confirmed at both the code
  layer (§1) and the DB layer: `inspections.vehicle_id`,
  `delivery_records.vehicle_id`, and `vehicle_events.vehicle_id` are real
  foreign keys into `vehicles.id`. **`ntr_records`, `pm_records`, and
  `records` (MQR) instead link to `vehicles` only by a denormalized
  `serial` text column - no FK exists on any of the three.** This is a
  real, pre-existing inconsistency (not introduced by this pass): the two
  newer domains (Inspection, Delivery) enforce referential integrity at
  the database layer; the three older domains (NTR, PM, MQR) rely on
  string equality, enforced only in application code. See Technical Debt
  §11.3.
- **Machine Passport is the only Vehicle 360 implementation** (§1,
  ADR-030) - confirmed, no action needed.
- **No duplicate vehicle pages/services** - confirmed via `src/app`
  route sweep (every `page.tsx` under `src/app/(app)` is either
  nav-reachable, a redirect, or a dynamic detail page of a reachable
  list - re-verified against `navConfig.ts` post-ADR-031, no orphan
  found beyond the two already-documented, intentionally-manual routes
  `/report` and `/profile/security`, which are real working pages linked
  from elsewhere, not dead code).

---

## 3. Service Layer Audit

Every `service.ts`/`repository.ts` under `src/features/*` and `src/shared/attachments/`,
plus `lib/db.ts`'s 81 MQR/shared functions, was enumerated (every
exported method, every call site, classified as route-called,
cross-module-called, test-only, or dead). Full per-method inventory
retained in the PR's research trail; findings below.

### Dead methods (zero callers anywhere, production or test)

| Method | Notes |
|---|---|
| `DeliveryService.listDeliveries`, `createDeliveryRecord`, `receiveAtStockYard`, `linkInspection`, `completeDealerPrep`, `linkNtr`, `getDeliveryReport` | Unchanged since ADR-031 - the UI that called them was removed there. No Delivery-Records list/report route or page exists anywhere. |
| `InspectionService.listActiveInspections` | Zero callers anywhere - no route, no cross-module call, no test. |
| `VehicleEventPublisher.publishCampaignAssigned`, `publishCampaignCompleted`, `publishPartsRequested`, `publishPartsDelivered` | Expected - no Campaign or Parts Request module exists yet; the publisher's own doc comment already names these as "not wired into any real module yet." |
| `MachineRepository` (`features/machine/repository.ts`, whole class) | Its own header comment already says "currently unused (no caller), confirmed during the v2.3.2 authorization review." `MachineService` never instantiates it. |
| `AttachmentService.enqueueArchiveEligible`/`processArchiveQueue` | Unreachable in production - their only caller, `StorageScheduler`, itself has zero callers anywhere under `src/app`. |

### Test-only methods (exercised only by their own service's test file)

`DeliveryService.getDelivery` (also called internally by `recordTraining`), `recordTraining`, `recordAcceptance`, `getDashboardStats`; `VehicleEventPublisher.publishMaintenanceCompleted`, `publishMqrOpened`, `publishMqrClosed` (Maintenance and MQR have never been wired into the Platform Event Framework - their events still reach the Timeline, but only via their own dedicated `VehicleEventSource` functions in the registry, §5, never via `getPlatformEvents()`); `VehicleEventService.getModuleEvents`; `AttachmentService.verifyChecksum`. All kept - "do not remove code referenced by tests."

### Duplicate / parallel implementations

| Finding | Severity | Recommendation |
|---|---|---|
| **`NtrSummaryProvider`** builds its own raw `ntr_records` query instead of reusing `SupabaseNtrRepository.findActiveBySerial()` - a third independent "current NTR for this serial" read alongside the repository's own method and `fetchNtrRecordsForSerial()` | Low risk, genuine duplication | Merge candidate: repoint to `findActiveBySerial()`. Not executed this pass (zero behavior change kept). |
| **`buildLeaderboard()`** exists twice, independently: a closure inside `lib/db.ts`'s `dashboardStats()` (keyed over `MqrRecord`, computes MTTR) and a module-level function in `features/delivery/service.ts` (generic, no MTTR). `DeliveryService`'s own comment acknowledges reusing "the same shape," but never extracted a shared helper. | Low risk, small function | Merge candidate for a future task (e.g. `lib/leaderboard.ts`). |
| **Excel export**: three independent `ExcelJS.Workbook` builders (`lib/exportExcel.ts`, `features/ntr/services/ntrExcel.ts`, `features/ntr/services/ntrImportResultExcel.ts`), each hand-rolling the same bold-header/frozen-row/autofilter boilerplate - unlike CSV export, which already has one shared `buildCsv()` every module's CSV builder calls. | Low risk, cosmetic/DRY only | Named as a missed opportunity, not urgent. |
| **`calcWarranty()` vs. `warrantyCutoffIso()`** (`features/ntr/repositories/supabaseNtrRepository.ts`) - two independent warranty-window computations, **already intentional and documented**: `lib/` infrastructure may not depend on `shared/master-data`, so the repository's own warranty-status filter can't call `calcWarranty()`. Not a defect, but a real "two implementations of one constant" divergence risk if the warranty-months rule ever changes in only one place. | Documented, intentional | No action - named for awareness only. |
| **`MachineService` vs. direct `vehicle/service.ts` calls** - `MachineService`'s own doc comment states "new code should call `MachineService`, not `features/vehicle/service.ts`, directly," but `app/(app)/ntr/[id]/page.tsx` and `app/api/ntr-records/[id]/export/route.ts` both still import `getVehicleSummary`/`getVehicleTimeline` directly. Same underlying function either way (not a behavior bug), but a partial-migration gap. | Low risk, stylistic | Candidate for a future small cleanup: repoint both call sites through `MachineService`. |

`fetchMqrRecords`/`fetchMaintenanceHistoryForSerial`/`fetchNtrRecordsForSerial`
remain the correct shape (each domain owns its own scoped read), already
deduped at the call-site level by ADR-031's `React.cache()` wrapping -
not a finding. CSV export (`buildCsv()`) is genuinely shared, not
duplicated - not a finding.

### `lib/db.ts`

81 exported functions spanning MQR, Vehicle lookups, PM/NTR cross-reads,
audit log, and dashboards - no dedicated class, unlike every sibling
domain. See §11.2. **Merge candidate for a future task**, not executed
here (would touch every MQR route/component import - out of
"hardening only" scope).

---

## 4. Database Review

Every table classified (Master Data / Transaction / Audit / Reference /
Temporary). No schema modified.

| Table | Class | Notes |
|---|---|---|
| `vehicles` | Master Data | The vehicle master (§2) |
| `dealers`, `branches`, `technicians`, `product_families`, `product_family_models` | Master Data | |
| `users` | Master Data | |
| `pm_intervals`, `maintenance_program_versions`, `maintenance_program_version_stages`, `maintenance_program_assignments` | Master Data | PM program configuration |
| `parts` | Master Data | Reserved, unused by any query today - intentionally kept for parity (`canManageParts`'s own comment, confirmed ADR-031) |
| `pm_programs` | Master Data | **Zero code references anywhere** - superseded by `maintenance_program_versions`/`_assignments`. Candidate for removal in a future, explicitly-scoped pass; not dropped here. |
| `provinces`, `districts`, `subdistricts` | Reference | Thai address hierarchy |
| `provinces_raw`, `districts_raw`, `subdistricts_raw` | Temporary | One-time address-import staging tables (ADR-011), zero code references - same removal candidate as `pm_programs` |
| `problem_codes` | Reference | |
| `event_definitions` | Reference | Platform Event Framework catalog |
| `job_seq` | Reference | Atomic per-dealer/year counter backing `next_job_seq()` - actively used by MQR/PM/NTR/Knowledge/Delivery/Inspection repositories, confirmed live |
| `ntr_records`, `pm_records`, `records` (MQR), `inspections`, `delivery_records`, `delivery_trainings`, `knowledge_cases`, `knowledge_evidence` | Transaction | Business-event records, one owner each (§1) |
| `ntr_import_sessions` | Transaction | Legacy Import operation record |
| `vehicle_events` | Transaction | Platform Event Framework - one row per cross-module business event, FK to `vehicles` |
| `attachments` | Transaction | Evidence/document, FK'd from every module via generic `(module, entity_type, entity_id)` keys, never a per-module attachments table |
| `attachment_retention_policies` | Reference | |
| `tractor_in_sync_runs` | Audit | Sync run log |
| `record_audit_log` | Audit | Field-level change trail (Activity Timeline's source) |
| `auth_audit_log`, `login_log`, `password_history` | Audit | |
| `auth_tokens`, `user_sessions` | Temporary | Short-lived/revocable session and token state |

**Domain map derived from this classification + FK data** (§2): Master
Data (`vehicles`, `dealers`, `branches`, ...) sits at the bottom of every
dependency chain; every Transaction table either FKs into it directly
(Inspection, Delivery, Vehicle Events) or references it by `serial`
string (NTR, PM, MQR - the inconsistency named in §2); Audit/Temporary
tables depend on nothing and are depended on by nothing except the
modules that write them.

---

## 5. Dependency Map

```
                    vehicles (Master Data)
                          │
        ┌─────────────────┼──────────────────────────┐
        │  vehicle_id FK  │  vehicle_id FK             │  serial (string, no FK)
        ▼                 ▼                            ▼
  Import Inspection    Delivery                  NTR ──┬── PM ──┬── MQR
  (inspections)     (delivery_records)      (ntr_records)  (pm_records) (records)
        │                 │                       │
        │   linked by id  │  linked by id          │  sole trigger
        └────────┬────────┘                        ▼
                  │                          Warranty Activation
                  ▼                     (delivery_records.warranty_activated_at,
          Delivery orchestrates          written once by activateWarrantyFromNtr(),
          Inspection + NTR as             called only from NTR's post-create
          references, never              orchestration - the one real stateful
          duplicates their fields         Warranty fact in the whole platform)

        Every domain above ──▶ Timeline (two independent feeds):
                                 • Machine Lifecycle (vehicle_events + per-module
                                   VehicleEventSource, coarse milestones)
                                 • Activity Timeline (record_audit_log, field-level,
                                   rendered per-module on each record's own detail page)

        Every domain above ──▶ Documents (AttachmentService, generic
                                 (module, entity_type, entity_id) key - never
                                 a per-module attachments table)

        Machine Passport ──── reads everything above (never writes any of it)
        via MachineService, a pure aggregation facade
```

**Coupling review**: no circular dependency found (confirmed both by
manual trace and a full re-import-graph sweep of every `@/features/*`
module - Knowledge is the one true leaf, depended on by Inspection and
Machine, depending on nothing). The one directional rule every module
already follows: **Machine Passport depends on every domain; no domain
depends on Machine Passport.** Delivery is the one domain that
legitimately depends on two siblings (Inspection via
`pdi_inspection_id`, NTR via `ntr_id`) - both by reference (foreign key /
id), never by duplicating the referenced record's own fields, matching
ADR-027's original design intent and re-confirmed here.

**Boundary violations found: 4** (a domain's repository/route reaching
into another domain's owned table directly, bypassing its public
service/repository). Correcting an earlier, too-optimistic read of this
codebase - a second, deeper pass found these:

1. `NtrImportService.fetchVehiclesBySerials()` (`features/ntr/services/ntrImportService.ts`)
   - a direct, chunked bulk query against `vehicles`, bypassing
   `getVehicleBySerial()` (which has no bulk-by-serials variant).
2. `lib/db.ts`'s `searchVehiclesForPm()` and `searchTractorsForNtr()` -
   each queries another domain's table directly (`pm_records`,
   `ntr_records` respectively) instead of through
   `MaintenanceService`/`NtrService`, for a capped, two-query search-box
   pattern the code itself documents as precedented (`searchTractorsForNtr`'s
   own comment cites `searchVehiclesForPm` as the reason it repeats the
   pattern rather than inventing a new one).
3. `DeliveryRepository.listActiveWithRelated()`/`countVehiclesWithoutDeliveryRecord()`
   (`features/delivery/repository.ts`) - one embeds a `vehicles(model)`
   join, the other queries `vehicles` directly for an anti-join count,
   both bypassing `getVehicleBySerial()`.
4. `MachineService` imports `fetchMqrRecords` from
   `@/features/vehicle/eventSources/mqrEvents` - a non-facade subpath of
   the Vehicle module, not `vehicle/service.ts`'s own public exports. A
   housekeeping/location inconsistency (MQR has no module of its own to
   own this function - see §11.2), not a functional bug.

All four are **read-only**, all four are **capped/bounded** (never an
unbounded scan), and three of the four are already self-documented in
code as a deliberate trade-off, not an oversight. None is a data-
integrity risk. Named as debt (§11.6), not fixed in this pass - each
would need its own scoped follow-up (a bulk `getVehiclesBySerials()` on
Vehicle's own service, for #1 and #3; accepting the capped-search
precedent as intentional, for #2).

---

## 6. Performance

- **`React.cache()` dedup** (ADR-031): Machine Passport's
  `fetchMqrRecords`/`fetchMaintenanceHistoryForSerial`/`fetchNtrRecordsForSerial`
  are memoized per-request - confirmed still in place, no regression.
- **Parallel queries**: `getVehicleSummary()`'s provider merge and
  `getVehicleTimeline()`'s event-source merge both already run every
  provider/source via `Promise.all`, not sequentially - confirmed
  unchanged.
- **N+1 review**: `searchTractorsForNtr()` (vehicles query + one bulk
  `ntr_records` existence check) and `MachineService.getMachineAttachments()`
  (bulk per-record-type attachment list) were the two most N+1-shaped
  candidates in the codebase and both were already confirmed bulk, not
  looped, in the ADR-031 pass - re-verified here, unchanged.
- **Large payloads**: `.select('*')` is used in a handful of places
  (e.g. `getVehicleBySerial()`) rather than a narrow column list - low
  risk today (`vehicles` has 16 columns), but worth a column allowlist if
  the table grows substantially in a future Customer/CRM-adjacent
  expansion. **Recommendation only, not changed here.**
- **No new performance issue found** in this pass beyond what ADR-031
  already fixed.
- **Incidental finding**: `report-form.tsx` (`'use client'`) imports
  `calcWarranty()` directly, meaning the warranty rule ships into the
  client bundle - every other of its 6 call sites is server-only. Not a
  performance problem (`calcWarranty()` is a small pure function, no I/O)
  and consistent with `lib/warranty.ts`'s own designed independence from
  server-only platform services - flagged only so nobody assumes the
  function is server-only when reasoning about the client bundle.

---

## 7. Security

- **RBAC** (`src/lib/scope.ts`): every permission boundary is a named,
  documented predicate over the 4-role union (`SuperAdmin`/
  `CentralAdmin`/`DealerAdmin`/`DealerUser`) - confirmed no inline role
  checks exist outside this file's own predicates being called. Post
  ADR-031's cleanup, every remaining predicate has at least one real call
  site (`canManageParts` is the one deliberate, documented exception -
  reserved for the intentionally-unbuilt Parts capability).
- **Dealer/branch scope** (`src/lib/dealerBranchScope.ts`): one
  `AuthorizationScope`/`resolveDealerScope()`/`resolveBranchScope()`/
  `canAccessDealerBranch()` mechanism, fail-closed (a `DealerUser` with no
  assigned branch matches nothing, never "everything"), confirmed used
  consistently by every module's own scoping rather than re-derived
  per-domain.
- **MSEAL scope** (`canAccessImportInspection` = `seesAllDealers`):
  confirmed still the single gate for Import Inspection across
  `InspectionService`, `DeliveryService.linkInspection()`, and the
  `/delivery/pdi/**` UI - no second, parallel MSEAL check found anywhere.
- **Permission consistency**: no inconsistency found between the
  documented predicates in `scope.ts` and their actual enforcement in API
  routes (spot-checked across Inspection/Delivery/NTR/PM/Knowledge/Admin
  routes).
- **No behavior change** made or recommended in this section - audit
  only, per the milestone's own instruction.

---

## 8. API Consistency

Sampled 21 route files across 10+ modules; findings corrected/sharpened
against a second, deeper pass:

- **Response envelope**: not a clean two-way split. NTR/PM/vehicle-event/
  Platform Events use `{ ok: true, data: T }`; MQR, Vehicles, Inspection,
  Knowledge, and Admin instead use a **module-specific key**
  (`{ ok, record }`, `{ ok, vehicle }`, `{ ok, inspections }`/
  `{ ok, inspection }`, `{ ok, cases }`/`{ ok, case }`,
  `{ ok, users }`/`{ ok, dealers }`/`{ ok, branches }`, etc.) instead of
  a generic `data`. The single sharpest inconsistency:
  `knowledge-cases/[id]/route.ts`'s `GET` spreads `KnowledgeService.getCase()`'s
  whole return value into the top level
  (`{ ok, case, evidence, relatedMachines, relatedQualityReports, relatedPm, relatedWarranty }`)
  while its own `PATCH` in the same file returns the narrower
  `{ ok, case }` - two handlers, one file, two different envelope shapes
  for the same resource.
- **DTO field naming**: the actual rule is **module era, not "has a
  repository or not."** Inspection and Knowledge (the two newest,
  ADR-017/ADR-018-era modules) map to camelCase DTOs via an explicit
  row→DTO function; every older module - NTR, Maintenance/PM, Vehicle,
  MQR, Admin - returns the raw snake_case Supabase row as-is, *even
  though NTR and Maintenance both have a full repository/service class*
  (those classes exist for scoping/business rules, not row mapping).
  One route mixes both styles in a single response object:
  `admin/users/route.ts`'s `GET` spreads a raw snake_case `AdminUser`
  row (`full_name`, `dealer_id`) together with three computed camelCase
  fields (`emailMissing`, `forgotPasswordAvailable`, `emailVerified`) -
  already self-documented in `AdminUser`'s own type comment as a
  deliberate, scoped exception, not an oversight.
- **Error shape**: a hard, verifiable split along the same "module era"
  line, not a gradient. NTR, PM/Maintenance, and Platform Events
  uniformly use `{ error: { code, message } }` with real codes
  (`UNAUTHORIZED`/`VALIDATION_ERROR`/`NOT_FOUND`/`FORBIDDEN`/`CONFLICT`/
  `LOCKED`/`INTERNAL_ERROR`); MQR, Vehicles, Inspection, Knowledge,
  Admin, and Auth uniformly return a plain `{ error: string }` (often
  already Thai-localized at the point of return). No route in the sample
  mixed both error styles.
- **Recommendation**: all three findings are pre-existing and already
  partially named (`API_STANDARD.md`'s MQR grandfather clause) -
  **no code change recommended this pass**; a future task could migrate
  Inspection/Knowledge/Admin/Vehicles onto the structured error shape and
  a generic `data` envelope, additive per `API_GOVERNANCE.md`'s own
  deprecation process (old shape keeps working until every caller
  migrates), never a breaking rename.

---

## 9. Documentation

Updated this pass (small, factual corrections only):
- `docs/governance/MODULE_MATURITY_MATRIX.md` - Inspection/Delivery rows
  corrected (no longer "open PR," reflect ADR-028 domain correction and
  ADR-031 UI removal); Timeline row corrected (Machine Lifecycle +
  Activity Timeline both now production, not "MQR only"); Vehicle 360 row
  added.
- `docs/governance/DOMAIN_OWNERSHIP_MATRIX.md`,
  `docs/governance/CAPABILITY_DEPENDENCY_MAP.md`,
  `docs/governance/REPOSITORY_STRUCTURE_MAP.md` - one-line amendment
  pointer each to this document, since their full bounded-context-level
  prose predates ADR-017/018/027 and refreshing it in full is a larger
  task than this pass's scope (named in Technical Debt §11.4, not
  silently left stale).
- `docs/adr/README.md` - ADR-032 row added.

This document itself is the new Domain Map / Dependency Map / Repository
Structure detail (feature-module grain) and Technical Debt Register for
this milestone - see §11 below and the Roadmap (§10).

---

## 10. Roadmap (v3.1 / v3.2 / v3.3, ordered by business value)

Given the stated destination (Customer Ownership, CRM, Service
Operations, Analytics) and this audit's findings:

**v3.1 - Customer Ownership Foundation** (highest value: every downstream
capability - CRM, Service Ops, Analytics - needs a real Customer entity
first). NTR already captures customer name/phone/address per
transaction, but there is no `customers` table - the "same customer" is
never resolved across multiple NTR/PM/MQR records today. Proposes a
`customers` master-data table + a resolution service (fuzzy match on
phone/name at minimum), following the exact "one new master table + one
new service, reuse everywhere" shape this platform already uses for
`vehicles`. Directly unblocks CRM.

**v3.2 - Service Operations Consolidation** (addresses this audit's one
concrete debt item with real operational cost: §11.3's `serial`-string
vs `vehicle_id`-FK inconsistency). Backfills `vehicle_id` onto
`ntr_records`/`pm_records`/`records`, switches new writes to set it,
keeps `serial` for backward compatibility during a deprecation window
(matching `API_GOVERNANCE.md`'s existing additive-first process) -
directly benefits Analytics (real joins instead of string matching) and
Service Operations (one consistent linking convention platform-wide).

**v3.3 - Analytics-Ready Event Model** (lowest urgency, highest future
leverage). Formalizes Warranty as its own read-model (§11.1) - one
`getWarrantySummary(serial)` function every caller uses instead of four
independent `calcWarranty()` call sites - and extracts MQR's 81
`lib/db.ts` functions into a `features/mqr/` service/repository pair
(§11.2), matching every sibling domain's shape. Both are internal
consistency improvements that make Analytics's eventual cross-domain
queries land on a uniform shape instead of one-off DB reads.

---

## 11. Technical Debt Register

1. **Warranty has one calculation, four independent call sites** with
   different inputs (`MachineService.getMachineWarrantySummary()`:
   `'powertrain'`, today's date; NTR detail page: `'other'`, today's
   date; QIR report form: live preview, form's own date/system; `records`
   API create route: authoritative, stored). Not a bug - each caller's
   inputs are contextually correct - but there is no single
   `getWarrantySummary()` a future caller can reuse without re-deriving
   which `problemSystem`/date convention applies. Proposed in Roadmap v3.3.
2. **MQR has no dedicated service/repository class** - 81 functions
   live directly in `lib/db.ts`, unlike every sibling domain (NTR, PM,
   Inspection, Delivery, Knowledge each have their own `service.ts` +
   `repository.ts`). Historical (MQR is the oldest module), not a defect,
   but the one structural inconsistency in an otherwise uniform Service
   Construction Standard. Proposed in Roadmap v3.3.
3. **NTR/PM/MQR link to `vehicles` by `serial` string, not `vehicle_id`
   FK** - Inspection/Delivery (built later) use a real FK. No integrity
   bug found (application code enforces the match consistently), but it
   is the platform's one real schema inconsistency. Proposed in Roadmap
   v3.2.
4. **`DOMAIN_OWNERSHIP_MATRIX.md`/`CAPABILITY_DEPENDENCY_MAP.md`/
   `REPOSITORY_STRUCTURE_MAP.md` predate ADR-017/018/027** and don't
   name Inspection/Delivery/Knowledge/Vehicle 360 at all. Amendment
   pointers added this pass (§9); a full refresh is a documentation-only
   follow-up, not urgent (no code depends on these docs).
5. **`DeliveryService`'s 7 production-dead + 4 test-only methods**
   (§3) - unchanged from ADR-031, still awaiting a product decision on
   whether to formally retire General Delivery lifecycle tracking.
6. **7 pre-existing callerless API routes** named in ADR-031's PR
   (`product-families`, `ntr-records/history`, `pm-records/[id]/lock`,
   `attachments/[id]` GET/DELETE, `attachments/[id]/restore`,
   `knowledge-cases` GET routes) - still unaddressed, still out of scope
   for a hardening-only pass.
7. **`pm_programs` table and the three `*_raw` address-staging tables**
   - zero code references, named in ADR-031, not dropped (no production
   data destruction without an explicit, scoped task).
8. **`swalInfo`** (`lib/swal.ts`) - never-used third sibling of
   `swalSuccess`/`swalError`. Trivial, low priority, unchanged.
9. **`MachineRepository`** (`features/machine/repository.ts`) - dead
   code, already self-documented as unused since a prior authorization
   review. Report only.
10. **`NtrSummaryProvider` duplicates a query `SupabaseNtrRepository.findActiveBySerial()`
    already implements** (§3) - a genuine, if low-risk, duplicate
    implementation. Merge candidate for a future task.
11. **4 read-only boundary violations** (§5): `NtrImportService`'s bulk
    vehicle lookup, `lib/db.ts`'s two capped cross-domain search
    functions, `DeliveryRepository`'s two direct `vehicles` reads, and
    `MachineService`'s import of a non-facade Vehicle subpath. All
    read-only, all capped, three already self-documented as a deliberate
    trade-off. None found to be a data-integrity risk; named so a future
    task can decide whether to add the missing bulk-lookup methods these
    routes are working around.
12. **`buildLeaderboard()` implemented twice independently** (`lib/db.ts`'s
    `dashboardStats()` closure and `features/delivery/service.ts`'s
    module-level function) - low-risk, small-function duplication, merge
    candidate.
13. **Excel export has three independent workbook builders** with no
    shared helper (unlike CSV's `buildCsv()`) - cosmetic/DRY gap, not
    urgent.
14. **`InspectionService.listActiveInspections`, `MachineRepository`,
    `AttachmentService.enqueueArchiveEligible`/`processArchiveQueue`
    (via the never-invoked `StorageScheduler`)** - additional dead code
    beyond the ADR-031-era `DeliveryService` methods, same "report only,
    do not remove without a scoped task" treatment.
15. **`MachineService`'s own "call me, not `vehicle/service.ts` directly"
    convention is not fully adopted** - the NTR detail page and NTR PDF
    export route still import `getVehicleSummary`/`getVehicleTimeline`
    directly. Same underlying function, no behavior difference - a
    partial-migration cleanup candidate.

None of the above are blockers for v3.1 (Customer Ownership) - each is
named so the next milestone's design starts from an accurate map, not a
rediscovery.

---

## 12. Repository Health Report

- **Domains with single, confirmed ownership**: 9/9 (§1).
- **Duplicate implementations found**: 5 (§3/§11.10/§11.12/§11.13) -
  `NtrSummaryProvider`'s raw query, `buildLeaderboard()` ×2, three
  independent Excel builders, and `calcWarranty()`/`warrantyCutoffIso()`'s
  intentional-but-divergent pair. All low-risk; none is a correctness bug
  today.
- **Boundary violations found** (a module reaching into another's
  repository/table directly): 4 (§5/§11.11) - all read-only, capped,
  three already self-documented as a deliberate trade-off.
- **Circular dependencies found**: 0 (§5, confirmed by a full
  re-import-graph sweep of every `@/features/*` module).
- **Dead code found** (beyond ADR-031's already-named items): 5 methods/
  classes (§11.14) - all report-only, none removed this pass.
- **Security findings requiring a code change**: 0 (§7) - RBAC/scope
  fully consistent.
- **Stale governance docs identified**: 4 (§9), 1 corrected this pass,
  3 pointer-amended.
- **Named, unresolved technical debt items**: 15 (§11), none blocking.

## 13. Production Readiness Assessment

The foundation is sound for the next wave. Every domain the milestone
asked about has one owner; the one place multiple things looked
superficially similar (`calcWarranty()`'s four call sites) turned out to
be intentional variation, not duplication, once traced. The debt that
does exist (`serial` vs `vehicle_id`, MQR's missing service class,
Warranty's missing read-model) is exactly the kind of thing worth fixing
*before* Customer Ownership/CRM/Analytics are built on top of it, which
is why the Roadmap (§10) orders v3.1 first (new capability, no
prerequisite fix needed) and v3.2/v3.3 next (the two debt items that
would otherwise compound once Analytics starts joining across domains).

**Recommendation: PASS.** No blocking issue found. Proceed to v3.1
(Customer Ownership Foundation) once this audit is reviewed; v3.2/v3.3
can run in parallel with early CRM work since neither blocks it.
