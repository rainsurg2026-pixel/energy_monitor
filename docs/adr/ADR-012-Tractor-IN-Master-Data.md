# ADR-012: Tractor IN as the Single Source of Truth for Product Family / Sub Model

> **Amended by ADR-029** (Quality Inspection Navigation Consolidation &
> Vehicle Master Data Expansion): the sync now also writes `model`,
> `engine_number`, `product_code`, `wh_arrival_date`, `delivery_date`, and
> `dealer_id` on both insert and update, not just Product Family/Sub Model.
> The content below is preserved as the original decision record.

## Problem

The NTR registration form let a dealer manually pick Product Family and
type/select a Sub Model, sourced from `product_family_models` (a
model→family mapping table) and NTR's own historical `variant` values
respectively. This meant:

- Product Family was re-derived from `vehicles.model` on every read
  (`getProductFamilyIdForModel()`), independently in NTR and PM, rather
  than being a stored, synced fact about the vehicle.
- Sub Model had no real master-data source at all - it was whatever a
  dealer had typed into a prior NTR record.

Both are properties of the physical tractor, not something a dealer
should choose at registration time - they should come from the Tractor
IN Google Sheet (the warehouse intake master list), the same way
model/engine number already do.

## Decision

1. **`vehicles.product_family_id` / `vehicles.sub_model`** (new, nullable
   columns) become the read model every business module (NTR, PM) reads
   from. Neither is ever written by a business module.
2. **`TractorInSyncService`** (`src/features/vehicle/services/
   tractorInSyncService.ts`) is the *only* place that writes these two
   columns. It reads the Tractor IN sheet's `Product Family`/`Sub Model`
   columns (a manual prerequisite - see below), resolves Product Family
   by exact `code`/`name` match against `product_families` (never
   guesses, never auto-creates), and writes into `vehicles` by serial -
   **UPDATE** when the serial already exists, **INSERT** when it doesn't
   (v2.3.1 - see "v2.3.1: Sync Hardening" below).
3. **No read-through sync.** NTR's tractor search and PM's vehicle lookup
   never trigger a sync as a side effect of a lookup - they only read
   whatever is already in `vehicles`. Synchronization is a deliberate,
   separate action.
4. **Manual trigger today.** `POST /api/admin/tractor-in/sync`
   (SuperAdmin-only) is the sync's one entry point. No scheduler platform
   exists in this repo yet (see `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s
   Platform service boundaries section) - a scheduled trigger can be
   added later by calling the same `TractorInSyncService.sync()`, with no
   change to the service itself.
5. **PM's temporary fallback.** `maintenanceSummaryProvider.ts` prefers
   `vehicle.product_family_id`; only falls back to the old
   `getProductFamilyIdForModel()` derivation for a vehicle not yet
   synced. Marked with a `TODO(tractor-in-sync)` for removal once the
   first production sync has run.
6. **Legacy Import unchanged.** It reads `product_family_id`/`variant`
   directly from the uploaded historical file's own columns - a
   completely separate, unaffected path.

## Manual prerequisite (outside this codebase)

This codebase has no write access to the Tractor IN Google Sheet (it's
read via the sheet's public CSV export URL - see `lib/tractorSheet.ts`).

**Correction (2026-07-09):** this ADR originally proposed adding the new
columns at position 8/9, based on `lib/tractorSheet.ts`'s own doc
comment, which turned out to be stale - it documented only 7 columns.
Fetching the live sheet's actual CSV directly during verification showed
it already has **9** real columns, the last two being `วันที่ส่งมอบ`
(Delivery Date, Thai) and `Dealer` - neither previously known to this
codebase. A first sync attempt against the live sheet before this
correction briefly wrote the `Dealer` column's value (`"KTV"`) into
`vehicles.sub_model` for 12 rows; caught immediately via the sync's own
result reporting (12 rows "updated" against a sheet with no real Product
Family/Sub Model data yet was the tell), and reverted with `UPDATE
vehicles SET sub_model = NULL WHERE sub_model = 'KTV'` before any other
module read it. No `product_family_id` was affected. **The sheet owner
must add two columns**, in this exact position (columns 10 and 11,
immediately after the existing `Dealer`):

| Column | Notes |
|---|---|
| `Product Family` | Must exactly match an existing `product_families.code` or `.name` (case-insensitive) - a row whose text doesn't match anything real is reported as "unmatched" by the sync, not guessed |
| `Sub Model` | Free text |

Until this column exists, `TractorInSyncService.sync()` simply finds
nothing to write for any row (both fields read as empty string) - it
does not error. Verified live against the real sheet post-fix: 0 rows
updated, 0 unmatched (confirms the fix; see Verification section).

## Database migration

```sql
alter table vehicles add column product_family_id uuid references product_families(id);
alter table vehicles add column sub_model text;
create index vehicles_product_family_id_idx on vehicles(product_family_id);

-- Backfill product_family_id for existing vehicles from the
-- already-correct model -> family mapping. sub_model stays NULL - no
-- source of truth for it exists until the sheet has the new column.
update vehicles v
set product_family_id = pfm.product_family_id
from product_family_models pfm
where pfm.model = v.model
  and v.product_family_id is null;
```

Applied 2026-07-09 as Supabase migration
`add_vehicles_product_family_and_sub_model`. Result: 290/333 existing
vehicles backfilled with `product_family_id` (the remainder have a
`model` with no entry in `product_family_models` - expected, not an
error); 0/333 have `sub_model` (expected - no source exists yet).

### v2.3.1 migration

```sql
alter table vehicles add column last_synced_at timestamptz;
alter table vehicles add column sync_source text;

create table tractor_in_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  total_rows integer not null,
  inserted integer not null,
  updated integer not null,
  skipped integer not null,
  failed integer not null,
  status text not null check (status in ('success', 'partial_failure')),
  unmatched_product_family jsonb not null default '[]'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  triggered_by text,
  created_at timestamptz not null default now()
);
-- RLS enabled, permissive policies (same pattern as product_family_models) -
-- authorization is enforced in the SuperAdmin-gated API routes, not per-row.
```

Applied 2026-07-09 as Supabase migration
`add_vehicles_sync_metadata_and_sync_runs_log`. No backfill needed -
`last_synced_at`/`sync_source` are correctly `NULL` for every vehicle
until the next real sync run touches it; `tractor_in_sync_runs` starts
empty.

## Rollback plan

The migration is additive only (two new nullable columns, one index, one
backfill `UPDATE` against columns that didn't previously exist) - nothing
existing is modified or dropped. To roll back:

```sql
drop index if exists vehicles_product_family_id_idx;
alter table vehicles drop column if exists product_family_id;
alter table vehicles drop column if exists sub_model;
```

Application-level rollback: revert the NTR/PM code changes in this PR.
`maintenanceSummaryProvider.ts`'s fallback to `getProductFamilyIdForModel()`
means PM keeps working identically even mid-rollback (it was already
resilient to `vehicle.product_family_id` being absent/null before this
column existed). NTR's manual form would need `product_family_id`/
`sub_model` reintroduced as user-editable fields if fully reverted - the
prior PR (#21/#23) history has that shape if ever needed again.

No data loss risk: `product_family_id`/`sub_model` are the only new
columns, nothing else changes, and `ntr_records`/Legacy Import are
completely unaffected regardless of rollback.

## v2.3.1: Sync Hardening (2026-07-09)

The previous version's known limitation ("sync updates existing vehicles,
never creates new ones" - `.update()` only, no `.insert()`) is resolved.
This section supersedes that limitation and documents the hardened design.

### INSERT + UPDATE, idempotent, no duplicates

`TractorInSyncService.sync()` fetches every existing `vehicles.serial`
once up front into an in-memory `Set`. For each sheet row:

- **Serial already in the set → UPDATE.** Only `product_family_id` (if
  resolved) and `sub_model` (if non-empty) are touched - this never
  overwrites `model`/`engine_number`/`dealer_id` on an existing row with
  sheet noise, since a business module or a dealer may have since
  corrected that vehicle's own data.
- **Serial not in the set → INSERT.** This is the only place a new
  `vehicles` row gets `model`/`engine_number`/`dealer_id` from the sheet
  directly (`dealer` resolved against `dealers.id` - the sheet's `Dealer`
  column already contains dealer codes like `"KTV"`, confirmed against
  the live sheet). The newly-inserted serial is added to the in-memory
  set immediately, so a duplicate serial elsewhere in the same sheet
  still only ever inserts once.
- **Hard backstop:** `vehicles_serial_key` (pre-existing DB-level UNIQUE
  constraint) makes a true duplicate impossible even under a race with
  another process. A `23505` (unique-violation) on insert is treated as
  `skipped`, not `failed` - the row already exists with the intended
  data, so nothing is wrong, and the service never retries an insert into
  an existing row.
- Re-running the sync any number of times against an unchanged sheet
  produces the same `vehicles` state every time - verified live (see
  Verification section).

### Sync metadata

Two new columns on `vehicles`: `last_synced_at` (timestamptz) and
`sync_source` (text, always `'tractor_in_sheet'` when set by this
service). Stamped on **every** synced row (insert or update) regardless
of whether Product Family/Sub Model actually changed - this is what
makes "is this vehicle's data stale" answerable later. Application-set
only, no DB-level default: NTR's manual "Create Tractor" flow never sets
either column, so `sync_source IS NULL` correctly means "never
sheet-synced."

### Per-row error isolation

Each row's insert/update is wrapped individually - a thrown Supabase
error (network blip, constraint violation) is caught, counted in
`failed`, and recorded in `failures: [{ serial, error }]`. The loop
always continues to the next row. One bad record can never abort the
rest of a sync run.

### Sync run log & health endpoint

Every run persists one row to `tractor_in_sync_runs` (`started_at`,
`finished_at`, `duration_ms`, `total_rows`, `inserted`, `updated`,
`skipped`, `failed`, `status`, `unmatched_product_family`, `failures`,
`triggered_by`) - the durable record behind "return and log," and the
only thing `GET /api/admin/tractor-in/health` (SuperAdmin-only, new)
reads from, alongside a live `select count(*) from vehicles`. Persisting
the log is best-effort: a failure to write the log row is caught and
logged separately, and never turns an otherwise-successful sync into a
reported failure - `vehicles` is already correctly written by that point.

### PM's fallback - kept, not removed

Requirement was: remove `getProductFamilyIdForModel()`'s fallback in
`maintenanceSummaryProvider.ts` only if the sync has populated
`product_family_id` for every vehicle. Verified live (2026-07-09): 290/333
have it (all from the one-time migration backfill, not yet from a real
sheet sync - the sheet's own `Product Family` column is still empty
sheet-wide, since the sheet owner hasn't added it yet per the "Manual
prerequisite" section above). The remaining 43 have no entry at all in
`product_family_models` for their `model`, so even a sync against a fully
populated sheet can't help them unless their serial happens to be in the
sheet with a resolvable Product Family. **Fallback stays**, with the
precise removal condition now spelled out in the code comment itself
(`maintenanceSummaryProvider.ts`).

### Rollback plan (v2.3.1 additions)

Additive only, same shape as before - two nullable columns plus one new
table, nothing existing modified or dropped:

```sql
drop table if exists tractor_in_sync_runs;
alter table vehicles drop column if exists last_synced_at;
alter table vehicles drop column if exists sync_source;
```

Application-level rollback: revert `tractorInSyncService.ts` to the prior
(update-only) version, remove the health endpoint. No data loss risk -
rolling back stops writing/reading two metadata columns and one log
table; `vehicles.product_family_id`/`sub_model` (the v2.3.0 columns) and
every row inserted by v2.3.1's sync remain exactly as they were, since
this rollback doesn't touch or depend on them.

### Failure recovery

A partially-failed run (`status: 'partial_failure'`) leaves `vehicles` in
a safe, well-defined state: every row that succeeded is already committed
(no all-or-nothing transaction wraps the whole sync - each row commits
independently), and every row that failed is listed by serial in the run
log's `failures` column with its error message. Recovery is simply
re-running the sync - rows that already succeeded update harmlessly
(idempotent), and only the previously-failed serials do real work again.
There is no separate "retry just the failures" path in this version; the
full-sheet re-run is cheap enough (a few hundred rows) that this wasn't
built out further.

## Consequences

- Product Family is now a stored, synced fact per vehicle instead of
  re-derived per read - NTR and PM read the identical value, with PM's
  fallback existing only as a temporary migration safeguard.
- Sub Model has a real, single source of truth (Tractor IN) instead of a
  dealer-typed value with no master data behind it - at the cost of a
  manual, one-time sheet-schema change and a still-manual sync trigger
  until a scheduler exists.
- `/api/ntr/variants` and its backing repository/service methods are
  removed - Sub Model is never chosen manually in NTR again.
