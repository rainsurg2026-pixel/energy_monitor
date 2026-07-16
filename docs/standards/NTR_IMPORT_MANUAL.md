# NTR Legacy Import — Template Manual

> **RETIRED (2026-07-16, ADR-038, Product Owner decision).** The
> `/admin/legacy-import` tool this manual describes no longer exists.
> Kept as historical record only - see
> `docs/adr/ADR-038-Historical-NTR-Import-Retirement.md`.

How to prepare a historical-data file for the NTR Legacy Import tool
(`/admin/legacy-import`, Super Administrator only). This is the short
operator-facing quick reference - see
`docs/import/NTR_HISTORICAL_IMPORT.md` for full detail (address
validation, Serial Number modes, duplicate detection, date validation,
transaction strategy, audit log, error messages). Read alongside
`docs/standards/MODULE_DEVELOPMENT_STANDARD.md` and the tool's own code
(`src/features/ntr/services/ntrImportFields.ts`), which is the actual
source of truth for the field/alias list if this document ever drifts
from it.

## File format

`.xlsx` or `.csv`. The first row is the header row and is not itself
imported — data starts on row 2. **Columns are matched by header
name/alias, not position** - a file with reordered columns or a
recognized synonym header (e.g. "Zip Code" for Postal Code) still parses
correctly, via `ColumnMappingService`. The table below still reflects
the template's own default column order (and is what the downloadable
template ships with), but a dealer's existing export does not need to
match it exactly:

| # | Column | Required? | Notes |
|---|---|---|---|
| 1 | `dealer_id` | **Required** | Must match an existing Dealer Code exactly |
| 2 | `branch_id` | Optional | Branch UUID, if known |
| 3 | `serial` | **Required** | Tractor serial number — if no matching `vehicles` row exists, one is created automatically |
| 4 | `model` | **Required** | Changed from Optional in Release v1.2 |
| 5 | `engine_number` | Optional | Changed from Required in Release v1.2 |
| 6 | `customer_name` | Optional* | *Composed automatically from `customer_title`/`customer_first_name`/`customer_last_name` (columns 18–20, all required as of v1.2) — see below |
| 7 | `customer_phone` | **Required** | Thai mobile format, 10 digits starting with 0 |
| 8 | `customer_address` | **Required** | Changed from Optional in Release v1.2 |
| 9 | `customer_district` | **Required** | Changed from Optional in Release v1.2 |
| 10 | `customer_province` | **Required** | Changed from Optional in Release v1.2 |
| 11 | `customer_postal_code` | Optional | |
| 12 | `customer_type` | Optional | `Individual` / `Company` (or Thai `บุคคลธรรมดา` / `นิติบุคคล`) |
| 13 | `retail_date` | **Required** | Changed from Optional in Release v1.2. ISO `YYYY-MM-DD` |
| 14 | `delivery_date` | **Required** | ISO `YYYY-MM-DD` — this is the Acceptance Date (see `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s Retail Date vs. Acceptance Date note), not "Retail Date" |
| 15 | `salesperson` | Optional | |
| 16 | `receiving_person` | Optional | |
| 17 | `hour_meter` | **Required** | Changed from Optional in Release v1.2. Numeric |
| 18 | `customer_title` | **Required** | Changed from Optional in Release v1.2 |
| 19 | `customer_first_name` | **Required** | Changed from Optional in Release v1.2 |
| 20 | `customer_last_name` | **Required** | Changed from Optional in Release v1.2 |
| 21 | `customer_subdistrict` | **Required** | Changed from Optional in Release v1.2 |
| 22 | `product_family_id` | Optional | Product Family UUID (must reference an existing, active Product Family) |
| 23 | `variant` | Optional | Free text |
| 24 | `pdi_date` | Optional | ISO `YYYY-MM-DD` |
| 25 | `pdi_number` | Optional | Added in Release v1.2 — free text |
| 26 | `manufacturing_year` | Optional | 4-digit year |

**A legacy file exported before Release v1.2 (only 25 columns) still
imports** for any row that already happens to fill the columns promoted
to Required above — `pdi_number` (column 25) is appended at the end, not
inserted in the middle, so an older file's existing columns never need
reordering. A row missing a newly-Required column (Model/Retail Date/
Hour Meter/Customer Title/First Name/Last Name/Address/Province/
District/Sub-District) now fails validation where it previously
imported with that field left `NULL` — this is the intended, documented
behavior change for Release v1.2, not a bug.

## Customer name: two ways to provide it

Columns 18–20 (`customer_title`/`customer_first_name`/
`customer_last_name`) are required as of Release v1.2, so `customer_name`
(column 6) is composed from them automatically and can be left blank.
Filling column 6 explicitly still works and wins if non-empty (same rule
the manual registration form uses, see
`docs/standards/DATABASE_STANDARD.md`'s "avoid storing duplicate
business data").

## Validation (Preview step)

Every row is checked before anything is imported:

- **Required fields** (`dealer_id`, `serial`, `model`, `delivery_date`,
  `retail_date`, `hour_meter`, `customer_title`, `customer_first_name`,
  `customer_last_name`, `customer_phone`, `customer_address`,
  `customer_province`, `customer_district`, `customer_subdistrict`) —
  missing any marks the row **Failed**.
- **Dealer must exist** — an unrecognized `dealer_id` marks the row
  **Failed**.
- **Duplicate detection** — a `serial` that already has an active NTR on
  file marks the row **Duplicate**, not re-imported.
- **Empty row** (every key field blank) is marked **Skipped**, not
  Failed — distinguishing a genuinely malformed row from a blank
  spreadsheet row left over from formatting.

Nothing is written to the database during Preview. Only after reviewing
the counts and clicking **Import** does `commit()` re-fetch and
re-validate the stored file and actually write rows — see
`src/features/ntr/services/ntrImportService.ts`'s header comment for why
it re-validates rather than trusting the preview's row list.

## Product Family reference

Column 22 (`product_family_id`) must be an existing Product Family's
UUID, not a free-text name — this column resolves to master data
(`product_families`), it never creates a new Product Family. Look up the
correct UUID via the Product Family admin page
(`/admin/product-families`) before preparing the import file. A value
that doesn't match any Product Family is simply left `NULL` on the
resulting record (not a validation failure) — the record still imports,
just without a resolved Product Family until corrected manually.

## Verification

This document was updated (parsing-method description corrected;
pointer to `docs/import/NTR_HISTORICAL_IMPORT.md` added) as part of the
NTR Historical Import Framework enhancement, which did modify the
import tool - see that document for exactly what changed (address
validation, Serial Number import modes, duplicate detection, date
validation, `NTR_IMPORT_RESULT.xlsx`).
