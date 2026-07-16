# Entity Model

Status: Sprint 7 (Core Business Domain). Field-level definition of the six
core entities introduced in docs/CORE_DOMAIN_MODEL.md. Naming follows the
existing docs/NAMING_STANDARD.md: tables snake_case plural, columns
snake_case, foreign keys `<referenced_table_singular>_id`, and a matching
PascalCase singular TypeScript type per docs/NAMING_STANDARD.md's Types
section.

This is a standard, not an implementation. No table is created by this
sprint.

## 1. Dealer

Type: `Dealer`. Table: `dealers` (already exists in production —
src/app/(app)/admin/dealers/, docs/ADMIN_FRAMEWORK.md §0).

| Field | Description |
|---|---|
| `dealer_id` | Primary key. |
| `dealer_code` | Short, human-readable dealer code used in lists, exports, and search (docs/SEARCH_MODEL.md). |
| `dealer_name` | Full dealer/dealership name. |
| `branch_count` | Count of Branch rows belonging to this Dealer. Read as a derived/denormalized convenience value — the Branch rows themselves (§2) are the source of truth; this field is not a second place to edit branch membership. |
| `status` | Administrative active/inactive state for the Dealer record itself. This is distinct from the per-record workflow `status` defined in docs/MODULE_LIFECYCLE.md — that field tracks where a module's *record* is in Draft→...→Closed; this field tracks whether the *Dealer* is currently active, the same active/inactive concept docs/ADMIN_FRAMEWORK.md §2 already implements as a boolean toggle on the production `dealers` table. |

## 2. Branch

Type: `Branch`. Table: `branches` (already exists in production —
src/app/(app)/admin/branches/).

| Field | Description |
|---|---|
| `branch_id` | Primary key. |
| `dealer_id` | Foreign key to Dealer. Every Branch belongs to exactly one Dealer. |
| `branch_code` | Short, human-readable branch code, unique within its Dealer. |
| `branch_name` | Branch display name. |
| `province` | The Branch's province. Value drawn from the Provinces master list, docs/MASTER_DATA.md §6 — not a free-text field. |

## 3. Customer

Type: `Customer`. Table: `customers` (new — does not exist in production
today; the closest existing concept is the customer fields embedded
directly on a record in today's monolithic MQR schema, not a standalone
table).

| Field | Description |
|---|---|
| `customer_id` | Primary key. |
| `customer_name` | Customer's name. |
| `phone` | Customer's contact phone number. |
| `address` | Customer's address. |

A Customer is not a system user. It has no login, no Role, and is not part
of docs/PERMISSION_MODEL.md — it exists purely as the owner-of-record a
Tractor (and the modules that act on that Tractor) point to.

## 4. Tractor

Type: `Tractor`. Table: `tractors` (see open question §7 — today's
production equivalent is `vehicles`, not `tractors`).

| Field | Description |
|---|---|
| `tractor_id` | Primary key. |
| `serial_number` | Unit serial number. Primary global-search key, docs/SEARCH_MODEL.md §2. |
| `engine_number` | Engine serial number. Secondary global-search key. |
| `model` | Tractor model. Value drawn from the Tractor Models master list, docs/MASTER_DATA.md §2. |
| `model_year` | Model year. |
| `dealer_id` | Foreign key to Dealer — the dealer the unit is associated with (sold through, or currently scoped to for service). |
| `customer_id` | Foreign key to Customer — the current owner. Nullable until New Tractor Delivery (docs/BUSINESS_WORKFLOW.md §3) assigns one. |
| `warranty_status` | Convenience/summary field reflecting the Tractor's current warranty state. The Warranty module's own records (docs/ENTITY_RELATIONSHIP.md §3, docs/BUSINESS_WORKFLOW.md §5) remain the system of record for warranty history; this field is a denormalized read, not a second place warranty decisions are made. |

## 5. Technician

Type: `Technician`. Table: `technicians` (already exists in production —
src/app/(app)/admin/technicians/).

| Field | Description |
|---|---|
| `technician_id` | Primary key. |
| `dealer_id` | Foreign key to Dealer — the dealer this Technician works for. |
| `technician_name` | Technician's name. |
| `certification_level` | Technician's certification level. Value drawn from the Technician Levels master list, docs/MASTER_DATA.md §7 — the level scheme itself is not defined by this sprint. |

Note: this field list does not carry a `branch_id`. docs/ENTITY_RELATIONSHIP.md
§3 flags this as an open question against the Dealer → Branch → Technician
chain in docs/CORE_DOMAIN_MODEL.md §3.

## 6. Employee

Type: `Employee`. Table: `employees` (new — does not map to an existing
production table; see open question §7 against the existing `users` table).

| Field | Description |
|---|---|
| `employee_id` | Primary key. |
| `department` | The MSEAL department the Employee belongs to. |
| `role` | The Employee's role within that department. Not the same value space as docs/PERMISSION_MODEL.md's Role (Super Admin / Customer Care / Dealer Admin / Dealer User / Technician / Viewer) — that Role governs system permissions; this `role` is an organizational job title/function. A future module that needs an Employee to also act in the system still authenticates and is authorized through the existing Role model, not through this field. |

## 7. Open questions

| Question | Status |
|---|---|
| Should `Tractor` (this sprint) and today's production `vehicle` concept (`/api/vehicles/*`, `src/lib/tractorSheet.ts`, the "Vehicle master feed" in docs/ARCHITECTURE.md §1) be unified under one name? | Open — not resolved by this sprint |
| How does `Employee` (this sprint) relate to the existing `users` table, which already holds dealer-side and admin accounts under one four-value `Role` (docs/PERMISSION_MODEL.md)? Is Employee a new table for MSEAL-internal staff only, or an eventual supertype of Users? | Open — not resolved by this sprint |
| What is the defined value set for `Technician.certification_level`? | Open — docs/MASTER_DATA.md §7 |

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
