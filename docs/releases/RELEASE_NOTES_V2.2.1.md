# Energy Monitor v2.2.1

## Dashboard-FAC reliability fix

Investigated the reported issue "Dashboard-FAC cannot reliably retrieve/update
data from other sheets" independently for `DC_Rangsit.xlsm` and
`DC_Srinakarin.xlsm`. Root cause was **not** broken formulas or wrong source
references — every Dashboard-FAC formula in both workbooks was verified to
point at the correct sheet/table, and no `#REF!`/`#VALUE!`/`#N/A`/`#DIV/0!`
errors were found. The real defects were narrower and additive:

- **Percentage cells displayed as raw decimals.** Load %, Available %, and
  4th Floor Energy Share cells hold correct fractional values (e.g. `0.2616`
  for 26.16%) but were formatted `#,##0.00` instead of `0.00%`, so Excel
  displayed `0.26` instead of `26.16%`. Confirmed on both workbooks across
  every percentage region (UPS/PPC Load %, Available %, Floor Energy Share).
- **Srinakarin's save path skipped two recalculation safeguards that
  Rangsit's already had.** `patchSrinakarinWorkbookBuffer` never removed the
  stale `xl/calcChain.xml` on save and never flagged pivot caches
  `refreshOnLoad="1"`, unlike the Rangsit writer. Confirmed by round-tripping
  both facilities' actual save path against copies: Rangsit already stripped
  calcChain and flagged pivots; Srinakarin did neither before this fix.
  Both writers already correctly set `fullCalcOnLoad="1"` on save.

An uncommitted, unfinished edit to `src/excel/WorkbookWriter.ts` was found in
the working tree at the start of this work (adds per-region percentage
number-format handling for Dashboard-FAC). It matched the confirmed
percentage-format defect but did not compile — a new required
`percentageStyles` parameter was added to `applyGlobalNumericNumberFormats`
without updating either call site, so both the typecheck and the runtime save
path failed (`TypeError: centeredStyles?.get is not a function`). The edit
was completed (both call sites wired, a `0.00%` style registered via the
existing `ensureExactCellFormatStyles` helper) rather than discarded, since it
was the correct fix for a real, independently-confirmed defect.

## Decision: repair, not redesign

Dashboard-FAC's formulas, section layout, Excel Tables, named ranges, pivot
tables, charts, and VBA were all verified structurally sound and
facility-appropriate (Rangsit `A1:K34`; Srinakarin `A1:L42` — deliberately
different layouts, verified independently, not assumed identical). No
redesign was warranted or performed; the workbook's existing visual structure
(clear numbered sections, generous column widths, no clipped text) already
met the professional-appearance bar once the percentage-display defect was
fixed.

## What changed

- `src/excel/WorkbookWriter.ts`: completed Dashboard-FAC percentage
  number-formatting; ported calcChain-removal and pivot-refresh-on-load logic
  from the Rangsit writer into the Srinakarin writer.
- `scripts/test-srinakarin-roundtrip.ts`: added assertions that were missing
  and let the Srinakarin recalculation-safeguard gap ship unnoticed —
  calcChain removal, `fullCalcOnLoad`, pivot `refreshOnLoad`, and
  Dashboard-FAC percentage formatting are now checked on every Srinakarin
  save, matching Rangsit's existing `test:excel` coverage.
- `DC_Rangsit.xlsm`, `DC_Srinakarin.xlsm`: re-saved through the app's real,
  now-fixed save path with no log/data changes — only number formats and
  recalculation metadata changed. See the manifest for before/after hashes.

## Known limitation (not fixed in this release, flagged for follow-up)

The application's own UPS/PPC dashboard read path (`src/reports/upsMappingReader.ts`,
used by `DashboardSummary` and the PDF "All Report") reads Dashboard-FAC's
**cached** formula values directly — it does not run a formula engine. Now
that both writers correctly request a full recalculation on next open, a
human opening either workbook in real Excel will get fresh values. But if the
app itself re-reads a workbook immediately after saving it (without a real
Excel session recalculating in between), it will see the same
pre-recalculation cached values Excel last wrote. This is a pre-existing
architectural characteristic of the offline, non-Excel-engine reader, not a
regression introduced or fixed here. Recommended follow-up: extend the
existing `energyCost.ts` pattern (which already recomputes Building/Floor
energy figures from raw log sheets instead of trusting Dashboard-FAC's cache)
to the UPS/PPC summary and detail tables that `upsMappingReader.ts` currently
reads from Dashboard-FAC's cache.

## Release files

- Portable EXE: `release/Energy Monitor-v2.2.1.exe`
- Portable ZIP: `release/Energy Monitor-v2.2.1.zip`
- Verification record: `docs/releases/RELEASE_MANIFEST_V2.2.1.md`

## Known limitations

- Vite reports one renderer chunk above its 500 kB advisory threshold (carried
  over from v2.2.0; build and packaged runtime tests pass).
- Microsoft Excel was unavailable in this environment. OOXML/VBA/pivot/
  chart/table preservation and the recalculation-metadata fix were verified
  by direct OOXML inspection and the full automated test suite; an operator
  may perform an optional Excel smoke test on a copy of either workbook.
