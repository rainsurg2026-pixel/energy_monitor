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
npm run migration:workbook -- "D:\path\to\sanitized-workbook.xlsx" --import
```

The initial Phase 4 tests use sanitized JSON fixtures and do not touch the
operational workbooks or a database. Live Supabase import verification remains
a separate deployment gate.
