# ADR-017: Inspection Domain (PDI)

## Status

Accepted (PR #45, merged 2026-07-13, SHA `de4d8cd`). See
`docs/releases/FOUNDATION_FREEZE_v1.1.md` for what this ADR's
architecture froze on merge.

> **Amendment (2026-07-14): ADR-028 (Import Inspection Domain
> Correction) reopens this frozen layer.** Dealer Approval and the NTR
> link described below (Data model, Decision table) were removed - Import
> Inspection is an internal MSEAL process, never dealer-approved, never
> linked to an NTR record. RE-PDI chaining, Release to Dealer, and the
> Factory Feedback Model were added. This document's original content
> below is preserved as the historical record of the 2026-07-13
> declaration; see `docs/adr/ADR-028-Import-Inspection-Domain-Correction.md`
> for the corrected decision and `docs/architecture/INSPECTION_PDI.md`
> for the corrected, current architecture (that document is updated in
> place, not preserved historically, since it is a living doc, not a
> frozen ADR).

`ADR-017` is the number `docs/architecture/blueprint/16-ADR-RECOMMENDATIONS.md`
reserved for "Inspection Domain" - used here, not the next sequential
number, per `docs/governance/DOCUMENTATION_POLICY.md`'s numbering rule and
the precedent ADR-018 already set for Knowledge's own reserved number.

## Problem

The Machine Delivery Platform task asks for a "PDI Architecture" -
Checklist, Findings, Evidence, Measurements, Parts Replacement, Digital
Sign-off, Checklist Version, Technician Certification, Dealer Approval -
as one stage inside a larger delivery lifecycle (see ADR-027).

**Grounding audit before any design work** (per this repo's own "never
write code from memory" rule): no PDI/Inspection module exists anywhere
in this codebase - the only trace is `ntr_records.pdi_date`/`pdi_number`,
two bare fields, not a module. `docs/architecture/blueprint/
04-INSPECTION-DOMAIN.md`, however, already proposes almost exactly what
the task asks for: a generic `Inspection` entity (`inspection_type`,
`status`, `result`, `checklist[]`, `photos[]`, `attachments[]`, optional
link to the NTR record it accompanies), naming `IMPORT_PDI` and
`DEALER_PDI` as its two concrete inspection types (`PRE_DELIVERY_
INSPECTION` was left as "Future - confirm with business, don't guess").

**Reviewing "Current AppSheet"** (the task's own instruction) was not
possible: "AppSheet" has zero references anywhere in this repository or
this environment - no export, no schema dump, no prior documentation.
This is stated explicitly here rather than fabricated. The design below
is grounded instead in (a) the task's own complete, explicit field list
for PDI, and (b) ch.04's frozen proposal - both are sufficient specs on
their own, and ch.04 in particular already anticipated this exact build.

## Decision

Build the Inspection domain ch.04 proposed, reconciled against the
task's own field list where ch.04 left something open:

| | Frozen ch.04 (before) | This build (after reconciliation) |
|---|---|---|
| Storage | One `Inspection` entity/table | Same - one `inspections` table, confirmed |
| Inspection types | `IMPORT_PDI` (Phase 1 target), `DEALER_PDI` (Phase 2), `PRE_DELIVERY_INSPECTION` (future, undecided vs. `DEALER_PDI`) | `DEALER_PDI` is this epoch's only targeted UI (dealer-facing platform scope); `IMPORT_PDI` accepted by the schema, no manufacturer-side screen built. `PRE_DELIVERY_INSPECTION`'s "is it distinct from `DEALER_PDI`" question remains genuinely undecided - not resolved here, not needed to ship this epoch |
| Checklist | `InspectionChecklistItem[]` JSON column | Same shape, plus a `checklist_version` column (task's own explicit "Checklist Version" requirement) and one seeded default template (`DEFAULT_PDI_CHECKLIST`) - ch.04's own open question ("are checklist templates dealer/product-family-configurable?") remains unresolved, a template builder is explicitly deferred |
| Findings/Evidence/Measurements/Parts | Not named in ch.04 | New, additive columns on the same `inspections` row: `findings` (severity/system/description + a `knowledge_case_id` link once promoted), `measurements` (parameter/value/unit/spec range/in-range), `parts_replaced` (name/number/qty/reason). Evidence reuses the existing Attachment Platform, not a new table |
| Sign-off/Approval | Not named in ch.04 | New columns: `signed_off_by`/`signed_off_at` (Digital Sign-off, open to the performing technician), `dealer_approved_by`/`dealer_approved_at` (Dealer Approval, gated by `canApproveDelivery` - `lib/scope.ts`) |
| Technician Certification | Not named in ch.04 | New `technician_certification_ref` column - a free-text reference only; a full certification-management module is explicitly deferred |
| Downstream hooks | Machine Timeline "View Checklist," Knowledge observation input, future "Inspection Recommendation" AI capability | Realized: Activity Timeline via the existing `record_audit_log`/`<ActivityTimeline>` (module `'pdi'`); Knowledge via `KnowledgeService.createCandidate()`/`.addEvidence()` directly from a Finding ("Structured Findings may become Knowledge Candidates... do not duplicate entry" - task brief); AI stays reserved (ADR-027's Delivery-level AI panel covers Inspection findings too - no separate Inspection-level AI panel was requested) |

**One Aggregate, One Owner**: `inspections` is the only table; `Inspection`
Repository`/`InspectionService` are its only writers. No `checklist`,
`finding`, `measurement`, or `part_replaced` gets its own table - they are
JSONB columns on the one row, exactly matching ch.04's own shape.

## Data model

`inspections` (see `docs/architecture/INSPECTION_PDI.md` for the full
column list): `id`, `inspection_ref` (`PDI-<year>-######`, dealer-scoped
`next_job_seq()` bucket), `inspection_type`, `vehicle_id` (FK
`vehicles.id`) + denormalized `serial`, `dealer_id`, `status`
(`Scheduled`/`InProgress`/`Completed`/`Cancelled`), `result`
(`Pass`/`Fail`/`Conditional`), `checklist_version`, `checklist`/
`findings`/`measurements`/`parts_replaced` (JSONB), `technician_name`/
`technician_certification_ref`, `signed_off_by`/`signed_off_at`,
`dealer_approved_by`/`dealer_approved_at`, `related_ntr_id` (optional FK).

## Consequences

- PDI is real, dealer-facing infrastructure the moment this PR merges -
  `InspectionService` is the one door every future caller (Delivery,
  Machine Passport, a future AI capability) goes through.
- Import PDI (manufacturer-side) is schema-ready but UI-deferred - a
  future epic can add its screens without a migration.
- Structured Findings can already become Knowledge Candidates today,
  through Knowledge's existing public write API - no new Knowledge
  surface was added, and none is needed for future Inspection-sourced
  Evidence either.
- Checklist template configurability remains an open product decision
  (ch.04's own question, still unresolved) - one seeded default ships.

## Alternatives considered

**A second, PDI-specific table separate from a generic `Inspection`
table** was rejected - it would fork ch.04's frozen proposal for no
reason; `inspection_type` already lets one table serve both `DEALER_PDI`
today and `IMPORT_PDI` whenever it's built, exactly as ch.04 intended.

**Embedding PDI fields directly onto `ntr_records`** (extending the
existing `pdi_date`/`pdi_number` columns) was rejected - PDI can happen
before an NTR record exists (Stock Yard/Dealer PDI, ahead of Customer
Delivery), and conflating the two would violate One Aggregate (NTR owns
NTR's own fields; Inspection owns PDI's).
