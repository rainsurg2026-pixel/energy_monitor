# Phase 4 Workbook Data Migration

Phase 4 preserves the Desktop v2.3.1 workbook data through a server-side,
transactional pipeline:

```text
Read -> Validate -> Preview -> Import -> Verify
```

## Safety boundary

The migration command reads `.xlsx`/`.xlsm` files only. It does not save,
recalculate, or patch the source workbook. The source SHA-256 hash is recorded
in `migration_batches` and `provenance_records`. A source hash plus site code
forms the idempotency key.

Preview is the default and performs no database writes. Import requires all of
the following local environment gates:

```text
MIGRATION_SITE_CODE=<existing development site>
MIGRATION_TARGET=development or test
MIGRATION_ALLOW_WRITE=true
```

The Desktop workbooks keep Rack Unit Capacity images in the external
`data\rack-unit-images\<Facility>` filesystem store rather than inside the
`.xlsm` package. To include those images in a migration preview/import, set
`MIGRATION_IMAGES_ROOT` to either that exact directory or a release directory
containing it. The preview reports `rackUnitCapacityImageCount`; image bytes
are validated by magic bytes, dimensions, and SHA-256 before import. An image
is rejected when its month has no Rack Unit Capacity numeric row.

The same preview reads the Desktop `Dashboard-FAC` summary/detail mapping, the
persisted `2. UPS Group History` table, and the persisted `Rack Capacity
History` table. It reports `dashboardMappingRowCount`,
`upsGroupHistoryRowCount`, and `rackCapacityHistoryRowCount`; an import retains
the source UPS history values and persists the read-only Dashboard-FAC mapping
in the existing `site_profiles.policy` JSON so Web Dashboard and Excel export
use the source workbook's topology, labels, and saved history rather than a
facility-specific hard-coded substitute. Identical duplicate UPS history
snapshots are collapsed by key with the newest timestamp; conflicting values
are rejected.

Production targets are rejected by the importer. The migration connection uses
the existing migration/admin database path; browser credentials and frontend
Supabase access are never involved.

## Validation and provenance

Validation rejects workbook structure errors, duplicate rows/months, missing
month/device mappings, unknown device identifiers, invalid months, and
non-finite numeric values. Formula results found in authoritative input fields
are rejected rather than trusted; read-only derived fields are retained as
evidence. Rejected rows/issues are returned in the preview
diagnostics and, for an attempted database import, recorded in
`migration_errors`.

Authoritative raw values are written to the Phase 2 raw-input tables. Workbook
formula/cache results are captured separately in `legacy_cached_evidence` and
are never used as authoritative inputs. Each imported period receives source
file, hash, sheet, and source-location provenance.

## Derived values and verification

Derived values are recomputed through the shared Phase 1 domain layer using the
Desktop v2.3.1 formula contract. The importer records calculated outputs in
`calculation_runs` and `calculation_output_values`, then reads the imported raw
values back inside the same transaction and compares the recalculated results.
Any mismatch rolls back the entire import. A repeat import with the same source
hash is skipped; a different source targeting an existing month is rejected
rather than overwritten.

## Usage

Read/validate/preview a workbook:

```powershell
$env:MIGRATION_SITE_CODE = "rangsit"
npm run migration:workbook -- "D:\path\to\sanitized-workbook.xlsx"
```

Import is an explicit development/test-only operation after reviewing the
preview:

```powershell
$env:MIGRATION_TARGET = "development"
$env:MIGRATION_ALLOW_WRITE = "true"
$env:MIGRATION_IMAGES_ROOT = "D:\path\to\release\data\rack-unit-images"
npm run migration:workbook -- "D:\path\to\sanitized-workbook.xlsx" --import
```

## Controlled Production import

The normal importer intentionally rejects Production. When the Product Owner
has approved historical Desktop data for Production, use the separate guarded
command below against the authoritative `.xlsm` source files. It verifies the
known Production Supabase project, requires `NODE_ENV=production`, requires an
explicit `YES` confirmation, and requires the operator to copy the printed
workbook SHA-256 into `MIGRATION_CONFIRM_SOURCE_HASH`.

```powershell
$env:NODE_ENV = "production"
$env:MIGRATION_SITE_CODE = "rangsit"
$env:MIGRATION_ALLOW_WRITE = "true"
$env:MIGRATION_CONFIRM_PRODUCTION_IMPORT = "YES"
$env:MIGRATION_CONFIRM_SOURCE_HASH = "<sha256-from-preview>"
$env:MIGRATION_IMAGES_ROOT = "D:\path\to\release\data\rack-unit-images"
npm run migration:workbook:production -- "D:\path\to\DC_Rangsit.xlsm"
```

Run the same command separately for `srinakarin`. The command is import-only:
it does not run schema migrations, seed sites, create users, change the Global
Display Period, or copy data from Preview. The Production schema, sites,
administrator, and a Display Period that includes the source months must
already exist. After importing, verify that the configured Display Period
includes the historical months; the API deliberately hides rows outside that
period.

The initial Phase 4 tests use sanitized JSON fixtures and do not touch the
operational workbooks or a database. Live Supabase import verification remains
a separate deployment gate.
