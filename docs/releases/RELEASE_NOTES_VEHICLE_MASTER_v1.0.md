# Release Notes — Vehicle Master Modernization v1.0

PR #47 (`feature/quality-inspection-consolidation-vehicle-master`),
squash-merged to `main` 2026-07-14 (merge SHA `9943494`). ADR-029
(Quality Inspection Navigation Consolidation & Vehicle Master Data
Expansion) - a production refinement pass, not a redesign. ADR-017/
ADR-027/ADR-028's frozen Inspection/Delivery domain models are untouched;
ADR-012 (Tractor IN) is reopened to extend the same sync path.

## Quality Inspection Navigation

The Delivery nav group is replaced by a Quality Inspection group
("ตรวจสอบคุณภาพ"), MSEAL-only, with exactly two items: Dashboard and
Import Inspection. Every Delivery route/API/permission is unchanged - a
navigation-only restructuring, not a deletion. General Delivery Dashboard/
Deliveries/Delivery Reports remain fully functional at their existing
URLs, simply no longer nav-linked.

## Tractor IN as Vehicle Master

Google Sheet Tractor IN is now the sole vehicle master. New
`vehicles.product_code`/`wh_arrival_date` columns + indexes
(`engine_number`, `product_code`). `TractorInSyncService` v2.4 syncs
`model`/`engine_number`/`product_code`/`wh_arrival_date`/`delivery_date`/
`dealer_id` on both insert and update (v2.3.1 only wrote these on insert) -
a blank sheet cell is never written on update, so it can never blank out
already-known data. PDI Status is read but never synced - it has no
`vehicles` column. `serial` remains the only conflict/lookup key.

**Data-quality reporting** (v2.4.1): the sync result and the persisted
`tractor_in_sync_runs` log now report `missingProductCode`/
`missingWhArrivalDate` counts - a data-quality signal about the sheet
itself, never a sync failure. No value is ever generated, inferred, or
backfilled.

**Backfill executed against production**: 330/330 sheet rows processed,
0 failures. 318/331 vehicles now carry Product Code/WH Arrival Date; the
remaining 13 have a blank cell in the sheet itself (confirmed via the new
data-quality report, not a defect). 136/331 carry Delivery Date (the rest
are genuinely not yet delivered).

## Engine Number / Product Code / WH Arrival Date Support

Every vehicle-lookup surface now consistently reads the same field set
instead of partially-duplicated shapes: `GET /api/vehicles/[serial]`,
NTR's tractor search (`NtrTractorSearchResult`), Import Inspection, and
Machine Passport.

## NTR Terminology Cleanup

"Retail Date"/"Registration Date"/"Acceptance Date" labels consolidated
into "Delivery Date"/"Document Submission Date" across the detail page,
PDF, Excel export, and list page - a display correction only;
`calcWarranty()`'s input and the PM-schedule anchor date are unchanged.
NTR also gained the missing `/ntr/[id]/edit` screen for the
already-existing `PUT /api/ntr-records/[id]` route (Edit button before
Export/Download/Print, Delete visually separated, vehicle master fields
read-only).

## Import Inspection Improvements

New search-by-Serial-or-Engine-Number step (reuses the existing NTR
tractor-search endpoint - no duplicated query), read-only vehicle-master
display (Serial/Engine Number/Product Code/Model/Dealer/WH Arrival Date/
Delivery Date), Technician Certificate removed from the UI (the
`technician_certification_ref` column/historical data is untouched).

## Machine Passport Master-Data Integration

`MachineIdentityPanel` now displays Product Code and WH Arrival Date
alongside Serial/Engine Number/Model/Variant/Product Family, plus Delivery
Date (not previously shown in Identity).

## Verification

`tsc --noEmit` clean; `eslint .` 0 errors (12 pre-existing warnings,
unchanged baseline); `vitest run` 742/742 pass; `next build` succeeds;
`architecture-check` 6/6 PASS. Post-merge CI on `main` green (see PR #47).

## Milestone

Tagged `v2.8.0-vehicle-master` - completion of the **Vehicle Master
Modernization** milestone.
