# Future Module Dependency

Status: Sprint 7 (Core Business Domain). This is the binding contract this
sprint exists to produce: which shared entity (docs/ENTITY_MODEL.md) every
future business module must reference by foreign key, and must never
duplicate into a module-local table. This is a standard, not an
implementation — no module's schema is created or changed by this sprint.

## 1. The rule

A module's own `types.ts`/`db.ts` (docs/MODULE_ARCHITECTURE.md §1) may
define module-specific record shapes — a PM Record, a Warranty Claim, a
Campaign — but those shapes reference Dealer, Branch, Customer, Tractor,
Technician, and Employee by their `*_id` foreign key only. A module does
not store its own copy of `dealer_name`, `customer_name`, a tractor's serial
number, or any other field that already belongs to one of the six core
entities. This is the data-layer counterpart to
docs/BUSINESS_MODULE_STANDARD.md's "Shared services" rule: a module never
re-implements a cross-cutting concern, and a core entity is exactly that —
a cross-cutting concern, just made of data instead of code.

## 2. Per-module dependency matrix

| Module | Core entities referenced | Master data used (docs/MASTER_DATA.md) |
|---|---|---|
| MQR | Tractor (subject), Customer (owner), Dealer/Branch (scope), Technician (performed by) | Problem Codes, Failure Codes |
| PM Record | Tractor, Customer, Dealer/Branch, Technician | PM Checklist, Tractor Models |
| New Tractor Delivery | Tractor, Customer, Dealer/Branch, Employee (where MSEAL-side coordination applies) | Tractor Models |
| NTR | Tractor, Customer, Dealer/Branch | — |
| Warranty | Tractor (and its `warranty_status`), Customer, Dealer/Branch, Technician | Problem Codes, Failure Codes |
| Parts Request | Tractor (optional, docs/ENTITY_RELATIONSHIP.md §3), Dealer/Branch, Technician/Employee (requester) | The existing-but-unused `parts` table (docs/ADMIN_FRAMEWORK.md) is the likely catalog source — not re-specified here |
| Campaign | Tractor (targeted population, often by model/serial range), Dealer/Branch (execution), Customer (notification target) | Tractor Models |
| Dealer KPI | Dealer, Branch, Employee (reporting owner) | Consumes other modules' records as input; produces dashboard/report output (docs/DASHBOARD_MODEL.md), not a new core entity |

NTR's row is provisional: docs/ROADMAP.md's open questions table already
flags "What does the NTR module actually cover?" as unanswered — this
matrix attributes entities to NTR based on its name (new tractor
registration) only, and should be revisited once that question is actually
answered, not treated as a settled scope.

## 3. What this does not authorize

Listing an entity against a module above is not approval to build that
module, and is not a schema. It only states that *if and when* a module is
built, it must reach the listed entity by reference rather than by copy.
Building any of these modules remains a separately approved, future
implementation sprint, per docs/ROADMAP.md's Phase 3 sequencing.

## 4. Enforcement

There is no automated check for this rule today — the codebase has no test
framework (docs/ARCHITECTURE.md §6, docs/MODULE_ARCHITECTURE.md §9) and no
schema-migration review tooling beyond manual `git diff` review
(docs/MODULE_ARCHITECTURE.md §9's checklist already requires a hand review
before any module change is committed). Until that changes, compliance with
this matrix is a manual review item at the point a module's first
migration is written, not something CI catches.

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
