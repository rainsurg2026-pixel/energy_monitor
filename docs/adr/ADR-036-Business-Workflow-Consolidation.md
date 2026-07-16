# ADR-036: Business Workflow Consolidation (v3.1)

## Status

**Accepted - P0/P1 implemented.** Audit only at the time of writing (no
code, schema, migration, API, or UI change in this ADR itself). Full
findings in `docs/architecture/BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`
and the companion `docs/architecture/BUSINESS_INVARIANTS.md`; this ADR
records the audit's existence and headline conclusion, not the detail.
Of the 8-item recommendation below, **P0** (the Tractor IN scope guard)
and **P1** (formally reopening ADR-029) are now done - see ADR-037
(Accepted, implemented) and PR #60. MQR NTR auto-fill, machine-type
classification, the Constitutional Amendment, and the future
Troubleshooting/Parts-Used/Knowledge automation chain remain open, not
documentation tasks.

## Problem

ADR-035 audited the platform against the tractor lifecycle at the
workflow/navigation level. This milestone asked for a sharper pass:
precise, field-level source-of-truth rules for Tractor IN, NTR, PM, and
MQR, and explicit verification of Warranty Start/Delivery Date
immutability. That level of precision surfaces something ADR-035's
workflow-level pass could not: **the platform's current code actively
contradicts the newly-stated Tractor IN field-scope rule, by design,
via an already-Accepted architecture decision (ADR-029).**

## Decision

Verified every stated business rule directly against current source
(`tractorInSyncService.ts`, `ntrPostCreateOrchestration.ts`,
`lib/db.ts`, `api/records/route.ts`, `ntr_records`'s status field).
Full field-by-field verdicts in `BUSINESS_INVARIANTS.md`; full audit
deliverables (workflow audit, sidebar recommendation, source-of-truth
matrix, business rule matrix, write precedence matrix, screen flow
matrix, automation roadmap, remaining gaps, prioritized plan) in
`BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`.

**Headline finding**: `vehicles.dealer_id` is written exclusively by
the Tractor IN sync today - NTR never writes it. `vehicles.
delivery_date` is correctly set by NTR at registration, but the Tractor
IN sync can silently overwrite it again on any later sync run
(`if (value) updatePayload[key] = value;`, no "already NTR-activated"
guard). Both are the exact two fields this milestone's stated rule says
Tractor IN must never carry. This is not a bug introduced by accident -
ADR-029 *deliberately* extended Tractor IN's sync scope to include
`dealer_id` ("Reopens ADR-012 to extend Tractor IN sync to ...
`dealer_id` on both insert and update"). **A real, named conflict
between an Accepted architecture decision and a newly-clarified
business rule** - flagged for explicit resolution, not silently
patched.

**Confirmed already-solved, no new work needed**: Repair and MQR Closed
are already the `'Repaired'`/`'Closed'` values `StatusValue` has always
had - the business lifecycle's "Repair → MQR Closed" segment requires
zero implementation.

**Confirmed gaps, not violations** (nothing to fix, something to build,
later): MQR has no NTR auto-fill for Dealer/Delivery Date/Customer; no
machine-type classification (Customer Machine/Dealer Stock/MSEAL
Stock/Demo Machine) exists; "Approved NTR" has no backing approval
workflow (`ntr_records.record_status` is only `Active`/`Deleted`).

## Recommendation

**8-item prioritized plan** (full detail, `BUSINESS_WORKFLOW_
CONSOLIDATION_AUDIT.md` §9), starting with **P0: add a guard to the
Tractor IN sync so it stops writing `dealer_id` and stops re-writing
`delivery_date` once an NTR registration has activated warranty for
that vehicle** - the single fix that resolves the two confirmed
Source-of-Truth and two confirmed Business Rule violations together,
since they share one root cause. **P1: formally reopen ADR-029's
`dealer_id` sync-scope decision** rather than silently reverting it.
Every other item (MQR auto-fill, machine classification, a
Constitutional Amendment elevating the confirmed-holding invariants
into `PLATFORM_CONSTITUTION.md`, and the explicitly-deferred
Troubleshooting/Parts Used/Knowledge automation chain) is later,
dependent work - none implemented here.

## Consequences

- No behavior, schema, or code change from this ADR alone.
- Names a real, concrete conflict between ADR-029 and this milestone's
  business rules that must be explicitly resolved (P1) before the P0
  fix can be considered complete architecture-wise, not just a data
  patch.
- Does not reopen or contradict ADR-035 - extends it with field-level
  precision ADR-035's workflow-level pass did not have.

## Verification

See `docs/architecture/BUSINESS_INVARIANTS.md` and
`docs/architecture/BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`'s own
Verification sections for the complete list of source files checked
directly to ground every finding above.
