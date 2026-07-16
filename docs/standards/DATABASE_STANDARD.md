# Database Standard

Binding Supabase/Postgres convention for every current and future MASP
table. Grounded in the live schema (`records`, `pm_records`, `dealers`,
`branches`, `technicians`, `users`, `vehicles`, `problem_codes`, `job_seq`)
— see `list_tables` via the Supabase MCP tool before assuming a column
exists; this document describes the convention, not a live schema dump.

## Naming

- Table names: lowercase, snake_case, plural — `dealers`, `branches`,
  `problem_codes`, `pm_records`. Full rationale: `docs/NAMING_STANDARD.md`.
- Column names: lowercase, snake_case — `dealer_id`, `found_date`,
  `hour_meter`.
- Foreign key columns: `<referenced_table_singular>_id` —
  `dealer_id`, `branch_id`, `technician_id`, `pm_interval_id`.
- A module's primary business-record table is named after the business
  entity, not the module folder, when they differ for historical reasons
  (`pm_records` for the `maintenance` technical domain is the precedent —
  see `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s note that a technical
  rename must never require a matching database rename).

## Primary keys

New tables use a `uuid` primary key (`id`, default `gen_random_uuid()`),
matching `pm_records`. A table that exists purely as a per-key counter
(like `job_seq`) is the one documented exception and uses a composite
natural key instead (see below) — that exception does not extend to any
other table.

## Foreign keys

- Every foreign key column is nullable only when the referenced entity is
  genuinely optional for that record's lifecycle (e.g. `branch_id` on a
  record created before a branch was known); required relationships use
  `NOT NULL` with a Postgres foreign key constraint, not just an
  application-level assumption.
- A record never carries a live foreign key to data that should be a
  point-in-time snapshot instead (see `pm_records`' `model`,
  `delivery_date`, `engine_number`, `dealer_name`, `branch_name`,
  `technician_name` columns — deliberately captured at create time, never
  joined live back to `vehicles`/`dealers`/`branches`/`technicians`, so a
  record stays historically accurate even after the master data changes).
  A new module decides, per field, whether it is a live reference or a
  snapshot, and documents that choice in its own module doc — this is a
  business decision, not a database default.

## Soft delete

Business records are never hard-deleted through the application. Every
business table has:

- `record_status` (`Active` / `Deleted`) — the same column name and two
  values as `records`, not a per-module bespoke enum.
- `deleted_by`, `deleted_at` — set together with `record_status='Deleted'`
  in the same write.
- An optional `deleted_reason` when the module's delete flow requires one
  (PM's locked-record delete requires a reason; MQR's does not — a
  module decides this per its own lock/permission model).

Every list/detail query filters `record_status = 'Active'` at the
application layer (`applyScope()`) **in addition to** RLS — see
`SECURITY_STANDARD.md`. Hard delete is reserved for the `users` table,
SuperAdmin-only, and stays that way for any new module's user-like data.

Do not conflate `record_status` (soft-delete state) with a module's own
business lifecycle/status field (`records.status` — Open/Closed/etc.,
`pm_records.status`) — they are two different columns with two different
meanings, per `docs/MODULE_LIFECYCLE.md`'s explicit warning.

## Audit fields

Every business table carries:

- `created_by` (text, username — not a foreign key to `users.id`, matching
  the existing pattern), `created_at` (`timestamptz`, default `now()`).
- `updated_by`, `updated_at`, updated on every mutating write.

Field-level history beyond "who/when last touched this row" is not stored
on the record itself — it lives in the shared audit log
(`logAuditEvent()`/`logAuditEvents()`/`diffFieldsForAudit()` in
`src/lib/db.ts`), tagged with a `module` discriminator (`'mqr'`, `'pm'`,
and a new value per future module) and `recordId`/`recordRef`. A new
module writes to this shared log; it does not create its own audit
table.

## Timestamp columns

Every `timestamptz` column is stored and queried in UTC (Postgres/Vercel
default) — display-only conversion to `Asia/Bangkok` (GMT+7) happens
exclusively through `formatThaiDateTime()`/`formatDateTimeLocalized()`
(`src/lib/thaiDate.ts`). Never call `.toLocaleString()`/`.toString()` on a
`Date` directly in a component; never store a pre-converted local
timestamp in the database. This has caused real production bugs
(timestamps silently drifting 7 hours) and is treated as a hard rule, not
a style preference.

Business-meaningful dates that are *not* "when this row changed"
(`found_date`, `performed_date`, `scheduled_date`, `next_pm_due`) are
stored as plain `date` (no time/timezone component) — they represent a
calendar day, not an instant.

## Indexes

- Every foreign key column used in a `WHERE`/`applyScope()` filter has an
  index — at minimum `dealer_id`, `branch_id`, and `created_by` on any
  table that RLS/`applyScope()` filters by role.
- Every column a list view sorts by default (`created_at`,
  `performed_date`) is indexed to support that `.order()` without a full
  table scan as row counts grow.
- A composite index backs any column pair queried together habitually
  (e.g. `job_seq`'s composite primary key `(dealer_id, year)`, queried
  atomically by `next_job_seq()`).

## Dealer scope

Every business table has a `dealer_id` column (nullable only for
central/system-level tables that are deliberately not dealer-scoped, e.g.
`problem_codes`). Both of the following are mandatory for every new
table, not either/or:

1. **Postgres RLS**, enabled on the table.
2. **`applyScope()`-equivalent filtering in application code** — every
   query in the module's repository layer adds the same dealer/role
   filter RLS enforces, independent of it. This is the single rule most
   likely to cause a real cross-tenant data leak if skipped (see
   `SECURITY_STANDARD.md` and the PM cross-tenant IDOR fixed in Release
   1.0 as the concrete example of what happens when the *application*
   layer is missing even though RLS existed).

## Report-number generation

A module's business-document number (job number, PM number, and every
future module's own number) is generated via the shared `next_job_seq()`
RPC — an atomic per-`(bucket_key, year)` counter — never a
client-computed or `SELECT MAX(...) + 1`-style counter (races under
concurrent inserts). The bucket key is the module-prefixed dealer id
(`MQR:<dealerId>`, `PM:<dealerId>`, and so on for a new module) so two
modules issuing numbers for the same dealer in the same year never share
a counter — see the Dealer Standard format,
`<Module>-<DealerCode>-<Year>-<Running>`, and
`docs/releases/archive/RC1_RELEASE_NOTES.md` for why the module prefix on the
bucket key specifically exists (it was added to prevent MQR and PM from
colliding on the same counter).

## Migration naming

Supabase migrations (applied via `mcp__claude_ai_Supabase__apply_migration`
or the Supabase CLI) are named `<sequence>_<verb>_<what>.sql` in
chronological, monotonically increasing order — e.g.
`0043_add_pm_records_pm_interval_id.sql` — never edited after being
applied to any environment; a correction is always a new migration.
`list_migrations` is checked before writing a new one, to confirm the
next sequence number and that no equivalent migration already exists.

## Avoid storing duplicate business data

Before adding a column, check whether the value can be resolved from
existing master data instead of persisted as a second copy:

- **Reference master data by foreign key when a master table exists**
  (e.g. `ntr_records.product_family_id → product_families.id`) — never
  duplicate the master row's name/label as a free-text column alongside
  the FK.
- **Compose a value from more granular fields already being captured
  rather than asking for it twice** — e.g. NTR's `customer_name` is
  derived server-side (`NtrService`'s `deriveCustomerName()`) from
  `customer_title`/`customer_first_name`/`customer_last_name` when those
  are present, so an operator who fills in structured name fields is
  never also required to separately type a duplicate full name.
- **Only add a free-text column when no master table exists yet** for
  that concept (e.g. NTR's `variant` — no Variant master table exists in
  MASP today, so free text is the correct fallback, not a reason to
  invent a master table speculatively).

### Example: NTR's enterprise-detail fields (Release v1.1)

Added as nullable columns, additive migration only, no backfill:

| Column | Required? | Source |
|---|---|---|
| `customer_title` | Optional | Manual entry |
| `customer_first_name` | Optional | Manual entry |
| `customer_last_name` | Optional | Manual entry |
| `customer_subdistrict` | Optional | Manual entry (free text, matches existing district/province pattern — no Thai address master-data hierarchy exists yet) |
| `product_family_id` | Optional | **Resolved from `product_families` master data** — never a duplicated free-text name |
| `variant` | Optional | Manual entry (no Variant master table exists yet) |
| `pdi_date` | Optional | Manual entry |
| `manufacturing_year` | Optional | Manual entry |

`engine_model` was deliberately **not** added — per this rule, a field is
only persisted when it can't be derived from Tractor/Product master data,
and no such need was established for it in this pass; it remains
undisplayed on the redesigned PDF/Detail Page rather than added as a
speculative column.

## Verification

Documentation only. Does not create, alter, or apply any migration.
