# Master Data

Status: Sprint 7 (Core Business Domain). Documents the shared reference and
lookup data every module draws from rather than each maintaining its own
copy — the master-data equivalent of docs/FUTURE_MODULE_DEPENDENCY.md's
entity-reuse rule. This is a standard, not an implementation. No table or
seed data is created by this sprint.

Two kinds of master data are in scope here. Dealers and Branches are full
core entities with their own relationships — they are defined once in
docs/ENTITY_MODEL.md and only referenced here, not redefined. The other six
are simpler reference/lookup lists (typically a code plus a label) with no
relationships of their own, used to populate dropdowns and validate fields
on other entities and module records.

## 1. General principle

Master data is managed centrally — today, through the existing Admin
framework (docs/ADMIN_FRAMEWORK.md, shared/admin/) for the lists that
already have an admin module, and through whatever future admin surface
covers the rest. A module consumes a master-data value by code/id; it never
hand-maintains its own copy of a code list, the same rule
docs/BUSINESS_MODULE_STANDARD.md already applies to shared services.

## 2. Tractor Models

Referenced by `Tractor.model` (docs/ENTITY_MODEL.md §4) and by Campaign's
targeting (docs/ENTITY_RELATIONSHIP.md §3). Today's production source is a
public Google Sheet, read read-only via `src/lib/tractorSheet.ts`
("Vehicle master feed," docs/ARCHITECTURE.md §1) — not a Supabase table.
Whether Tractor Models should migrate into Supabase as a proper master-data
table is an open question, not decided by this sprint; docs/DATA_SYNCHRONIZATION.md
already distinguishes this read-only feed from the Supabase → Sheets sync
direction used elsewhere, and that distinction still applies.

### 2.1 Product Family / Sub Model (implemented — `docs/adr/ADR-012-Tractor-IN-Master-Data.md`)

Product Family and Sub Model are properties of the physical tractor, sourced
from the Tractor IN Google Sheet, not chosen per-module. The data flow:

```
Google Sheet (Tractor IN)
        ↓
Sync Service (src/features/vehicle/services/tractorInSyncService.ts)
        ↓
vehicles (Application Master: product_family_id, sub_model,
          last_synced_at, sync_source)
        ↓
NTR
PM
Warranty   (not yet built)
ORC        (not yet built)
Reports    (not yet built)
```

`vehicles.product_family_id`/`vehicles.sub_model` are written **only** by
`TractorInSyncService` (triggered manually today via
`POST /api/admin/tractor-in/sync`, SuperAdmin-only — no scheduler platform
exists yet, see docs/SCHEDULER_ARCHITECTURE.md). No business module ever
derives or writes these two columns itself. NTR and PM are the only two
consumers wired up so far; Warranty, ORC, and Reports don't exist as
modules yet, but when they're built, they read the same `vehicles` columns
rather than re-deriving Product Family from `model` independently — this
is the single-source-of-truth contract this table records for future
readers.

**v2.3.1 (Sync Hardening):** the sync now **inserts** a new `vehicles`
row when the sheet has a serial with no existing match (previously
update-only — see ADR-012's "v2.3.1: Sync Hardening" section), is
idempotent under repeated runs and concurrent-write races (backed by the
pre-existing `vehicles_serial_key` UNIQUE constraint), stamps
`last_synced_at`/`sync_source` on every row it touches, isolates one
row's failure from the rest of the run, and persists a per-run summary to
`tractor_in_sync_runs` — read by the new `GET /api/admin/tractor-in/health`
endpoint (last sync time, inserted/updated/failed counts, total vehicles,
sync status). Full detail, migration, and rollback: ADR-012.

## 3. Problem Codes

Already exists in production as the `problem_codes` table with its own
admin module (`admin/problem-codes/`, docs/ADMIN_FRAMEWORK.md §0), including
`severity` and `system` fields. Referenced by MQR and Warranty
(docs/FUTURE_MODULE_DEPENDENCY.md §4, §5) to classify what was found on a
Tractor.

## 4. Failure Codes

Does not exist in production today. Needed by Warranty and MQR to classify
why a part or system failed, as distinct from Problem Codes' classification
of what was found. The relationship between Problem Codes and Failure Codes
(e.g. whether a Failure Code is always reached from a Problem Code, or is
independent) is not defined by this sprint — flagged as an open question
for whichever module first needs Failure Codes in practice.

## 5. PM Checklist

Does not exist in production today. Needed by PM Record so that the items a
technician checks during preventive maintenance are standardized once,
centrally, rather than re-typed per PM Record submission or per dealer.
Whether the checklist varies by Tractor Model or service interval is left
to PM Record's own scoping (docs/BUSINESS_WORKFLOW.md §2) — this entry only
establishes that the checklist *items* are master data, not free text
entered on each record.

## 6. Provinces

Does not exist in production today as its own table. Referenced by
`Branch.province` (docs/ENTITY_MODEL.md §2). Expected to be the standard
Thai province list — static and rarely changing, which makes it a candidate
for either a small lookup table or a static in-code constant; that
implementation choice is not made by this sprint.

## 7. Technician Levels

Does not exist in production today. Referenced by
`Technician.certification_level` (docs/ENTITY_MODEL.md §5). The actual level
scheme (e.g. how many levels, what each is called) is not specified by the
user and is not invented here — left as an open question for whoever owns
Technician certification policy.

## 8. Dealers

Full entity, not a simple lookup list — defined in docs/ENTITY_MODEL.md §1.
Already exists in production (`admin/dealers/`). Referenced here only as a
pointer: any module needing a dealer picker/dropdown reads from the
existing Dealer entity, it does not maintain a separate "dealer list" master
table.

## 9. Branches

Full entity, not a simple lookup list — defined in docs/ENTITY_MODEL.md §2.
Already exists in production (`admin/branches/`). Same pointer-only note as
Dealers above applies.

## Verification

Documentation only. No production code changes. No routing changes. No
imports changed. No database implementation. No API implementation.
Application behavior unchanged.
