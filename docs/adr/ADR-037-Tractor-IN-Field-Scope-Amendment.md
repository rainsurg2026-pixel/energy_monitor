# ADR-037: Tractor IN Field Scope Amendment (reopens ADR-029)

## Status

**Accepted, implemented.** Approved by the repository owner via the
"Production Pilot Readiness" milestone instruction, which directed the
implementation described below directly (standing in for the separate
future implementation PR this document originally deferred to). The
`TractorInSyncService` guard is live on `main` (PR #60, squash commit
`f927018`, 2026-07-15) - see `docs/business/FIELD_OWNERSHIP_MATRIX.md`
and `docs/architecture/BUSINESS_INVARIANTS.md` for the corresponding
"RESOLVED" verdicts. This ADR is the formal resolution PR #57 and
PR #58 both named as a real conflict but did not resolve: it reopens
ADR-029's decision to extend Tractor IN's sync scope to `dealer_id`,
per this milestone's explicit instruction that an Accepted ADR
conflicting with an approved business rule gets an amendment, not a
silent implementation change.

## Problem

ADR-029 ("Quality Inspection Navigation Consolidation & Vehicle Master
Data Expansion") **deliberately** extended `TractorInSyncService`'s
write scope to include `dealer_id` (`docs/adr/README.md`'s own entry:
"Reopens ADR-012 to extend Tractor IN sync to
`product_code`/`wh_arrival_date`/`model`/`engine_number`/`dealer_id` on
both insert and update"). Confirmed in code
(`tractorInSyncService.ts` lines 204-208, 230-251): every sync run
writes `dealer_id` (and, since it predates ADR-029, `delivery_date`
too) unconditionally whenever the Tractor IN sheet's own columns are
non-blank, with no distinction between insert-time and a later,
already-operational vehicle.

This milestone's Field Ownership model states, without qualification:

- **Factory Domain (Tractor IN)** owns only Serial Number, Engine
  Number, Model, Product Code, WH Arrival Date.
- **Operational Domain (NTR)** owns Dealer, Delivery Date, Customer.

These two statements directly contradict ADR-029's accepted scope.
This is not a defect to patch quietly - `docs/architecture/
BUSINESS_INVARIANTS.md` (PR #58) already named it as a violation, but
naming a violation against an Accepted ADR is not the same as deciding
which one is now correct. That decision is this ADR.

## Decision

**Amend ADR-029: narrow Tractor IN's write scope back to the five
Factory Domain fields only - Serial Number, Engine Number, Model,
Product Code, WH Arrival Date. `dealer_id` and `delivery_date` are
removed from `TractorInSyncService`'s write scope, in a future,
separate implementation PR - not this one.**

Rationale for choosing this direction (over declaring the new business
rule wrong and keeping ADR-029 as-is):

1. **NTR is the only domain with a real customer-facing delivery
   event.** Tractor IN is a factory/logistics feed with no visibility
   into which dealer a unit is actually delivered to, or when - it can
   only report where a unit currently sits in the supply chain, which
   is exactly the Factory Domain's job, not the Operational Domain's.
2. **The Warranty Start = Delivery Date invariant depends on this.**
   PR #58 already demonstrated that leaving Tractor IN able to write
   `delivery_date` makes the Warranty Start date not immutable, in
   direct violation of a second stated invariant. Narrowing the scope
   is the one change that resolves both the Field Ownership conflict
   and the immutability violation together (`BUSINESS_WORKFLOW_
   CONSOLIDATION_AUDIT.md` §5's Write Precedence Matrix already
   identified this as the single highest-leverage fix).
3. **`dealer_id` before an NTR exists still needs a value.** A vehicle
   sitting in MSEAL Stock or Dealer Stock (pre-NTR) has no "Latest NTR"
   yet - Tractor IN's `dealer_id` is still the only signal available at
   that point (which physical dealer a unit was shipped to, distinct
   from who ultimately owns/delivers it). The amendment therefore is
   **narrow, not remove**: Tractor IN may still write `dealer_id` **only
   while no NTR exists for that serial**; once an NTR is registered,
   Tractor IN must never write `dealer_id` or `delivery_date` again for
   that vehicle. This is a refinement of "NEVER: Dealer" into "NEVER,
   once an NTR exists" - stated precisely so the future implementation
   PR has an unambiguous rule to build, not left to interpret "never"
   as "never even before delivery," which would leave pre-delivery
   vehicles with no dealer assignment at all.

**This is a decision, not an implementation.** The actual code change
(adding the "already has an NTR" guard to `TractorInSyncService`) is
explicitly deferred to a future PR, per this milestone's "No
implementation. No schema changes. No UI changes." instruction.

## Consequences

- ADR-029 is reopened for this one field-scope detail; every other
  decision it recorded (`product_code`/`wh_arrival_date`/`model`/
  `engine_number` sync, the nav consolidation) is untouched and remains
  Accepted as originally written.
- Unblocks the future implementation PR (`BUSINESS_WORKFLOW_
  CONSOLIDATION_AUDIT.md`'s roadmap item P0) with an unambiguous,
  already-decided target state, rather than that PR having to also
  make this call under time pressure.
- No behavior changes today. `TractorInSyncService` keeps writing
  `dealer_id`/`delivery_date` exactly as it does now until the deferred
  implementation PR lands.

## Recommendation

**APPROVE this amendment** (narrow Tractor IN's scope, `dealer_id` only
until an NTR exists). Implementation is a separate, future PR, gated on
this amendment being explicitly approved by a human first - the same
"Architecture Review + Explicit human approval before implementation"
discipline this platform already requires for every prior Foundation-
adjacent reopening (ADR-011 v1→v2, ADR-028 reopening ADR-017).

## Implementation Note (added post-merge, does not alter the decision above)

The repository owner approved and directed this implementation via the
"Production Pilot Readiness" milestone instruction - satisfying the human
approval gate this document required before the code change above could
land. `TractorInSyncService` now excludes `dealer_id` from its UPDATE
payload once a serial has a real, Active NTR registration, and never
writes `delivery_date` again after that point (PR #60, squash commit
`f927018`, 2026-07-15; 2 new tests cover both the guarded and
pre-NTR-unguarded paths). Every "future PR"/"deferred"/"today"
reference above describes the state as of this ADR's original proposal
and is left unedited as the historical record; this note is the only
part of the document reflecting what actually shipped.

## Verification

Grounded in `tractorInSyncService.ts` (full update-path logic,
`updateVehicleDeliveryInfo()`, both re-checked in this pass),
`docs/adr/README.md`'s ADR-029 entry, and `docs/architecture/
BUSINESS_INVARIANTS.md`/`BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`
(PR #58's prior findings, restated with a decision, not re-derived).
