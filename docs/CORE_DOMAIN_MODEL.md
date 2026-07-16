# Core Domain Model

Status: Sprint 7 (Core Business Domain). This document is the index for the
shared business domain every module in docs/VISION.md's eight-module list —
MQR, PM Record, New Tractor Delivery, NTR, Warranty, Parts Request, Campaign,
Dealer KPI — is built on top of. It does not redefine detail owned by another
document; each section below links to the document that owns it.

This is a standard, not an implementation. No table, column, or row exists
because of this sprint.

## 1. Why a core domain model

Every module so far documented (docs/BUSINESS_MODULE_STANDARD.md) is
expected to reuse shared services, shared UI, and a shared lifecycle. Sprint
7 extends that same reuse rule to data: a small set of entities — Dealer,
Branch, Customer, Tractor, Technician, Employee — exist once, are owned
once, and are referenced by every module that needs them, by foreign key.
A module does not get to decide it needs its own copy of "customer" or
"dealer" because copying is easier than referencing; that duplication is
exactly what this sprint exists to prevent. The binding contract — which
module must reference which entity — is docs/FUTURE_MODULE_DEPENDENCY.md,
not this document.

## 2. The six core entities

| Entity | One-line role |
|---|---|
| Dealer | The dealership organization. Top of the org hierarchy every other entity scopes against. |
| Branch | A physical location belonging to one Dealer. |
| Customer | The end owner of a Tractor. Not a system user — no login, no role. |
| Tractor | The physical unit every service, warranty, and delivery record is ultimately about. |
| Technician | Dealer-side field/service staff who perform work on a Tractor. |
| Employee | MSEAL-side (manufacturer) staff — department and role, not dealer-affiliated. |

Full field-level definitions for each entity are in docs/ENTITY_MODEL.md.
This document only describes how they relate to each other and to the
business modules; it does not repeat their fields.

## 3. How the entities relate

Two organizational chains and one transactional chain, summarized here and
fully diagrammed with cardinality and foreign keys in
docs/ENTITY_RELATIONSHIP.md:

- **Dealer → Branch → Technician** — the dealer-side org chart. A Technician
  belongs to a Dealer; today's ENTITY_MODEL.md field list does not yet carry
  a `branch_id` on Technician, so the Branch step in this chain is
  organizational, not yet a foreign key — see the open question in
  docs/ENTITY_RELATIONSHIP.md §3.
- **Dealer → Customer → Tractor** — how a unit reaches its owner. A Tractor
  is sold/delivered through a Dealer to a Customer; New Tractor Delivery
  (docs/BUSINESS_WORKFLOW.md) is the workflow that sets `Tractor.customer_id`.
- **Tractor → PM Record → MQR → Warranty → Parts Request → Campaign** — every
  module-specific record in this chain carries (directly or transitively) a
  reference back to the Tractor it concerns. This is a shared-foreign-key
  relationship, not a mandatory sequential pipeline — a Tractor can have an
  MQR with no prior PM Record. The actual process each module's records move
  through is owned by docs/BUSINESS_WORKFLOW.md and docs/MODULE_LIFECYCLE.md,
  not by this chain.

## 4. Open questions (track here, don't let them block delivery)

| Question | Status |
|---|---|
| This sprint's "Tractor" entity covers the same real-world thing as today's production "vehicle" concept (`/api/vehicles/search`, `/api/vehicles/list`, `src/lib/tractorSheet.ts`). Reconciling the two names into one is not decided by this sprint. | Open — see docs/ENTITY_MODEL.md §7 |
| How "Employee" (this sprint, MSEAL-side staff) relates to the existing production `users` table (which already carries dealer-side and admin accounts under one `Role` type) is not decided by this sprint. | Open — see docs/ENTITY_MODEL.md §7 |
| NTR's actual scope is still an open question per docs/ROADMAP.md ("What does the NTR module actually cover? — Unanswered, do not design against a guess"). Any entity usage attributed to NTR in docs/FUTURE_MODULE_DEPENDENCY.md is provisional for the same reason. | Open — carried from docs/ROADMAP.md |

## 5. Document map for this sprint

| Document | Owns |
|---|---|
| docs/ENTITY_MODEL.md | Field-level definition of each of the six entities |
| docs/ENTITY_RELATIONSHIP.md | Relationship chains, cardinality, foreign keys |
| docs/MASTER_DATA.md | Shared reference/lookup data (codes, models, levels) the entities and modules draw from |
| docs/BUSINESS_WORKFLOW.md | How a module's records move through status, referencing these entities |
| docs/SEARCH_MODEL.md | How a user finds these entities across modules |
| docs/DASHBOARD_MODEL.md | KPI definitions aggregated over these entities and module records |
| docs/FUTURE_MODULE_DEPENDENCY.md | The binding reuse contract: which entity every module must reference, never duplicate |

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
