# Module Lifecycle

The standard status workflow a business-module record (an MQR, a Parts Request, an NTR, etc.) moves through, from creation to closure.

## Naming note — read first

This workflow's field is referred to here as **`status`** (or `lifecycle_status` if a module already has a conflicting `status` meaning). It is a different field from `record_status`, which `docs/MODULE_ARCHITECTURE.md` §4 already reserves for soft-delete state (active vs. deleted) on every table. A module's schema is expected to carry both columns with distinct meanings — `record_status` answers "does this row still exist," `status` answers "where is this record in its workflow." This sprint does not create either column; it documents the convention a future schema migration would follow.

## The six stages

**Draft.** The record exists but has not been submitted. Only its owner (the dealer user or technician who created it) can edit or delete it. Not yet visible to an approver.

**Submitted.** The owner has finished editing and handed the record to whoever processes it next (Customer Care / Central Admin, depending on the module). The record becomes read-only to its owner from this point — edits go through the same re-submission path the module defines, not silent mutation of a submitted record.

**In Progress.** Someone is actively working the record — reviewing it, fulfilling it, scheduling it. A module may attribute this stage to a specific assignee field; that field is module-specific and not part of this shared workflow.

**Waiting Approval.** The work is done from the assignee's side and the record needs a decision from a role with Approve permission (`docs/PERMISSION_MODEL.md`). This stage exists specifically to make "needs a decision" queryable and dashboard-able across every module, rather than each module inventing its own approval flag.

**Completed.** Approved and finished. The record is not editable by ordinary roles past this point; reopening (if a module supports it) is an explicit transition back to In Progress, not a direct edit.

**Closed.** Terminal. Used once a Completed record has also cleared whatever a module considers final (invoicing, reconciliation, expiry) — modules that have no meaningful difference between "Completed" and "Closed" are free to treat them as the same instant, but the column still records both stage names so reporting stays consistent across modules.

## How a module may extend this

The six stages above are the shared minimum every module's dashboard and reporting can rely on. A module may:

- Insert additional stages between two shared ones (e.g. a Warranty claim might need a `Submitted → Pending Manufacturer Response → In Progress` sub-step) as long as the shared six remain identifiable as checkpoints a cross-module dashboard can still query.
- Skip a stage that doesn't apply (a module with no approval step may go straight from In Progress to Completed) — but should not repurpose a shared stage's name to mean something else.
- Add module-specific side effects on a transition (e.g. Parts Request triggers a notification on entering Waiting Approval) — that wiring lives in the module's own `services/`, not in this document.

What a module may not do: rename one of the six shared stages to mean something different, or omit the `status`/`record_status` distinction above.

## Who can move a record between stages

Stage transitions are themselves a permission, not a side effect of any role being able to edit a record. Which role can move a record into Waiting Approval, and which role can move it out (Approve), is defined per module in terms of the roles and permissions in `docs/PERMISSION_MODEL.md` — this document defines the stages, not who may trigger each transition.

## Verification

Documentation only — defines a field-naming and workflow convention for a future schema, and does not itself add, rename, or modify any column, table, or RLS policy.
