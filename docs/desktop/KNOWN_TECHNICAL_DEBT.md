# Known Technical Debt

Debt discovered during RC-3. Neither item below is a correctness or
production issue — both are documented here so they are tracked
deliberately instead of rediscovered later.

---

## 1. Cross-language duplication: Srinakarin aggregate IDs

**What**: the 10 Srinakarin UPS/PPC device IDs
(`UPS 41A`/`UPS 41B`/`PPC 41A`…`PPC 44B`) exist in two places:

- `config/srinakarin/profile.json` (`dashboard.upsMapping[].upsId`,
  `dashboard.upsGroups[].ids`) — consumed by the dashboard presentation
  layer (`DashboardSummary.tsx`, `UniversalFilterBar.tsx`)
- `src/utils/srinakarinPower.ts` (`SRINAKARIN_AGGREGATE_IDS`) — consumed by
  the entry screen and the workbook writer for phase-reading aggregation

**Why it exists**: `profile.json` is static JSON, loaded by the Electron
main process; `SRINAKARIN_AGGREGATE_IDS` is a TypeScript constant, compiled
into application code. JSON cannot reference or import a TypeScript
constant, so the same 10 ID strings had to be written twice when the
dashboard's config-driven refactor (see `ARCHITECTURE.md` §6) moved the
dashboard's grouping out of component source and into facility config.

**This is NOT a correctness issue.** Both lists are verified identical by
`scripts/test-dashboard-config-driven.ts`, and a mismatch would surface
immediately as a failing dashboard row, not a silent data error — the
aggregation itself (`calculateSrinakarinAggregate()`) never reads
`profile.json`, so a drift here cannot corrupt saved workbook data.

**This is NOT a production issue.** Nothing in the write/read/save path is
affected; this is purely two lists that need to be kept in sync by hand
if Srinakarin's device topology ever changes.

**This is a maintainability concern only**: a future edit to one list
(e.g. adding an 11th Srinakarin device) that forgets to update the other
would desync the dashboard's grouping from the entry screen's aggregation,
without a compiler error to catch it.

**Recommended future solution** (not implemented — documentation only):
generate `config/srinakarin/profile.json`'s `dashboard` block from
`SRINAKARIN_AGGREGATE_IDS` at build time (a small script step in
`scripts/build-electron.mjs` or a dedicated `scripts/generate-facility-config.mjs`),
so `SRINAKARIN_AGGREGATE_IDS` remains the single source and the JSON
becomes a build artifact rather than hand-maintained duplicate data. Out
of scope for RC-3; tracked here for a future pass.

---

## 2. Legacy test: `test:excel` references a retired workbook

**Status: Deprecated.**

`npm run test:excel` (`scripts/test-excel-roundtrip.ts`) copies and
round-trips `RST_Dashboard.xlsm` from the repository root. That file is
the pre-multi-site, single-facility workbook this application used before
the Rangsit/Srinakarin facility split — it is no longer part of the
supported multi-site architecture and is not present in this repository's
current working state (`config/facilities.json` now points at
`DC_Rangsit.xlsm` / `DC_Srinakarin.xlsm`).

Running `test:excel` today fails with `ENOENT` on `RST_Dashboard.xlsm` —
this is expected given the above, not a regression in the Excel engine
itself. The Excel engine's actual round-trip/preservation guarantees (VBA,
pivots, charts, tables, atomic save) are independently and currently
verified by `scripts/test-facility-isolation.ts` and
`scripts/test-dashboard-facility-isolation.ts` against the real,
supported `DC_Rangsit.xlsm` / `DC_Srinakarin.xlsm` workbooks.

**Recommendation** (not implemented — documentation only): retire
`test:excel` / `scripts/test-excel-roundtrip.ts` and replace its
byte-level preservation assertions (`vbaProject.bin` identity, pivot
cache/chart/table survival) with an equivalent round-trip test driven off
`DC_Rangsit.xlsm` (or `DC_Srinakarin.xlsm`), so the multi-site workflow has
its own dedicated byte-level preservation coverage instead of relying on a
retired single-facility file.

---

## 3. `test:ups-group-history` asserts a "pristine fixture" against the live Srinakarin workbook

**Status: Known, non-blocking (Release Audit, 2026-07-22).**

`scripts/test-ups-group-history.ts` reads `DC_Srinakarin.xlsm` directly
from the repository root (not a copy) and asserts, as its first check,
that the workbook has no `2. UPS Group History` sheet yet ("source
workbook has no History sheet yet (test fixture untouched)"). That
assertion now fails, because the live `DC_Srinakarin.xlsm` legitimately
already has the sheet — the feature has been exercised against this
workbook through real use (the app auto-migrates the sheet in on open;
see the "UPS Group History migration-on-open" behavior covered by
`scripts/test-ups-group-history-migration.ts`). All 24 other assertions
in the same suite pass, including the ones that verify the sheet's
contents against live dashboard aggregation.

**This is NOT a correctness or regression issue.** The test never writes
to the workbook on disk (`patchUpsGroupHistoryBuffer` returns a new
in-memory buffer); it only reads the current file and diffs buffers in
memory. The failure is the test's own "pristine fixture" precondition
going stale against a live file that has, correctly, already had the
feature run against it.

**Recommended fix** (not implemented — documentation only): point this
suite at a copied fixture (mirroring the pattern already used by
`test-excel-roundtrip.ts`, `test-ups-group-history-migration.ts`, and
`test-production-stress-fault.ts`, all of which copy into
`dist-electron/test-work/` before asserting "before" state) instead of
reading the project-root live workbook directly.
