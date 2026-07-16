# NTR Historical Import Framework

> **RETIRED (2026-07-16, ADR-038, Product Owner decision).** Historical
> NTR Import (formerly "Legacy Import") is permanently retired - no route,
> page, API, or code path described below still exists. This document is
> kept as historical record of how existing, already-imported `ntr_records`
> data got into the system, not as active documentation. See
> `docs/adr/ADR-038-Historical-NTR-Import-Retirement.md`.
>
> **Superseded status line (kept for history, no longer current):**
> Status: Foundation (feature-frozen), reaffirmed as of MASP Platform
> Foundation v1.1.0 (`docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md`;
> originally frozen at v1.0.0, see `docs/releases/archive/`). Further
> work on this framework is bug fixes and security hardening only, not
> new capability, until an explicit future decision reopens it.

Enterprise-grade documentation for `src/features/ntr/`'s Legacy Import
tool (`/admin/legacy-import`) - importing historical New Tractor
Registration (NTR) records from legacy dealer systems into MASP. This
document is the authoritative reference for the import contract and
validation rules; `docs/standards/NTR_IMPORT_MANUAL.md` remains the
shorter operator-facing quick reference and now points here for detail.

## What this is (and isn't)

This is an **enhancement** of an already-working v1.0 framework, not a
rebuild. Upload → Validation → Preview → Commit, one atomic transaction
per row (`commit_ntr_legacy_import_row`), a stored session per attempt
(committed or not) - all of that predates this document and is unchanged.
This document adds: address hierarchy validation against Thailand's real
province/district/subdistrict data, in-file duplicate detection,
date-validity checks, a configurable Serial Number validation policy, a
downloadable `NTR_IMPORT_RESULT.xlsx`, and execution-time reporting.

## Template Format

`.xlsx` (`ntr-legacy-import-template.xlsx`, downloadable from
`/api/ntr/import/template`) or `.csv`. Three sheets: `Instructions`,
`Data`, `_META` (template name/version/module - informational, checked
on upload but never a hard reject on its own). **Columns are matched by
header name/alias, not position** - a dealer's spreadsheet can reorder
columns or use a recognized synonym (e.g. "Zip Code" for Postal Code);
see `NTR_IMPORT_FIELDS` in `src/features/ntr/services/ntrImportFields.ts`
for the full alias list. (This corrects `NTR_IMPORT_MANUAL.md`'s older
claim that parsing is positional - that predates the alias-based
`ColumnMappingService` rewrite and was never updated to match; fixed
alongside this document.)

**Removed from the template, per this enhancement:** nothing - Customer
Photo with Tractor / Customer Signature / Dealer Signature never existed
as Data-sheet columns in the current (v1.2) template to begin with.
Historical import has never required photos or signatures: `commit()`
writes every photo/video/audio field as `null` unconditionally on
import. Photos/signatures are added later from the NTR Detail page, as
intended.

## Mandatory Fields (v1.2 template)

`Dealer Code`, `Product Serial Number`, `Model`, `Retail Date`, `Hour
Meter`, `Customer Title`, `Customer First Name`, `Customer Last Name`,
`Address`, `Province`, `District`, `Sub-District`, `Customer Phone`, and
`Acceptance Date` (labeled "Delivery Date"/"Retail Date (Acceptance)"/
"NTR Date" in some dealer files). `Customer Name` remains optional -
composed automatically from Customer Title/First Name/Last Name when
left blank, same rule the manual registration form uses.

**Changed from the v1.1 template:** `Engine Number` moved from mandatory
to optional. `Model`, `Retail Date`, `Hour Meter`, `Customer Title`,
`Customer First Name`, `Customer Last Name`, `Address`, `Province`,
`District`, and `Sub-District` moved from optional to mandatory.

## Optional Fields

Branch, Engine Number, Customer Postal Code, Customer Type, Salesperson,
Receiving Person, Product Family, Variant, PDI Date, **PDI Number**
(new in v1.2), Manufacturing Year. All optional fields may be blank with
no validation consequence, **except** that once a field participates in
a validated relationship (address hierarchy, date ordering) an
inconsistent combination is still rejected - see below.

## Address Lookup

This is the MASP Platform's Address Platform
(`src/shared/master-data/address/`), consumed here via
`MasterDataService` - not an NTR-specific implementation. Source of
truth (as of ADR-011 v2): the canonical `provinces`/`districts`/
`subdistricts` Supabase tables (7,436 subdistricts, 928 districts, 77
provinces - deduplicated, with PK/FK/indexes), queried through
`AddressRepository`. Each import run's repeated lookups are served from
that repository's own in-memory cache (populated on first query, reused
for the rest of the run) rather than one round-trip per row.
`src/shared/master-data/address/seed/thaiAddressData.ts` (the pre-v2
JSON-backed implementation) is kept only as seed/backup/test-fixture
data - it is not read by this import path.

**Normalization before lookup** (`normalizeThaiAddressValue()`): trims
leading/trailing whitespace, collapses multiple internal spaces to one,
and strips a recognized administrative-unit prefix (`อำเภอ`/`เขต`/
`ตำบล`/`แขวง`/`จังหวัด`/`กิ่งอำเภอ`) so both "อำเภอเมืองบุรีรัมย์" and
"เมืองบุรีรัมย์" resolve to the same district - the master data's own
`*ThaiShort` columns are the canonical "no prefix" form matched against,
never an invented abbreviation table. Normalized values are used **only
for comparison** - the original imported text is always what gets
stored on `ntr_records`.

## Address Validation

Enforced top-down, only as far as the row actually provides data
(everything stays optional - an address-free row is always fine):

1. **Province**, if given, must be a real Thai province - else `Unknown
   Province "<value>"`.
2. **District**, if given, requires a resolved Province, and must belong
   to it - else `District "<value>" does not belong to Province
   "<value>"`. (The milestone's own worked example: District
   "เมืองบุรีรัมย์" does not belong to Province "สุรินทร์" - it belongs
   to "บุรีรัมย์". This exact case is covered by
   `shared/master-data/address/__tests__/addressValidation.test.ts`.)
3. **Sub-District**, if given, requires a resolved District, and must
   belong to it - else `Sub-District "<value>" does not belong to
   District "<value>"`.
4. **Postal Code**, if given, requires a resolved Sub-District, and must
   match one of that subdistrict's known postal code(s) (a subdistrict
   can validly have more than one) - else `Postal Code "<value>" does
   not match Sub-District "<value>"`.

Nothing is ever silently guessed or auto-corrected - an unmatched value
at any level fails that row with a specific, actionable message.

## Serial Number Validation

Two import modes, selected per import run (never persisted on the
session row - no schema change; the import UI resends whichever mode it
used at Preview when it later calls Commit):

- **Legacy Import Mode (default)** - matches this framework's existing,
  documented behavior: if the Product Serial Number matches an existing
  Tractor, the row links to it (and if the row's `Model` disagrees with
  that Tractor's stored Model, a **warning** is raised, not a failure).
  If the serial doesn't match any existing Tractor, one is created
  automatically (unchanged from before this enhancement) **and a
  warning is raised**: *"New Tractor record was created automatically
  from historical import."* Before creating it, the Serial Number's
  format is checked for basic plausibility (alphanumeric plus hyphens,
  3-50 characters) - genuinely malformed input still fails outright
  rather than creating garbage Tractor data.
- **Strict Import Mode** - an unrecognized Product Serial Number is
  rejected: `Unknown Product Serial Number`, no Tractor is created.
  Choose this only when every Tractor is already expected to exist in
  MASP.

Default is Legacy Import Mode - **this enhancement does not change
today's production default behavior.**

## Duplicate Detection

| Case | Scope | Outcome |
|---|---|---|
| Serial already has an active NTR on file | Database-wide | **Rejected** (`duplicate`) |
| Serial repeated within the same uploaded file | This file only | **Rejected** (`duplicate`) |
| Customer Phone repeated within the same file | This file only | **Warning only** - never blocks import |
| Customer Name repeated within the same file | This file only | **Warning only** - never blocks import |

There is no Invoice Number or Registration Number column anywhere in
`ntr_records`/this template - "Duplicate Invoice"/"Duplicate
Registration" from the milestone brief have no field to check against
in this schema (`ntr_number`, the generated business key, is already
guaranteed unique by a database constraint and is never user-supplied,
so it can't be "duplicated" by an import row). Not implemented as
invented debt; flagged here rather than silently ignored. Phone/Name
duplicate checks are scoped to the current file only (not a
database-wide scan) - see Performance below for why.

## Date Validation

- **Retail Date** (if given) must not be in the future.
- **Retail Date** (if given) must not be before **Manufacturing Year**
  (if given) - checked at year granularity, since this template only
  captures a manufacturing *year*, not a full manufacturing date.
- **Before Invoice Date** - not implemented. No Invoice Date field
  exists anywhere in this schema or template; there is nothing to
  validate against. Not silently faked.
- **Duplicate Retail Date for the same tractor** - not a separate check.
  A second row for the same Serial Number is already rejected by the
  duplicate-serial checks above before this function ever sees two
  different dates for one tractor.

## Dry Run

`preview()` **never writes** to `ntr_records`/`vehicles` - it only
parses, validates, and stores the raw session row (status
`Validated`) so every attempt is auditable, including ones never
committed. This was already true before this enhancement; unchanged.

## Import Flow

Upload → Validation → Preview Result → Commit Import, exactly per the
milestone's own diagram:

1. **Upload** - `/api/ntr/import/preview`, multipart form (`file` +
   `importMode`).
2. **Validation** - `NtrImportService.preview()`'s `validateRows()`:
   required fields, dates, address, in-file duplicates, database
   duplicates, Serial Number policy (mode-dependent), phone/name
   warnings.
3. **Preview Result** - counts (total/valid/duplicate/skipped/failed),
   per-row outcomes and reasons, warnings, column mapping report,
   execution time - returned to the UI, nothing written to
   `ntr_records` yet.
4. **Commit Import** - `/api/ntr/import/commit`, re-parses and
   re-validates from the session's *stored* file bytes (never a
   client-echoed row list - a row that changed between preview and
   commit, e.g. someone else registered the same serial meanwhile, is
   re-classified, not blindly imported), then commits every row that
   re-validates as `valid`.

## Transaction Strategy

**Partial import, one row = one atomic transaction.** Each valid row
calls `commit_ntr_legacy_import_row()` (a single Postgres function -
Tractor find-or-create + NTR record + Timeline + Audit together, or none
of it, on any exception). A failure on one row is caught, recorded in
that row's error entry, and the loop **continues** to the next row -
"never stop because of one invalid record," exactly as required. This
was already the framework's design before this enhancement; unchanged.

## Audit Log

Every import attempt - dry-run or committed - is a row in
`ntr_import_sessions`: `importer`, `filename`, `total_records`, `valid_count`/
`duplicate_count`/`skipped_count`/`failed_count`, `errors` (jsonb, row/
serial/reason), `status` (`Pending`→`Validated`→`Imported`→`Archive
Pending`→`Archived`/`Archive Failed`), `started_at`/`completed_at`. This
enhancement adds **Execution Time** to every preview/commit response
(`executionTimeMs`, measured wall-clock milliseconds for that pass) and
**Import Mode** (`importMode`, echoed back on the response - not
persisted on the row itself, see Serial Number Validation above).
Audit data is retained indefinitely (no purge job exists for
`ntr_import_sessions`).

## Idempotency

Importing the same file twice never creates duplicate NTR records:
every row's Product Serial Number is checked against `ntr_records` for
an existing **active** NTR before commit - a second import attempt for
an already-registered serial is classified `duplicate` and skipped, not
re-inserted. Combined with the new in-file duplicate check, a serial
can also never be imported twice from *within* a single file, even
before the first occurrence reaches the database-side check.

## Error Messages

Every row in the downloadable `NTR_IMPORT_RESULT.xlsx`
(`GET /api/ntr/import/sessions/:id/result?importMode=<legacy|strict>`)
carries every original column plus three appended columns: **Status**
(`valid`/`duplicate`/`skipped`/`failed`), **Error Message** (populated
for `failed`/`duplicate` rows), **Warning** (populated for any row with
one or more non-blocking warnings, semicolon-joined if more than one).
A dealer can fix the flagged rows directly in this file and re-upload
it. Reasons follow the format `<Field/Concept> "<value>" <what's
wrong>`, e.g.:

- `Invalid Province "..." - not a recognized Thailand province` / `Unknown Product Serial Number`
- `District "..." does not belong to Province "..."`
- `Postal Code "..." does not match Sub-District "..."`
- `Duplicate Product Serial Number - already used on row N in this file`
- `Duplicate NTR - already registered as NTR-...`
- `Retail Date "..." cannot be in the future`
- `Retail Date "..." is before Manufacturing Year ...`

## What this enhancement deliberately does not do

- No table redesign, no new required columns on `ntr_records`/
  `ntr_import_sessions` - `import_mode` is a request-time parameter, not
  a stored column.
- No change to the Machine Domain or the Storage Platform.
- No change to `commit_ntr_legacy_import_row()`'s transaction logic -
  Strict Mode's unknown-serial rows are filtered out during validation,
  before `commit()` ever attempts them; the RPC itself is untouched.
- No database-wide phone/customer-name duplicate scan (in-file only) -
  a design choice for the 10,000-row performance target, documented
  above, not an oversight.
