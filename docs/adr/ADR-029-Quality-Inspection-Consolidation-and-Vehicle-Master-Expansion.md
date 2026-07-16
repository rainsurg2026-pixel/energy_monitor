# ADR-029: Quality Inspection Navigation Consolidation & Vehicle Master Data Expansion

## Status

Accepted. Does not reopen ADR-017/ADR-027/ADR-028's frozen Inspection/
Delivery domain models - no table is redesigned, no stage is added or
removed. Reopens ADR-012 (Tractor IN as the Single Source of Truth for
Product Family / Sub Model) to extend the same sync path to more `vehicles`
columns, the same "reopened, not replaced" precedent ADR-011/ADR-014/ADR-028
already set.

## Problem

A set of production refinement decisions were made about how the platform
should present itself and where vehicle master data comes from:

1. The Delivery nav group's Import Inspection Dashboard/List were the only
   two capabilities still meant to be nav-reachable; General Delivery
   Dashboard/Deliveries/Delivery Reports (lifecycle-tracking pages built
   under ADR-027) are no longer part of the day-to-day navigation.
2. "Dealer PDI" was never a real concept in this codebase (ADR-028 already
   corrected the model) but nav/label wording still said "PDI (Pre-Delivery
   Inspection)" - a terminology drift, not a data-model one.
3. Tractor IN (the Google Sheet, ADR-012) is now the *sole* vehicle master
   for `engine_number`/`product_code`/`model`/`wh_arrival_date`/
   `delivery_date`/`dealer_id` - not just `product_family_id`/`sub_model`.
   `product_code`/`wh_arrival_date` did not exist as `vehicles` columns at
   all.
4. NTR, Import Inspection, and Machine Passport each read vehicle master
   data through different, inconsistent, partially-duplicated shapes.
5. NTR's date-related labels ("Retail Date", "Registration Date",
   "Acceptance Date") didn't consistently describe what they actually were
   (a Legacy-Import-only artifact, the record's creation timestamp, and
   the same `delivery_date` field, respectively), and NTR had no Edit
   screen despite `PUT /api/ntr-records/[id]` already existing.

## Decision

**Navigation** (`navConfig.ts`): the `delivery` nav group is replaced by a
`qualityInspection` group ("ตรวจสอบคุณภาพ"), MSEAL-only
(`canAccessImportInspection`), with exactly two items: the existing Import
Inspection Dashboard (`/delivery/pdi/dashboard`) and Import Inspection list
(`/delivery/pdi`). Every Delivery route/API/permission is unchanged - this
is a navigation-only restructuring; `/delivery/dashboard`, `/delivery/records`,
`/delivery/reports` still work, they are simply no longer nav-linked.

**Database** (`vehicles`, additive migration
`vehicles_add_product_code_wh_arrival_date`): added `product_code text`,
`wh_arrival_date date`, plus btree indexes on `engine_number` and
`product_code`. `serial` remains the only conflict/lookup key - no new
unique constraint.

**Tractor IN Sync Service** (`tractorInSyncService.ts`, v2.4.0): now writes
every vehicle master field the sheet carries (`model`, `engine_number`,
`product_code`, `wh_arrival_date`, `delivery_date`, `dealer_id`) on **both**
INSERT and UPDATE, not just INSERT as in v2.3.1 - the sheet is the sole
master, so a correction on the sheet must flow through to an existing row.
On UPDATE, a blank sheet cell is never written (same rule already applied
to Product Family/Sub Model) - a blank cell must never blank out
already-known data just because the sheet hasn't caught up yet. PDI Status
is parsed from the sheet but deliberately never written anywhere - it has
no `vehicles` column and isn't part of this platform's data model. Date
cells are parsed via a shared `parseSheetDate()` that recognizes both
Gregorian and Buddhist-era years (the sheet's "วันที่ส่งมอบ" column uses
Buddhist era). A one-time backfill (`sync()` against the live sheet) was
run against production: 330/330 rows processed, 0 failures, 318/331
vehicles now carry `product_code`/`wh_arrival_date`, 136/331 carry
`delivery_date` (the remainder are genuinely not yet delivered).

**Vehicle lookup DTOs** now consistently return
`serial`/`engine_number`/`product_code`/`model`/`dealer_id`/
`wh_arrival_date`/`delivery_date`: `GET /api/vehicles/[serial]`'s merged
response, `NtrTractorSearchResult`/`searchTractorsForNtr()`. List/search
autocomplete endpoints (`listVehicles`/`searchVehicles`) are intentionally
unchanged - they are lightweight dropdown DTOs, not "the vehicle lookup."

**NTR** (`ntr-search.tsx`) auto-fills Engine Number/Product Code/Dealer as
read-only display (matching the existing Product Family/Sub Model
convention) and Delivery Date now auto-fills from `vehicles.delivery_date`
when the sheet already has it, falling back to manual entry only for a
tractor Tractor IN hasn't synced yet - vehicle master data is never
duplicated/re-entered once the sheet has it.

**Import Inspection** (`NewInspectionForm.tsx`) gained a search-by-Serial-
or-Engine-Number step (reusing `searchTractorsForNtr()`/
`/api/ntr/tractor-search` rather than a second vehicle-search
implementation) showing every master field read-only, and the Technician
Certificate field was removed from the UI (the underlying
`technician_certification_ref` column/type is untouched - historical data
is preserved, it's simply no longer collected). The Import Inspection
detail page gained a read-only vehicle-master card for the same fields.

**Machine Passport** (`MachineIdentityPanel.tsx`) now displays Product
Code and WH Arrival Date alongside the existing Serial/Engine Number/
Model/Variant/Product Family, plus Delivery Date (previously not shown in
Identity at all).

**Terminology**: `csv.retailDate`/`ntr.registrationDate`/
`ntr.acceptanceDate` translation keys are removed. The NTR detail page,
PDF, Excel export, and list page now show one canonical "Delivery Date"
(`csv.deliveryDate`, already existed) wherever `delivery_date` or the
`VehicleSummary.retailDate` field is displayed, and "Document Submission
Date" (`ntr.documentSubmissionDate`, new) for the record's creation
timestamp. The Legacy-Import-only `retail_date` column's own dedicated
detail-page/PDF/Excel row is removed (redundant with the canonical
Delivery Date row); the column itself, and its use as `calcWarranty()`'s
input and `resolveVehicleProgramVersionStages()`'s PM anchor date, is
unchanged - this ADR is a display-terminology correction, not a warranty/PM
business-logic change.

**NTR Edit**: added `/ntr/[id]/edit` (+ `NtrEditForm.tsx`), the missing UI
for the already-existing `PUT /api/ntr-records/[id]` route. Authorization
matches that route exactly (dealer/branch scope only - the route never had
an additional role gate). Vehicle master fields (serial/model/engine
number/product family) are read-only on this screen, never editable -
consistent with "vehicle info comes only from `vehicles`." The Edit button
is placed before Export PDF/Download/Print on the detail page; Delete is
visually separated (a border) from the primary action group, not removed
or re-gated.

## Consequences

- One additional Supabase round-trip inside `searchTractorsForNtr()`'s
  `.select()` (two more columns) - negligible, same query shape.
- `TractorInSyncService.sync()`'s per-row work is unchanged in shape (still
  one `.update()`/`.insert()` per row); it now writes more columns per call,
  not more calls.
- The General Delivery Dashboard/Deliveries/Delivery Reports pages built
  under ADR-027 remain in the codebase and fully functional, but are
  unreachable from navigation - a deliberate, documented product decision,
  not dead code left by accident. Revisiting whether to delete them
  outright is left to a future, explicitly-scoped task.

## Verification

`tsc --noEmit` clean; `eslint .` 0 errors (12 pre-existing warnings,
unchanged baseline); `vitest run` 739/739 pass (+2 new
`TractorInSyncService` tests for the update-writes-master-fields and
never-writes-PDI-Status behaviors); `next build` succeeds; `architecture-check`
6/6 PASS. Backfill executed against production Supabase (see Decision).
