# Project State

Live, point-in-time snapshot of where the repository actually is. Unlike
the Constitution (permanent principle) and the ADR Index (permanent
record of decisions), this document is expected to go stale and must be
re-verified against `git log`/`gh pr list`/`docs/adr/README.md` before
being trusted, not read as historical fact.

**No prior document of this kind existed in the repository** (checked
`docs/architecture/`, `docs/`, `docs/governance/`, `docs/releases/`) -
created fresh, derived entirely from git history, `gh pr list`, and the
existing architecture/governance documents cited below. Nothing in this
document is invented.

## Constitution and precedence

`docs/architecture/PLATFORM_CONSTITUTION.md` (v1.0, effective 2026-07-13)
is this repository's engineering constitution - Vision/Mission/Values/
Engineering/Business/Domain/Capability/Navigation/Knowledge/AI/Data/
Governance Principles, sitting above the Architecture Blueprint,
Architecture Standards, ADRs, and Design Framework per
`docs/governance/DOCUMENTATION_HIERARCHY.md`. Read it first, always.

## Current milestone

**Open, not yet merged**: **Historical NTR Import Retirement** (ADR-038,
2026-07-16, Product Owner decision) - permanently retires Historical NTR
Import (formerly "Legacy Import") and Import History. Removes the
Dashboard Quick Action/KPI, both admin pages, the entire `/api/ntr/import/*`
API surface, the import wizard/service/repository code, the
`canManageLegacyImport` permission, and all associated translations/tests.
Does not touch existing `ntr_records` data, `source`/`import_session_id`
provenance fields, or the Universal Import Framework (`src/shared/import/`,
a separate ADR-024 layer, now unconsumed but not itself retired). See
`docs/adr/ADR-038-Historical-NTR-Import-Retirement.md` for full scope.

This section previously described the Documentation Cleanup PR (#61) as
"not yet merged" for two PRs' worth of history after it actually merged
(2026-07-15) - stale self-referential text, corrected at the time, not a
new decision. Note: this document's own "Recent history" table and
"Domain ownership" section are known to predate several since-merged PRs
(#64-#68, a consistency-sweep series) - not caught up here, out of this
retirement task's scope; flagged again under Known documentation gaps.

**Last shipped**: **Factory PDI Status integration** (PR #63, squash
commit `18a5237`, 2026-07-15; doc-consistency follow-up `fb2a4d6`) -
`vehicles.factory_pdi_status`, synced from Tractor IN's "PDI Status"
sheet column (grounded against the live sheet: blank/`"QC Passed"`/
`"Quarantine"`, no literal "Pending" value - implemented as `IS NULL`).
Import Inspection Dashboard's "Pending Import Inspection" KPI now
counts this Factory Domain signal instead of the module's own
inspection-record status, and is clickable through to the existing
Import Inspection list, filterable by Factory PDI Status
(vehicle-centric, so a machine with no Inspection record yet still
shows as waiting). Zero impact on Import Inspection's own ownership of
`inspections` (verified structurally: `InspectionRepository` remains
the only reference to that table name anywhere in `src/`).

**Previously completed, still current**: **Documentation Cleanup for
Production Pilot** merged via PR #61, squash commit `bcaf17e`,
2026-07-15 - brought ADR-035/036/037 and their companion business docs
into `main` (they had lived only in three open, mutually-conflicting PR
branches #57/#58/#59 that never merged), corrected every "today"/
"VIOLATED"/"future PR" verdict PR #60 already resolved, fixed unrelated
pre-existing drift (stale ADR-022/023/025 index rows, a stray
`docs/release/` directory, `MSEAL_DESIGN_FRAMEWORK.md`'s pre-Pilot nav
table). Recommended PR #57/#58/#59 be closed as superseded - **still
open as of this pass, not yet actioned** (see Remaining Technical Debt
below). **`docs/governance/AI_ENGINEERING_PLAYBOOK.md`** (PR #62,
squash commit `c40eda7`) established as the Bootstrap Standard - first
stop in `.claude/CLAUDE.md`'s "Where to look, in order," right after
root `CLAUDE.md`. **Production Pilot Readiness** merged via PR #60,
squash commit `f927018` - Production Pilot's navigation
(lifecycle-ordered sidebar, Coming Soon hidden for every role) is the
live, active navigation on `main`.

## Recently completed: Production Pilot Readiness (ADR-037 implemented)

Real code, not audit-only - implements ADR-037's approved amendment and
three other Production-Pilot-specific changes, reusing existing services/
forms/mechanisms throughout (no new architecture):

1. **Tractor IN scope guard (ADR-037 implemented)** -
   `TractorInSyncService` now excludes `dealer_id` from its UPDATE
   payload once a serial has a real, Active NTR registration, and never
   writes `delivery_date` again after that point either - closes the
   Source-of-Truth violation ADR-035/036/037 all named. Insert-time and
   pre-NTR update-time behavior unchanged.
2. **Platform-wide timestamp format** - `formatDateTimeLocalized()`
   (13 call sites, one shared function) now renders
   `dd/MMM/yyyy hh:mm:ss a` in Asia/Bangkok regardless of UI language
   (e.g. "15/Jul/2026 09:45:18 AM"). Pure business dates
   (`formatDateLocalized()` - delivery date, performed date, etc.) are
   unchanged and stay locale-varying.
3. **NTR Edit consolidated into the New NTR form (One Form, Dual Mode)**
   - the smaller, previously-separate `NtrEditForm` is retired; both
   create and edit now share `features/ntr/components/ntr-form.tsx`.
   Photos/GPS/customer info/hour meter/salesperson are all editable in
   both modes; Vehicle Master/Factory Domain fields (Serial, Engine
   Number, Model, Product Family, Sub Model, Product Code, Dealer) stay
   read-only in both, unchanged design principle. Branch becomes
   editable in Edit mode (dealer-internal correction, not Factory
   Domain). NTR's detail page also gained an Activity Timeline section
   (`record_audit_log`-backed, same shared component MQR/PM/Knowledge
   already use - `"ntr"` was always a valid `AuditModule`, just never
   rendered before).
4. **Sidebar reorganized by business lifecycle** - Vehicle Lookup
   (Machine Passport) elevated to its own top-level entry; New Tractor
   Delivery moved into a new Delivery Lifecycle group; "Quality
   Inspection" renamed to "Import & Inspection" (the group label was
   the one place still using the wrong term - ADR-028 already corrected
   the domain, item labels already said "Import Inspection"). Legacy
   Import's nav entry removed entirely (route/Import History still
   reachable directly). Coming Soon capabilities (Troubleshooting,
   Engineering Intelligence, Reports, Warranty, PIP, Service Campaign)
   are now hidden for every role, including SuperAdmin, for the
   duration of Production Pilot - the underlying `CapabilityStatus`/
   `effectiveStatus` mechanism is unchanged, ready for the next
   capability post-Pilot.

Validation: `architecture-check` 6/6 PASS, `tsc`/`eslint` clean, full
test suite passing (new/updated tests for the Tractor IN guard,
timestamp format, and nav restructuring), `next build` succeeds.

## Recently completed: Business Architecture Consolidation (ADR-037)

Audit + formal Architecture Amendment, Accepted and implemented - see
`docs/adr/ADR-037-Tractor-IN-Field-Scope-Amendment.md`,
`docs/architecture/BUSINESS_ARCHITECTURE_CONSOLIDATION.md`, and
`docs/business/MACHINE_LIFECYCLE.md`/`FIELD_OWNERSHIP_MATRIX.md`/
`WRITE_PRECEDENCE_MATRIX.md` (brought into `main` via the Documentation
Cleanup PR, superseding the original open-and-conflicting PR #59).
Resolved the ADR-029 conflict ADR-035/036 both named but did not
decide - recommendation **APPROVE**, implemented above (PR #60).

## Recently completed: Business Workflow Consolidation (ADR-036)

Field-level pass confirming the ADR-029 conflict, Accepted - full
detail `docs/architecture/BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`,
`docs/architecture/BUSINESS_INVARIANTS.md` (brought into `main` via the
Documentation Cleanup PR, superseding the original open-and-conflicting
PR #58). Confirmed Repair/MQR Closed need zero new work; confirmed MQR
NTR auto-fill and machine-type classification as genuine gaps, not
violations - restated and resolved (the ADR-029 conflict specifically)
by ADR-037 above.

## Recently completed: Business Workflow & UX Audit (ADR-035)

Workflow-level pass over the tractor lifecycle, Accepted - full detail
`docs/architecture/BUSINESS_WORKFLOW_UX_AUDIT.md` (brought into `main`
via the Documentation Cleanup PR, superseding the original
open-and-conflicting PR #57). Found
three dead/unmodeled Delivery-lifecycle stages (MSEAL Stock/Ship to
Dealer/Dealer Stock), a non-existent Troubleshooting workflow, and two
small nav defects (duplicate PIP entry, "Import Inspection" vs.
"Quality Inspection" naming drift) - MSEAL Stock/Ship to Dealer/Dealer
Stock's fate is still open (ADR-035's R-1, restated as Implementation
Sequence item 6 in ADR-037's audit), not resolved by any of the three
passes.

## Recently completed: v3.1 Customer Ownership (ADR-033/034), Phase 1 + Governance Gate

PRs #50-#54 all merged. `customers`, `customer_ownership_history`, and
`vehicles.customer_id` exist in the live schema (migration
`20260715054732_customer_ownership_schema_v3_1`) but are not yet read
or written by any application code. **Every implementation phase is
currently gated WAIT** per `docs/architecture/
CUSTOMER_COMPLIANCE_DECISION_REGISTER.md`:

| Phase | Gate | Status |
|---|---|---|
| Phase 2 - Backfill | CDR-001 (PDPA review), CDR-002 (retention period), CDR-003 (anonymization design), CDR-006 (request-process owner), CDR-007 (identity-key validation) all Resolved | **WAIT** - 5/5 open |
| Phase 3 - CustomerService + APIs | Phase 2 complete + CDR-004 (cross-dealer visibility) Resolved | **WAIT** - transitively blocked, CDR-004 open |
| Phase 4 - UI + Cutover | Phase 3 complete + a full production reporting cycle with no new issue surfaced | **WAIT** - transitively blocked |

None of the open decisions are open-ended engineering questions - each
is a named Legal, Business, or bounded-Engineering item with a single
owner. Full detail, including each decision's risk and recommendation:
`docs/architecture/CUSTOMER_COMPLIANCE_DECISION_REGISTER.md`,
`docs/adr/ADR-034-Customer-Data-Governance.md`,
`docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md`,
`docs/adr/ADR-033-Customer-Ownership.md`.

**v3.0 Foundation Hardening (ADR-032)** - architecture-hardening audit,
no code or schema change. Full detail:
`docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md`.

Outcome: **PASS**. All 9 named business domains (Vehicle, Machine
Passport, Import Inspection, NTR, Warranty, PM, MQR, Timeline, Documents)
confirmed to have exactly one code owner, zero circular dependencies,
RBAC/scoping consistent. Named, not fixed: 4 read-only boundary
violations, 5 duplicate implementations, 5 dead/test-only methods, an
API envelope-shape split by module era - full list in the audit doc's
Technical Debt Register (§11), none blocking.

Remaining v3 roadmap (ADR-032 §10):
- **v3.1 - Customer Ownership Foundation** (in progress, Phase 1 above).
- **v3.2 - Service Operations Consolidation**: backfill `vehicle_id` FK
  onto `ntr_records`/`pm_records`/`records` (currently denormalized
  `serial`-string linking, no FK - the one real schema inconsistency the
  audit found).
- **v3.3 - Analytics-Ready Event Model**: single `getWarrantySummary()`
  read-model; extract MQR's 81 `lib/db.ts` functions into their own
  `features/mqr/` service/repository pair.

## Recent history (merged, most recent first)

| PR | Title | ADR |
|---|---|---|
| #63 | Factory PDI Status integration from Tractor IN | - |
| #62 | AI Engineering Playbook - Production Pilot operating rules | - |
| #61 | Documentation Cleanup for Production Pilot | ADR-035/036/037 (brought to `main`) |
| #60 | Production Pilot Readiness - Tractor IN scope guard, timestamp standard, NTR consolidation, lifecycle sidebar | ADR-037 (implemented) |
| #56 | PM create redirects to list, not detail page | - |
| #55 | Vehicle 360 search - Model-gated across Serial/Engine/Product Code | - |
| #54 | Customer Ownership Governance Gate - Compliance Decision Register | - |
| #53 | Customer Data Governance - policy only, no code | ADR-034 |
| #52 | Customer Ownership schema - Phase 1 | ADR-033 |
| #51 | Customer Ownership architecture proposal - design only | ADR-033 |
| #50 | v3.0 Foundation Hardening - architecture audit, domain map, technical debt register | ADR-032 |
| #49 | Platform Stabilization - post-ADR-028/029/030 cleanup | ADR-031 |
| #48 | Vehicle 360 consolidation - expand Machine Passport | ADR-030 |
| #47 | Quality Inspection nav consolidation + Vehicle Master Data expansion | ADR-029 |
| #46 | Import Inspection domain correction | ADR-028 |
| #45 | Machine Delivery Platform v1.0 - Tractor In through Warranty Activation | ADR-017, ADR-027 |
| #44 | MSEAL DMS Platform Constitution v1.0 | - |
| #43 | Capability-status-driven navigation visibility | - |
| #42 | Engineering Knowledge Platform v1.0 | ADR-018 |
| #41 | Terminology & navigation cleanup | - |
| #40 | Foundation Freeze v1.0 declared | - |
| #39 | Machine Digital Passport v1.0 | ADR-026 |
| #38 | MSEAL DMS Platform Governance Framework v1.0 | - |
| #37 | MSEAL Design Framework v1.0 | ADR-023 |
| #36 | Import Platform v2 | ADR-022, ADR-024 |

Foundation Freeze v1.0 (`docs/releases/FOUNDATION_FREEZE_v1.0.md`),
amended to v1.1 (`docs/releases/FOUNDATION_FREEZE_v1.1.md`) after the
Delivery Platform (ADR-017/027). Foundation-frozen layers: Architecture
Blueprint, Platform Governance, Design Framework, Navigation Standard,
Dashboard Standard, Authentication Platform, Import Platform Foundation,
Machine Domain, plus `PLATFORM_ARCHITECTURE_STANDARDS.md`'s ten frozen
platform layers - changed only via the Foundation Freeze reopening
process, never a routine PR.

## ADR index

`docs/adr/README.md` is canonical - this section was stale (said
"ADR-001 through ADR-032, next ADR-033" for two PRs' worth of history
after ADR-033 through ADR-037 landed); corrected here, not re-derived
independently of the canonical index. ADR-001 through ADR-038 exist;
**next available number: ADR-039**. ADR-015/016/019/020 remain reserved
(Machine Domain v2, Event Model, Engineering Intelligence, Analytics
Domain - Inspection/017 and Knowledge/018 already consumed their
reservations; 021's reservation was reconciled against ADR-026, which
actually consumed it, during the Documentation Cleanup pass). ADR-038
(Historical NTR Import Retirement, 2026-07-16) is a Product Owner
decision superseding ADR-008/024's Production-status framing of that
feature - see ADR-038 itself for full scope.

## Domain ownership (current, per ADR-032 audit)

| Domain | Owner | Notes |
|---|---|---|
| Vehicle (master) | `vehicles` table, `src/shared/master-data/` | Single source of truth (ADR-012, ADR-029) |
| Machine Passport (Vehicle 360) | `src/features/machine/` | Only Vehicle 360 destination (ADR-030); `/vehicles/[serial]` is now a redirect |
| Import Inspection (PDI) | `src/features/inspection/` | ADR-017, corrected by ADR-028 |
| NTR | `src/features/ntr/` | - |
| Warranty | `lib/warranty.ts`'s `calcWarranty()` (pure function, no dedicated table/service) | 7 call sites; named debt (Roadmap v3.3) |
| PM | `src/features/maintenance*/` | - |
| MQR | `src/lib/db.ts` (81 functions) | Only domain without its own service/repository pair; named debt (Roadmap v3.3) |
| Timeline | Machine Lifecycle (`vehicle_events` + per-module `VehicleEventSource`) and Activity Timeline (`shared/activity-timeline/`, `record_audit_log`) - two legitimately separate, non-duplicative implementations | - |
| Documents | `src/shared/attachments/` (Attachment Platform, ADR-010) | - |

Full detail, including the 4 confirmed read-only boundary violations:
`docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md` §1-§5.

## Technical debt (live register)

Tracked in `docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md` §11 (15
items as of ADR-032) - not duplicated here. Headline items: MQR's absent
service/repository layer; NTR/PM/MQR's denormalized `serial`-string
vehicle linking (no FK); `calcWarranty()`'s 7 independent call sites with
no shared read-model (one, `report-form.tsx`, ships it into the client
bundle); a handful of dead/test-only methods (`InspectionService.
listActiveInspections`, `MachineRepository`, `AttachmentService`'s
unreachable archive-queue chain via a callerless `StorageScheduler`).

## Validation status

`architecture-check`: 6/6 PASS (last run this session, on ADR-032's
docs-only diff). `tsc`/`eslint`/`vitest`/`next build` last verified
clean on this branch prior to the docs-only edits (no source file has
changed since).

## Known documentation gaps (not fixed this pass)

- **This document's "Recent history" table and "Last shipped" narrative
  predate PRs #64-#68** (a consistency-sweep series: shared components/
  validators/formatters/empty states, then three API error-response-helper
  tranches) - not caught up during the Historical NTR Import Retirement
  pass (ADR-038); out of that task's scope.
- **PR #57/#58/#59 remain open**, unactioned, despite being recommended
  for closure (as superseded by PR #61) twice now - a real, cheap
  cleanup action still not taken.
- **Domain ownership table below predates Delivery (ADR-027) and
  Customer (ADR-033) as their own rows** - both are real, live domains
  (`src/features/delivery/`, `customers`/`customer_ownership_history`
  tables) not reflected in that table's list. Not rewritten here to
  avoid an unreviewed rewrite of a table last produced by ADR-032's
  own audit - flagged as a gap for that audit's own next revision.
- `docs/ROADMAP.md` is a stale Sprint-1-through-5-era phase plan
  (predates ADR-017 onward entirely; states "currently zero test
  coverage," no longer true - `vitest` suite exists). ADR-032's own
  Roadmap section (§10, restated above under "Current milestone") is the
  current, accurate near-term plan; `docs/ROADMAP.md` needs a full
  rewrite or retirement, named as debt, not resolved here (out of this
  bootstrap's scope).
- `docs/governance/*.md` (Domain Ownership Matrix, Capability Dependency
  Map) operate at bounded-context grain and were amendment-noted, not
  rewritten, during ADR-032 - see those files' own amendment pointers.

## Verification

Derived from: `git log --oneline origin/main` (commit/PR chain), `gh pr
list --state open` / `--state merged` (PR numbers/titles/status),
`docs/adr/README.md` (ADR numbers/next-available), `docs/architecture/
V3_FOUNDATION_HARDENING_AUDIT.md` (domain ownership, debt register,
roadmap), `docs/architecture/PLATFORM_CONSTITUTION.md` (constitution
status), `docs/releases/` directory listing (Foundation Freeze state).
No fact in this document is asserted without a corresponding
repository artifact.
