# ADR-033: Customer Ownership (v3.1)

## Status

**Proposed, Phase 1 (schema) implemented.** The design below was
approved by the repository owner without redesign. This PR implements
only Phase 1 of the Migration Strategy — schema, additive-only, zero
data written. Phases 2 (backfill), 3 (dual-run), and 4 (cutover) remain
unimplemented, each its own future PR requiring its own approval,
per the Rollout Strategy already specified in
`docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md`. Full design in that
document; this ADR records the decision and its scope, not the detailed
design itself.

## Implementation Note (Phase 1, this PR)

Applied directly against the live schema (project `lhlzzxjayywqhqtjzfiu`,
migration `20260715054732_customer_ownership_schema_v3_1`, additive-only,
zero rows written by the migration itself — verified: `customers` 0
rows, `customer_ownership_history` 0 rows, `vehicles.customer_id` 0
non-null out of 331 vehicles). Created exactly the two tables and one
column the design specifies — `customers`, `customer_ownership_history`,
and a nullable `vehicles.customer_id` FK — with RLS enabled and a
permissive `ALL`/`true` policy on both new tables, the same pattern
already used by every other table in this platform (`inspections_all`,
`delivery_records_all` confirmed as the precedent before writing this
migration). No `CustomerService`, no API route, no UI, no backfill, and
no existing table's column touched beyond the one additive FK on
`vehicles`. Supabase security/performance advisors show no new issue
class beyond the two expected `rls_policy_always_true` INFO/WARN entries
every other table in this platform already carries (68 total across the
platform; these two tables contribute 2 of them, not a new pattern).

## Problem

ADR-032 (v3.0 Foundation Hardening) confirmed every named business
domain has a single owner — except Customer, which does not exist as a
domain at all. Customer identity today is three independent, unlinked
free-text captures (`ntr_records.customer_*`, `pm_records.customer_
name`/`customer_phone`, `records.customer_name`/`customer_phone`), with
no `customers` table and no `vehicles.customer_id` FK, despite:

- The frozen Architecture Blueprint (ch.02, ch.17) already naming
  Customer as one of the platform's bounded contexts.
- `docs/ENTITY_MODEL.md`/`docs/ENTITY_RELATIONSHIP.md` (Sprint 7)
  already specifying a minimal `customers` table and a nullable
  `Tractor.customer_id`, never built.
- `docs/architecture/MACHINE_DATA_OWNERSHIP.md` (Machine Digital
  Passport v1.2) already naming this exact gap explicitly — "Ownership
  has no identity table," "solving them is a Customer/Owner Identity
  Platform-sized decision, out of scope" for that PR.

Customer Ownership is the platform's own next milestone (ADR-032 §10's
Roadmap v3.1) precisely because CRM, Service Operations analytics, and
a real customer-facing history all depend on Customer existing as one
real, de-duplicated entity rather than three free-text snapshots.

## Decision

Design (not yet build) a new Customer bounded context: one `customers`
table (aggregate root), one `customer_ownership_history` table (closes
Machine Passport's named "Owner History" gap), one nullable, additive
`vehicles.customer_id` column, and one `CustomerService`/
`CustomerRepository` pair in a new `src/features/customer/` module —
the same three-file shape every domain except MQR already uses.

**No existing domain is redesigned.** Vehicle remains the vehicle
master. Machine Passport remains the only Vehicle 360. Import
Inspection, NTR, PM, Warranty, and MQR remain independent, each keeping
its own `customer_name`/`customer_phone` columns unchanged, forever, as
historical per-visit snapshots. The only touch to an existing table is
one additive, nullable column on `vehicles`.

Full domain model, ER diagram, migration strategy (4 phases: schema →
human-reviewed backfill → dual-run → cutover), backward-compatibility
guarantees, and impact analysis (API/DB/UI/Workflow): see
`docs/architecture/CUSTOMER_OWNERSHIP_PROPOSAL.md`.

**Reuse confirmed, not duplicated**: `shared/master-data/lookup/
customerType.ts`, `shared/master-data/lookup/customerTitle.ts`,
`shared/master-data/address/ThailandAddressResolver.ts` (ADR-022), the
`VEHICLE_SUMMARY_PROVIDERS` registry's existing merge mechanism, and
`MasterDataResolver`'s resolution-method vocabulary (its class itself
is not reused — it is deliberately read-only/never-creates, wrong shape
for an operationally-created entity).

## Risks (full detail in the proposal document)

1. Backfill data quality — mitigated by exact-phone-first + unique-
   fuzzy-only matching and a human-reviewed exception report, never a
   silent merge.
2. **PII/retention — genuinely unresolved.** `docs/governance/
   SECURITY_BOUNDARY.md` already flags Customer name/phone as a direct
   identifier with no retention/deletion rule anywhere in the platform.
   This ADR does **not** resolve that; it requires Legal/Compliance
   sign-off before the schema implementation PR is opened.
3. Dual-source-of-truth window during the migration's dual-run phase —
   gated on backfill completion, not a calendar date.
4. `vehicles` is Foundation-Freeze-adjacent (Blueprint ch.20's Machine-
   as-aggregate-root). A nullable additive column doesn't change
   Machine's aggregate-root status, but should still go through the
   same explicit-reopening care ADR-011/ADR-014 used for their own
   frozen layers.
5. **Constitution phrasing tension, named not violated**: the
   Constitution's "Machine is the center of the platform" principle
   reads as if every entity is Machine-subordinate; Customer (like
   Dealer already) inverts this locally — a Customer owns many
   Machines. Not a violation (Dealer is precedent) but flagged for a
   future Constitutional clarification, not resolved by this ADR.

## Recommendation

**PROCEED**, conditional on Legal/Compliance PII sign-off before any
backfill (Phase 2) work, and explicit human approval of each subsequent
phase before it is implemented. No redesign of any existing domain
required. Phase 1 (this PR) recommendation: **PASS** — see the schema
implementation PR's own Production Readiness Assessment for evidence.

## Consequences

- **No behavior change from Phase 1** — two new, empty tables and one
  new, all-null column exist in production; nothing reads or writes
  them yet. Every existing domain's behavior is unchanged.
- Unblocks CRM and Service Operations analytics work that depends on a
  real Customer identity, per ADR-032's own Roadmap v3.1 framing —
  once later phases build on this foundation.
- The next PR (Phase 2, backfill) requires the Legal/Compliance PII
  sign-off named in Risk 2 before it is opened — not a formality, a
  precondition on scheduling that work at all.

## Verification

Grounded in live schema queries (`information_schema.columns`/`.tables`
against project `lhlzzxjayywqhqtjzfiu`, confirming zero `customers`
table and zero `vehicles.customer_id` column exist today), direct
reads of `docs/CORE_DOMAIN_MODEL.md`/`ENTITY_MODEL.md`/
`ENTITY_RELATIONSHIP.md`/`DATA_OWNERSHIP_MATRIX.md`/`MACHINE_DATA_
OWNERSHIP.md`/`SECURITY_BOUNDARY.md`/`DOMAIN_LANGUAGE_STANDARD.md`, and
direct reads of `MachineOwnershipPanel.tsx`, the three
`*SummaryProvider.ts` files, `MasterDataResolver.ts`, and
`shared/master-data/lookup/customerType.ts`/`customerTitle.ts`. No
architecture invented — every element above already existed as a
specification, a named gap, or a reusable service before this ADR.
