# Release Notes — Machine Delivery Platform v1.0

PR #45 (`feature/machine-delivery-platform`), squash-merged to `main`
2026-07-13 (merge SHA `de4d8cd`). The complete digital delivery
lifecycle - Tractor In through Warranty Activation - with PDI as one
stage inside it, built on top of the Foundation (Machine, Attachment,
Timeline, Knowledge, Authentication, Master Data all reused, none
reopened).

## Architecture

- **Two ADRs, matching One Aggregate/One Owner**: ADR-017 (Inspection
  Domain/PDI - new `inspections` table, reconciles the frozen Blueprint's
  ch.04) and ADR-027 (Machine Delivery Platform - new `delivery_records`/
  `delivery_trainings` tables, the lifecycle-tracking aggregate that
  orchestrates Tractor In/Stock Yard/PDI/Dealer Preparation/Customer
  Delivery/Operator Training/Delivery Acceptance/Warranty Activation
  without duplicating any stage's real owner).
- **"AppSheet" (the task's own review instruction) has zero references
  anywhere in this repository or environment** - flagged explicitly, not
  fabricated; the design is grounded in the task's own complete field
  spec and the frozen Blueprint proposal instead.
- **Warranty Activation becomes a real point-in-time event for the first
  time** - `delivery_records.warranty_activated_at`/
  `warranty_activation_source` - closing a gap
  `03-MACHINE-LIFECYCLE-AND-TIMELINE.md` itself named ("warranty status
  is computed on read, never emitted as an event"). `calcWarranty()`'s
  live computation is unchanged.

## Digital PDI (ADR-017)

`inspections` table: Checklist (versioned, one seeded default template),
Findings (severity/system/description, promotable to a Knowledge
Candidate), Measurements (parameter/value/unit/spec range/in-range),
Parts Replacement, Digital Sign-off, Dealer Approval (gated by
`canApproveDelivery`), Technician Certification (reference only).
`/delivery/pdi` list/new/detail. See `docs/architecture/INSPECTION_PDI.md`.

## Delivery Lifecycle (ADR-027)

Nine ordered stages (`delivery_records.stage`), advanced only through
named `DeliveryService` methods - Tractor In (reads `vehicles`, ADR-012,
never duplicates), Stock Yard, PDI (links an Inspection), Dealer
Preparation, Customer Delivery (links an NTR record, never duplicates),
Operator Training (`delivery_trainings`), Delivery Acceptance (gated),
Warranty Activation (auto-triggered by Acceptance, or manual).
`/delivery/records` list/new/detail. See
`docs/architecture/DELIVERY_PLATFORM.md`.

## Machine Passport Integration

Machine Digital Passport v1.5 - new read-only Delivery section
(`MachineService.getMachineDeliverySummary()` -> `DeliveryService`),
placed before Warranty to match real-world chronology. Machine owns none
of this data - same thin-facade + `<Suspense>` pattern as every other
section.

## Timeline Integration

Zero new table. `AuditModule` widened to add `'pdi'`/`'delivery'`; every
mutating method in `InspectionService`/`DeliveryService` writes through
the existing `logAuditEvent()`/`logAuditEvents()` into `record_audit_log`.
`<ActivityTimeline>` needed zero component changes (confirmed
module-agnostic, re-verified during the pre-merge refinement pass).

## Knowledge Integration

Inspection Findings promote to Knowledge Candidates through
`KnowledgeService.createCandidate()`/`.addEvidence()` directly - no
parallel entry form. `knowledge_evidence.source_type` widened to add
`'Inspection'` (and `source_module` to add `'pdi'`) - the Knowledge
Foundation Freeze v1.0's own documented Extension path, not a violation.

## Rule 6 - Service Construction Standard (platform-quality refinement)

A module-scope Service construction tripped an eager Supabase-client
field initializer at build time during this PR's own CI run
(`SupabaseNtrRepository`). Rather than leaving that as a one-off fix,
this release adds a permanent preventive control:

- **`docs/standards/SERVICE_CONSTRUCTION_STANDARD.md`** (new) -
  Repository/Service constructors must be side-effect free; a runtime-
  configured client must be resolved lazily.
- **Architecture Check Rule 6** (`scripts/architecture-check.ts`) -
  generic, technology-agnostic detection of eager runtime work (a direct
  lowercase-function call or `process.env` read) in any
  `*Repository`/`*Service` class field initializer. New violations fail
  immediately, anywhere; four pre-existing eager repositories (NTR,
  Maintenance, Vehicle Event) are grandfathered via a pinned,
  non-growing per-file allowlist - temporary technical debt, documented
  with migration guidance in `docs/engineering/ARCHITECTURE_ENFORCEMENT.md`.

## Dashboard KPI Contract

`/delivery/dashboard` - the official ten-KPI Screen Contract
(`docs/architecture/DELIVERY_PLATFORM.md` §8). Eight implemented and
live-computed: Pending Tractor In (a real anti-join against `vehicles`),
Pending Stock Yard, Pending PDI, Pending Delivery, Pending Training,
Warranty Waiting, PDI First Pass Rate, Average Delivery Lead Time. Two -
Open Delivery Findings, Dealer Delivery SLA - have no defined data model
and are rendered as Coming Soon tiles, explicitly marked **Reserved for
Future Capability**, never faked.

## Reports

`/delivery/reports` - all 7 named report types (Dealer/Technician/Model/
Checklist Version/Delivery Duration/Training Completion/Warranty
Activation) are filters/columns of one consolidated dataset, not 7
pipelines. CSV export reuses the existing shared `buildCsv()`.

## Documentation

`docs/adr/ADR-017-Inspection-Domain.md`, `docs/adr/
ADR-027-Machine-Delivery-Platform.md`, `docs/architecture/
INSPECTION_PDI.md`, `docs/architecture/DELIVERY_PLATFORM.md`,
`docs/standards/SERVICE_CONSTRUCTION_STANDARD.md` (new); blueprint ch.03/
ch.04 amendment notes; `docs/adr/README.md`, `docs/governance/
CAPABILITY_MAP.md`, `docs/governance/MODULE_MATURITY_MATRIX.md`,
`docs/standards/TERMINOLOGY_STANDARD.md`, `docs/standards/
MODULE_DEVELOPMENT_STANDARD.md`, `docs/engineering/
ARCHITECTURE_ENFORCEMENT.md`, `docs/ROADMAP.md` updated.

## Corrections made during review (not silently fixed)

- **Ownership leak**: `DeliveryRepository` was embedding `inspections`
  columns directly into its own query. Fixed via proper service
  composition (`InspectionService.listInspectionsByIds()`), restoring
  the ownership boundary with zero change to Dashboard/Report output.
- **Real bug**: `MachineService.getMachineDeliverySummary()` hardcoded
  `pdiResult: null` unconditionally - fixed to read the real result
  through `InspectionService.getInspection()`.
- **Documentation overclaim corrected**: Training Photos/Videos were
  never actually wired to the Attachment Platform (only PDI Evidence
  is) - now stated honestly under Explicitly Deferred.

## Verification

Typecheck clean, lint clean (0 errors, 12 pre-existing warnings),
720/720 tests pass (16 new), build succeeds (10 new pages, 20 new API
routes), architecture check 6/6 PASS (new Rule 6 included).

## Explicitly deferred (named, not silently dropped)

Import PDI UI (schema-ready, no manufacturer-side screen); full Warranty
claims/policy ledger (only the one activation event is captured);
Technician Certification management (free-text reference only);
checklist template builder (one seeded default ships); Training Photos/
Videos capture UI (schema and retention policy ready, no upload screen
built); AI Delivery Review/Risk/Readiness/Recommendation (reserved, zero
logic); Open Delivery Findings and Dealer Delivery SLA KPIs (no data
model exists for either); AppSheet data migration execution (no export
available in this environment).
