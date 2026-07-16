# Customer Ownership — Compliance Decision Register

**Status: tracking document, not a decision itself.** Converts every
unresolved governance item named in `docs/adr/ADR-034-Customer-Data-
Governance.md` into one tracked decision, each with a single owner, a
required approver, and an explicit gate on the ADR-033 implementation
phase it blocks. This register is updated in place as each decision
resolves — it is not re-created per phase.

## Relationship to existing documents

`docs/governance/DECISION_MATRIX.md` answers a different, permanent
question ("which domain/layer has authority to decide an architecture
change") and is not restated or duplicated here. This register answers
a narrower, initiative-scoped question: for the Customer Ownership
initiative specifically, which concrete decisions are still open, who
owns closing each one, and what does each one block. `docs/adr/
ADR-034-Customer-Data-Governance.md` is the source of every item below;
this document does not re-derive governance rules, only tracks their
resolution status.

## Register

| ID | Title | Owner | Required Approver | Status | Blocking Phase | Dependency Class |
|---|---|---|---|---|---|---|
| CDR-001 | PDPA applicability review | Legal | Legal/Compliance | **Open** | Phase 2 | Legal, Compliance |
| CDR-002 | Retention period approval | Legal + Business | Legal, Business owner | **Open** | Phase 2 | Legal, Business |
| CDR-003 | Anonymization mechanism approval | Architecture + Legal | Legal, Architecture Review | **Open** | Phase 2 (precondition), Phase 3 (implementation gate) | Legal, Engineering |
| CDR-004 | Cross-dealer visibility policy | Business (Dealer Network owner) | Business owner | **Open** | Phase 3 | Business |
| CDR-005 | Government ID photo PII classification | `SECURITY_BOUNDARY.md` owner | Compliance | **Open** | Phase 3 (advisory only today — no code path links Customer to the photo yet) | Compliance, Business |
| CDR-006 | Data-subject request process owner | Business + Customer Care | Business owner | **Open** | Phase 2 | Operational, Business |
| CDR-007 | Phone-as-identity-key validation | Engineering | Engineering (data-quality spike, not an approval) | **Open** | Phase 2 | Engineering |
| CDR-008 | "Owner" ≠ legal title clarification | Engineering (documented) | None required | **Resolved** (ADR-034 §2) | None | Engineering |

### CDR-001 — PDPA applicability review

**Description**: Thailand's Personal Data Protection Act may govern
`customers`/`customer_ownership_history`. No assessment has been
performed. Engineering does not interpret data-protection law.
**Risk**: Backfilling real PII (Phase 2) before this review completes
risks processing personal data without a confirmed lawful basis or
required safeguards. **Recommendation**: commission the review now;
treat its outcome as binding on CDR-002 and CDR-003's final shape.

### CDR-002 — Retention period approval

**Description**: No retention period is defined for either table.
Engineering cannot set one — it depends on CDR-001's outcome plus
Mahindra's own corporate record-retention policy and real business
needs (warranty-dispute evidence, tax/audit requirements). **Risk**:
indefinite retention by default is itself a compliance posture, not a
neutral non-decision — silence here is a choice, not a deferral.
**Recommendation**: Legal + Business jointly set one period for active
customers and one (possibly different) for historical
`customer_ownership_history` rows, before Phase 2.

### CDR-003 — Anonymization mechanism approval

**Description**: ADR-034 proposes (not approves) a redaction-in-place
operation as the mechanism for a possible erasure request, distinct
from this platform's universal soft-delete rule. **Risk**: writing
real PII into `customers` via backfill with no approved erasure
mechanism means a legitimate request received the day after Phase 2
runs has no defined way to be honored. **Recommendation**: approve the
mechanism's *design* (not its full implementation) before Phase 2;
implement it no later than Phase 3, before any customer-facing surface
exists.

### CDR-004 — Cross-dealer visibility policy

**Description**: When a customer's vehicle is currently serviced by a
dealer different from the one that originated the relationship, does
that servicing dealer see the customer's full record, or a minimum
subset? **Risk**: deciding this unilaterally in code risks either
over-exposing PII across dealer boundaries or under-serving a
legitimate service transaction — this is a business/commercial
question, not a technical default. **Recommendation**: Business
(Dealer Network owner) decides before Phase 3's `canViewCustomerPII`
predicate is implemented — this is a hard input to that predicate's
design, not a detail that can be revised freely afterward without
touching every dealer's existing access pattern.

### CDR-005 — Government ID photo PII classification

**Description**: NTR already captures a government-ID photo today,
independent of the Customer entity; `SECURITY_BOUNDARY.md`'s four-class
PII taxonomy has no tier for it. **Risk**: low today (no code path
links `customers` to this photo), but real the moment any future work
aggregates NTR's attachment onto a Customer 360 view. **Recommendation**:
non-blocking for Phase 2/3 as currently scoped; must be resolved before
any feature links Customer to the ID photo directly.

### CDR-006 — Data-subject request process owner

**Description**: Customer has no login (frozen rule) — there is no
self-service channel for a data subject to request access, correction,
or erasure. **Risk**: the moment Phase 2 backfill writes a real
person's PII into `customers`, a request could arrive with no
documented process to route it. **Recommendation**: Business assigns
an owner (Customer Care/`CentralAdmin` proposed in ADR-034, not yet
confirmed) and a manual interim process, before Phase 2 — this is an
operational-readiness gate, not a technical one.

### CDR-007 — Phone-as-identity-key validation

**Description**: ADR-033's backfill design matches customers by exact
phone number first. This assumption (shared family/business phones,
numbers changing over time) has not been validated against real data.
**Risk**: false-positive merges (two people treated as one) and
false-negative splits (one person treated as two) at an unknown rate.
**Recommendation**: Engineering runs a data-quality spike against a
sample of real NTR/PM/MQR records before finalizing Phase 2's matching
logic — this is the one item on this register Engineering can resolve
without external approval, tracked here only so it isn't silently
skipped.

### CDR-008 — "Owner" ≠ legal title clarification (Resolved)

**Description**: ADR-034 §2 already states, as a documentation
decision requiring no further approval, that MSEAL's "Owner" field is
an operational point-of-contact, never a legal title record, and that
`calcWarranty()` must never be Customer-keyed. **Status**: resolved by
ADR-034 itself — included here only for completeness, so this register
is a genuinely complete conversion of every item ADR-034 raised, not a
selective one.

## Implementation Gates

### Phase 2 — Backfill

**Gate**: CDR-001, CDR-002, CDR-003 (design approval), CDR-006, and
CDR-007 must all be **Resolved** before this phase may begin.

**Status: BLOCKED — 5 of 5 gating decisions still Open.**

**Recommendation: WAIT.**

### Phase 3 — CustomerService + APIs

**Gate**: Phase 2 must be complete (its own gate resolved and the
backfill executed and reviewed), **and** CDR-004 must be Resolved.
CDR-005 is advisory only at this phase (no blocking dependency exists
in the current design) but should be tracked, not forgotten.

**Status: BLOCKED — transitively blocked by Phase 2, and CDR-004 is
independently still Open.**

**Recommendation: WAIT.**

### Phase 4 — UI + Cutover

**Gate**: Phase 3 must be complete and running clean in production for
a full reporting cycle (ADR-033's own Rollout Strategy — a soak
period, not a fixed calendar date), with no new PII/legal issue
surfaced during that period.

**Status: BLOCKED — transitively blocked by Phase 2 and Phase 3.**

**Recommendation: WAIT.**

## Summary

No implementation phase is clear to proceed today. Every blocker is
either a Legal/Compliance decision (CDR-001, CDR-002, CDR-003), a
Business decision (CDR-002, CDR-004, CDR-006), or a bounded Engineering
task (CDR-007) — none is an open-ended engineering design question.
The schema built in ADR-033 Phase 1 remains live, empty, and read/write
by no application code, so nothing is at risk while these decisions are
pending. Re-run this register's Status column check the moment any
CDR item is resolved — a phase's gate should be re-evaluated
individually, not held open past the point its specific blockers clear.

## Verification

Every decision above traces to a specific, named section of
`docs/adr/ADR-034-Customer-Data-Governance.md` (cited inline) — none is
invented here. Phase definitions and their dependency order match
`docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md`'s Migration Strategy
and Rollout Strategy sections (ADR-033) exactly; this register does not
redefine what each phase contains, only gates when it may start.
