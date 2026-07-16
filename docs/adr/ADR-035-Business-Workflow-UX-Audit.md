# ADR-035: Business Workflow & UX Audit (v3.1)

## Status

**Accepted - findings largely addressed.** Audit only at the time of
writing (no code, schema, migration, API, or UI change in this ADR
itself). Full findings in `docs/architecture/
BUSINESS_WORKFLOW_UX_AUDIT.md`; this ADR records the audit's existence,
scope, and headline recommendations, not the detail itself. Of the five
workstreams recommended below, four are now implemented (PR #60,
"Production Pilot Readiness," 2026-07-15): the delivery-date overwrite
risk (via ADR-037's guard), the small nav/label fixes (duplicate PIP
entry removed as a side effect of hiding all Coming Soon items, Import
Inspection naming corrected), and the larger nav restructuring
(Vehicle Lookup elevated, NTR moved to Delivery Lifecycle). **Still
open**: workstream 2, deciding the fate of MSEAL Stock/Ship to Dealer/
Dealer Stock, and workstream 3, deciding Troubleshooting's fate -
neither is a documentation task; both need a business decision before
any implementation.

## Problem

Prior audits (ADR-032's Foundation Hardening) evaluated the platform by
domain/module ownership - correctly, and that audit's findings stand.
No audit had yet evaluated the platform against the real, single
lifecycle a business user actually experiences: a tractor moving from
import through inspection, stock, delivery, warranty, ownership,
maintenance, quality problems, and (eventually) knowledge capture. This
milestone asked specifically for that lens, not a module-by-module
review.

## Decision

Reviewed every real (non-Coming-Soon) route and nav entry against the
brief's own 12-stage business flow, verified directly against current
source (`navConfig.ts`, the route tree, `calcWarranty()`,
`tractorInSyncService.ts`, `ntrPostCreateOrchestration.ts`,
`delivery/types.ts`). Full detail: `docs/architecture/
BUSINESS_WORKFLOW_UX_AUDIT.md`.

**Headline findings**:

1. **A real business-rule risk, not previously flagged**: the Tractor
   IN sync can silently overwrite `vehicles.delivery_date` (the
   Warranty Start = Delivery Date field) after an NTR registration has
   already set it correctly - no guard exists today. Highest-priority
   item in the roadmap.
2. **Three consecutive lifecycle stages are dead or unmodeled**: MSEAL
   Stock and Dealer Stock have schema (`delivery_records`, ADR-027) but
   zero UI since ADR-031's cleanup (already known debt, now reframed
   against the business flow); Ship to Dealer has no model at all.
3. **Troubleshooting, as the business flow describes it (auto-created
   from a completed MQR), does not exist** - only a Coming Soon nav
   placeholder with no backing table or logic.
4. **Navigation groups by entity/domain, not lifecycle** - most visibly,
   Machine Passport (a lifecycle-spanning lookup) and NTR (a one-time
   workflow step) are grouped together under "Machines" for no reason
   beyond both concerning a vehicle.
5. **Two small, real nav defects**: PIP has two Coming Soon entries
   (Service > Campaigns and Engineering Intelligence); the Import
   Inspection domain (ADR-028's own corrected term) is labeled "Quality
   Inspection" in the nav, and neither term is frozen in
   `DOMAIN_LANGUAGE_STANDARD.md`.
6. **Two invariants explicitly verified and confirmed holding**:
   "Vehicle is the warranty identity" (no customer reference anywhere
   in `calcWarranty()`) and "Vehicle Master remains the single source
   of truth" (every domain reads `vehicles` by FK/serial, never forks
   its own copy).

## Recommendation

**Five prioritized, independent workstreams** (full detail and
ordering in the audit document's §9):

1. Fix the delivery-date overwrite risk (small, scoped, no redesign).
2. Decide the fate of the dead MSEAL Stock/Ship to Dealer/Dealer Stock
   stages - revive or formally retire, not leave silently dead.
3. Decide Troubleshooting's fate - build the real workflow or stop
   presenting it as an active commitment.
4. Small nav/label fixes (merge duplicate PIP entry, rename Import
   Inspection, clarify Quality Cases/MQR label, reclassify the
   Warranty placeholder) - `navConfig.ts`/locale only, zero
   architecture impact.
5. Larger nav restructuring (elevate Vehicle Lookup, move NTR into a
   Delivery Lifecycle group) - zero architecture impact, but changes
   every role's navigation muscle memory, so it ships as its own
   reviewed change, not bundled into the small fixes above.

None of these five is implemented by this ADR. Each requires its own
future PR and explicit approval, matching this platform's own
established practice for every prior domain change.

## Consequences

- No behavior, schema, or code change from this ADR alone.
- Gives the next several PRs a shared, business-lifecycle-grounded
  reference instead of each one rediscovering the same gaps
  independently.
- Does not reopen or contradict ADR-027/030/031/032 - it cites their
  already-established findings and adds the lifecycle framing plus two
  findings (the delivery-date overwrite risk, and Ship to Dealer's
  total absence) neither of those audits surfaced.

## Verification

See `docs/architecture/BUSINESS_WORKFLOW_UX_AUDIT.md`'s own Verification
section for the complete list of source files read directly to ground
every finding above.
