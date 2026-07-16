# ADR-011: Address Platform

> **Status: v2 (Supabase canonical tables) is RELEASED as v1.2.1.**
> Merged via PR #16 (`b351b424c2d3fa62d9b693dd8192fdb7ed19d54b`) and
> PR #18 (`c45c3ab584b0709e87cbdcd2fd98940aa3bfd0c0`), tagged and
> published as GitHub Release `v1.2.1` on the latter commit. Production
> re-confirmed healthy post-merge (`https://masp-mseal.vercel.app`).
>
> **Superseded in part by the v2 update below (v1.2.1).** The original
> decision ("keep the in-memory JSON design; do not migrate to DB
> tables") is no longer current - Thailand Address Master Data now
> exists in Supabase, changing the "no consumer needs foreign keys yet /
> a migration is a real production-data risk for zero benefit" reasoning
> that decision rested on. The original Problem/Audit/Decision/
> Alternatives/Consequences below are kept verbatim as the historical
> record of the v1 decision and why it was reasonable at the time; the
> **v2 Supersession** section at the end is what governs today.

## Problem

The MASP Platform Layer (v1.2.0, PR #14) shipped an Address Platform
(`src/shared/master-data/address/`) built around an in-memory JSON index
and `/api/address/*` routes (`provinceId`/`districtId` camelCase query
params). The subsequently-adopted **MASP Enterprise Development
Standard** describes a different concrete shape for the same platform:
DB tables (`provinces`/`districts`/`subdistricts`) and `/api/master/*`
routes with `province_id`/`district_id` snake_case params. Before
adopting that Standard as this repository's canonical architecture
document, the conflict needs a decision - not a silent pick of whichever
document was written more recently.

## Audit: implementation vs. Standard

| Requirement (Standard) | Current implementation | Verdict |
|---|---|---|
| Shared Tables: `provinces`/`districts`/`subdistricts` | In-memory index built once per serverless instance from `data/thaiAddressMaster.json` (7,436 rows, one-time export of the reference spreadsheet) | **Mismatch** - see Decision |
| Shared APIs: `/api/master/provinces`, `/api/master/districts?province_id=`, `/api/master/subdistricts?district_id=` | Was `/api/address/*` with `provinceId`/`districtId` | **Reconciled this ADR** - renamed to match |
| Shared Component: `AddressSelector` | Exists, same name, same cascading shape | Match |
| Province → District → Subdistrict → Postal Code (auto-fill) | Implemented - postal code auto-fills when a subdistrict has exactly one valid code | Match |
| Searchable Dropdown | Was a plain `<select>` with no filtering | **Reconciled this ADR** - added a filter `<input>` per level, narrowing the `<select>`'s options as the user types |
| Keyboard Accessible | Native `<select>`/`<input>` - accessible by default | Match |
| Cached | Server: module-level singleton index, built once per instance. Client: per-selection `Map` cache in `AddressSelector`, mirroring `useDealerBranchScope`'s branch cache | Match |
| Thai Support | Full Thai province/district/subdistrict names, `normalizeThaiAddressValue()` strips administrative prefixes for matching | Match |
| Reject invalid Province/District/Subdistrict combinations | `validateThaiAddress()` (Historical Import path) + the cascading `<select>`'s own structure (a child list is only ever populated with children of the selected parent, so an invalid combination cannot be constructed in the interactive form) | Match |
| Auto-clear child selections | Implemented - changing Province clears District/Subdistrict/Postal Code; changing District clears Subdistrict/Postal Code | Match |
| Historical Import: accept Thai names, resolve to `province_id`/`district_id`/`subdistrict_id`/`postcode` | Import validates the name hierarchy (`validateThaiAddress`) but `ntr_records` stores the Thai names as free text (`customer_province`/`customer_district`/`customer_subdistrict`/`customer_postal_code`), not resolved foreign-key IDs | **Mismatch** - see Decision |

## Decision

**Keep the in-memory JSON design; do not migrate to DB tables or add ID
foreign keys.** Reconcile only the two safe, mechanical gaps (API route
naming, searchable dropdown) and document the rest as an intentional,
justified deviation from the Standard's literal wording.

Reasoning, against this repository's own "Architecture Evolution Rule"
(a platform layer changes only when a real business module needs it, the
change measurably reduces maintenance cost, and is backed by an ADR - not
"just in case"):

1. **No consumer needs ID-based foreign keys today.** Every current
   caller (NTR's registration form, NTR's Historical Import) only ever
   needs to validate and display a Province/District/Subdistrict name -
   never to join against a `province_id` column elsewhere. Adding tables
   and foreign keys with zero real consumer would be exactly the
   "infrastructure add just in case" this repository's own rule warns
   against.
2. **The data is a static reference dataset, not business data.**
   Thailand's province/district/subdistrict list changes on the order of
   years, not days (the source doc itself calls regenerating it "a
   manual, explicit step"). A `provinces`/`districts`/`subdistricts`
   table would need to be seeded from the exact same JSON export this ADR
   would otherwise keep using directly - the DB tables would just be a
   slower, migration-risk-carrying copy of the same 7,436 rows, not a new
   capability.
3. **A DB migration here is a real production-data risk for zero measured
   benefit.** This repository's Database Standard requires migrations to
   be justified, backward-compatible, and rollback-considered - "the new
   Standard document says so" is not a measured performance or business
   justification, and the Foundation Freeze explicitly restricts
   non-bugfix/non-security/non-performance changes to a completed
   platform layer without one.
4. **The in-memory design already satisfies every *behavioral*
   requirement** (cascading, auto-clear, postal auto-fill, hierarchy
   validation, Thai support, caching, keyboard access) - the Standard's
   "Shared Tables" wording describes one possible *storage* mechanism to
   deliver that behavior, not a requirement in itself.

What **is** reconciled in this ADR (both are safe, additive, zero
production-data-risk changes):

- **API route naming**: `/api/address/*` → `/api/master/*`,
  `provinceId`/`districtId` → `province_id`/`district_id` - a pure
  rename with exactly two call sites (`AddressSelector.tsx`, one doc
  comment in `ntr-search.tsx`), no data migration, no behavior change.
- **Searchable Dropdown**: added a plain-text filter `<input>` above each
  of the three `<select>` elements in `AddressSelector`, narrowing the
  `<select>`'s own option list as the user types. Deliberately not a
  free-text `<input list>`/combobox - that would allow typing a value
  that isn't a real option, undermining "reject invalid combinations."
  No new dependency (this repo's binding rule against adding one
  casually).

## Alternatives Considered

- **Migrate to DB tables + foreign keys, fully matching the Standard's
  literal wording** - rejected per the Decision above: no consumer need,
  real migration risk, and a direct violation of this repository's own
  Architecture Evolution Rule and Foundation Freeze if attempted without
  a demonstrated business need.
- **Leave the route names as `/api/address/*` and treat the Standard's
  `/api/master/*` wording as non-binding** - rejected: the rename is
  zero-risk and costs nothing, so there is no reason to leave a known,
  documented mismatch against the now-canonical Standard when reconciling
  it is this cheap.
- **A full searchable combobox (type digital match against any position,
  ARIA combobox pattern, keyboard-navigable listbox)** - rejected as
  over-engineering for what a native `<select>` plus a filter input
  already delivers; revisit only if real usage shows the filter-input
  pattern is insufficient.

## Consequences

- `AddressSelector` and its three backing routes now match the Standard's
  naming exactly; a future reader comparing code to the Standard document
  will find them consistent.
- The Standard's "Shared Tables" and "resolve `province_id`/`district_id`/
  `subdistrict_id`/`postcode`" wording is explicitly superseded by this
  ADR for the Address Platform specifically - a future module that
  genuinely needs a real foreign-key reference to a subdistrict (not just
  display/validation) is a new, real business need that gets its own ADR
  at that time, not a retroactive trigger to redo this one.
- `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Master data rules section
  and `PROJECT_STATE.md` are updated to point here rather than restate
  the reconciliation inline.

---

## v2 Supersession (v1.2.1): Supabase becomes the canonical source

### Context

The Thailand Address Master Data has been imported into Supabase. This
is the fact that changes the v1 Decision's reasoning: point 1 above
("no consumer needs ID-based foreign keys today... adding tables would
be infrastructure just in case") and point 2 ("the DB tables would just
be a slower, migration-risk-carrying copy of the same rows, not a new
capability") no longer hold once the data already exists in Supabase
independent of anything this ADR does - the question is no longer
"should we create DB tables nobody asked for," it's "the data already
exists in the database; should the platform read from its actual
system of record or keep a separate copy." Kept as a JSON-only source at
that point would itself become the "two copies of the same reference
data" duplication this repository's rules warn against.

**Audit finding before writing this migration**: the imported
`provinces`/`districts`/`subdistricts` tables were a raw, undeduplicated
flat export - `provinces` had 7,436 rows for only 77 distinct
`province_id` values (`districts`: 7,436 rows for 928 distinct ids), no
primary keys, no foreign keys, no indexes anywhere, and a stray
duplicate `province_id_1` column on `subdistricts`. This was confirmed
via `information_schema.table_constraints` (empty result) and `count(*)`
vs. `count(distinct id)` before any migration was written - "the data
exists in Supabase" and "the data is usable as canonical reference data"
are different claims, and only the first was true without further work.

### Decision

1. **Keep the raw imported tables, untouched, as `*_raw` staging data.**
   Renamed `provinces`/`districts`/`subdistricts` → `provinces_raw`/
   `districts_raw`/`subdistricts_raw` (migration
   `address_platform_canonical_tables`) - no row deleted, no column
   changed. This is the "seed/backup" role the raw data now plays.
2. **Create new, proper canonical tables** with the same names the
   application actually reads (`provinces`/`districts`/`subdistricts`):
   `bigint` primary keys, `districts.province_id`/`subdistricts.
   district_id`/`subdistricts.province_id` foreign keys to their parent,
   and the three indexes named in the migration brief
   (`districts_province_id_idx`, `subdistricts_district_id_idx`,
   `subdistricts_postcode_idx`).
3. **Populate the canonical tables via a `DISTINCT ON (id) ... ORDER BY
   id, ctid` deduplication pass** from the `*_raw` tables in the same
   migration - one canonical row per id, deterministically picking the
   first-seen raw row's name when (rarely) more than one name variant
   existed for the same id.
4. **Build `AddressRepository`** (`src/shared/master-data/address/
   AddressRepository.ts`) as the one data-access layer over the
   canonical tables - async (Supabase queries are async, unlike the old
   in-memory index), with an instance-level cache per method (province
   list, district list per province, subdistrict list per district) so
   the "load once, reuse for every caller" property the v1 JSON index
   had is preserved without re-querying Supabase on every lookup.
5. **`MasterDataService`'s Address Platform methods (`findProvince`/
   `findDistrict`/`findSubdistrict`/`listProvinces`/`listDistricts`/
   `listSubdistricts`/`validateThaiAddress`) are now `async`**, delegating
   to `AddressRepository`. Every call site (`/api/master/*` routes,
   `ntrImportService.ts`) was updated to `await` them.
6. **The pre-v2 JSON module moved to `address/seed/thaiAddressData.ts`**
   (with its `data/thaiAddressMaster.json`) - kept only as the seed the
   `*_raw` tables were originally loaded from, a backup if the DB ever
   needs re-seeding, and a fixture for tests that want real Thai address
   data without mocking Supabase. No production code path imports it.
7. **RLS enabled on all six tables** (canonical + raw), each with a
   permissive `SELECT ... USING (true)` policy - matching this
   repository's existing pattern for other public reference tables
   (`problem_codes`, `product_families`): RLS technically on, but this
   is non-tenant-scoped reference data every authenticated session reads
   identically, so there is nothing to restrict per-row.

### Alternatives Considered

- **Deduplicate the raw tables in place (`DELETE` the extra rows, then
  add PK/FK/indexes to the same table)** - rejected: destructive on a
  production table for no benefit over creating clean tables alongside;
  the instruction to treat imported data as **immutable** staging rules
  this out directly, and it also removes the "backup to re-seed from"
  property entirely if the dedup logic ever needs revisiting.
- **Views over the raw tables instead of new physical tables** - rejected:
  a `SELECT DISTINCT` view cannot itself hold a primary key or foreign
  key constraint, so the required indexes/FKs (`districts.province_id`,
  `subdistricts.district_id`, `subdistricts.postcode`) would not be
  real, enforced constraints - only query-time behavior that Postgres
  could still plan inefficiently around.
- **Leave `MasterDataService`'s Address methods synchronous, fetch all
  three tables once at cold-start and keep an in-memory index (same
  shape as v1, just Supabase-sourced)** - rejected: this repository's own
  convention for reference-data reads (dealers/branches/technicians in
  `reference/referenceData.ts`) is a thin async pass-through to
  Supabase, not a bulk-preload-then-sync-index pattern; matching that
  existing convention was preferred over inventing a second one.

### Migration

Applied as Supabase migration `address_platform_canonical_tables`:
rename raw tables → create canonical tables (PK/FK) → create the three
required indexes → populate via `INSERT ... SELECT DISTINCT ON` → enable
RLS + permissive SELECT policy on all six tables.

**Data quality summary** (raw row count → canonical row count):

| Table | Raw rows | Canonical rows | Duplicates removed | Invalid rows rejected |
|---|---|---|---|---|
| Provinces | 7,436 | 77 | 7,359 | 0 |
| Districts | 7,436 | 928 | 6,508 | 0 |
| Subdistricts | 7,436 | 7,436 | 0 | 0 |

"Invalid rows rejected" (0 for all three) means every raw row had a
non-null id/parent-id and was eligible for the dedup pass - the
migration's `WHERE id IS NOT NULL` guards existed defensively but found
nothing to exclude in this particular import. Subdistricts needed no
deduplication (the raw export was already correctly one-row-per-
subdistrict); Provinces/Districts did, since the raw export repeated
every province/district's row once per subdistrict.

**Constraints verified post-migration** (`pg_constraint`/`pg_indexes`):
primary keys on all three canonical tables (`province_id`/`district_id`/
`subdistrict_id`), foreign keys (`districts.province_id` →
`provinces`, `subdistricts.district_id` → `districts`,
`subdistricts.province_id` → `provinces`), and the three required
indexes (`districts_province_id_idx`, `subdistricts_district_id_idx`,
`subdistricts_postcode_idx`). The primary keys themselves already are
"unique constraints on stable codes rather than names" - Thailand's
official administrative id, not the display name, is the uniqueness
key - so no additional unique constraint was needed on top of them.

No destructive change to any table another module reads - `ntr_records`
still stores `customer_province`/`customer_district`/`customer_
subdistrict`/`customer_postal_code` as free text (unchanged); this
migration only affects the Address Platform's own reference tables.

**Roadmap note**: migrating `ntr_records`'s (or any future module's)
customer address fields from free text to resolved
province_id/district_id/subdistrict_id foreign keys is explicitly
deferred - it requires its own future ADR once a real business
requirement for the join exists (e.g. address-based reporting/
analytics), not a speculative schema change bundled into this one. See
`docs/ROADMAP.md`.

### Consequences

- Supabase (via `AddressRepository`) is now the single, real system of
  record for Thai Province/District/Subdistrict/Postcode data - the v1
  ADR's "the JSON is the source of truth" is no longer true anywhere in
  this codebase.
- Every Address Platform method is now `async` - a future caller must
  `await` it; there is no synchronous path left (the old
  `thaiAddressData.ts` functions still exist, synchronously, but only as
  seed/test-fixture code, never wired into `MasterDataService`).
- Re-seeding the canonical tables (if Thailand's official boundaries
  ever change) means regenerating `thaiAddressMaster.json`, reloading
  `*_raw`, and re-running the same `DISTINCT ON` population query - not
  hand-editing 7,436 JSON rows.
- `docs/architecture/MASTER_DATA_PLATFORM.md` and
  `docs/architecture/ADDRESS_PLATFORM.md` (new) hold the current
  architecture/schema/API reference; this ADR stays the historical
  decision record for both the v1 and v2 choices.
