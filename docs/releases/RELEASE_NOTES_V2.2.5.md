# Release Notes — v2.2.5

## Summary

Two phases in this pass:

1. **Recovery** — resumed a prior session that left the v2.2.5 Rack Capacity
   context-migration mid-flight (build broken: a leftover unmigrated
   selector block in `RackCapacityEditor.tsx`, stale prop-drilling in
   `App.tsx` against components that had already moved to context). Restored
   a compile-clean baseline, then found and fixed a second, real bug that
   `tsc` did not catch: `RackCapacityContext`'s memoized context value was
   silently missing `rackUnitCapacity`/`rackCapacityHistory`, crashing the
   page on first navigation (`TypeError: reading 'filter'`). Only caught by
   actually driving the running app via Chrome DevTools Protocol — a plain
   `npm run lint` stayed green throughout.
2. **Executive Dashboard build-out** — composed the Rack Capacity page into
   the mandated architecture (Sticky Header → Reporting Timeline →
   Executive KPI Cards → Capacity Health Gauge + Forecast → Rack Capacity
   and Utilization → Rack Unit Capacity and Utilization → Historical
   Explorer → Rack Capacity Editor → Rack Unit Capacity Editor), added a
   shared dynamic-utilization color system with a WCAG AA contrast helper,
   a new Zone Heatmap, a weighted Capacity Health score, forecast
   confidence/exhaustion-month projection, a new read-only Rack Unit
   Capacity executive summary, and an explicit "Record Monthly Snapshot"
   action on both editors.

## A. Recovery

- `src/components/rack/RackCapacityEditor.tsx` — the month/year selector
  block still referenced pre-migration local variables (`monthNum`, `year`,
  `onMonthChange`) that no longer existed after the component switched to
  reading `reportingMonth` from `RackCapacityContext`. Fixed to derive
  `year`/`monthNum` from context, mirroring the already-correct pattern in
  `RackUnitCapacityPanel.tsx`.
- `src/App.tsx` — the Rack Capacity view still passed `rackCapacity`/`rows`/
  `month`/`onMonthChange` props into components that had already been
  migrated to read those from context (TypeScript did not catch this for
  the two zero-argument components, `RackCapacitySummaryCard`/
  `RackCapacityHistoryPanel` — arity-0 function components aren't
  excess-property-checked the same way). Fixed by wrapping the view in
  `<RackCapacityProvider>` and dropping the now-dead props/App-level
  `rackCapacityMonth` state.
- `src/components/HistoricalExplorer.tsx` — a second stale call site
  (`<RackCapacityHistoryPanel rows={...} lang={...} />`) not wrapped in a
  provider; would have crashed with "useRackCapacity must be used within a
  RackCapacityProvider" the first time a user opened the History tab's Rack
  Capacity History section. Fixed with its own scoped `<RackCapacityProvider>`.
- `src/components/rack/RackCapacityContext.tsx` — the real, crash-causing
  bug: the `useMemo<RackCapacityContextValue>` return object omitted
  `rackUnitCapacity`/`rackCapacityHistory` despite the interface requiring
  them, and `tsc` did not flag it. Fixed by adding both fields. Left as a
  documented lesson (see project memory) that this codebase's TS config can
  miss missing-object-literal-property errors in this exact position —
  actually running the app is not optional verification here.

## B. Shared color + accessibility system

- `src/utils/capacityHealth.ts` — added `utilizationColorHex(percent)`, a
  single five-band gradient (0–60 green / 60–75 yellow-green / 75–85 yellow
  / 85–95 orange / 95–100 red) used everywhere a continuous utilization
  value needs a color: KPI cards, donut "In Use" segment, zone table, Zone
  Heatmap, gauge, progress bars, and the PDF donut. Also added
  `calculateCapacityHealthScore()` — a documented, tunable weighted blend
  (usage 60% / unavailability 20% / reserved 10% / pending-dismantle 10%,
  no business-specified weights were given) for the gauge's 0–100 health
  score.
- `src/utils/rackStatusConfig.ts` — `rackStatusColorForRatio(status, ratio)`
  is now the color every multi-status view should call: "In Use" resolves
  through the utilization gradient, every other status keeps its fixed
  color (Available green, Reserved blue, Pending Dismantle brown, Other
  slate — In Use's own fixed fallback, only used when no ratio is
  available, was kept distinct from Available's green specifically because
  the existing `test-rack-status-config.ts` regression asserts all 5 fixed
  colors are mutually distinct).
- `src/utils/colorContrast.ts` — new, `getAccessibleTextColor(bgHex)`: WCAG
  relative-luminance-based black/white text selection for any dynamic
  background (used by the Zone Heatmap's colored tiles).

## C. New components

- `src/components/rack/ZoneHeatmap.tsx` — one utilization-colored tile per
  zone (color from the shared gradient), showing rack count/usage%/
  availability%. Clicking a zone sets the new shared
  `RackCapacityContext.selectedZone` (not a local/duplicated filter) and
  scrolls to the Rack Capacity Editor, which now reads `selectedZone`
  directly instead of owning its own zone-filter state.
- `src/components/rack/ExecutiveKpiCards.tsx` — extended from Total +
  per-status counts to also show Usage %, Availability %, and Trend vs
  Previous Month (reusing the same `trendCalculator` already used by
  `StickyHeader`).
- `src/components/rack/CapacityGauge.tsx` — color/label now come from the
  weighted health score, not raw utilization alone; the raw utilization %
  stays the large headline number, with the health score shown as a
  secondary caption.
- `src/components/rack/Forecast.tsx` — added Forecast Exhaustion Month
  (`regression.crosses(100)`), Remaining Capacity, Trend, and Confidence
  (`regression.rSquared`) tiles below the existing history/forecast chart.
  "Not enough history" still shown rather than ever fabricating a
  projection (tightened from `usageHistory.length === 0` to `< 2`, matching
  what `linearRegression` actually requires).
- `src/components/rack/RackUnitCapacitySummary.tsx` — new, entirely
  separate from the `RackUnitCapacityPanel` editor: header, executive cards
  (Total/Used/Available U, Usage %, Availability %, trend vs previous
  month), donut (Used/Total U), the workbook's "Rack Unit Capacity Image",
  and a 12-month Used/Available/Total trend chart with tooltips.
  - **Superseded in round 2 (see section G below)**: the image now comes
    from the per-(Facility, Reporting Month) history store, fetched on
    demand, not the old single global slot.
- `src/components/rack/Timeline.tsx` — was previously hidden entirely
  (`return null`) whenever a facility had no persisted Rack Capacity History
  yet, which would have left the Rack Capacity Editor's own month/year
  selector as the only way to change the Reporting Month — a duplicated
  control the recomposed page could no longer justify keeping. Made the
  strip always render (6 months padding before / 3 after the history range
  or the current Reporting Month, whichever is wider) so it's genuinely the
  one shared Reporting Month control, then removed the now-redundant
  selector from `RackCapacityEditor.tsx` entirely.

## D. Monthly Snapshot (explicit, opt-in — existing Save button unchanged)

`saveRackCapacityFieldChanges`/`saveRackUnitCapacity` (main process) both
have a deliberate, documented, tested invariant: a no-op save (zero field
changes, no image) never touches disk or the backup history. The mandate's
"allow Save even with unchanged values, to create a monthly snapshot"
directly conflicts with that invariant. Rather than weaken the existing
Save button's tested behavior, added a new, separate, explicit
`forceSnapshot` opt-in (default `false`, every existing call site
unaffected) plumbed through `IDataProvider` → IPC → the two writer
functions, surfaced as a distinct "Record Monthly Snapshot" button next to
(not replacing) each editor's normal Save button.

## E. Deferred / explicitly not built (flagged, not fabricated)

- **PDF export**: Gauge, Forecast, Zone Heatmap, Historical Charts, and
  Site Comparison sections do not exist in the hand-rolled SVG PDF pipeline
  (`reportHtml.ts`) and were not added — building them (SVG gauge-arc math,
  a from-scratch line-chart renderer, a heatmap grid) is substantial,
  separate work against a proven customer-facing export path, and this pass
  had no way to visually verify PDF output. What already existed (Executive
  KPI, Rack Capacity, Rack Unit Capacity, Monthly Image) now uses the
  shared color palette (donut fill via `rackStatusColorForRatio`).
- **Historical Explorer tier placement**: `RackCapacityHistoryPanel` stands
  in for the "Historical Explorer" position in the mandated page order;
  whether the generic `HistoricalExplorer.tsx` component (currently a
  separate top-level nav tab, covering UPS/AC/DC monthly logs) should
  instead be embedded on this page was never confirmed.
- **History Quick Jump / "Historical Explorer must include Rack Capacity"**:
  both already fully satisfied by pre-existing, unmodified code
  (`HistoricalExplorer.tsx`'s `quickJumpEntries` — year-scoped,
  facility-isolated, real months only; its existing Rack Capacity History
  tab) — verified against `git diff v2.2.4`, not re-implemented.

## G. Round 2 — business decisions applied

Following business review of the pass above (color palette, gauge weights,
forecast rules, image rule, and writer diffs — see the review package),
seven decisions were approved and applied:

1. **Gauge weight** — `HEALTH_SCORE_WEIGHTS` changed to usage 60% /
   unavailability 25% / reserved 5% / pending-dismantle 10% (was 60/20/10/10).
   "Availability 25%" was applied to the existing `(100 - availability%)`
   pressure term, preserving the already-reviewed formula shape rather than
   inverting its sign.
2. **Status color palette** — confirmed already compliant as reviewed; no
   code change. Verified every status color is a literal constant lookup
   (five-band step function, no interpolation/derivation) and that the
   only other hex literals in `components/rack/` are unrelated chart chrome
   (grid lines, tooltips, non-status series).
3. **Forecast** — `MIN_FORECAST_HISTORY_MONTHS` raised from 2 to 6 in
   `capacityForecast.ts` (`linearRegression`/`extendWithForecast`), so it
   applies everywhere the shared regression is used, not just the one UI
   component. Below 6 months, `Forecast.tsx` shows "Insufficient History" /
   "ประวัติไม่เพียงพอ" plus a count, never a regression with almost no
   support.
4. **Image rule — Option B, plus real historical storage.** The image now
   strictly follows the selected Reporting Month (never `currentMonth()`),
   and a genuinely new workbook structure was designed and built to back
   it — see below.
5. **Workbook writers** — confirmed already compliant (Validate → UPSERT →
   Backup → Write → Verify, in that sound order; "never overwrite existing
   history" already enforced by upsert-by-key + tested). No code change.
6. **Executive Health Score** — new KPI tile in `ExecutiveKpiCards.tsx`
   reusing `calculateCapacityHealthScore()` (the exact function the Gauge
   uses — single source, no duplicate calculation).
7. **Capacity Alerts** — new `CapacityAlerts.tsx`, scoped to an in-app-only
   panel (no email/push infrastructure exists in this app) reusing the
   existing Warning ≥75 / Critical ≥90 thresholds (`getCapacityHealth`) -
   no new thresholds invented. Facility-level alert uses the same weighted
   Executive Health Score; per-zone alerts use each zone's own raw
   utilization % (zones don't have a weighted score computed elsewhere -
   a deliberate, disclosed asymmetry, not an inconsistency). Renders a
   calm "No active capacity alerts" state when clean, not nothing.

### New workbook structure: Rack Unit Capacity Image History

`src/excel/RackUnitCapacityImageHistoryWriter.ts` (new) — one row +
one embedded image per **(Facility, Reporting Month)**, replacing the old
single global image slot entirely for the dashboard's purposes. Columns:
`ReportingMonth` (real Excel date, `mmm-yy`, same convention as the
existing Rack Capacity History sheet), `Facility`, `Timestamp` (ISO,
upload time), `User`, `MimeType`, `DataVersion`.

- **Row identity** is `(Facility, ReportingMonth)`; upserting an existing
  key replaces that row's data + image, every other row's data and image
  is byte-identical, untouched — verified directly (not just asserted) by
  a new dedicated test, see Testing below.
- **User** is `os.userInfo().username` (Node's `os` module, Electron main
  process) — this app has no separate login/auth system, so the OS account
  is the only real, non-fabricated identity source available. Never
  supplied by the renderer.
- **Image anchoring**: OOXML allows a worksheet at most one `<drawing>`
  reference, but that one drawing part may contain any number of anchored
  pictures — so this sheet uses one shared drawing part with one
  `<xdr:oneCellAnchor>` block per row, positioned at a fixed vertical
  offset (20 rows apart) derived from that row's own stable sheet row
  number (assigned once, on first insert, never reassigned by later
  upserts of other rows — same guarantee `upsertRackCapacityHistoryRows`
  already provides). Modeled directly on
  `RackCapacityHistoryWriter.ts` (row/sheet plumbing) and
  `SheetImageWriter.ts` (drawing/replace mechanics).
- **New IPC**: `excel:saveRackUnitCapacityImageHistory` and
  `excel:getRackUnitCapacityImageForMonth` (fetches exactly one month's
  image on demand — never the whole history at once, so opening the
  Rack Capacity page doesn't have to load every historical image).
- The pre-existing single-slot mechanism (`SheetImageWriter.ts`'s
  `embedRackCapacityImage`, the "Rack Unit Capacity" sheet's fixed K9
  anchor) is untouched and still used, unmodified, by the PDF export's
  independent read path (`reportDataBuilder.ts`) — the dashboard and the
  PDF now intentionally read from two different sources; see Known
  limitations.
- `RackUnitCapacitySummary.tsx` fetches the selected month's image via
  `provider.getRackUnitCapacityImageForMonth` in a `useEffect` keyed on
  `[facility, reportingMonth, refreshKey]`; shows "No image for this
  reporting month." (not the old "current month only" caption) when none
  exists. `refreshKey` is bumped by `RackUnitCapacityPanel`'s new
  `onImageHistorySaved` callback so the summary re-fetches immediately
  after a same-month upload, without needing a second page navigation.
  Verified live via CDP: filled Total(U)=500/Used(U)=350, clicked Save,
  and confirmed the summary panel correctly showed "No image for this
  reporting month." (the month had numbers but no image yet) with zero
  console exceptions.

## H. Round 3 — PDF parity (Gauge, Forecast, Heatmap, Site Comparison, image source)

Following business review of round 2, the Product Owner classified the portable-packaging `EPERM` as an environment limitation (not a blocker for committing source) but classified the PDF gaps disclosed in round 2's "Deferred" section as **release blockers**: the PDF's Gauge/Forecast/Zone Heatmap/Site Comparison sections did not exist, and the PDF still read the legacy single-image slot instead of the new Rack Unit Capacity Image History. Directive: dashboard and PDF must use the same data source; reuse shared components/calculations/Reporting Month/image-history source rather than duplicating dashboard logic.

- **`src/reports/pdf/reportHtml.ts`** — four new sections, all built server-side (Node/Electron main process, not React — this pipeline hand-rolls HTML+SVG, so "shared components" means reusing the exact calculation modules the dashboard uses, never re-deriving the math):
  - **Capacity Health Gauge** — new `gaugeSvg()` half-donut arc + `capacityGaugeBlock()`, using `calculateCapacityHealthScore()`/`utilizationColorHex()`/`getCapacityHealth()` (the identical functions `CapacityGauge.tsx` calls), same utilization fallback order (saved Rack Unit Capacity row first, then rack-count In Use %).
  - **Zone Heatmap** — new `zoneHeatmapBlock()`, one colored tile per zone via `utilizationColorHex()` + `getAccessibleTextColor()` (the same WCAG-AA helper `ZoneHeatmap.tsx` uses).
  - **Capacity Trend and Forecast** — new `capacityForecastPage()`, reusing the existing `trendPage()` chart renderer plus `linearRegression()`/`extendWithForecast()`/`MIN_FORECAST_HISTORY_MONTHS` from `capacityForecast.ts` (the same functions `Forecast.tsx` uses) — below 6 months of persisted Rack Capacity History it shows "Insufficient History", identically to the dashboard, never a low-support regression.
  - **Rack Capacity Site Comparison** — new page, self vs. sibling facility's *current* Rack Capacity state (`calculateRackCapacityMetrics()` applied to each side, never re-derived). Deliberately named distinctly from the pre-existing energy "Site Comparison" page (a different business dimension) so the two headings never collide in the regression test's substring checks.
- **`src/reports/reportDataBuilder.ts`** — the Rack Unit Capacity Image now comes from `RackUnitCapacityImageHistoryWriter.readRackUnitCapacityImageForMonth(buffer, options.facility, currentRow.month)` — the same per-(Facility, Reporting Month) store the dashboard reads — replacing the old single-slot `readRackUnitCapacityImageFromBuffer` read entirely. Also added `rackComparison` data: this facility's Rack Capacity records plus a best-effort sibling read (mirrors the existing energy-comparison sibling-read pattern; a missing/unreadable sibling never blocks the primary report).
- **`src/reports/pdf/reportHtml.ts`'s `rackUnitCapacityBlock()` — a real pre-existing bug fixed**: it picked the *latest* Rack Unit Capacity row (`.at(-1)`) regardless of the report's actual Reporting Month. Now selects the row matching `data.reportingMonth` (the same single Reporting Month every other PDF section already uses) — with three distinct, non-overlapping messages: no Rack Unit Capacity data at all, no data for *this* month specifically, and no image for *this* month specifically (matching the dashboard's Option B text exactly).
- **`src/reports/reportTypes.ts`** — added `ReportRackComparisonFacility` and `ReportData.rackComparison`.

### Real bug found and fixed during this round: worksheet name exceeded Excel's 31-character limit

`RACK_UNIT_CAPACITY_IMAGE_HISTORY_SHEET_NAME` was `"Rack Unit Capacity Image History"` — **32 characters**, one over OOXML's hard 31-character worksheet-name limit. This existed since round 2 but was never caught: round 2's own 44-check test suite only round-trips the sheet through raw JSZip/XML parsing (which never enforces Excel's name limit), so it always passed. It was only caught now because `buildReportData()`'s `readWorkbookFromBuffer()` loads the *entire* workbook through ExcelJS (for the energy-log sheets) — the first time this sheet was ever read by an ExcelJS-based path, ExcelJS truncated the name to 31 chars on load and collided/threw `Error: Worksheet name already exists`. Fixed by shortening the constant to `"Rack Unit Capacity Img History"` (30 chars); since this sheet has never been written to the real production workbooks (confirmed: both stayed byte-unchanged through every round), the rename carries zero migration cost. Updated the one hardcoded-string assertion in `test-rack-unit-capacity-image-history.ts` accordingly. This is the same class of gap already documented for this codebase: `tsc`/an isolated unit test can both stay green while a real read path still breaks — see project memory.

### Regression updates

- **`scripts/test-all-report.ts`** — added assertions for all four new PDF sections against real production data; `expectedTrendPages`/point-label-count formulas extended to account for the new Forecast trend page (only counted once ≥6 real history months exist).
- **`scripts/test-rack-unit-capacity.ts`** — `testFullSavePipeline` reworked: it now discovers the report's *actual* resolved Reporting Month up front (energy-log-driven, never touched by this test) and saves the Rack Unit Capacity numbers **and** the new per-month image at that exact month, so the "data present" PDF assertions test the real fixed behavior instead of the old (always-latest) one. The pre-v2.2.5 single-slot image mechanism is still separately exercised (on its own, deliberately different month) to prove it still works even though nothing in the live UI writes to it anymore — coverage preserved, not silently dropped.

### Verification

- `npm run lint` / `npm run build` — clean.
- Full rack-capacity regression (7 scripts) + broader adjacent regression (6 scripts) — all green, including the reworked `test-rack-unit-capacity.ts` and the sheet-name-limit fix.
- `npm run test:all-report:pdf` (real Electron `printToPDF` smoke test) — 18 pages, valid PDF.
- **Live desktop verification, real production data, real click path** (not just the test harness): launched the app against isolated copies of `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` (`ENERGY_MONITOR_APP_ROOT`), drove it via CDP to the Data Entry tab, clicked the real Export Center button, clicked the real "Export All Report" button, and read the resulting PDF page-by-page. Confirmed, in the actual generated 18-page PDF: Capacity Health Gauge (82.1% / Healthy / 75/100, correct fallback-source note), Zone Heatmap (4 zones, correct utilization-band colors), Capacity Trend and Forecast ("Insufficient History — currently 0" — Rangsit has no persisted Rack Capacity History snapshots yet, correctly not fabricated), and Rack Capacity Site Comparison (Rangsit 358 racks vs. Srinakarin 237 racks, both real, no fabricated sibling row) — all reachable from the real Export Center UI, zero console exceptions throughout.
- Portable packaging (`npm run portable:build`) — reproduced the identical `EPERM` on the `win-unpacked` directory rename a 6th time, across a 3rd review round, same stack trace as rounds 1–2. Per explicit Product Owner decision this round, classified as an **environment limitation**, not a code defect, and is **not** a blocker for a local commit. Packaged-runtime verification remains blocked transitively by the same issue.

## Testing

- `npm run lint` (renderer + Electron strict TypeScript) — clean.
- `npm run build` — clean (pre-existing >500kB chunk-size warning only,
  unrelated).
- Full rack-capacity regression: `test:rack-capacity-metrics`,
  `test:rack-capacity-write`, `test:rack-capacity-image`,
  `test:rack-capacity-image-embed`, `test:rack-capacity-history`,
  `test:rack-unit-capacity-image-history` (new, 44 checks - see below),
  `test:rack-status-config` — all green (one real regression caught and
  fixed mid-pass: the new "In Use" fallback color collided with
  "Available"'s new green, breaking the existing "5 distinct status
  colors" assertion).
- Broader regression: `test:excel`, `test:facility-isolation`,
  `test:facility-comparison`, `test:dashboard-facility-isolation`,
  `test:dashboard-config-driven`, `test:dashboard-workbook-mapping` — all
  green (these exercise the same save-path files the Monthly Snapshot and
  Image History changes touched).
- `scripts/test-rack-unit-capacity-image-history.ts` (new, 44 checks, both
  facilities against real production workbook copies): first-save creates
  exactly one row/image anchored at K9; a second month's save creates a
  second row/image without disturbing the first (byte-for-byte); both
  images share one drawing part with two independent anchors; re-saving an
  already-saved month replaces its row/image in place (no duplicate row,
  no orphaned media file) while every other month stays untouched; a month
  with nothing saved reads back `null` (never a fallback to another
  month); cross-facility isolation (Rangsit's image is never returned for
  a Srinakarin lookup, even against the same month); VBA/pivot/table/other
  drawings untouched throughout; production `DC_Rangsit.xlsm` /
  `DC_Srinakarin.xlsm` byte-unchanged.
- Live desktop verification via Chrome DevTools Protocol (CDP), against an
  isolated scratch copy of a real workbook and an isolated
  `ENERGY_MONITOR_APP_ROOT` (never the real `config/config.json` or the
  real `DC_*.xlsm` files — see safety note below): zero console exceptions
  on a clean load, both before and after round 2; full-page screenshot
  confirmed every section renders with real, correct data (237/218/3/13/3-
  equivalent counts matching the regression suite); Reporting Month change
  correctly propagated to every component reading the shared context; Zone
  Heatmap click-to-filter verified end-to-end; mobile viewport (390×844)
  verified responsive stacking; Executive Health Score tile and Capacity
  Alerts panel verified showing internally-consistent values (3 zone
  Warnings, no facility-level alert, matching the facility score landing
  just under the Warning threshold); Forecast's "Insufficient History"
  message verified with the exact required text and a real history count;
  the image round-trip (fill numbers → Save → summary panel fetches and
  correctly shows "No image for this reporting month.") verified
  interactively, not just via the Excel-level test.

## Data safety note

Mid-verification, a real risk was found and contained: launching the
desktop app for visual testing did **not** reliably honor the workbook path
passed via command-line argument — the app's `startupBehavior: "last"`
config re-opened the real `DC_Srinakarin.xlsm` with write access instead of
the intended safe scratch copy. No save action was triggered (verified:
regression-suite numbers matched before and after), and the process was
killed immediately on discovery. The proper isolation mechanism
(`ENERGY_MONITOR_APP_ROOT` env var, already supported by
`src/electron/paths.ts` for exactly this dev/test scenario) was used for
all subsequent testing in this pass. Recorded as a project memory so this
does not recur in a future session.

## Known limitations

- **Portable EXE/ZIP packaging was not produced.** `npm run portable:build`
  fails deterministically (6 attempts across three review rounds, including
  a direct manual `Rename-Item` retry outside the build tooling entirely)
  with `EPERM: operation not permitted, rename '...\release\win-unpacked.tmp'
  -> '...\release\win-unpacked'`. Diagnosed as a real, persistent restriction
  on this specific dev environment — individual file reads/deletes inside
  the freshly-extracted Electron staging directory succeed, but the
  directory-rename operation itself is denied every time, identically,
  even run as the directory's own owning user. This is environmental (very
  likely this sandboxed session's filesystem layer restricting directory
  renames), not an application defect — `dist/`+`dist-electron/` build
  outputs are clean, and the v2.2.4 portable artifacts already in
  `release/` were left untouched. Packaging needs to be run from a session
  without this restriction (e.g. a normal interactive terminal on this
  machine, not this sandboxed tool session). **Product Owner decision
  (round 3): classified as an environment limitation, not a code defect —
  not a blocker for a local commit. The release itself remains "Not
  Certified" until packaging is verified in a normal Windows environment.**
- ~~PDF Gauge/Forecast/Heatmap/Site Comparison sections: not built~~ —
  **built in round 3** (see section H above).
- ~~PDF's Monthly Image is a different source than the dashboard's~~ —
  **fixed in round 3**: the PDF now reads the same per-(Facility, Reporting
  Month) image history store as the dashboard, for the same Reporting Month.
- Monthly Snapshot's `forceSnapshot` path was verified against the full
  regression suite (which exercises the same writer functions) but does not
  yet have a dedicated new regression script asserting the no-op-bypass
  behavior itself.
- PDF Historical Charts (a fuller drill-down beyond the existing 12-month
  trend pages) was named in round 2's original deferred list but was not
  part of round 3's explicit release-blocker scope (Gauge/Forecast/
  Heatmap/Site Comparison/image-source only) — still not built.
- "Historical Explorer tier placement" (whether the generic top-level
  `HistoricalExplorer.tsx` should be embedded on the Rack Capacity page
  instead of `RackCapacityHistoryPanel`) remains unconfirmed, unchanged
  from round 1.
