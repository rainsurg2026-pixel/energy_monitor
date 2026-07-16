# Business Workflow

Status: Sprint 7 (Core Business Domain). Documents how PM Record, Delivery
(New Tractor Delivery), MQR, Warranty, and Parts Request move through the
shared six-stage lifecycle already defined in docs/MODULE_LIFECYCLE.md
(Draft → Submitted → In Progress → Waiting Approval → Completed → Closed),
plus the shared Approval and Close mechanics every module relies on. This
document does not define a new lifecycle — it applies the existing one to
five specific modules and notes where each extends it, exactly as
docs/MODULE_LIFECYCLE.md's "How a module may extend this" section permits.

This is a standard, not an implementation. No status column, transition, or
notification exists because of this sprint. Workflows below describe the
target; they are not a claim about what any module enforces in code today.

## 1. Shared lifecycle (recap)

Draft → Submitted → In Progress → Waiting Approval → Completed → Closed.
Full definition of each stage: docs/MODULE_LIFECYCLE.md. A module may insert
extra stages, skip a stage that doesn't apply, or attach side effects to a
transition — it may not rename or repurpose one of the six.

## 2. PM Record

| Stage | What happens |
|---|---|
| Draft | Technician opens a PM Record against a Tractor and works through the PM Checklist (docs/MASTER_DATA.md §5). Only the technician can edit. |
| Submitted | Technician finishes the checklist and submits. |
| In Progress | Not typically meaningful for PM Record — most PM work is completed in one visit. A module may skip this stage per docs/MODULE_LIFECYCLE.md. |
| Waiting Approval | Optional — only if a dealer's process requires supervisor sign-off before a PM Record counts as done. |
| Completed | PM Record is finished; feeds PM Completion (docs/DASHBOARD_MODEL.md §8). |
| Closed | Terminal. A module may treat Completed and Closed as the same instant (docs/MODULE_LIFECYCLE.md). |

## 3. Delivery (New Tractor Delivery)

| Stage | What happens |
|---|---|
| Draft | Delivery is scheduled/prepared for a specific Tractor and Dealer. |
| Submitted | Handover paperwork is filled in. |
| In Progress | Delivery is being executed (unit being prepared/handed over). |
| Waiting Approval | Optional — e.g. a dealer-admin or customer confirmation step before the unit is considered delivered. |
| Completed | Unit is handed over. This is the transition that sets `Tractor.customer_id` (docs/ENTITY_RELATIONSHIP.md §2) — Delivery is the workflow that establishes the Dealer → Customer → Tractor relationship, not a side effect of any other module. |
| Closed | Terminal. |

## 4. MQR

| Stage | What happens |
|---|---|
| Draft | A job is opened against a Tractor. |
| Submitted | Initial intake/diagnosis info is handed off. |
| In Progress | Technician is actively diagnosing/repairing. |
| Waiting Approval | Customer Care / Central Admin reviews before the record counts as done (docs/PERMISSION_MODEL.md's Approve permission). |
| Completed | Repair finished. |
| Closed | Terminal. |

Today's production MQR (`src/app/(app)/records/`) already has its own
`jobId`-keyed records and a status concept, but does not yet implement this
full six-stage model in code — this table documents the target shape any
future MQR migration (docs/ROADMAP.md Phase 2, "Re-home MQR") would align
to, not a claim about what is live today.

## 5. Warranty

| Stage | What happens |
|---|---|
| Draft | Dealer drafts a warranty claim against a Tractor. |
| Submitted | Claim submitted. |
| Pending Manufacturer Response | Extension stage — this is the exact example docs/MODULE_LIFECYCLE.md itself gives for Warranty: a sub-step inserted between Submitted and In Progress while MSEAL/manufacturer reviews the claim. |
| In Progress | Repair or replacement under the claim is being carried out. |
| Waiting Approval | Final sign-off before the claim is settled. |
| Completed | Claim settled. Reflected back to `Tractor.warranty_status` (docs/ENTITY_MODEL.md §4) as a denormalized read. |
| Closed | Terminal. |

## 6. Parts Request

| Stage | What happens |
|---|---|
| Draft | Dealer drafts a request for parts, optionally tied to a Tractor (docs/ENTITY_RELATIONSHIP.md §3). |
| Submitted | Request submitted. |
| In Progress | Fulfillment/picking in progress. |
| Waiting Approval | Optional, module-specific — e.g. a cost or quantity threshold requiring approval. docs/MODULE_LIFECYCLE.md gives Parts Request as its own example of a side effect here: entering Waiting Approval triggers a notification. |
| Completed | Parts shipped/received. Feeds the Waiting Parts KPI (docs/DASHBOARD_MODEL.md §5) for any other module's record blocked on this one. |
| Closed | Terminal. |

## 7. Approval

Waiting Approval is the shared checkpoint that makes "needs a decision"
queryable and dashboard-able across every module above, rather than each
module inventing its own approval flag (docs/MODULE_LIFECYCLE.md). Moving a
record into or out of Waiting Approval is itself a permission, not a side
effect of edit access: per docs/PERMISSION_MODEL.md's matrix, only Super
Admin and Customer Care hold Approve — Dealer Admin, Dealer User,
Technician, and Viewer do not, regardless of what else they can edit. A
module may narrow further (e.g. approval restricted to a region) but may
not grant Approve to a role not already marked for it without documenting
the exception, per docs/PERMISSION_MODEL.md's own note.

## 8. Close

Completed and Closed are deliberately separate stages so reporting stays
consistent across modules even when a given module sees no practical
difference between them (docs/MODULE_LIFECYCLE.md) — e.g. Closed might mean
"also invoiced/reconciled" for Parts Request but be the same instant as
Completed for PM Record. Closed is terminal: no ordinary role edits a Closed
record; reopening, where a module supports it, is an explicit transition
back to In Progress, never a direct edit.

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
