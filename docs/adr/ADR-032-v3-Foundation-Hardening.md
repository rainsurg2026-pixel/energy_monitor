# ADR-032: v3.0 Foundation Hardening

## Status

Accepted. An architecture-hardening milestone, not a feature or redesign
- run after ADR-028/029/030/031 to confirm the platform's foundation is
sound before building Customer Ownership, CRM, Service Operations, and
Analytics on top of it. The full audit lives in
`docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md`; this ADR records
the decision and its outcome, not the analysis itself.

## Problem

Four consecutive corrections (ADR-028 Import Inspection domain
correction, ADR-029 Quality Inspection nav consolidation, ADR-030 Vehicle
360 consolidation, ADR-031 Platform Stabilization) each fixed a specific,
scoped problem. None of them stepped back to ask the milestone-level
question this one does: *is every business domain still singly owned,
is the dependency direction still one-way, and is there any duplication
or debt that would compound once Customer/CRM/Analytics start reading
across domains?*

Separately, this repository's own governance framework
(`docs/governance/*.md`) - which already answers exactly these questions
at the bounded-context level - predates ADR-017/018/027 entirely and had
gone stale (missing `delivery/`/`inspection/`/`knowledge/` from its own
repository-structure listing, describing Inspection/Delivery as "open
PR," not naming Vehicle 360 at all).

## Decision

Ran the full audit specified by the milestone brief (Architecture Audit,
Domain Boundaries, Service Layer, Database Review, Dependency Map,
Performance, Security, API Consistency) against the current, merged
state of `main`. Findings and full detail: see
`docs/architecture/V3_FOUNDATION_HARDENING_AUDIT.md`.

**Outcome: PASS.** Every domain named in the milestone brief (Vehicle,
Machine Passport, Import Inspection, NTR, Warranty, PM, MQR, Timeline,
Documents) has exactly one code owner. No duplicate vehicle page, no
duplicate vehicle service, no duplicate timeline, no circular dependency,
no security/RBAC inconsistency requiring a change. Zero code changes were
needed to correct a boundary violation, because none was found.

**Documentation corrected** (small, factual edits only - not a rewrite):
`MODULE_MATURITY_MATRIX.md`'s Inspection/Delivery/Timeline rows (no
longer "open PR," reflect what actually shipped) and a new Vehicle 360
row; `REPOSITORY_STRUCTURE_MAP.md`'s `src/features/` listing (was
missing `delivery/`/`inspection/`/`knowledge/`). `DOMAIN_OWNERSHIP_MATRIX.md`
and `CAPABILITY_DEPENDENCY_MAP.md` each got a one-line amendment pointer
to the new audit document rather than a full rewrite - refreshing their
complete bounded-context-level prose is named as follow-up debt, not
done in this pass (out of "hardening only" scope).

**Named, not fixed, technical debt** (all pre-existing, none introduced
by this pass, none blocking): Warranty's four independent
`calcWarranty()` call sites with no shared read-model; MQR's absent
service/repository class (81 functions live in `lib/db.ts` instead);
NTR/PM/MQR linking to `vehicles` by denormalized `serial` string rather
than a real FK (Inspection/Delivery, built later, use a real FK);
`DeliveryService`'s now-production-dead methods (ADR-031); 7 unrelated
pre-existing callerless API routes (ADR-031); `pm_programs`/`*_raw`
address-staging tables (ADR-031). Full detail in the audit document's
Technical Debt Register.

## Roadmap

Proposed next three milestones, ordered by business value (full
reasoning in the audit document §10):

- **v3.1 - Customer Ownership Foundation**: a real `customers` master
  table + resolution service, unblocking CRM directly.
- **v3.2 - Service Operations Consolidation**: backfill `vehicle_id` FK
  onto `ntr_records`/`pm_records`/`records`, closing the one real
  schema inconsistency this audit found.
- **v3.3 - Analytics-Ready Event Model**: a single `getWarrantySummary()`
  read-model, and extracting MQR's `lib/db.ts` functions into its own
  `features/mqr/` service/repository pair.

## Consequences

- No behavior change anywhere in the running application - this ADR's
  only code-adjacent artifact is documentation.
- The next milestone (v3.1) can proceed without first rediscovering the
  platform's shape - this audit is the shared reference point.

## Verification

`tsc --noEmit` clean; `eslint .` 0 errors (pre-existing warning baseline
unchanged); `vitest run` full suite passes unchanged (no source file
touched); `next build` succeeds; `architecture-check` 6/6 PASS.
