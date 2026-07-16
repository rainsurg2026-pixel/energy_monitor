# Capability Map

## Relationship to existing documents

`docs/architecture/blueprint/17-BUSINESS-CAPABILITY-MAP.md` (frozen,
part of the Baseline) is the authoritative Capability → Business Module
→ Implementation index. **This document does not compete with it.** It
presents the same underlying capabilities as a per-domain tree (the
shape the task asked for - `Machine ├── Registration ├── Passport ...`)
rather than 17's flat table, because a tree makes "what does Machine
include" easier to scan than a table keyed the other way. **Where this
tree and 17 disagree, 17 wins** - it is part of the frozen Baseline; this
document is a governance-layer convenience view, not a second Baseline.

## Machine

```
Machine
├── Registration          (Service > NTR - 17 "Registration")
├── Passport               (proposed - ROADMAP.md priority #1, not built; 10-MACHINE-PROFILE.md)
├── Delivery                (Delivery domain, ADR-027 - open PR; Machine reads its own Delivery summary via DeliveryService, never owns Delivery data)
├── PDI (Inspection)         (Inspection domain, 04/ADR-017 - open PR; one stage inside Delivery, not a separate Machine sub-concept)
├── Timeline                  (shared/activity-timeline/, ACTIVITY_TIMELINE.md)
├── Warranty                   (Service - Warranty Activation event captured by Delivery/ADR-027; overall status still computed via calcWarranty(), no claims/policy table yet, DATA_OWNERSHIP_MATRIX.md)
├── PM                          (Service > Maintenance - 17 "Maintenance", built)
├── Quality                      (Quality - 17 "Quality Management (MQR + PIP)", built as MQR)
├── Knowledge                     (Knowledge domain, 07/ADR-018 - built; Machine reads Published cases via KnowledgeService, never owns Knowledge)
├── AI                             (Engineering Intelligence, 08 - reads Knowledge about this Machine, never Machine tables directly)
├── PIP                             (Engineering Intelligence, produced from this Machine's Quality/Knowledge - not built)
└── Recall                           (Service > Campaigns - not built, targets a population including this Machine)
```

## Delivery

```
Delivery
├── Tractor In              (reuses Service > Registration's Tractor In Sync, ADR-012 - never a second sync)
├── Stock Yard                (Delivery domain, ADR-027 - open PR)
├── PDI (reference only)        (owned by Inspection domain, ADR-017 - open PR; Delivery links an Inspection, never duplicates its fields)
├── Dealer Preparation             (Delivery domain, ADR-027)
├── Customer Delivery (reference only) (owned by Service > NTR; Delivery links an NtrRecord, never duplicates its fields)
├── Operator Training                (Delivery domain, ADR-027 - owns delivery_trainings)
├── Delivery Acceptance                 (Delivery domain, ADR-027 - gated by canApproveDelivery)
├── Warranty Activation                   (Delivery domain, ADR-027 - one point-in-time event + source; not a claims/policy ledger)
└── AI (reserved, not built)                 (4 Coming Soon tiles - AI Delivery Review/Risk/Readiness/Recommendation)
```

## Dealer

```
Dealer
├── Branches              (Master Data - built, ENTITY_RELATIONSHIP.md)
├── Technicians             (Master Data - built, organizational only, no branch FK yet - open gap)
├── Machines                 (via Customer AND directly, both are real FKs - ENTITY_RELATIONSHIP.md)
├── Users                      (Administration - RBAC, scoped to this Dealer)
└── Dealer KPI                  (Reports/Analytics - 09, DASHBOARD_MODEL.md)
```

Import History (formerly listed here) is retired along with Historical NTR
Import - ADR-038, 2026-07-16, Product Owner decision. No longer a leaf of
any capability tree.

## Customer

```
Customer
├── Machines Owned        (Tractor.customer_id - direct FK, ENTITY_RELATIONSHIP.md)
├── Service History         (via Machine - PM/Quality/Warranty records referencing owned Machines)
├── NTR Delivery Record       (Service > NTR - Acceptance Date captured here, DOMAIN_LANGUAGE_STANDARD.md)
└── (no login, no Role)         (ENTITY_MODEL.md - Customer is never a system user)
```

## Service

```
Service
├── Registration (NTR)     (built)
├── Maintenance (PM)         (built)
├── Warranty                  (no table yet - DATA_OWNERSHIP_MATRIX.md)
├── Parts Request               (17 "Parts Management" - "no dedicated module/table yet")
└── Campaigns                     (proposed nav grouping, ADR-023)
    ├── Recall                       (not built)
    ├── Service Campaign               (not built)
    └── PIP (reference only)             (owned by Engineering Intelligence - Service tracks, does not own)
```

## Quality

```
Quality
├── Dashboard              (built - the original MQR analytics dashboard, moved to /quality/dashboard per ADR-023 proposed)
├── Cases                    (built - MQR/`records` table)
├── Analytics                  (not built beyond the Dashboard's own charts)
├── Knowledge (reference only)   (built, ADR-018 - Knowledge owns itself, an independent domain, not owned by Quality; nav-grouped here for UX/discoverability only; Quality Cases feed it as Evidence)
└── PIP (reference only)           (produced from Quality's own Cases/Knowledge, owned by Engineering Intelligence)
```

## Engineering Intelligence

```
Engineering Intelligence
├── Knowledge (reference only)   (ADR-018 - Knowledge owns itself, an independent domain (see the Quality tree above for its nav placement, not its ownership); Engineering Intelligence consumes it via KnowledgeService, never owns a second copy - "Knowledge Engine" as a separate EI capability is corrected here, matching TERMINOLOGY_STANDARD.md's existing Forbidden wording rule)
├── Troubleshooting           (proposed nav, ADR-023 addendum - Coming Soon, architecture-reserved only)
├── AI Analysis                 (08 - capabilities named, not implementation-level designed)
├── Prediction                    (08's "Predictive Quality Analytics" capability - feeds Analytics per 09's one exception)
├── PIP                              (owned here per ADR-023's addendum - produced from Knowledge)
└── Insights                           (proposed nav grouping over the above capabilities)
```

## Administration

```
Administration
├── Users                  (built - RBAC via lib/scope.ts, 4 roles)
├── Master Data              (built - Dealers/Branches/Technicians/Problem Codes/PM Intervals/Product Families/Maintenance Programs)
├── Audit                        (data exists per-record via record_audit_log; no cross-module admin UI yet)
├── Sessions                       (self-service only, /profile/security - no admin cross-user view yet)
└── System Health                    (built - Tractor-IN sync health, /admin/email-health)
```

Import History (`/admin/import-history`) is retired along with Historical
NTR Import - ADR-038, 2026-07-16, Product Owner decision.

## Cross-references not repeated here

Import Platform, Authentication, Master Data (as a platform layer rather
than the Administration screens that manage it), Timeline (as a shared
rendering component rather than Machine's own sub-concept), Notifications,
and Reports are documented in `DOMAIN_OWNERSHIP_MATRIX.md` rather than
given their own tree here, since - per that matrix's own conclusion -
they are cross-cutting capabilities or frozen platform layers, not
domains with a capability *tree* the way Machine/Dealer/Customer/Service/
Quality/Engineering Intelligence/Administration are. Giving them a fake
tree here would imply a domain shape they explicitly don't have.

## Gap Analysis

- Passport, Knowledge Engine, Troubleshooting, AI Analysis (implementation
  level), Prediction, Insights, Warranty, Parts Request, Recall, Service
  Campaign, PIP (as a real table), Quality Analytics/Knowledge (real UI)
  are all named here as capability-tree leaves with **no implementation**
  - consistent with 17's own practice of naming a capability before it's
  built; this tree does not authorize building any of them.
- **Resolved by retirement, not by building it**: the previous gap noted
  here ("Import History under Dealer is not yet dealer-scoped") no longer
  applies - Historical NTR Import and Import History are permanently
  retired (ADR-038, 2026-07-16, Product Owner decision), not extended to
  be dealer-scoped.
