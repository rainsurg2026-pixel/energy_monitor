# Search Model

Status: Sprint 7 (Core Business Domain). Documents what a platform-wide
global search must cover: Serial Number, Engine Number, Customer, Dealer,
Branch, Technician, Job Number. This is a standard, not an implementation —
no search index, query, or endpoint exists because of this sprint.

## 1. Ownership

Global search is implemented once, by the shared `search` platform service
(docs/PLATFORM_SERVICES.md), not by each module. A module's UI calls into
this service rather than writing its own `ILIKE` query — the same
shared-first rule docs/BUSINESS_MODULE_STANDARD.md applies to every other
cross-cutting concern, applied here to search. `search`'s documented
boundary already states it owns query construction/matching, not result
rendering — rendering stays in the module/shared UI layer.

## 2. Search keys and their source field

| Search key | Source entity/field | Notes |
|---|---|---|
| Serial Number | `Tractor.serial_number` (docs/ENTITY_MODEL.md §4) | Primary identifier for a physical unit. |
| Engine Number | `Tractor.engine_number` | Secondary unit identifier — a dealer may know the engine number before the serial number. |
| Customer | `Customer.customer_name` (docs/ENTITY_MODEL.md §3) | May also match `phone` — left to the search service's own matching rules, not fixed by this sprint. |
| Dealer | `Dealer.dealer_name` / `Dealer.dealer_code` (docs/ENTITY_MODEL.md §1) | |
| Branch | `Branch.branch_name` / `Branch.branch_code` (docs/ENTITY_MODEL.md §2) | |
| Technician | `Technician.technician_name` (docs/ENTITY_MODEL.md §5) | |
| Job Number | Today's production MQR record identifier (`jobId`, `src/app/(app)/records/[jobId]`) | See open question below — whether every module gets its own record-number scheme or all share one "Job Number" namespace is not decided by this sprint. |

## 3. Result shape

A global search returns mixed entity types from one input box — a single
query for "ABC123" might match a Tractor's serial number and a Dealer code
in the same result set. Each result must identify which entity/module it
belongs to so the user can tell them apart; this sprint does not specify the
exact UI, only that the ambiguity must be resolved by labeling, not by
silently picking one match type over another.

## 4. Scoping

Search results are subject to the same tenant isolation as every other
query — `applyScope()` and RLS apply to search exactly as they do to a
direct list/detail fetch (docs/ARCHITECTURE.md §5's two-layer rule). A
Dealer User searching by Customer name must not see another dealer's
customers in the result set; search is not a bypass of scope, and no
module or shared service may treat it as one.

## 5. Open questions

| Question | Status |
|---|---|
| Should every module (PM Record, Warranty, Parts Request, etc.) get its own record-number scheme, or should all module records share one "Job Number" namespace searchable the same way today's MQR `jobId` is? | Open — not decided by this sprint |
| Exact matching behavior (partial match, alias handling, multi-field queries) is owned by docs/PLATFORM_SERVICES.md's `search` service definition and docs/DESIGN_SYSTEM.md's Search pattern, not redefined here. | Tracked in those documents |

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
