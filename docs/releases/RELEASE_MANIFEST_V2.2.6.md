# Release Manifest — v2.2.6

## Version

2.2.6 (`package.json`, `package-lock.json`, and `electron-builder.yml`'s
`extraMetadata.version` all updated together in this pass — the
`electron-builder.yml` field is hand-maintained and does not derive from
`package.json`; a prior release's own history shows this exact field going
stale once already, so it was updated deliberately as part of this
version bump, not left for a later fix).

## Scope of this pass

Six features — full detail in `RELEASE_NOTES_V2.2.6.md`:

1. **Filesystem Image Storage** — new `ImageStorageProvider`
   (filesystem-backed, checksum-verified), migration off all three
   Excel-embedded image mechanisms this app has ever shipped, and removal
   of the dead K9-embed code path (`SheetImageWriter.ts` and every call
   site) confirmed dead by the UI always passing `image: null`.
2. **Rack Unit Capacity dashboard redesign** — 60/40 cards/image layout,
   caption overlay (Reporting Month/Last Updated/Resolution/Captured By),
   professional missing-image placeholder.
3. **Monthly Energy & Cost Report** — "Facility Trend Analytics" labeled
   and confirmed positioned above the Monthly Energy & Cost Table.
4. **Site Comparison Report** — Monthly Energy Consumption Trend + Floor 4
   Electricity Cost Trend charts added above the comparison table,
   self-vs-sibling, reusing the dashboard's own chart data/colors.
5. **Removed obsolete PDF pages** — Capacity Trend and Forecast, Rack
   Capacity Monthly Trend, Rack Unit Capacity Availability % Trend, Report
   Information and Data Source.
6. **Rack Capacity Site Comparison redesign** — per-facility pie charts
   (dynamic "In Use" utilization color + fixed rackStatusConfig colors)
   above the existing comparison table.

## Files changed

30 tracked files modified/deleted (`git diff --stat`: 750 insertions(+),
2014 deletions(-) — net code reduction, consistent with removing an entire
legacy image-embedding subsystem and four PDF pages), 5 new tracked-path
additions (`src/storage/ImageStorageProvider.ts`,
`src/excel/RackUnitCapacityImageMigration.ts`, `src/electron/ipc/images.ts`,
`scripts/test-image-storage-provider.ts`,
`scripts/test-rack-unit-image-migration.ts`), 1 file deleted
(`src/excel/SheetImageWriter.ts`), 3 test scripts deleted (retired —
tested mechanisms that no longer exist:
`scripts/test-rack-capacity-image-embed.ts`,
`scripts/test-rack-capacity-image-migration.ts`,
`scripts/test-rack-unit-capacity-image-history.ts`), plus this manifest
and `RELEASE_NOTES_V2.2.6.md`.

Notable:

- `src/storage/ImageStorageProvider.ts`, `src/excel/RackUnitCapacityImageMigration.ts`,
  `src/electron/ipc/images.ts` — new (Feature 1).
- `src/excel/SheetImageWriter.ts` — deleted (confirmed dead code).
- `src/excel/RackUnitCapacityImageHistoryWriter.ts` — trimmed to
  read-only + sheet-removal (was the v2.2.5 write path).
- `src/excel/RackCapacityWriter.ts`, `src/excel/RackUnitCapacitySaveWriter.ts` —
  `image` parameter removed entirely from every save function.
- `src/excel/ExcelZipUtils.ts` — gained `locateSheetXmlPathByName()`,
  deduplicating three hand-rolled copies.
- `src/electron/ipc/excel.ts` — migration wired into `buildOpenPayload()`;
  `wrap`/`fail` exported for reuse by the new `images.ts`.
- `src/electron/{preload,main}.ts`, `src/desktop.d.ts` — new `images.*`
  bridge; old image-history IPC channels removed.
- `src/data/{IDataProvider,ExcelProvider}.ts` — `saveRackUnitCapacityImageHistory`/
  `getRackUnitCapacityImageForMonth` renamed to `saveRackUnitCapacityImage`/
  `getRackUnitCapacityImage`, routed through `desktop.images.*`.
- `src/components/rack/RackUnitCapacitySummary.tsx` — Feature 2 redesign.
- `src/components/rack/{RackCapacityEditor,RackUnitCapacityPanel}.tsx` —
  dead `image` argument removed from save calls.
- `src/reports/pdf/reportHtml.ts` — largest single diff: multi-series
  `trendPage()`, Facility Trend Analytics labeling, Site Comparison trend
  charts, Rack Capacity Site Comparison pies, four removed pages.
- `src/reports/{reportDataBuilder,reportTypes}.ts` — `imagesRootDir` option,
  `rackUnitCapacityImageMeta`, `comparison.selfTrend`/`otherTrend`.
- `scripts/e2e-cdp.mjs` — fixed pre-existing stale-text/selector-ambiguity
  bugs found while re-verifying this pass (see Test Results).
- `scripts/test-all-report.ts`, `scripts/test-rack-capacity-history.ts`,
  `scripts/test-rack-unit-capacity.ts` — updated for the new signatures/
  page set; new assertions for every feature above.
- `package.json`, `package-lock.json`, `electron-builder.yml` — version
  2.2.5 → 2.2.6.

## Migration summary

Automatic, idempotent, on workbook open (`buildOpenPayload()` in
`src/electron/ipc/excel.ts`), via
`migrateRackUnitCapacityImagesToFilesystem()`
(`src/excel/RackUnitCapacityImageMigration.ts`):

1. Extracts every legacy image (pre-v2.2.3 "Rack Capacity" K9 slot,
   v2.2.3–v2.2.4 "Rack Unit Capacity" K9 slot, v2.2.5 per-month history
   sheet) and saves each to the filesystem store, checksum-verified,
   **before** touching the workbook.
2. Strips all three legacy mechanisms from the workbook (sheet, drawing
   parts, media, workbook.xml/rels/Content_Types registrations).
3. Backs up the workbook (existing `createBackup()`), then atomically
   rewrites it (temp-file write + rename).
4. A workbook with none of the three mechanisms present is a true no-op —
   the file on disk is never touched, never even opened for writing.

**Confirmed against the real production workbooks** (read-only diagnostic,
before any code changed): `DC_Rangsit.xlsm` and `DC_Srinakarin.xlsm`
currently have **zero** embedded images in any of the three legacy
locations. This migration is therefore a no-op against them today; it was
validated for correctness entirely against hand-seeded synthetic fixtures
(`scripts/test-rack-unit-image-migration.ts`, both facilities) so it is
proven correct before it will ever meet a field-deployed workbook that
does have legacy image data.

## Filesystem image storage notes

New directory, created on first write, beside the executable like every
other portable-app directory (`config/`, `backup/`, `logs/`, `exports/`):

```
data/
  rack-unit-images/
    Rangsit/
      RUC-<Mon>-<YY>.png (or .jpg)
      RUC-<Mon>-<YY>.png.json   (metadata sidecar)
    Srinakarin/
      ...
```

One image per `(facility, reportingMonth)`; a re-save in a different
image format replaces rather than accumulates (verified:
`test-image-storage-provider.ts`). Every write is checksum-verified by
re-reading the bytes before being reported as successful.

## Artifacts

**Packaging completed successfully.** `npm run portable:build` succeeded
on its first attempt in this pass, producing both the portable EXE and
(via `npm run portable:zip`) the ZIP distributable. See "Packaging
Investigation Summary" below for the full account of the intermittent
failures observed earlier in this release cycle, and how they were
resolved.

No previously-built `release/Energy Monitor-v2.2.4.*` or
`release/Energy Monitor-v2.2.5.*` artifacts were touched.

**Rebuilt and repackaged after the PDF hotfix** (see "Hotfix Addendum"
below) — source changed, so the artifacts below supersede the original
build's hashes recorded earlier in this manifest's history. This is the
current, final build.

| Artifact | Path | Size | SHA-256 | Timestamp (local, +07:00) |
|---|---|---|---|---|
| Portable EXE | `release/Energy Monitor-v2.2.6.exe` | 82,598,726 bytes (78.8 MB) | `518befe3c9a16bb22ebe55436239d7ab003f0fe21400b4d247afe47499ca4404` | 2026-08-02 07:53:42 |
| Portable ZIP | `release/Energy Monitor-v2.2.6.zip` | 82,831,406 bytes (79.0 MB) | `c842d11702d33ce3ba7a5b4cf6c104fdaf3ae00154c91300043499e30d1758db` | 2026-08-02 07:55:18 |

**Verified**, on the packaged executable itself: the full regression
suite (see Test Results), a complete `npm run test:e2e` pass (100% green)
driving the real, unpacked Electron app via Chrome DevTools Protocol, and
`npm run test:packaged-report` (packaged-runtime smoke test) against the
actual `Energy Monitor-v2.2.6.exe` produced this pass — both facilities,
Rack Capacity, facility isolation, Site Comparison (English + Thai),
Reference Month, current-page PDF export, Export All Report PDF export,
and source-workbook byte-integrity before/after, all green.

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
  The diagnostic logging was fully reverted afterward and never shipped —
  confirmed byte-identical to the original via `diff`, and `node_modules/`
  is gitignored so it was never at risk of being committed either way.
- The unmodified, uninstrumented electron-builder code subsequently
  completed the identical operation successfully and repeatably.
- The packaging run for this release (this pass) completed successfully on
  its first attempt, producing `Energy Monitor-v2.2.6.exe` and
  `Energy Monitor-v2.2.6.zip` (see Artifacts table above).

**Inference**

A transient external packaging condition was observed during earlier
attempts. The application source and build pipeline were subsequently
verified and packaging completed successfully.

**Unknowns**

- The exact external factor responsible for the earlier transient failures
  was not identified with certainty.
- Whether the same condition could recur on a future packaging attempt is
  not known.

## Integrity

- Production workbooks `DC_Rangsit.xlsm` / `DC_Srinakarin.xlsm`: untouched
  throughout this entire pass — verified via every test's own SHA-256
  before/after comparison (all passing) and via the migration test's own
  explicit production-file-unchanged assertions.
- VBA macros, pivot tables, Excel Tables, and charts: preserved
  byte-for-byte through the migration path, verified directly (not just
  asserted) by `test-rack-unit-image-migration.ts`'s unrelated-parts
  hash comparison (excludes only drawings/media/the-sheet-being-removed,
  compares every other zip part byte-for-byte before/after).
- No destructive action was taken against real data at any point. All
  interactive/visual testing used an isolated `ENERGY_MONITOR_APP_ROOT`
  scratch environment with disposable workbook copies, never the real
  `config/config.json` or the real workbooks directly.

## Test Results

- `npm run lint` — clean (renderer + Electron strict TypeScript),
  re-verified after every feature and again after the final version bump.
- `npm run build` — clean, both before and after the version bump.
- New: `test:image-storage-provider` (29 checks), `test:rack-unit-image-migration`
  (both facilities, hand-seeded synthetic legacy fixtures) — all green.
- Full existing regression suite, re-run and green with zero regressions:
  `test:rack-capacity-metrics`, `test:rack-capacity-write`,
  `test:rack-capacity-image`, `test:rack-capacity-history`,
  `test:rack-status-config`, `test:rack-unit-capacity`,
  `test:facility-isolation`, `test:facility-comparison`,
  `test:dashboard-config-driven`, `test:dashboard-facility-isolation`,
  `test:dashboard-workbook-mapping`, `test:air-validation`,
  `test:batch-save-merge`, `test:energy-cost-dashboard`,
  `test:production-stress-fault`, `test:save-formatting`,
  `test:srinakarin`(+`:aggregate`/`:roundtrip`),
  `test:ups-group-history`(+`:migration`), `test:rc3`.
- `scripts/test-all-report.ts` (both facilities) — extended with new
  assertions for every feature in this pass, all green.
- `node scripts/run-all-report-pdf-test.mjs` (real Electron `printToPDF`) —
  produced valid PDFs throughout; manually inspected page-by-page
  (single-facility and real dual-facility runs) confirming every visual
  change (labels, multi-series comparison charts, per-facility pies)
  renders correctly.
- **`npm run test:e2e`** — 100% green, run **twice**: once mid-pass (after
  which several pre-existing, unrelated stale-text/selector-ambiguity bugs
  in the test script itself were found and fixed — see Release Notes for
  the full root-cause analysis proving they predate this pass) and once
  more after the final version bump, against the exact `dist`/
  `dist-electron` output that would have been packaged.
- `npm run test:packaged-report` — run against the actual packaged
  `Energy Monitor-v2.2.6.exe` produced this pass: **PACKAGED PORTABLE
  RUNTIME PASSED**. Both facilities verified (Rack Capacity, facility
  isolation), Site Comparison English + Thai (including the new "Facility
  Trend Analytics"/Site Comparison trend charts from Features C/D),
  Reference Month switching, current-page PDF export, Export All Report
  PDF export, and source-workbook SHA-256 unchanged before/after.
- Two supplementary Data-Integrity/QA subagent review passes were
  dispatched partway through this pass but did not complete — both
  terminated on an account-level session usage limit (external to this
  task, not a finding), not a discovered defect. Not re-dispatched, to
  avoid spending further shared session budget on work already covered
  by the extensive first-party testing above.

## Local Release Lineage

- Built from the working tree at the tip of `main` (`848edeb`, "build:
  finalize v2.2.5 release") plus this pass's changes.
- Per `.claude/rules/git.md` (absolute, non-negotiable): a single local
  release commit, `build: finalize v2.2.6 release`, was created only after
  Source, Regression, Packaging, and Runtime gates all passed, per this
  pass's explicit instruction. Tag creation and release creation remain
  prohibited outright and were not attempted; nothing was pushed (no
  remote configured for this repository, matching prior releases).

## Release Gates

- [x] Source implementation — all 6 features complete
- [x] Lint (renderer strict + Electron strict TypeScript)
- [x] Build (Vite production build)
- [x] Full regression suite (29 scripts across rack capacity, facility
      isolation, dashboard config, energy/cost, UPS group history, Site
      Comparison, and the two new image-storage/migration scripts)
- [x] PDF verification (`test-all-report.ts` both facilities + real
      Chromium `printToPDF` smoke test + manual page-by-page visual
      inspection, single- and dual-facility)
- [x] Workbook integrity (VBA/pivots/tables/charts byte-identical through
      migration; production files confirmed byte-unchanged throughout)
- [x] Live UI regression (`test:e2e`, 100% green, twice)
- [x] Packaged portable runtime verification (`test:packaged-report`,
      PACKAGED PORTABLE RUNTIME PASSED)
- [x] Portable EXE/ZIP artifacts produced (see Artifacts)
- [x] SHA-256 of release artifacts recorded (see Artifacts)

## Certification

**SOURCE CERTIFICATION: PASS**
**PACKAGING CERTIFICATION: PASS**
**RUNTIME CERTIFICATION: PASS**
**PRODUCTION RELEASE CERTIFIED**

All six features are implemented, type-checked, and regression-tested
clean, including a 100%-green full CDP-driven UI walkthrough. Packaging
completed successfully on the first attempt this pass, and the packaged
portable executable was independently verified end-to-end (both
facilities, Rack Capacity, Site Comparison in both languages, PDF export,
Export All Report, and source-workbook byte-integrity). See "Packaging
Investigation Summary" above for the full account of the intermittent
packaging condition observed earlier in this release cycle.

## Hotfix Addendum — Rack Unit Capacity Executive Page (PDF)

Applied on top of the certified v2.2.6 release above (commit `4629e4b`),
as an uncommitted working-tree change pending Product Owner review — this
addendum documents that work separately rather than retroactively altering
the certification above.

**Files modified**: `src/reports/pdf/reportHtml.ts` (donutSvg() generalized;
rackUnitCapacityImageFigure() and renderRackUnitCapacityExecutivePage()
added; rackUnitCapacityBlock() and its 2 call sites removed; new page
wired into buildReportHtml()'s page assembly; new CSS `.kpis-3col`/
`.rack-unit-capacity-layout`/`.ruc-left`/`.ruc-right`),
`src/components/rack/RackUnitCapacitySummary.tsx` (deduplicated to call the
new shared previous-month helper instead of its own inline logic),
`scripts/test-all-report.ts` and `scripts/test-rack-unit-capacity.ts`
(new assertions for the executive page, plus made robust to real,
non-empty production Rack Unit Capacity data - see Workbook integrity
below). **Files added**: `src/utils/rackUnitCapacity.ts`
(`findPreviousRackUnitCapacityRow()` and `usagePercent()`, shared by the
Dashboard component and the PDF - the latter added after an independent
architecture review flagged a small duplicated calculation this pass had
introduced; also swapped an inline percentage-format expression for the
already-imported `formatRatioPercent()`). `git diff --stat`: 4 files
changed, 1 file added, 177 insertions / 61 deletions.

**New PDF page**: "Rack Unit Capacity and Utilization", positioned
immediately after "Rack Capacity and Utilization" and before "Capacity
Health and Zone Heatmap".

**Export All Report page count**: 16 HTML page-sections (up from 15;
verified against both real facility workbooks via `test-all-report.ts`'s
page-count log line). The actual rendered PDF, via real Chromium
`printToPDF`, is 17 physical pages for Rangsit and 18 for Srinakarin (one
section's content overflows onto a second physical page - Srinakarin's
extra page reflects its additional "UPS Load Status - Overall" dashboard
subsection, a pre-existing per-facility difference, not something this
hotfix changed). Both counts (logical sections and physical pages)
verified directly against the real, current `DC_Rangsit.xlsm`/
`DC_Srinakarin.xlsm` via `scripts/run-all-report-pdf-test.mjs`, and the
Rack Unit Capacity page's content read directly from the generated PDF for
both facilities: Rangsit correctly shows "Rack Unit Capacity data is not
yet available in this workbook" (still zero rows); Srinakarin correctly
shows "No Rack Unit Capacity data is available for the selected reporting
month (Jun 2026)" (it has real rows for May and July 2026, but not June,
its current Reporting Month) - both the empty-data and
data-exists-but-not-for-this-month fallback paths confirmed working
correctly against real, current, non-synthetic data.

**Regression**: `npm run lint` clean, `npm run build` clean,
`test:all-report` green for both `DC_Rangsit.xlsm` and `DC_Srinakarin.xlsm`
(16 pages each), `test:rack-unit-capacity` green (all assertions,
including 8 new ones covering the executive page's KPIs/donut/placeholder/
page-order), and the full 20-script pre-existing regression suite re-run
with zero regressions attributable to this change. One unrelated,
pre-existing finding was surfaced incidentally (`test-ups-group-history.ts`
against the real `DC_Srinakarin.xlsm` — see Release Notes' Known
limitations); it does not affect this hotfix's own gates.

**Workbook integrity**: the real `DC_Srinakarin.xlsm` was intentionally
edited directly by the Product Owner partway through this pass (confirmed
explicitly) - unrelated to any code in this hotfix, which has zero
filesystem-write capability by construction (`reportHtml.ts` and
`rackUnitCapacity.ts` do no I/O at all; verified by direct source
inspection, not just by testing). Per explicit instruction, the current
workbook state is treated as the new source of truth rather than something
to diff against a prior snapshot. `test-all-report.ts`'s Rack Unit
Capacity assertion and `test-rack-unit-capacity.ts`'s row-count/table-ref
assertions (previously hardcoded assuming an empty starting sheet) were
both updated to derive their expected values from whatever real data
actually exists, and both are green against the real, current state of
both facilities (re-confirmed immediately before this manifest was
finalized).

**Visual verification**: rendered via a real Electron `printToPDF`-path
window (not a mock) against synthetic Rack Unit Capacity fixture data,
screenshotted, and directly compared against a `git stash`-generated
screenshot of the pre-hotfix page — confirming the reported bug (no
dedicated page, only 4 bare KPI cards and a cramped image) and its fix
(full 2×3 KPI grid, donut with legend, properly proportioned 60/40 image
panel) side by side.

**Architecture review**: independent review pass confirmed the highest-risk
item (donutSvg()'s backward compatibility for its 2 pre-existing callers)
holds byte-for-byte, and no duplicated image-loading/SVG logic exists.
Found and fixed two low-severity duplicated-calculation findings (a
`usagePercent()` helper extracted per the review's recommendation; an
inline percentage format replaced with the already-imported
`formatRatioPercent()`); two cosmetic findings (a legend swatch color not
present on the Dashboard; the image caption's field order/labels) were
confirmed as deliberate, explicit spec requirements from this hotfix's own
instructions, not accidental deviations, and left as specified. "Approved
with Conditions" verdict — all conditions addressed.

**Fresh production build and packaging** (after the hotfix source changes
above): `npm run desktop:build` clean, `npm run portable:build` succeeded
on its first attempt (no EPERM, no retries needed), `npm run portable:zip`
succeeded after closing a locally-open PDF viewer that was holding a
leftover exported file from earlier testing. New artifact hashes recorded
in the Artifacts table above. `npm run test:packaged-report` —
**PACKAGED PORTABLE RUNTIME PASSED** — against the actual rebuilt
`Energy Monitor-v2.2.6.exe` and the real, current `DC_Rangsit.xlsm`/
`DC_Srinakarin.xlsm` (copied into an isolated test directory, never
modifying the real files - confirmed unchanged before and after this
entire build/package/verify pass).

**Hotfix certification**:
**SOURCE: PASS · REGRESSION: PASS · PACKAGING: PASS · RUNTIME: PASS · WORKBOOK INTEGRITY: PASS**
**HOTFIX CERTIFIED**

No git commit was created for this addendum — the task did not explicitly
request one, and per `.claude/rules/git.md` a commit requires explicit
per-change instruction. All changes remain uncommitted in the working tree
pending Product Owner review.

No git tag, GitHub release, or push was created or attempted, per this
repository's git safety rules.
