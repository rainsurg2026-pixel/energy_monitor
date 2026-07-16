# Entity Relationship

Status: Sprint 7 (Core Business Domain). Diagrams the relationships between
the entities defined in docs/ENTITY_MODEL.md, with cardinality and the
foreign key that implements each link. This is a standard, not an
implementation — no foreign key or constraint exists because of this
sprint.

## 1. Dealer → Branch → Technician

```
Dealer
  ↓  (1 Dealer has many Branch)
Branch
  ↓  (organizational — see §3)
Technician
```

| Link | Cardinality | Foreign key |
|---|---|---|
| Dealer → Branch | 1 Dealer : many Branch | `Branch.dealer_id` |
| Branch → Technician | Organizational only | none today — see §3 |

## 2. Dealer → Customer → Tractor

```
Dealer
  ↓  (1 Dealer sells/delivers to many Customer)
Customer
  ↓  (1 Customer owns many Tractor, over time)
Tractor
```

| Link | Cardinality | Foreign key |
|---|---|---|
| Dealer → Tractor | 1 Dealer : many Tractor | `Tractor.dealer_id` |
| Customer → Tractor | 1 Customer : many Tractor | `Tractor.customer_id` (nullable until delivery) |

`Tractor.dealer_id` and `Tractor.customer_id` are both direct foreign keys on
Tractor (docs/ENTITY_MODEL.md §4) — Dealer does not reach Tractor only
through Customer. A Tractor can exist (e.g. in dealer stock, pre-delivery)
with `dealer_id` set and `customer_id` still null. docs/BUSINESS_WORKFLOW.md
§3 (New Tractor Delivery) is the workflow that sets `customer_id`.

## 3. Tractor → PM Record → MQR → Warranty → Parts Request → Campaign

```
Tractor
  ↓
PM Record
  ↓
MQR
  ↓
Warranty
  ↓
Parts Request
  ↓
Campaign
```

This chain means every module record listed carries (directly or
transitively) a reference back to a Tractor — it does not mean a Tractor
must pass through PM Record before an MQR can exist, or that any later
stage requires the one before it. Each arrow is a shared-foreign-key
dependency, not a required sequence. The actual order any of these records
can be created in, and what state they move through once created, is owned
by docs/BUSINESS_WORKFLOW.md and the shared lifecycle in
docs/MODULE_LIFECYCLE.md — not by this diagram.

| Module record | Cardinality to Tractor | Foreign key |
|---|---|---|
| PM Record | many : 1 | `tractor_id` on the PM Record's own table (module-owned; not defined by docs/ENTITY_MODEL.md) |
| MQR | many : 1 | `tractor_id` (today's production equivalent: a record references a vehicle, not yet named `tractor_id` — see open question below) |
| Warranty | many : 1 | `tractor_id` |
| Parts Request | many : 1, optional | `tractor_id` — a Parts Request is not always tied to one specific unit (docs/FUTURE_MODULE_DEPENDENCY.md §7) |
| Campaign | many : many | Campaign targets a population of tractors (often by model/serial range, docs/MASTER_DATA.md §2), not a single `tractor_id` |

Each module owns its own record table and its own `tractor_id` (or
equivalent) column; this sprint does not create any of them. The binding
rule — that every one of these modules must reference Tractor by id rather
than copy Tractor's fields into its own table — is docs/FUTURE_MODULE_DEPENDENCY.md.

## 4. Open questions

| Question | Status |
|---|---|
| docs/ENTITY_MODEL.md §5 (Technician) has no `branch_id` field, so the Branch → Technician step in §1 is not currently backed by a foreign key — a Technician is only directly linked to a Dealer. Whether Technician should carry a `branch_id` is not decided by this sprint. | Open |
| The chain in §3 names "Tractor" throughout; today's production code reaches the same physical unit through a `vehicle` concept (docs/ENTITY_MODEL.md §7). Until that naming question resolves, any `tractor_id` foreign key named here is the target-state name, not necessarily today's production column name. | Open |

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
