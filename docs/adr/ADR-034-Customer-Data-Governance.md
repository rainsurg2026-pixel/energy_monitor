# ADR-034: Customer Data Governance (v3.1, Phase 1.5)

## Status

**Proposed. Documentation only.** No code, no schema change, no
migration, no API, no UI. This ADR defines the governance rules a real
Customer entity requires before Phase 2 (backfill) of ADR-033 may
begin — several of the decisions below cannot be made by engineering
alone and are named explicitly as requiring human approval, not
resolved here.

## Problem

ADR-033 built the Customer schema (`customers`,
`customer_ownership_history`, `vehicles.customer_id`) but explicitly
deferred every governance question: identity resolution rules, who may
see a customer's PII, how long data is kept, how it is corrected or
deleted, and what must be audited. `docs/governance/SECURITY_BOUNDARY.md`
already flagged, twice, before this ADR existed: "Customer has no
documented retention/deletion rule anywhere today." Building the schema
without first defining these rules would let Phase 2 (backfill) and
Phase 3 (a real write path) proceed on assumptions no one has actually
approved — the same failure mode this platform's Constitution calls
"Honesty over completeness" exists to prevent.

**No data has been migrated. No application code reads or writes the
new schema.** This is the right moment to define these rules — before
any customer's real name, phone, or address is copied into `customers`,
not after.

## Relationship to existing documents

This ADR does not invent a governance framework from nothing:

- `docs/governance/SECURITY_BOUNDARY.md`'s PII taxonomy (Direct
  identifier / Indirect identifier / Sensitive-adjacent / Not PII) is
  reused as-is, not replaced. It already classifies "Customer name,
  phone number" as a **Direct identifier** and "Machine serial + owner
  (Customer)" as an **Indirect identifier**.
- `docs/governance/DATA_OWNERSHIP_MATRIX.md`'s existing Customer row
  (Owner Domain, Source of Truth, Consumers, Update Rules,
  Relationships, Lifecycle) is the starting point for the Ownership
  Model below, not restated in full.
- `src/lib/types.ts`'s `Role = 'SuperAdmin' | 'CentralAdmin' |
  'DealerAdmin' | 'DealerUser'` (verified directly against the current
  source, not `docs/PERMISSION_MODEL.md`'s own text alone, since that
  document names `Technician`/`Viewer` as "not implemented by this
  sprint" — confirmed still true; neither exists in `Role` today) is
  the actual, current role set this ADR's Access Control section is
  scoped against.
- `src/lib/dealerBranchScope.ts`'s `AuthorizationScope`/
  `resolveDealerScope()`/`canAccessDealerBranch()` (fail-closed,
  already governs every other dealer-scoped table) is the mechanism
  Dealer Visibility below extends, not a new scope system.
- `src/lib/types.ts`'s `AuditModule = 'mqr' | 'pm' | 'ntr' | 'knowledge'
  | 'pdi' | 'delivery'` and `record_audit_log` are the existing audit
  mechanism Audit Requirements below extends — the same widen-the-union
  pattern Knowledge/PDI/Delivery each used, not a new audit table.
- The Platform Constitution's Data Principles ("Soft-delete, never
  hard-delete, is the default for every record this platform considers
  evidence of what happened") is in direct, named tension with a
  possible legal erasure obligation — addressed explicitly below, not
  silently resolved in either direction.
- `docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md` (ADR-033) is the
  schema this ADR governs; not restated here beyond what each section
  needs to make its rule concrete.

## Decision

### 1. Customer identity

A `customers` row represents one real person or company, matched
primarily by **exact phone number**, per ADR-033's design. **This is a
named assumption, not a validated fact**: Thai households and small
businesses commonly share one phone number across several family
members or employees, and a person's number changes over their
lifetime. Phone-based matching will produce both false-positives
(two different people, one shared number) and false-negatives (one
person, two numbers over time) at a rate this document cannot
quantify without real data. **Recommendation: before Phase 2's backfill
matching logic is finalized, validate the phone-uniqueness assumption
against a sample of real NTR/PM/MQR records** (a data-quality
spike, not a legal question) — named here so it isn't silently
assumed correct at implementation time.

### 2. Ownership model

**"Owner" in this system means the current point of contact for a
machine — the party MSEAL and its dealers coordinate with for
delivery, service, and warranty matters. It is not a legal
title-of-ownership record.** This system has no integration with any
government vehicle-registration or title authority. A customer who has
sold their tractor privately, without informing the dealer, remains
the system's "Owner" until someone records a transfer. **This
distinction must be stated wherever "Owner"/"เจ้าของรถ" appears in a
customer-facing document or contract-adjacent context** — the term
itself is already frozen by `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`
and is not renamed here, but its scope of meaning is clarified: an
*operational* owner-of-record, not a *legal* titleholder. Confusing the
two is a real risk (see Legal & Operational Risks, below) — e.g. if a
warranty dispute or insurance claim ever treats MSEAL's "Owner" field
as legal proof of ownership.

### 3. Current owner

Exactly one nullable `vehicles.customer_id` per vehicle — the ADR-033
design. Always the present state; never itself a history. Written only
through `CustomerService.transferOwnership()` (Phase 3, not yet built)
or the Phase 2 backfill script — never a direct table write from any
other module, per Domain Principles' "One Aggregate, One Owner."

### 4. Ownership history

Append-only `customer_ownership_history`, one open row (`effective_to
IS NULL`) per vehicle at a time. Closes the "Owner History" gap
`docs/architecture/MACHINE_DATA_OWNERSHIP.md` already named. **Real
tension, named not resolved**: this table's entire value proposition
(showing a machine's full ownership timeline for service/warranty
context) requires retaining a *previous* owner's identity indefinitely,
while that previous owner may have a legal right to request their data
be forgotten once they are no longer a current customer. See Risk 7,
below — this is a Legal decision, not an engineering one.

### 5. Warranty relationship

**Warranty is Machine-keyed, never Customer-keyed.**
`calcWarranty()` (`lib/warranty.ts`) computes warranty status from
`vehicles.delivery_date` and the machine's own service history — it
does not read, and must never read, `customers` or
`customer_ownership_history`. **A change of ownership must never alter
a machine's warranty status, dates, or coverage.** This is stated
explicitly because it is the single most likely conflation a future
contributor could introduce (treating a new owner as a "new warranty
period" would be a real regression, not a feature) — any future
`CustomerService`/`transferOwnership()` implementation must not call
into warranty logic at all, in either direction.

### 6. Dealer visibility

**Proposed rule, requires business confirmation (see Recommendation
7)**: a dealer/branch may see a customer's full record precisely when
that dealer/branch currently has scope over at least one vehicle
linked to that customer (via the existing `vehicles.dealer_id`/
`branch_id`, resolved through `resolveDealerScope()`/
`canAccessDealerBranch()`) — **not** gated by `customers.dealer_id`
(the *originating* dealer) alone. This matters concretely: a customer
who bought from Dealer A but now has their machine serviced by Dealer
B under Dealer B's branch scope would, under this proposed rule, be
visible to Dealer B for service purposes. **This is a real business
policy question, not a technical default** — a dealer network may
consider a customer relationship commercially exclusive to the
originating dealer, in which case Dealer B should see only the minimum
needed for the service transaction (e.g. name and phone, not full
address/ID document), not the full record. Not decided here.

### 7. MSEAL visibility

Using the actual current `Role` set (`SuperAdmin`/`CentralAdmin`/
`DealerAdmin`/`DealerUser` — `Technician`/`Viewer` are not implemented
in code today, confirmed against `src/lib/types.ts`):

| Role | Proposed access |
|---|---|
| `SuperAdmin`, `CentralAdmin` | Full record, any customer, any dealer |
| `DealerAdmin`, `DealerUser` | Full record, scoped to customers linked to a vehicle within their dealer/branch scope (Dealer Visibility, above) |

No role sees an unscoped, platform-wide customer list. This mirrors
every other dealer-scoped table in this platform and requires no new
mechanism — only a new `canViewCustomerPII`/`canEditCustomer` predicate
pair in `src/lib/scope.ts`, to be added in Phase 3 (not this ADR).

### 8. PII classification

Reusing `SECURITY_BOUNDARY.md`'s existing taxonomy directly:

| Field(s) | Class |
|---|---|
| `phone`, `display_name`/`first_name`/`last_name` | Direct identifier |
| `address`, `subdistrict`/`district`/`province`/`postal_code` combined with a linked machine serial | Indirect identifier |
| `customer_type`, `customer_title`, `dealer_id`, `source_module` | Not PII |

**Gap found, not resolved by this ADR**: NTR's existing
`photo_customer_id_url`/`photo_customer_id_attachment_id` (a photograph
of a government-issued ID card, already captured today, unrelated to
this schema) does not fit cleanly into any of `SECURITY_BOUNDARY.md`'s
four existing classes — a government ID photo is materially more
sensitive than a plain Direct identifier. **Recommendation: this
taxonomy needs a fifth class** (e.g. "Government-issued identifier
document") **or an explicit statement that ID photos inherit the
strictest handling available today** — a decision for whoever owns
`SECURITY_BOUNDARY.md`, not invented unilaterally here.

### 9. Data retention

**Genuinely unresolved — the single largest open item in this ADR.**
Engineering cannot set a retention period unilaterally: it depends on
Thailand's Personal Data Protection Act (PDPA) requirements (which this
document does not attempt to interpret — that is Legal's role, not
engineering's), Mahindra's own corporate record-retention policy, and
real business needs (a warranty dispute may require producing service
history years after a machine is sold). **No retention period is
proposed here.** See Recommendation 1 and 2, below.

### 10. Data deletion

Ordinary deletion follows this platform's universal, Constitution-level
rule: **soft-delete only** (`record_status = 'Deleted'`), never a hard
`DELETE`, identical to every other table. This does not by itself
satisfy a PDPA-style "right to erasure," which may require the
underlying PII values themselves to be irrecoverable, not merely
hidden behind a status flag. **Proposed, not yet approved**: a distinct
second operation — **anonymization** — separate from soft-delete: an
audited, rare operation that overwrites `first_name`/`last_name`/
`display_name`/`phone`/`address`/`subdistrict`/`district`/`province`/
`postal_code` with a fixed redacted placeholder while leaving the row's
`id` and every FK relationship (`vehicles.customer_id`,
`customer_ownership_history.customer_id`) intact, so machine/warranty
history integrity is preserved without retaining the erased person's
actual PII. **This mechanism requires Legal + Architecture Review
approval before design detail is written** (Recommendation 3) — it is
named here as the shape of a solution, not approved as one.

### 11. Data correction

Customer has no login and is never a system user (frozen rule,
`docs/ENTITY_MODEL.md` §3, restated by ADR-033) — there is no
self-service "edit my data" path today, and none is proposed by this
ADR. All corrections happen through MSEAL staff (a dealer, Customer
Care/`CentralAdmin`, or a future Technician role) editing the record via
`CustomerService.updateCustomer()` (Phase 3, not yet built), never a
direct table write. **Gap named, not solved**: if Thai PDPA grants a
data subject a right to request access to or correction of their own
data (a real possibility this document does not resolve), this
platform has no channel for a customer to make that request directly —
today it would have to be a manual, offline process routed through
Customer Care. **Recommendation 6**, below.

### 12. Access control

Extends the existing, already-fail-closed
`AuthorizationScope`/`resolveDealerScope()`/`canAccessDealerBranch()`
mechanism (`src/lib/dealerBranchScope.ts`) — Customer access is scoped
through the vehicle(s) a customer is currently linked to, exactly as
every other dealer-scoped table already works. No new, parallel scope
system is introduced. New predicates (`canViewCustomerPII`,
`canEditCustomer`, mirroring `canApproveDelivery`'s shape) are named
here as the target shape but implemented in Phase 3, not this ADR.

### 13. Audit requirements

Every `customers`/`customer_ownership_history` create, update, and
ownership transfer must write to the existing `record_audit_log`
through the existing `logAuditEvent()`/`logAuditEvents()` path — this
requires widening `AuditModule` (`src/lib/types.ts:383`, currently
`'mqr' | 'pm' | 'ntr' | 'knowledge' | 'pdi' | 'delivery'`) to add
`'customer'`, the same widen-the-union move Knowledge/PDI/Delivery each
made, not a new audit mechanism. **A real detail named, not solved
here**: an audit log entry for a customer update necessarily contains
the PII values that changed. If a customer is later anonymized (Data
Deletion, above), an unredacted audit trail would be a residual PII
leak that defeats the point of anonymizing the source row.
**Recommendation: any anonymization operation must anonymize that
customer's own `record_audit_log` entries in the same operation**, not
leave them as a separate, forgotten copy — the exact mechanism is a
Phase 3+ implementation detail, named as a requirement here.

## Legal & Operational Risks

1. **PDPA applicability has not been assessed by Legal.** This document
   does not interpret Thai data-protection law — that determination
   belongs to Legal/Compliance, not engineering. **Blocks Phase 2**
   (backfill) per ADR-033's own precondition, restated here with more
   specificity.
2. **No retention period exists.** Engineering cannot invent one without
   Legal/Business input (Decision 9).
3. **No data-subject access/correction/erasure channel exists
   operationally** — Customer has no login, and no manual process is
   formally documented today (Decisions 11-12).
4. **Government ID photo is already being captured (via NTR) at a
   sensitivity tier this platform's taxonomy doesn't yet name**
   (Decision 8) — a real, pre-existing gap this ADR surfaces rather than
   introduces.
5. **Cross-dealer visibility is a genuine business-policy question**
   (Decision 6), not just a technical scoping default — could carry
   competitive-sensitivity implications between dealers if decided
   incorrectly.
6. **"Owner" terminology risk** (Decision 2): if MSEAL's operational
   "Owner" field is ever treated informally as legal proof of title
   (by a dealer, a customer, or in a dispute), that is a
   misrepresentation this system was never designed to support.
7. **Ownership History retention directly conflicts with a possible
   erasure right** for a customer who is no longer a current owner
   (Decision 4) — the clearest single tension in this document between
   business value (service/warranty history) and a data subject's
   rights.
8. **Constitution vs. legal-erasure tension** (Decision 10): this
   platform's own "soft-delete, never hard-delete" principle, applied
   uncritically to Customer, could itself become a compliance liability
   if a real erasure obligation exists and is not met by a status flag
   alone.

## Recommend: unresolved decisions requiring human approval

1. **Commission a PDPA (Thailand Personal Data Protection Act)
   applicability review from Legal**, scoped specifically to the
   `customers`/`customer_ownership_history` design in ADR-033 — before
   Phase 2 (backfill) is scheduled.
2. **Approve a named retention period** for `customers` (active
   relationship) and `customer_ownership_history` (historical rows),
   which may legitimately differ from each other.
3. **Approve the anonymization mechanism's design** (Decision 10) via
   Legal + Architecture Review before its implementation detail is
   written — this ADR proposes its shape, not its approval.
4. **Decide the cross-dealer visibility policy** (Decision 6): does a
   servicing dealer see a customer's full record, or a minimum subset,
   when that customer originated at a different dealer?
5. **Classify government-ID-photo handling** (Decision 8): extend
   `SECURITY_BOUNDARY.md`'s PII taxonomy with a fifth tier, or explicitly
   rule that ID photos inherit the platform's strictest existing
   handling — someone must own this decision.
6. **Assign an owner for data-subject access/correction/erasure
   requests** (Decision 11) — Customer Care (`CentralAdmin`) is the
   natural candidate given its existing role, but this needs explicit
   confirmation, not an assumption.
7. **Confirm or refute the phone-as-primary-identity-key assumption**
   (Decision 1) against a real data sample before Phase 2's matching
   logic is finalized — a data-quality validation step, not a legal one.

## Consequences

- No behavior, schema, or code change results from this ADR by itself.
- **Phase 2 (backfill) of ADR-033 remains blocked** until
  Recommendations 1-3 above are resolved — this ADR makes that
  precondition concrete rather than a vague "Legal sign-off needed"
  line.
- Phase 3 (`CustomerService`, API routes, RBAC predicates) has a
  governance reference to build against: Access Control, MSEAL
  Visibility, and Audit Requirements above define its target shape.
- `SECURITY_BOUNDARY.md`'s PII taxonomy has a named, real gap
  (government ID photos) that predates this ADR and is not fixed by it.

## Verification

Grounded directly against current source, not assumption:
`src/lib/types.ts` (`Role`, `AuditModule` — both read in full, not
recalled from memory), `src/lib/dealerBranchScope.ts`,
`docs/governance/SECURITY_BOUNDARY.md`'s PII table,
`docs/governance/DATA_OWNERSHIP_MATRIX.md`'s Customer row,
`docs/PERMISSION_MODEL.md` (cross-checked against `Role` and found
still accurate — `Technician`/`Viewer` genuinely unimplemented),
`docs/ENTITY_MODEL.md` §3 ("Customer is not a system user"),
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md` (Owner/เจ้าของรถ frozen
term), `lib/warranty.ts`'s `calcWarranty()` signature (Machine-keyed,
confirmed no Customer reference), and `docs/architecture/
CUSTOMER_OWNERSHIP_PROPOSAL.md`/ADR-033 (the schema this ADR governs).
No rule above was invented without a corresponding existing document,
existing code, or an explicitly named, unresolved gap.
