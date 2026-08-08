# Release Notes — v2.2.6

## Summary

Six features in this pass, all centered on removing Excel as the storage
medium for the Rack Unit Capacity monthly image and redesigning the
Executive Dashboard/Export-All-Report PDF around the resulting filesystem
store, plus report-layout changes for the Monthly Energy & Cost, Site
Comparison, and Rack Capacity Site Comparison reports.

## A. Filesystem Image Storage (replaces every Excel-embedded image mechanism)

- New `src/storage/ImageStorageProvider.ts` — a filesystem-backed store,
  Electron-agnostic (no `electron` import; `imagesRootDir` is passed in by
  the caller, the same dependency-injection pattern this codebase already
  uses for workbook paths/backup directories). One image per
  `(facility, reportingMonth)`, saved at
  `data/rack-unit-images/<Facility>/RUC-<Mon>-<YY>.<png|jpg>` with a JSON
  metadata sidecar (`mimeType`, `width`, `height`, `sizeBytes`, `savedAt`,
  `savedBy`, sha256 `checksum`). Every write is verified by re-reading the
  bytes and comparing a fresh checksum before the save is reported as
  successful. `saveImage`/`loadImage`/`deleteImage`/`exists`/`listImages` —
  the exact five-method surface the release spec named.
- New `src/electron/ipc/images.ts` — the IPC surface (`images:save/load/
  delete/exists/list`), re-validating uploaded bytes by real magic number
  in the main process (never trusting the renderer), mirroring the existing
  trust-boundary pattern in `ipc/excel.ts`.
- **Migration off three legacy Excel-embedded mechanisms**, all in one new
  module, `src/excel/RackUnitCapacityImageMigration.ts`:
  1. Pre-v2.2.3: single image anchored at K9 on the "Rack Capacity" sheet.
  2. v2.2.3–v2.2.4: single image anchored at K9 on the "Rack Unit Capacity"
     sheet (the old global slot).
  3. v2.2.5: one row + embedded image per `(Facility, Month)` on the
     "Rack Unit Capacity Img History" sheet.

  Every legacy image is extracted, saved to the filesystem store, and
  checksum-verified **before** anything is removed from the workbook —
  a mid-way failure can never lose an image that was not yet safely on
  disk. The two K9 single-slot mechanisms carry no reliable Reporting
  Month (they were never month-keyed), so any image found there is
  preserved as a dated "legacy orphan" file (content-hash-named, so a
  crash-then-retry cycle overwrites rather than duplicates) rather than
  discarded or given a fabricated month. The migration is wired into
  `buildOpenPayload()` (`ipc/excel.ts`) and runs automatically, once, on
  workbook open — the same pattern the existing UPS Group History
  migration already uses. A workbook with none of the three legacy
  mechanisms present is a true no-op: the file on disk is never touched.
- **Dead code removed**: `src/excel/SheetImageWriter.ts` deleted outright
  (the K9-embed module every legacy mechanism above built on). The `image`
  parameter was removed entirely from `RackCapacityWriter.ts`'s and
  `RackUnitCapacitySaveWriter.ts`'s save functions — confirmed dead code:
  every UI call site (`RackCapacityEditor.tsx`, `RackUnitCapacityPanel.tsx`)
  already always passed `image: null`. `migrateRackCapacityImageToUnitCapacity`
  (the old pre-v2.2.3 → v2.2.3 relocator) is superseded by the unified
  migration above and removed. The old `excel:saveRackUnitCapacityImageHistory`
  / `excel:getRackUnitCapacityImageForMonth` IPC channels are gone, replaced
  by `images:save`/`images:load` — with zero leftover references anywhere
  in `src/` (verified by grep).
- **Deduplication**: `locateSheetXmlPathByName()` (`src/excel/ExcelZipUtils.ts`)
  replaces three near-identical hand-rolled "find a worksheet by display
  name" implementations that had accumulated in `RackCapacityWriter.ts`,
  `RackUnitCapacityWriter.ts`, and the old `RackUnitCapacityImageHistoryWriter.ts`.
- `RackUnitCapacityImageHistoryWriter.ts` trimmed to read-only (used only
  by the migration path to extract legacy rows) plus a new
  `removeRackUnitCapacityImageHistorySheet()` that deletes the sheet's
  worksheet part, rels, drawing part(s), every media part they reference,
  and its workbook.xml/workbook.xml.rels/[Content_Types].xml registrations
  — every other sheet, table, pivot, chart, and VBA part is left untouched.
- `IDataProvider`/`ExcelProvider`: `saveRackUnitCapacityImageHistory`/
  `getRackUnitCapacityImageForMonth` renamed to `saveRackUnitCapacityImage`/
  `getRackUnitCapacityImage`, now routed through `desktop.images.*` and
  returning `StoredImageMeta` (adds `width`/`height`/`savedBy`/`savedAt`,
  needed by Feature 2's caption).
- **Confirmed** (read-only diagnostic, before any code changed): both real
  production workbooks, `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm`, currently
  have **zero** embedded images in any of the three legacy locations — this
  migration is a no-op against them today, and was validated entirely
  against hand-seeded synthetic fixtures (see Testing) so it is proven
  correct before it ever meets a field-deployed workbook that does have
  legacy data.

## B. Rack Unit Capacity Dashboard Redesign

`src/components/rack/RackUnitCapacitySummary.tsx` restructured: the KPI
tile row and donut+summary now sit in a left column occupying ~60% width;
the Monthly Rack Unit Capacity Image occupies the remaining ~40%, styled
as a rounded/bordered/shadowed card with a gradient caption overlay
showing **Reporting Month / Last Updated / Resolution / Captured By**
(sourced from the new `StoredImageMeta`, formatted through the shared
`formatTimestamp()` helper — never a raw `Date.toString()`). A missing
image now shows a professional placeholder ("Rack Unit Capacity image not
yet captured") instead of the old bare "No image for this reporting
month." text, with a pointer to the editor panel below. Reused the pie
chart's own `utilizationColorHex()` for the "Used" color rather than
introducing a second palette; no zone dimension was fabricated for a
"Zone Summary" — Rack Unit Capacity's real data model is
Total/Used/Available (U), not zone-broken-down, so the pie is paired with
a Used/Available/Total breakdown legend instead of invented zone data.

## C. Monthly Energy & Cost Report — Facility Trend Analytics above the table

The six facility energy/cost trend pages in the "Export All Report" PDF
already preceded the Monthly Energy & Cost Table positionally; what was
missing was the explicit "Facility Trend Analytics" label tying them to
the dashboard's own naming (`HistoricalCharts.tsx`). Added an eyebrow
label ("FACILITY TREND ANALYTICS") to all six pages via a new optional
`sectionLabel` parameter on the shared `trendPage()` renderer — applied
only to the six facility pages, never to the (now-removed, see Feature 5)
Rack Capacity trend pages that used to share the same function.

## D. Site Comparison Report — trend charts above the table

Added "Monthly Energy Consumption Trend" and "Floor 4 Electricity Cost
Trend" charts immediately above the Site Comparison table
(`comparisonPage()` in `reportHtml.ts`), reusing the exact same
`buildingEnergyKwh`/`floorCostThb` fields and per-facility accent colors
(`#e87959` Rangsit / `#5b8db8` other) the dashboard's `FacilityComparison.tsx`
already uses for its own comparison charts. Required extending `trendPage()`
from a single-series to a multi-series (1..N lines) renderer — single-series
rendering (markup, point-label count) is byte-identical to before, so
every existing single-line trend page is unaffected; the new 2-line
comparison charts get a legend and per-series color/label. `ReportData.
comparison` gained `selfTrend`/`otherTrend` (each facility's own up-to-12-
month history, aligned to the same reference month, sibling values looked
up per month and left `null` where the sibling has no record — never
fabricated).

## E. Removed obsolete PDF pages

Removed entirely from the "Export All Report" PDF: **Capacity Trend and
Forecast**, **Rack Capacity Monthly Trend** (Usage %/Availability % pages),
**Rack Unit Capacity Availability % Trend**, and the inline **Report
Information and Data Source** section. Their now-dead helper functions
(`capacityForecastPage`, `forecastUsageHistory`, `rackCapacityTrendPage`,
`rackUnitCapacityTrendPage`) and now-unused imports
(`linearRegression`/`extendWithForecast`/`MIN_FORECAST_HISTORY_MONTHS`/
`TimeSeriesPoint` from `capacityForecast.ts`, `RACK_CAPACITY_HISTORY_TOTAL_ZONE`,
`getTrendDirection`/`getTrendLabel`, `monthLabelLong`) were removed along
with the CSS rule (`.report-info`) that only they used. No TOC existed in
this PDF before this pass (confirmed: it is built as a flat, statically-
ordered sequence of `page-break-before` sections, with Chromium's
`printToPDF` footer template supplying page numbers) and none was added —
building one was not part of this release's explicit scope; page order
and numbering both continue to update automatically from the section
sequence, with no manual bookkeeping needed after removing four sections.

## F. Rack Capacity Site Comparison — redesigned with per-facility pies

`rackComparisonPage()` redesigned from table-only to: one donut per
facility (top) + the existing comparison table (bottom). Reuses `donutSvg()`
(the exact renderer the single-facility Rack Capacity page already uses)
and `rackStatusColorForRatio()` for every swatch — "In Use" gets the
dynamic utilization color (verified live: Rangsit at 82.1% renders yellow,
Srinakarin at 92.0% renders orange — genuinely different colors from the
same shared gradient function, not a fixed color per facility), every
other status its fixed `rackStatusConfig.ts` color (Available green,
Reserved blue, Pending Dismantle brown). No second palette or a second
pie-drawing implementation.

## Hotfix — Rack Unit Capacity Executive Page (PDF)

Post-release regression fix: "Export All Report" was missing the complete
"Rack Unit Capacity and Utilization" executive page. Feature B (above)
redesigned the *Dashboard's* Rack Unit Capacity summary; the PDF side had
only ever carried a stripped-down block (`rackUnitCapacityBlock()`) tacked
onto the bottom of the Rack Capacity page — 4 bare KPI cards (Total/Used/
Available (U)/Availability Capacity) and a cramped 260×150px image, with no
donut, no Usage %, no Trend vs Previous Month, and no dedicated page heading
at all.

Restored as a full standalone page, `renderRackUnitCapacityExecutivePage()`
in `reportHtml.ts`, positioned immediately after "Rack Capacity and
Utilization" (before "Capacity Health and Zone Heatmap"): a 2×3 KPI grid
(Total (U)/Used (U)/Available (U)/Availability %/Usage %/Trend vs Previous
Month), a large Used/Available donut (~60% width) with a legend, and the
Monthly Rack Unit Capacity Image (~40% width, with Reporting Month/Captured
By/Captured Date/Resolution caption) or the same placeholder the Dashboard
shows when no image exists for the month.

Zero duplicated logic — every number, color, and pixel of this page comes
from something that already existed:

- `unitCapacityRowForReportingMonth()` (pre-existing) for the Reporting
  Month's row.
- New `findPreviousRackUnitCapacityRow()` (`src/utils/rackUnitCapacity.ts`)
  for "previous month" — extracted from what was previously duplicated
  inline logic in the Dashboard's `RackUnitCapacitySummary.tsx`; the
  Dashboard component was updated to call this same shared helper too, so
  neither surface can drift from the other.
- `calculatePercentageDelta`/`getTrendDirection`/`getTrendLabel`
  (`trendCalculator.ts`, pre-existing) for the trend arrow — the exact same
  calls the Dashboard's own trend card uses.
- `utilizationColorHex()` (`capacityHealth.ts`, pre-existing, already used
  by the Capacity Health Gauge) for the donut's "Used" segment color — the
  literal same function call as the Dashboard, not a re-derived color.
- `donutSvg()` — generalized (optional per-segment `color` override,
  optional `centerLabel`/`centerSubLabel`) rather than writing a second
  donut renderer; the two existing callers (Rack Capacity page, Rack
  Capacity Site Comparison) are unaffected — they still call it with only
  the original 2 arguments, so their output is byte-identical to before.
- The image figure/placeholder markup, extracted into
  `rackUnitCapacityImageFigure()` from the now-deleted
  `rackUnitCapacityBlock()`, reads exclusively through
  `data.rackUnitCapacityImageDataUri`/`Meta` (`ImageStorageProvider` via
  `reportDataBuilder.ts`) — never the legacy Excel-embedded mechanisms,
  never a second image source.

The old `rackUnitCapacityBlock()` and its 2 call sites were deleted — its
content is now fully superseded by the new adjacent page, so the same data
is never shown twice on consecutive pages.

Layout reuses existing CSS wholesale (`.kpi`/`.block`/`.gauge-row`/
`.gauge-caption`/`.legend-row`, all pre-existing); the only additions are
`.kpis-3col` (a 3-column variant of the existing `.kpis` grid) and
`.rack-unit-capacity-layout`/`.ruc-left`/`.ruc-right` (a 60/40 flex split,
matching the Dashboard's own `lg:col-span-3`/`lg:col-span-2` out of 5
columns exactly).

Export All Report page count: 15 → 16 (verified against both facilities'
real workbooks).

## Testing

- `npm run lint` (renderer + Electron strict TypeScript) — clean throughout.
- `npm run build` — clean (pre-existing >500kB chunk-size warning only,
  unrelated to this pass).
- New: `test:image-storage-provider` (29 checks — filename convention,
  checksum verification, facility isolation, format-switch replacement,
  `listImages`/`deleteImage` semantics, corrupt-sidecar graceful
  degradation) and `test:rack-unit-image-migration` (hand-seeds all three
  legacy mechanisms into copied real-workbook fixtures; verifies
  extraction, checksum-verified filesystem landing, orphan recovery,
  complete removal from the workbook, byte-identical VBA/pivot/table
  preservation, and idempotency on a second run) — both green, both
  facilities.
- **Hotfix regression** (Rack Unit Capacity executive page):
  `scripts/test-all-report.ts` extended to assert the page's presence,
  correct page order (after Rack Capacity and Utilization, before Capacity
  Health and Zone Heatmap), and correct Facility subtitle against both real
  workbooks; `scripts/test-rack-unit-capacity.ts` extended with 8 new
  checks against synthetic data — KPI values (including the new
  Availability %/Usage %/Trend cards), donut legend and center label,
  page-order adjacency, and a dedicated placeholder-path check (a month
  with Rack Unit Capacity data but no saved image still renders the
  Dashboard's placeholder, not a crash or blank gap). All green, both
  facilities. Verified visually via a real Electron `printToPDF`-equivalent
  render (screenshot) against synthetic fixture data, and against a
  `git stash`-generated screenshot of the pre-hotfix page for a direct
  before/after comparison.
- **Test scripts made robust to real, changing production data**: mid-pass,
  the real `DC_Srinakarin.xlsm` gained genuine Rack Unit Capacity rows from
  a real, intentional edit outside this pass's own work. Both
  `test-all-report.ts` (the "not yet available"/"no data for this
  month"/"real data" fallback assertion) and `test-rack-unit-capacity.ts`
  (row-count and table-ref assertions in `testFacility()`, previously
  hardcoded assuming an empty starting sheet) were updated to derive their
  expected values from whatever the real starting state actually is,
  rather than assuming production workbooks stay pristine for this
  feature. Both scripts are green against the real, current state of both
  facilities.
- Full existing regression suite re-run and green with **zero regressions**
  from this pass: `test:rack-capacity-metrics`, `test:rack-capacity-write`,
  `test:rack-capacity-image`, `test:rack-capacity-history`,
  `test:rack-status-config`, `test:rack-unit-capacity`, `test:facility-
  isolation`, `test:facility-comparison`, `test:dashboard-config-driven`,
  `test:dashboard-facility-isolation`, `test:dashboard-workbook-mapping`,
  `test:air-validation`, `test:batch-save-merge`, `test:energy-cost-
  dashboard`, `test:production-stress-fault`, `test:save-formatting`,
  `test:srinakarin`(+`:aggregate`/`:roundtrip`), `test:ups-group-history`
  (+`:migration`), `test:rc3`.
- `scripts/test-all-report.ts` extended with new assertions: the removed
  sections are confirmed absent; "FACILITY TREND ANALYTICS" is confirmed
  present exactly 6 times, positioned above the Monthly Energy & Cost
  Table; the Site Comparison trend charts are confirmed present and
  positioned above the Site Comparison table; the Rack Capacity Site
  Comparison pies are confirmed present (1 or 2, matching sibling
  availability) and positioned above its table; trend-page and point-
  label counts updated to match the new page set.
- `node scripts/run-all-report-pdf-test.mjs` (real Electron `printToPDF`) —
  produced a valid PDF at every stage of this pass; page count moved from
  14 (post-removal, no comparison charts) to 16 (Feature 4) to confirmed-
  correct with the Rack Capacity pies (Feature 6); manually inspected via
  page-range PDF reads at each step, single-facility and real dual-facility
  (Rangsit + Srinakarin) runs both confirmed visually correct — two-line
  comparison charts genuinely show two distinguishable colored lines with
  a legend, and the two Rack Capacity Site Comparison pies genuinely show
  per-facility-different "In Use" colors from real, different utilization
  percentages.
- **`npm run test:e2e`** (full CDP-driven UI walkthrough) — 100% green.
  Found and fixed several **pre-existing** stale-text/selector-ambiguity
  bugs in `scripts/e2e-cdp.mjs` unrelated to this pass's actual feature
  work (confirmed via direct DOM inspection against a live app instance
  that neither the Thai empty-state string, the donut center-label string,
  nor the ambiguous `.find()` section selectors had been touched by this
  pass — `RackUnitCapacitySummary`'s and `RackUnitCapacityPanel`'s `<h3>`
  text were both already identical to what this pass shipped): the Rack
  Unit Capacity empty-state and donut-center-label assertions were
  checking for text that does not exist anywhere in the current source;
  the "fill Total(U)/Used(U)" and "Editor Month/Year selector" steps used
  a `.find()` that could resolve to the wrong section whenever two
  sections' `<h3>` text overlapped by substring (RackUnitCapacitySummary's
  heading is a superstring of RackUnitCapacityPanel's; ZoneHeatmap's own
  hint text contains "แก้ไขความจุแร็ค" as a substring, colliding with
  RackCapacityEditor's heading) — fixed by disambiguating on the actual
  capability the step needs (presence of the real number inputs / the
  section's own exact `<h3>`) rather than a full-section-text substring
  search. Also fixed a genuine timing gap where the Google Sheets sync
  board's own async config load could still be in flight when the test
  captured its snapshot. All fixes verified by re-running the full suite
  to a clean 100% pass.
- `npm run test:packaged-report` — packaged/portable-runtime smoke test,
  green (full export flow, both facilities, source workbooks byte-
  unchanged).

## Packaging Investigation Summary

**Facts**

- Earlier attempts in this release cycle to run `npm run portable:build`
  failed repeatedly with `EPERM: operation not permitted, rename
  'release\win-unpacked.tmp' -> 'release\win-unpacked'`.
- The cached Electron runtime archive used by the packaging step was
  checksum-verified against its official manifest and found intact.
- Manual extraction and a manual rename of that same archive, performed
  outside electron-builder entirely, both succeeded.
- Temporary diagnostic logging was added to electron-builder's own
  extraction code (a third-party dependency under `node_modules/`, never
  part of this application's own source) to record open file handles and
  attempt an exclusive-style file open immediately before the rename call.
  Every instrumented run showed zero open handles and a successful open.
  The diagnostic logging was fully reverted afterward and never shipped.
- The unmodified, uninstrumented electron-builder code subsequently
  completed the identical operation successfully and repeatably.
- The packaging run for this release (this pass) completed successfully on
  its first attempt, producing `Energy Monitor-v2.2.6.exe` and
  `Energy Monitor-v2.2.6.zip`.

**Inference**

A transient external packaging condition was observed during earlier
attempts. The application source and build pipeline were subsequently
verified and packaging completed successfully.

**Unknowns**

- The exact external factor responsible for the earlier transient failures
  was not identified with certainty.
- Whether the same condition could recur on a future packaging attempt is
  not known.

## Data safety note

No destructive action was taken against the real production workbooks at
any point in this pass. The migration was validated entirely against
synthetic fixtures seeded into **copies** under `dist-electron/test-work/`;
the real `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` were only ever opened
read-only for diagnostics or through the existing test suite's own
copy-first pattern, and every test that touches them asserts their SHA-256
is unchanged before/after. All interactive/visual verification used an
isolated `ENERGY_MONITOR_APP_ROOT` scratch environment (never the real
`config/config.json` or the real workbooks), per this project's own
recorded safety practice from prior releases.

## Known limitations

- No Table of Contents exists in the "Export All Report" PDF, before or
  after this pass — out of this release's explicit scope.
- **Unrelated, pre-existing finding discovered during this hotfix's
  regression run** (not caused by, and out of scope for, this hotfix — the
  hotfix touches no UPS Group History code): `scripts/test-ups-group-
  history.ts` fails one assertion, "source workbook has no History sheet
  yet", against the real `DC_Srinakarin.xlsm`. Verified read-only: that
  workbook genuinely already has a 330-row UPS Group History sheet, all
  rows generated at `2026-08-01T04:28:42.833Z` — exactly matching the
  file's own on-disk mtime, i.e. a legitimate backfill that already ran for
  real at some earlier point, not something touched during this pass. The
  test's "starts pristine" assumption is simply stale for this workbook now
  and needs a separate look; `test:ups-group-history-migration` (the
  migration-specific script) passes and is unaffected.
- The legacy K9-slot "orphan" recovery path (Feature A) has no dedicated
  UI surface yet for browsing/re-filing recovered orphan files; they are
  logged (full path) on migration and preserved on disk under
  `data/rack-unit-images/<Facility>/RUC-legacy-orphan-*`, but a facility
  user would need to browse the filesystem directly to find them. Real
  production workbooks currently have none, so this is a defensive path
  for future field data only.
- `IDataProvider.listRackUnitCapacityImages()` (part of the explicit
  five-method `ImageStorageProvider` surface) has a working IPC round-trip
  but no dashboard UI consumer yet — scaffolding for a future
  history-browsing feature, not wired into this release's UI.
