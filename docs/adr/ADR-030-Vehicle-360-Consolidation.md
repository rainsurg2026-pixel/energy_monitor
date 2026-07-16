# ADR-030: Vehicle 360 Consolidation

## Status

Accepted. Does not redesign any existing domain - no new table, no new
service, no new timeline implementation. Consolidates two pre-existing,
overlapping pages onto one, and closes the one real content gap (no
dedicated NTR section) with a thin read through an already-existing
function.

## Problem

Two separate pages already existed for the same vehicle:

- `/vehicles/[serial]` ("Vehicle 360") - a flat page showing Owner Info,
  Maintenance, Health, Timeline, and Attachments.
- `/machines/[machineId]` ("Machine Digital Passport") - a superset of the
  same data (same `MachineService.getMachine360()`/`getMachineTimeline()`/
  `getMachineAttachments()` calls), plus Import Inspection, Delivery,
  Warranty, PM, Quality, Related Records, Activity, and Knowledge sections
  the smaller page never had.

`Vehicle 360`'s own page had no unique data source of its own - every
field it showed was already covered inside Machine Passport, using the
exact same reads. This is the literal "duplicated page" the platform's own
reuse principles warn against, and it split one nav group into two
entries (`nav.vehicle360` -> `/vehicles`, `nav.machinePassport` ->
`/machines`) for what a vehicle lookup should be one destination.

Separately, no `MachineService` method surfaced NTR registration detail as
its own section - NTR data only reached the page as an ingredient of
Attachments/Activity/Related Records, never as a dedicated "NTR" section
the way Import Inspection/Warranty/PM/Quality already had.

## Decision

**One destination, not two.** `/machines/[machineId]` is now the sole
Vehicle 360 page. `/vehicles` and `/vehicles/[serial]` become thin
`redirect()`s to `/machines` and `/machines/[serial]` respectively -
existing bookmarks/links keep working, but there is no second render
implementation to keep in sync. `VehicleSearchBox`'s default `basePath`
changes from `/vehicles` to `/machines`. The nav's `machines` group drops
its duplicate entry - one `{ href: '/machines', label: t('nav.vehicle360') }`
replaces the previous two. `nav.vehicle360`'s and `machinePassport.title`'s
text both become "Vehicle 360" (was "Machine Registry"/"Machine Digital
Passport") - one consistent user-facing name for one page.

**Vehicle Master section** (`MachineIdentityPanel`, heading text changed
from "Identity" to "Vehicle Master"): gains a Dealer row, reusing
`summary.dealerName`/`dealerId` - the exact fields `MachineOwnershipPanel`
already reads from the same `MachineSummary` object. Serial/Engine
Number/Product Code/Model/WH Arrival Date/Delivery Date were already
present (ADR-029).

**NTR section** (new): `MachineService.getMachineNtrHistory(serial,
session)` is a thin passthrough to `fetchNtrRecordsForSerial()` - the
exact function `getMachineAttachments()`/`getMachineAuditTimeline()`/
`getMachineRelatedRecords()` already call. `MachineNtrSection` (async
Suspense wrapper, same shape as `MachineDeliverySection`/
`MachineWarrantySection`) + `MachineNtrPanel` (list, linking out to
`/ntr/[id]` for full detail - no NTR data duplicated onto this page)
render it as its own section, positioned between Import Inspection and
Delivery to match the real-world chronology.

**Everything else already existed and is unchanged**: Import Inspection
(`MachineImportInspectionSection`), Warranty (`MachineWarrantySection`),
PM History (`MachinePmSection`), MQR History (`MachineQualitySection` -
this platform's established name for the MQR/Quality Case domain
everywhere else, not a new concept), the Activity Timeline
(`MachineActivitySection` -> `<ActivityTimeline>`, unchanged), and
Documents (`MachineDocumentsSection` -> `MachineService.getMachineAttachments()`
-> `AttachmentService`, unchanged).

## Consequences

- No new database table, no new repository, no new timeline
  implementation, no new attachment-reading path - the one new method
  (`getMachineNtrHistory`) and the one new section
  (`MachineNtrSection`/`MachineNtrPanel`) are both thin reads through
  functions that already existed and were already imported into
  `MachineService`.
- `/vehicles`/`/vehicles/[serial]` remain valid URLs (redirect, not 404) -
  no broken external links.
- Performance: unchanged query shape. The new NTR section adds exactly
  one more independent `<Suspense>`-streamed query
  (`fetchNtrRecordsForSerial`, already scoped/paginated), not an N+1 - it
  runs once per page load, same as every other section.

## Verification

`tsc --noEmit` clean; `eslint .` 0 errors (12 pre-existing warnings,
unchanged baseline); `vitest run` 743/743 pass (+1 new
`MachineService.getMachineNtrHistory` test); `next build` succeeds;
`architecture-check` 6/6 PASS.
