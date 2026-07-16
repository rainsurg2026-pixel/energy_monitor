# Dashboard Model

Status: Sprint 7 (Core Business Domain). Documents reusable KPI definitions
— Completed Jobs, Pending Jobs, Overdue, Waiting Parts, Average Repair
Time, Open MQR, Warranty Claims, PM Completion — so each module's dashboard
widget computes the same KPI the same way instead of every module inventing
its own definition. This is a standard, not an implementation. No query,
aggregation, or chart exists because of this sprint.

## 1. Ownership

A module-specific dashboard widget is built from shared/ui/ chart/table
primitives and the module's own scoped data query, never a bespoke
reporting stack per module — this is already docs/BUSINESS_MODULE_STANDARD.md's
Reporting rule; this document supplies the specific KPI definitions that
rule operates over. The presentation primitive is the existing `KpiCard`
component (today inline in `dashboard/page.tsx`, flagged in
docs/ROADMAP.md Phase 2 as a future extraction target into shared/ui/).

## 2. Completed Jobs

Count of module records with `status` = Completed (or Closed, per
docs/MODULE_LIFECYCLE.md's note that a module may treat them as the same
instant) within a period, grouped by module. "Jobs" here means any
module's lifecycle-bearing record (an MQR, a PM Record, a Warranty claim,
etc.), not only MQR specifically.

## 3. Pending Jobs

Count of records not yet Completed/Closed — i.e. currently in Draft,
Submitted, In Progress, or Waiting Approval (docs/MODULE_LIFECYCLE.md).

## 4. Overdue

Count of Pending records (per §3) that have passed a module-defined
expected-completion threshold — e.g. a PM Record past its scheduled date,
or a Warranty claim past its SLA. The threshold itself is module-specific
and not fixed by this sprint; this document only standardizes the KPI's
name and the fact that it is computed from Pending records, not Completed
ones.

## 5. Waiting Parts

Count of records, in any module, currently blocked on a Parts Request
(docs/BUSINESS_WORKFLOW.md §6) that has not yet reached Completed. This is
a cross-module KPI — its input is Parts Request records, but it can be
displayed on MQR, PM Record, or Warranty's own dashboard to show how much
of that module's backlog is parts-blocked rather than work-blocked.

## 6. Average Repair Time

Average duration between a record entering Submitted (or In Progress, where
a module skips Submitted-as-meaningful) and reaching Completed. Primarily
relevant to MQR, PM Record, and Warranty — the three workflows in
docs/BUSINESS_WORKFLOW.md that represent actual repair/service work rather
than request or delivery processing.

## 7. Open MQR

Count of MQR module records not yet Closed (docs/BUSINESS_WORKFLOW.md §4).
Module-specific, unlike Completed Jobs/Pending Jobs above which aggregate
across all modules.

## 8. Warranty Claims

Count and stage breakdown of Warranty module records (docs/BUSINESS_WORKFLOW.md
§5) — e.g. how many are Pending Manufacturer Response vs. Waiting Approval
vs. Completed. Module-specific, mirroring Open MQR's shape for Warranty.

## 9. PM Completion

Rate of PM Record module records (docs/BUSINESS_WORKFLOW.md §2) reaching
Completed within their scheduled window, against the population of
Tractors due for PM in that window. Unlike the other KPIs above, this one
is a rate (completed ÷ due), not a raw count.

## 10. Scope

Who sees which KPI follows docs/PERMISSION_MODEL.md's Dashboard permission
column: Super Admin, Customer Care, and Viewer see platform-wide figures;
Dealer Admin and Dealer User see their own dealer's figures only; Technician
has no Dashboard permission today and sees none of these KPIs.

## 11. Known scale risk (carried forward, not resolved here)

docs/ARCHITECTURE.md §6 already flags that dashboard aggregation today runs
in JavaScript over up to 5000 rows pulled from Postgres, rather than in
SQL. Adding the KPIs above across eight modules increases the aggregation
surface; revisiting that strategy (e.g. moving aggregation into SQL) is a
decision for whoever implements this model, not something this
documentation sprint resolves.

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
