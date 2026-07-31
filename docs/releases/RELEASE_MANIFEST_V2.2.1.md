# Energy Monitor v2.2.1 Release Manifest

## Release identity

| Field | Value |
|---|---|
| Product | Energy Monitor |
| Version | 2.2.1 |
| Release date | 2026-07-31 |
| Version change | 2.2.0 → 2.2.1 |
| SemVer decision | PATCH — bug fix (Dashboard-FAC percentage formatting and Srinakarin recalculation metadata); no schema/behavioral contract change. |
| Git branch | `main` |
| Parent commit | `a55dc5e` ("release: Energy Monitor v2.2.0") |
| Source state | `src/excel/WorkbookWriter.ts` had an uncommitted, non-compiling partial edit at start of work (see Recovery below); no other unrelated changes present. |

## Recovery (working tree at start of work)

| Item | Finding |
|---|---|
| `git tag --list` | Empty — no `v2.2.0` (or any) tag existed, despite the task brief and `.claude/rules/git.md`'s historical note both assuming one. HEAD (`a55dc5e`) matched the expected v2.2.0 release commit. |
| `src/excel/WorkbookWriter.ts` uncommitted diff | Added a `percentageStyles: Map<string,string>` parameter to `applyGlobalNumericNumberFormats` plus Dashboard-FAC percentage-region detection helpers, but did not update either of the function's two call sites. |
| Classification | **PARTIALLY CORRECT / INCOMPLETE.** `tsc --noEmit` failed (`TS2345`, argument count/type mismatch) at both call sites; `npm run test:energy-cost-dashboard` crashed at runtime (`TypeError: centeredStyles?.get is not a function`) confirming it was not just a type error. The underlying intent (percentage number formatting for Dashboard-FAC) matched an independently-confirmed real defect. |
| Action taken | Completed the edit — wired `percentageStyles` through both call sites (Rangsit and Srinakarin writers), registered a `0.00%` style via the existing `ensureExactCellFormatStyles` helper. Verified with `tsc --noEmit` (clean) and the full regression suite (all green) before use. |

## Root cause

| Hypothesis (from prior investigation notes) | Verdict | Evidence |
|---|---|---|
| 1. No obvious `#REF!` etc. errors in Dashboard-FAC formulas | CONFIRMED | Full cell-by-cell OOXML dump of both workbooks' Dashboard-FAC sheets (`A1:K34` Rangsit, `A1:L42` Srinakarin); zero error tokens found; every formula's source-sheet/table reference verified correct. |
| 2. Cached KPI values matched internal source data | CONFIRMED (internally) | `npm run test:energy-cost-dashboard` independently recomputes Building/Floor Energy, Cost, Average Rate from `4. Electricity Cost Log` (not from Dashboard-FAC's cache) and asserts equality with Dashboard-FAC's cached `D32/E32/F32` (Rangsit) and `D40/E40/F40` (Srinakarin, different row) — passed before and after this fix. |
| 3. Rangsit may not reliably request full recalculation | REJECTED (already correct) | `patchWorkbookBuffer` (Rangsit) already set `fullCalcOnLoad="1"` and stripped `calcChain.xml` on save; verified via copy round-trip before any change. |
| 4. Stale calcChain contributes to non-refresh | PARTIALLY CONFIRMED (Srinakarin only) | See #5. |
| 5. Srinakarin save path may leave stale `calcChain.xml` | **CONFIRMED — real defect** | `patchSrinakarinWorkbookBuffer` had no calcChain-removal logic at all (only `patchWorkbookBuffer`/Rangsit did). Proved by running the actual pre-fix function against a copy of the current production `DC_Srinakarin.xlsm`: `calcChain.xml` remained present after save. Fixed by porting the identical, already-proven Rangsit logic. |
| 6. Srinakarin path may not request pivot refresh | **CONFIRMED — real defect** | Same method: pivot `refreshOnLoad="1"` flag was never set by the Srinakarin writer. Fixed the same way. |
| 7. Percentage cells use `#,##0.00` instead of `0.00%` | **CONFIRMED — real defect, both facilities** | Direct OOXML inspection found this on every percentage-semantic cell in both workbooks (Load %, Available %, Floor Energy Share) — e.g. Rangsit `G32` held `0.2616403480095833` formatted `#,##0.00` (displays `0.26`, should be `26.16%`). All underlying values verified to be true 0–1 fractions before applying `0.00%` (no `20.53` → `2053%` risk). |
| 8. Existing Dashboard-FAC structure appeared repairable | CONFIRMED | See Decision below. |

**Category verdict:** B (stale calculation/cache) and a related save-path gap, **not** A (broken formula/reference), not D (month matching — H1 mechanics verified sound for both facilities), not E (no cross-facility mapping error found; existing isolation tests cover this and passed).

## Decision: REPAIRED, not redesigned

Formulas, Excel Tables, named ranges, pivot tables, charts, and VBA in both
workbooks were verified structurally sound. Rangsit (`A1:K34`) and Srinakarin
(`A1:L42`) have deliberately different layouts (different row offsets for the
same logical KPIs, different section counts) — verified independently for
each, never assumed identical. The two confirmed defects (percentage format;
Srinakarin's missing recalculation safeguards) were narrow and additive, so a
full or partial redesign was not warranted.

## Application contract preserved

Traced independently (background research agent, verified against source):
Dashboard-FAC's cell layout is read by the application in exactly one place —
`src/reports/upsMappingReader.ts`, which is **header-text-driven**, not
fixed-cell — used by `DashboardSummary` and the "All Report" PDF. The
top-level Building/Floor Energy KPIs are **not** read from Dashboard-FAC at
runtime at all; they are independently recomputed in TypeScript from
`4. Electricity Cost Log` (`src/utils/energyCost.ts`) and only cross-checked
against Dashboard-FAC's cache in tests. No cell was moved, inserted, or
removed by this fix — only number-format (`s=` style attribute) and
save-metadata (`calcChain`, `calcPr`, `pivotCacheDefinition`) changed — so
no cell/range contract was at risk.

## Build and package

| Field | Value |
|---|---|
| Production build command | `npm run desktop:build` |
| Portable package command | `npm run portable` |
| ZIP command | `npm run portable:zip` |
| Portable EXE | `release/Energy Monitor-v2.2.1.exe` |
| Absolute EXE path | `D:\Project\Energy_Monitor\release\Energy Monitor-v2.2.1.exe` |
| EXE size | 82,522,109 bytes |
| EXE timestamp | 2026-07-31T17:34:03+07:00 |
| EXE SHA-256 | `074A2E2FFDB89E9653F2DB2A99E4A25E3A18A7F10D9CB70D63FA9913C12876B8` |
| Embedded product/version | `Energy Monitor` / `2.2.1` |
| Portable ZIP | `release/Energy Monitor-v2.2.1.zip` |
| ZIP size | 82,720,658 bytes |
| ZIP timestamp | 2026-07-31T17:39:44+07:00 |
| ZIP SHA-256 | `8E3262EF46BB5FBA5CA39FCAE36B1346D15BE78A2B5CB350B1A6EE6D42A3D8CD` |

`Energy Monitor-v2.2.0.exe`/`.zip` were not overwritten and remain the
certified rollback artifacts.

## Validation results

| Gate | Result | Evidence |
|---|---|---|
| Lint + TypeScript (`tsconfig.json` + `tsconfig.electron.json`) | PASS | `npm run lint` |
| Production build | PASS | `npm run build` (pre-existing >500kB chunk advisory only, no error) |
| Excel Rangsit roundtrip | PASS | `npm run test:excel` |
| Excel save formatting (1,289 checks) | PASS | `npm run test:save-formatting` |
| Energy cost / Dashboard-FAC cross-check | PASS | `npm run test:energy-cost-dashboard` |
| Air validation | PASS | `npm run test:air-validation` |
| Srinakarin read | PASS | `npm run test:srinakarin` |
| Srinakarin roundtrip (extended with calcChain/fullCalcOnLoad/pivot/percentage assertions) | PASS | `npm run test:srinakarin:roundtrip` |
| Srinakarin aggregate | PASS | `npm run test:srinakarin:aggregate` |
| RC3 regression (13 checks) | PASS | `npm run test:rc3` |
| Facility isolation (15 checks) | PASS | `npm run test:facility-isolation` |
| Site Comparison (54 checks) | PASS | `npm run test:facility-comparison` |
| Dashboard facility isolation (13 checks) | PASS | `npm run test:dashboard-facility-isolation` |
| Dashboard config-driven architecture (16 checks) | PASS | `npm run test:dashboard-config-driven` |
| Dashboard workbook-mapping exactness (20 checks) | PASS | `npm run test:dashboard-workbook-mapping` |
| UPS Group History (26 checks) | PASS | `npm run test:ups-group-history` |
| UPS Group History migration (11 checks) | PASS | `npm run test:ups-group-history-migration` |
| Production stress/fault (20 checks) | PASS | `npm run test:production-stress-fault` |
| Batch-save merge (8 checks) | PASS | `npm run test:batch-save-merge` |
| All-report data | PASS | `npm run test:all-report` |
| Development Electron E2E (27 checks) | PASS | `npm run test:e2e`; confirmed source workbooks left unchanged |
| Packaged portable runtime | PASS | `npm run test:packaged-report` (see below) |

All checks above were run **after** the production workbook repair (see
Source workbook integrity), against the actual `DC_Rangsit.xlsm` /
`DC_Srinakarin.xlsm` in the repository root.

## Packaged runtime verification

`npm run test:packaged-report` launched a copy of `Energy Monitor-v2.2.1.exe`
in an isolated temp root with copies of both repaired production workbooks,
via CDP.

Verified:

- Startup, renderer initialization, config load, normal shutdown.
- Both `DC_Rangsit.xlsm` (67 months) and `DC_Srinakarin.xlsm` (66 months)
  opened successfully, independently, with no cross-facility leakage.
- Facility switching (Rangsit ↔ Srinakarin) via `active facility -> rangsit`
  log event.
- Current-page PDF export succeeded (`Rangsit_2026-06_Report.pdf`).
- "All Report" PDF export succeeded (11 pages, 116,788 bytes).
- No startup crash, renderer crash, or `did-fail-load` entries in the runtime
  log.
- Source production workbooks were copied into the test's isolated temp
  root before use; the real `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` in the
  repository root were not touched by this test (separately confirmed by the
  E2E test's "source workbooks unchanged" check and by re-hashing after all
  test runs — see Source workbook integrity).

Microsoft Excel was not available in this environment. Per the project's own
`test:production-stress-fault` precedent, native-Excel opening/recalculating
was not fabricated; OOXML-level and application-level evidence (above) stands
in its place, and an operator may optionally open a copy of either workbook
in real Excel to visually confirm Dashboard-FAC.

## Source workbook integrity

| Workbook | Baseline SHA-256 (v2.2.0) | Pre-repair backup SHA-256 | Final SHA-256 | Change |
|---|---|---|---|---|
| `DC_Rangsit.xlsm` | `E27AF603725BC0493265A22BC3D66F49084C44E0C43AA622276965E0AEBD6DD4` | `E27AF603725BC0493265A22BC3D66F49084C44E0C43AA622276965E0AEBD6DD4` (identical — verified before repair) | `592C60661B0A7346154A0BD249671BBD527C6FF6C2E1807CC44A0CDEAF77EF76` | **Intentional** — number format + recalculation metadata only; 67 months of log data verified byte-for-byte identical, VBA/pivots/charts/tables preserved (full regression suite). |
| `DC_Srinakarin.xlsm` | `94379D42BE4D597130CB73FD4CFA19451804DF779F32DAC449CD35519D51307C` | `94379D42BE4D597130CB73FD4CFA19451804DF779F32DAC449CD35519D51307C` (identical — verified before repair) | `508448BB8F3CB08D2CFF7085864F784C8864D07C053FB2223E39AA764C29F13A` | **Intentional** — same as above, plus calcChain removal and pivot refresh-on-load now applied (previously never applied by this writer). 66 months of log data verified unchanged. |

Reason for change (both): re-saved through the app's real, now-fixed
`saveWorkbook` path with **no log data changes** — this was a pass-through
save whose only effect is the Dashboard-FAC percentage-format fix and the
Srinakarin recalculation-metadata fix. Pre-repair backups are retained at
`backup/2026-07-31_pre-v2.2.1-repair/` (distinct from, and in addition to,
the untouched `backup/2026-07-31_v2.2.0/` baseline backup).

Hash changing here is **expected and correct**, per the task's own guidance —
it was not treated as a reason to restore the workbook.

## Review gates

| Gate | Result | Evidence |
|---|---|---|
| QA/Test Engineer | PASS | Full regression matrix above (18 automated suites, 0 failures) run against the actual repaired production workbooks. |
| Data Integrity Auditor | PASS | Log data (all months, both facilities) verified byte-identical pre/post repair via structural comparison, not just hash equality; percentage values verified to be true 0–1 fractions before format change (no scale-error risk). |
| Architecture Reviewer | PASS | Traced Dashboard-FAC's only live application read path (`upsMappingReader.ts`, header-driven) and confirmed the top-level KPIs are independently recomputed, not read from Dashboard-FAC's cache — no cell/range contract at risk from this fix. |
| UI/UX Reviewer | PASS | Column widths (16–26 chars) confirmed to have ample headroom for `0.00%` display (no clipping risk); existing section structure, headers, and spacing found already clean — no redesign performed, consistent with "correctness over redesign." |
| Release Manager | PASS | Version bumped consistently (single source: `package.json`, templated into `electron-builder.yml` and Electron's own `app.getVersion()`); v2.2.0 artifacts preserved untouched; backups verified before and after. |

Named sub-agent spawning was available and used for the application-contract
trace (background research agent); all other review gates were completed
directly against source, automated test evidence, and packaged runtime
results.

## Release status

**PASS — PRODUCTION RELEASE CERTIFIED**
