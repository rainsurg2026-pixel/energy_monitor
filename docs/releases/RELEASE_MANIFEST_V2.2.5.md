# Release Manifest — v2.2.5

## Version

2.2.5 (`package.json` already at 2.2.5 from the interrupted prior session
that this pass resumed and completed).

## Scope of this pass

Four phases — full detail in `RELEASE_NOTES_V2.2.5.md`:

1. **Recovery**: restored a broken build left by an interrupted prior
   session (unmigrated selector block, stale prop-drilling against
   already-context-migrated components), then found and fixed a second,
   real bug invisible to `tsc` — a missing-property context-value defect
   that crashed the Rack Capacity page on first navigation.
2. **Executive Dashboard build-out**: recomposed the Rack Capacity page
   into the mandated architecture; added a shared dynamic-utilization color
   system + WCAG AA contrast helper; a new Zone Heatmap; a weighted
   Capacity Health score; forecast confidence/exhaustion-month; a new
   read-only Rack Unit Capacity executive summary; an explicit, opt-in
   "Record Monthly Snapshot" action on both editors (additive — the
   existing Save button's tested no-op-skip behavior is unchanged); and
   shared-palette alignment in the existing PDF Rack Capacity donut.
3. **Business decisions applied (round 2)**: gauge re-weighted to
   60/25/5/10 (approved); color palette confirmed compliant (no change);
   forecast raised to a 6-month minimum with "Insufficient History";
   Rack Unit Capacity Image switched to strictly following the selected
   Reporting Month, backed by a genuinely new Excel worksheet
   (`Rack Unit Capacity Img History` - one image per Facility + Reporting
   Month, with Timestamp/User, `os.userInfo().username` as the real,
   non-fabricated identity source); writer pattern confirmed compliant (no
   change); new Executive Health Score KPI tile; new Capacity Alerts panel
   reusing existing thresholds.
4. **PDF parity (round 3)**: closed the PDF/dashboard gap the Product Owner
   classified as a release blocker — added Capacity Health Gauge, Zone
   Heatmap, Capacity Trend and Forecast, and Rack Capacity Site Comparison
   to the "Export All Report" PDF (all reusing the exact shared calculation
   modules the dashboard uses, never re-derived); pointed the PDF's Rack
   Unit Capacity Image at the new per-(Facility, Reporting Month) history
   store instead of the legacy single slot; fixed a real bug where the PDF's
   Rack Unit Capacity block showed the *latest* saved month instead of the
   report's actual Reporting Month; found and fixed a genuine, previously
   undetected defect (the new image-history worksheet's name exceeded
   Excel's 31-character limit); reworked the relevant regression tests;
   verified live via the real desktop app's own Export Center button
   against real production data.

## Files changed

22 tracked files modified/deleted, 25 new files (15 in `src/components/rack/`,
6 in `src/utils/`, 1 new Excel writer module, 1 new test script, 2 release
docs). See `git diff v2.2.4 --stat` for the tracked-file list. Round 3
additionally touched: `src/reports/pdf/reportHtml.ts`,
`src/reports/reportDataBuilder.ts`, `src/reports/reportTypes.ts`,
`src/excel/RackUnitCapacityImageHistoryWriter.ts` (sheet-name fix),
`scripts/test-all-report.ts`, `scripts/test-rack-unit-capacity.ts`,
`scripts/test-rack-unit-capacity-image-history.ts`.

Notable:

- `src/components/rack/RackCapacityContext.tsx` — added `selectedZone`
  state (Zone Heatmap ↔ Editor filter); fixed the missing-property bug
  from the Recovery phase; the round-1 `rackUnitCapacityImageDataUri`
  field was added then removed again in round 2 once the image moved to
  on-demand per-month fetching.
- `src/components/rack/ZoneHeatmap.tsx`,
  `src/components/rack/RackUnitCapacitySummary.tsx`,
  `src/components/rack/CapacityAlerts.tsx` — new.
- `src/utils/colorContrast.ts` — new (WCAG AA text-color helper).
- `src/utils/capacityHealth.ts` — added `utilizationColorHex()`,
  `calculateCapacityHealthScore()` (business-approved weights).
- `src/excel/RackUnitCapacityImageHistoryWriter.ts` — new (round 2): the
  per-(Facility, Reporting Month) image history worksheet.
- `src/electron/ipc/excel.ts`, `src/electron/preload.ts`, `src/desktop.d.ts`,
  `src/data/{IDataProvider,ExcelProvider}.ts`,
  `src/excel/{RackCapacityWriter,RackUnitCapacitySaveWriter}.ts` — main-
  process plumbing: two new IPC handlers for the image history store, and
  the additive `forceSnapshot` opt-in on both save writers.
- `scripts/test-rack-unit-capacity-image-history.ts` — new (round 2), 44
  checks against real production workbook copies.

## Artifacts

**Not produced this pass.** `npm run portable:build` (electron-builder)
fails deterministically with `EPERM` on the post-extraction directory
rename (`release\win-unpacked.tmp` -> `release\win-unpacked`) — reproduced
identically across 6 attempts spanning all three review rounds, including a
manual `Rename-Item` outside the build tooling. Diagnosed as an environment
restriction specific to this sandboxed session (individual file operations
inside the same directory tree succeed; only the directory-level rename is
denied), not an application or build-config defect. See "Known limitations"
in `RELEASE_NOTES_V2.2.5.md`. The existing v2.2.4 portable EXE/ZIP in
`release/` were left untouched (verified: unchanged file sizes, all three
rounds). **Product Owner decision (round 3): classified as an environment
limitation, not a code defect — approved as not blocking a local commit.**

No SHA-256 hashes to record, since no new artifact exists.

## Integrity

- Production workbooks `DC_Rangsit.xlsm` / `DC_Srinakarin.xlsm`: untouched
  by any test in this pass (verified via the regression suite's own
  before/after SHA-256 comparisons, all passing).
- A real, disclosed near-miss during manual visual testing (not automated
  regression): the desktop app's `startupBehavior: "last"` config caused
  one launch to open the real `DC_Srinakarin.xlsm` with write access
  instead of the intended isolated scratch copy. No save action was ever
  triggered; verified via matching regression-suite numbers before and
  after, and the process was killed immediately on discovery. All
  subsequent visual testing used `ENERGY_MONITOR_APP_ROOT` for full
  isolation. Recorded as a project memory.
- The real dev `config/config.json` (gitignored, holds the actual
  `lastWorkbookPath`/`recentFiles` for this machine) was transiently
  polluted by the near-miss above and restored to its pre-session state
  (one stale scratch-file entry removed from `recentFiles`) before isolated
  testing began.

## Test Results

- `npm run lint` — clean (renderer + Electron strict TypeScript), both
  rounds.
- `npm run build` — clean, both rounds.
- Full rack-capacity regression (`test:rack-capacity-metrics`,
  `test:rack-capacity-write`, `test:rack-capacity-image`,
  `test:rack-capacity-image-embed`, `test:rack-capacity-history`,
  `test:rack-unit-capacity-image-history` (new), `test:rack-status-config`)
  — all green after one real regression caught and fixed mid-pass round 1
  (a fixed-fallback color collision, caught by the existing "5 distinct
  status colors" assertion).
- `test:rack-unit-capacity-image-history` (new, round 2): 44/44 checks
  against real production workbook copies (both facilities) - upsert
  correctness, cross-month non-interference, cross-facility isolation,
  VBA/pivot/table/other-drawings untouched, production files byte-unchanged.
- Broader regression (`test:excel`, `test:facility-isolation`,
  `test:facility-comparison`, `test:dashboard-facility-isolation`,
  `test:dashboard-config-driven`, `test:dashboard-workbook-mapping`) — all
  green, both rounds.
- Live desktop verification via Chrome DevTools Protocol against an
  isolated workbook copy and isolated `ENERGY_MONITOR_APP_ROOT`, both
  rounds: zero console exceptions; full-page screenshot confirmed every
  section renders with real, correct, cross-checked data; shared Reporting
  Month propagation verified; Zone Heatmap click-to-filter verified
  end-to-end; mobile viewport (390×844) responsive stacking verified.
  Round 2 additionally verified: Executive Health Score tile and Capacity
  Alerts panel showing internally-consistent values; Forecast's
  "Insufficient History" exact text; the image round-trip interactively
  (fill Total/Used → Save → summary panel correctly shows "No image for
  this reporting month.").
- Packaged portable runtime — **not verified**, blocked by the
  packaging failure above (all three rounds).

### Round 3 additions

- Full rack-capacity regression (7 scripts) + broader adjacent regression
  (6 scripts) re-run after the round-3 changes — all green, including the
  reworked `scripts/test-rack-unit-capacity.ts` (now saves the Rack Unit
  Capacity numbers and image at the report's actual resolved Reporting
  Month rather than a hardcoded, unrelated month) and the sheet-name-limit
  fix in `scripts/test-rack-unit-capacity-image-history.ts`.
- `npm run test:all-report:pdf` (real Electron `printToPDF` smoke test) —
  18 pages, valid PDF, `validatePdfBuffer` clean.
- **Live desktop verification via the real Export Center UI** (not just the
  test harness): launched the app against isolated copies of
  `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` (`ENERGY_MONITOR_APP_ROOT`), drove
  it via CDP through the actual Data Entry -> Export Center -> "Export All
  Report" click path, and read the resulting 18-page PDF page-by-page.
  Confirmed real, correct, non-fabricated data in every new section:
  Capacity Health Gauge (82.1% / Healthy / 75/100), Zone Heatmap (4 zones,
  correct utilization-band colors), Capacity Trend and Forecast
  ("Insufficient History — currently 0", correctly not fabricated since
  Rangsit has no persisted Rack Capacity History snapshots yet), and Rack
  Capacity Site Comparison (Rangsit 358 racks vs. Srinakarin 237 racks,
  both real). Zero console exceptions throughout. Isolated environment torn
  down afterward; production workbooks confirmed untouched.
- Portable packaging — reproduced the identical `EPERM` a 6th time (see
  Artifacts above); classified as an environment limitation per explicit
  Product Owner decision this round.

## Local Release Lineage

- A local commit **is** made as part of this pass, per the Product Owner's
  explicit round-3 decision: the portable-packaging `EPERM` is classified
  as an environment limitation, not a code defect, and its absence does not
  block a local commit once every other gate passes (see Release Gates
  below) — which they now do. This commit deliberately does not attempt to
  record its own hash inline in this document (a prior release's manifest,
  v2.2.4, needed two follow-up corrective doc commits precisely because it
  tried to self-reference its own hash before it existed) — see `git log`
  for the actual commit.
- Per this repository's `.claude/rules/git.md` (an absolute, non-negotiable
  constraint): tag creation and release creation remain prohibited outright,
  with no exception — not attempted, not part of this decision.
- No remote exists for this repository; nothing was pushed.

## Release Gates

- [x] Lint (renderer strict + Electron strict TypeScript)
- [x] Build (Vite production build)
- [x] Full rack-capacity domain regression (7 scripts, incl. the new
      image-history test)
- [x] Broader adjacent regression (6 scripts, covering the same files the
      Monthly Snapshot and Image History changes touched)
- [x] Live desktop CDP verification (exceptions, full-page render, shared
      state propagation, interactive click-through incl. the image
      round-trip, mobile viewport, and round 3's real Export Center click
      path producing a real 18-page PDF)
- [x] Data integrity (source workbooks byte-unchanged; near-miss disclosed
      and contained in round 1; real dev config restored)
- [x] All 7 business decisions from the round-2 review package applied and
      re-verified
- [x] PDF Gauge/Forecast/Zone Heatmap/Rack Capacity Site Comparison
      sections — **built in round 3**, reusing shared dashboard calculation
      modules, live-verified against real production data
- [x] PDF Rack Unit Capacity Image — **fixed in round 3**: reads the same
      per-(Facility, Reporting Month) history store as the dashboard
- [ ] Portable EXE/ZIP packaging — **not completed**, environment
      restriction (see Artifacts above), reproduced identically across all
      3 rounds (6 total attempts). **Classified by explicit Product Owner
      decision as an environment limitation — does not block this commit.**
- [ ] Packaged-runtime verification — blocked by the above, not attempted
- [ ] PDF Historical Charts (fuller drill-down beyond the existing 12-month
      trend pages) — named in round 2's deferred list but outside round 3's
      explicit release-blocker scope; still not built
- [ ] Historical Explorer tier placement confirmation — unchanged from
      round 1, still unconfirmed

## Certification

**NOT CERTIFIED AS A SHIPPABLE RELEASE — packaged-runtime verification has
still not been performed.** Every gate within this session's control now
passes: source-level work (recovery, full page composition, shared color
system, Zone Heatmap, weighted gauge, forecast rules, Rack Unit Capacity
executive summary, explicit monthly-snapshot action, the new per-month
image history worksheet, Executive Health Score, Capacity Alerts, and —
round 3 — PDF Gauge/Forecast/Heatmap/Site Comparison parity plus the PDF
image-source fix) is implemented, type-checked, regression-tested (including
a real, previously-undetected worksheet-name-limit bug found and fixed this
round), and live-verified against a running desktop instance with real
production data across all three review rounds, via the actual Export
Center UI a real user would use. The sole remaining gap — portable
packaging and packaged-runtime verification — is blocked by a reproducible,
diagnosed environment restriction specific to this sandboxed session, not
by any code or configuration defect. Per explicit Product Owner decision,
this environment limitation does not block today's local commit, but per
that same decision the release itself explicitly remains **Not Certified**
until packaging is verified end-to-end in a normal (non-sandboxed) Windows
environment — release-quality standards are not being downgraded to match
what this session's environment happens to be able to run. No git tag or
release was created, per this repository's git safety rules.
