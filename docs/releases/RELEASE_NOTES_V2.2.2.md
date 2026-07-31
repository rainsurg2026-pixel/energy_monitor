# Energy Monitor v2.2.2

## Rack Capacity Management (new feature)

The previously read-only Rack Capacity Overview is now a full management
feature, built directly against the real `Rack Capacity`/`Table7` schema in
both `DC_Rangsit.xlsm` (358 racks, zones A–D) and `DC_Srinakarin.xlsm` (237
racks, zones A–C — verified independently; layouts are not assumed identical).

- **Navigation.** Numeric prefixes ("1.", "2.", "3.", "4.") removed from every
  main tab. New **Rack Capacity** tab added immediately after **Data Entry**.
  Order: Dashboard Summary, Data Entry Sheet, Rack Capacity, Historical Logs,
  Site Comparison, Settings & Data Validation.
- **Search & filter.** Rack Zone, Rack ID (partial match), and Status filters,
  combinable, with a clear-filters control. Zone options are derived from the
  real workbook data, never hardcoded.
- **Staged Status editing.** Changing a rack's Status stages the change in
  the UI (dirty-row highlight, pending-change count); nothing is written
  until **Save Changes**, which is disabled with no pending edits. The save
  path verifies each row's Rack ID and previous Status against what is
  actually on disk before writing — a row changed elsewhere since the UI last
  read it is reported as a conflict, not silently overwritten.
- **Rack Capacity Image (K9).** Upload via file picker, drag-and-drop, or
  clipboard paste (PNG/JPEG). Validated by real file content (magic bytes and
  parsed pixel dimensions), never by filename/extension. Embedded as an
  actual Excel drawing anchored at K9 (`Rack Capacity` sheet), not a file
  path/base64 string in a cell — K9 was confirmed empty and unmerged, and
  neither workbook had any prior drawing on that sheet, so the first upload
  creates a dedicated drawing part and later replacements reuse it (aspect
  ratio preserved, oversized images downscaled, old media file removed on
  replace) without touching any other drawing/chart in the workbook.
- **Overview.** Cards now show count **and** percentage (ratios stored
  internally as 0–1 fractions, formatted at render time only — never stored
  as an already-scaled 0–100 number). Added a Rack Status Distribution donut.
  The Zone × Status pivot table now shows `count (percentage)`, with
  zone-level percentages using the **zone** total as denominator and the
  Grand Total row using the **facility** total — verified independently.
- **Rack Capacity History (new workbook sheet).** A structured Excel Table
  snapshot, captured only on a successful Save (never backfilled from
  today's data), keyed by Facility + SnapshotMonth + RackZone with a true
  upsert (re-saving unchanged data is a byte-identical no-op). Reporting
  month is read from the workbook's own existing `Dashboard-FAC!H1` selector,
  not the PC's system clock. History UI: Reference Month + 3/6/12-month
  ranges, a table, and a Usage %/Availability % trend (an "insufficient
  history" message when fewer than 2 months exist; missing months render as
  a gap, never a fabricated zero).
- **Export All Report (PDF).** Added Site Comparison (this facility plus a
  best-effort read of the sibling facility for the same reference month —
  never blocks the primary report if the sibling workbook is unavailable)
  and Rack Capacity Overview + trend pages, using the same
  `calculateRackCapacityMetrics()` the UI uses. Charts are inline SVG, not
  `<img>` (the report's existing forbidden-content check disallows `<img>`).
- **Facility isolation.** Verified end-to-end, including in the packaged
  build: Srinakarin's Rack Capacity tab never shows Rangsit's totals or vice
  versa.
- **U-capacity.** Still not exposed/inferred — no authoritative U-count field
  exists in either workbook's Table7.

## Also fixed while building this feature

- `patchRackCapacityStatusChanges`'s (and the equivalent history writer's)
  pivot-cache handling now flags Table7's Zone × Status pivot cache to
  refresh on next Excel open, the same mechanism proven in v2.2.1 for
  Dashboard-FAC. This closes a real, independently-confirmed staleness gap:
  Srinakarin's pivot cache was found to be 16 days stale relative to its live
  Table7 data during this investigation (not something the app's existing
  read-only Overview relied on — it already recomputed counts from the live
  table — but a real gap for anyone opening the file directly in Excel).
- `scripts/e2e-cdp.mjs` and `scripts/run-packaged-report-test.mjs` both
  navigated by matching the now-removed numeric label prefixes
  (`innerText.includes("1.")`, etc.); both were updated to index-based nav
  selection, which is also more robust to future label wording changes.
- `scripts/test-all-report.ts` previously asserted Rack Capacity content must
  **never** appear in Export All Report — a stale expectation from before
  this feature existed, now updated to assert the new, intentional content
  positively (real cards, donut, Site Comparison table) instead.

## Known limitation (not addressed in this release, tracked for follow-up)

`upsMappingReader.ts` (used by the Dashboard's UPS/PPC panels) still reads
Dashboard-FAC's cached formula values rather than recomputing from source —
flagged in v2.2.1's `docs/desktop/KNOWN_TECHNICAL_DEBT.md` item 4, unrelated
to and unchanged by this release.

## Release files

- Portable EXE: `release/Energy Monitor-v2.2.2.exe`
- Portable ZIP: `release/Energy Monitor-v2.2.2.zip`
- Verification record: `docs/releases/RELEASE_MANIFEST_V2.2.2.md`

## Known limitations

- Vite renderer chunk advisory above 500 kB remains (carried over; no
  functional/runtime failure found).
- Microsoft Excel was unavailable in this environment. The K9 image embed
  and Rack Capacity History sheet were verified by direct OOXML inspection,
  re-opening with ExcelJS, and the full automated + packaged-runtime test
  suite; an operator may optionally open a copy of either workbook after a
  real save in Excel to visually confirm the image and pivot refresh.
