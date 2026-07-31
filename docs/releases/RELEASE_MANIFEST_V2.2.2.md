# Energy Monitor v2.2.2 Release Manifest

## Release identity

| Field | Value |
|---|---|
| Product | Energy Monitor |
| Version | 2.2.2 |
| Release date | 2026-07-31 |
| Version change | 2.2.1 → 2.2.2 |
| SemVer decision | MINOR — new Rack Capacity Management feature (search/edit/save, K9 image, monthly history, PDF additions); backward-compatible, no existing cell/range contract changed. |
| Git branch | `main` |
| Parent commit | `d904326` ("release: Energy Monitor v2.2.1") |
| Source state | Reviewed working tree; no unrelated changes present. |

## Feature summary

New "Rack Capacity Management" feature, built against the real, independently
verified `Rack Capacity`/`Table7` schema in both production workbooks:

| Aspect | Rangsit (`DC_Rangsit.xlsm`) | Srinakarin (`DC_Srinakarin.xlsm`) |
|---|---|---|
| Table7 range | `A9:G367` (358 racks) | `A9:G246` (237 racks) |
| Rack Zones present | A, B, C, D | A, B, C (D exists only as a stale, unused pivot-cache filter item) |
| Status breakdown | In Use 294, Reserved 32, Pending Dismantle 24, Available 8 | In Use 218, Reserved 13, Pending Dismantle 3, Available 3 |
| K9 (image slot) before this release | Empty, unmerged, no existing drawing on the sheet | Empty, unmerged, no existing drawing on the sheet |
| Zone × Status pivot table | Present, cache fresh (refreshed same day as this investigation) | Present, cache found **16 days stale** vs. live table data — fixed by this release's refreshOnLoad flag |
| "Rack Capacity History" sheet before this release | Did not exist | Did not exist |

Both workbooks' Table7 column order is identical (Rack Zone, Rack ID, Status,
Cabinet Size, Detail, Device Type, Remarks); Srinakarin's Cabinet Size header
contains an embedded OOXML control-character escape (`_x000A_`) that
Rangsit's does not — handled correctly (verified by test).

## What changed (source)

| File | Change |
|---|---|
| `src/utils/rackCapacity.ts` | New: single authoritative `calculateRackCapacityMetrics()` + `formatRatioPercent()`. Ratios always 0–1 fractions. |
| `src/utils/imageValidation.ts` | New: PNG/JPEG validation by magic bytes + real dimension parsing (PNG IHDR, JPEG SOF markers). |
| `src/excel/RackCapacityWriter.ts` | New: safe Table7 Status writer (optimistic concurrency, shared-string reuse), K9 image embed/replace (OOXML drawing/media/rels/content-types), pivot-cache refresh fix, full save orchestration (lock/backup/atomic write). |
| `src/excel/RackCapacityHistoryWriter.ts` | New: "Rack Capacity History" sheet creation + upsert (Facility+SnapshotMonth+RackZone key), modeled on the existing `UpsGroupHistoryWriter.ts` zip-surgery pattern. |
| `src/components/RackCapacityEditor.tsx` | New: search/filter + staged Status editing + image upload (file/drag-drop/paste) UI. |
| `src/components/RackCapacityHistoryPanel.tsx` | New: Reference Month + 3/6/12M + trend chart UI. |
| `src/components/RackCapacitySummaryCard.tsx` | Enhanced: count+% cards, donut chart, zone-correct percentage pivot table. Moved out of `DashboardSummary.tsx` into its own tab. |
| `src/reports/reportDataBuilder.ts`, `src/reports/pdf/reportHtml.ts`, `src/reports/reportTypes.ts` | Rack Capacity Overview/trend + Site Comparison pages added to Export All Report (inline SVG, no `<img>`). |
| `src/electron/ipc/excel.ts`, `preload.ts`, `desktop.d.ts`, `src/data/IDataProvider.ts`, `ExcelProvider.ts` | New `excel:saveRackCapacity` IPC channel + strict server-side validation (canonical statuses only, real image content re-validated, never trusting the renderer alone) + provider wiring. |
| `src/electron/ipc/exportCenter.ts` | Resolves the sibling facility (best-effort) for the Site Comparison PDF page. |
| `src/App.tsx` | Nav: numeric prefixes removed, Rack Capacity tab added after Data Entry. |

## Build and package

| Field | Value |
|---|---|
| Production build command | `npm run desktop:build` |
| Portable package command | `npm run portable` |
| ZIP command | `npm run portable:zip` |
| Portable EXE | `release/Energy Monitor-v2.2.2.exe` |
| Absolute EXE path | `D:\Project\Energy_Monitor\release\Energy Monitor-v2.2.2.exe` |
| EXE size | 82,559,952 bytes |
| EXE timestamp | 2026-07-31T19:27:32+07:00 |
| EXE SHA-256 | `4A9AEAEBFB789962A563D517DB422B954D03E044F2EF698CFF0AD3B421054C50` |
| Embedded product/version | `Energy Monitor` / `2.2.2` |
| Portable ZIP | `release/Energy Monitor-v2.2.2.zip` |
| ZIP size | 82,758,332 bytes |
| ZIP timestamp | 2026-07-31T19:27:56+07:00 |
| ZIP SHA-256 | `343D4B9CEF151D3EC6BD2CD890F0D590F90AD349E7BFC3404F06C7E33259ED78` |

`Energy Monitor-v2.2.0.exe` (SHA-256 `8229206063306D7EC244F7A700898D378BF64F7A3DDFB9EB10439450AC6BDCD0`) and
`Energy Monitor-v2.2.1.exe` (SHA-256 `074A2E2FFDB89E9653F2DB2A99E4A25E3A18A7F10D9CB70D63FA9913C12876B8`)
were verified byte-identical to their previously certified hashes and were
not modified or overwritten by this release.

## Validation results

| Gate | Result | Evidence |
|---|---|---|
| Lint + TypeScript | PASS | `npm run lint` |
| Production build | PASS | `npm run build` (pre-existing >500kB chunk advisory only) |
| Rack Capacity metrics (domain model) | PASS | `npm run test:rack-capacity-metrics` — ratio correctness, zone vs. facility denominators, zero-denominator handling |
| Rack Capacity write (Table7 Status) | PASS | `npm run test:rack-capacity-write` — both facilities: happy path, conflict detection (stale status, Rack ID mismatch, out-of-range row), no-op, batch, byte-preservation of VBA/pivot/table/chart/drawing parts |
| Rack Capacity image validation | PASS | `npm run test:rack-capacity-image` — real PNG/JPEG accepted, corrupt/oversized/non-image rejected |
| Rack Capacity image embed (K9 OOXML) | PASS | `npm run test:rack-capacity-image-embed` — both facilities: create, replace (aspect ratio, old media removed), downscale, ExcelJS re-open, byte-preservation |
| Rack Capacity History | PASS | `npm run test:rack-capacity-history` — both facilities: sheet creation, idempotent no-op, in-place update, month append, no fake backfill, end-to-end Save → snapshot |
| Excel Rangsit roundtrip | PASS | `npm run test:excel` |
| Excel save formatting (1,289 checks) | PASS | `npm run test:save-formatting` |
| Energy cost / Dashboard-FAC cross-check | PASS | `npm run test:energy-cost-dashboard` |
| Air validation | PASS | `npm run test:air-validation` |
| Srinakarin read/roundtrip/aggregate | PASS | `test:srinakarin`, `test:srinakarin:roundtrip`, `test:srinakarin:aggregate` |
| RC3 regression (13 checks) | PASS | `npm run test:rc3` |
| Facility isolation (15 checks) | PASS | `npm run test:facility-isolation` |
| Site Comparison (54 checks) | PASS | `npm run test:facility-comparison` |
| Dashboard facility isolation / config-driven / workbook-mapping | PASS | 13 + 16 + 20 checks |
| UPS Group History + migration | PASS | 26 + 11 checks |
| Production stress/fault (20 checks) | PASS | `npm run test:production-stress-fault` |
| Batch-save merge (8 checks) | PASS | `npm run test:batch-save-merge` |
| All-report data (updated for intentional Rack Capacity + Site Comparison inclusion) | PASS | `npm run test:all-report`, both facilities |
| All-report PDF render (real Electron print-to-PDF) | PASS | `npm run test:all-report:pdf` — 14 pages, valid PDF header |
| Development Electron E2E (31 checks, incl. new Rack Capacity nav/search/cards/Save-disabled checks) | PASS | `npm run test:e2e`; confirmed source workbooks left unchanged |
| Packaged portable runtime (incl. Rack Capacity facility isolation) | PASS | `npm run test:packaged-report` (see below) |

## Packaged runtime verification

`npm run test:packaged-report` launched a copy of `Energy Monitor-v2.2.2.exe`
in an isolated temp root with copies of both production workbooks, via CDP.

Verified:

- Startup, portable identity (version/portable flag/appRoot), renderer init,
  normal shutdown.
- Facility registry isolation (Rangsit/Srinakarin map to distinct workbooks).
- **Rack Capacity tab, both facilities, in the packaged build**: Rangsit
  shows its real total (358) and In Use count (294); after switching to
  Srinakarin, its own real total (237) and In Use count (218) render, and
  Rangsit's numbers are confirmed absent — no facility-isolation leak.
- Site Comparison (Thai and English), reference month, 3/6/12-month controls,
  full-value tooltips.
- Current-page PDF export and Export All Report PDF (14 pages) both succeed.
- Language toggle round-trips and persists to `config.json`.
- No startup crash, renderer crash, or `did-fail-load` entries in the runtime
  log.
- Source production workbooks were copied into the test's isolated temp root
  before use; the real `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` were not
  touched (confirmed by re-hashing — see Source workbook integrity).

Microsoft Excel was not available in this environment; native Excel opening
of the K9 image/pivot refresh was not fabricated. OOXML-level (ExcelJS
re-open, structural verification) and application-level evidence stands in
its place, consistent with this project's established precedent for this
limitation.

## Source workbook integrity

Rack Capacity Management required no changes to the production workbooks
themselves — the Rack Capacity History sheet and any K9 image are created
only the first time a real user performs a save/upload through the app.

| Workbook | SHA-256 before this release's work | SHA-256 after | Result |
|---|---|---|---|
| `DC_Rangsit.xlsm` | `592C60661B0A7346154A0BD249671BBD527C6FF6C2E1807CC44A0CDEAF77EF76` | `592C60661B0A7346154A0BD249671BBD527C6FF6C2E1807CC44A0CDEAF77EF76` | PASS — identical |
| `DC_Srinakarin.xlsm` | `508448BB8F3CB08D2CFF7085864F784C8864D07C053FB2223E39AA764C29F13A` | `508448BB8F3CB08D2CFF7085864F784C8864D07C053FB2223E39AA764C29F13A` | PASS — identical |

(These are the v2.2.1-certified hashes; both were re-verified unchanged
throughout this release's development and testing, including every
automated test that reads them — all Rack Capacity write/image/history tests
operate exclusively on copies under `dist-electron/test-work/`.)

## Review gates

| Gate | Result | Evidence |
|---|---|---|
| QA/Test Engineer | PASS | 18 targeted Rack Capacity test files/suites + full pre-existing regression matrix (0 regressions), dev E2E, packaged runtime — all against real production workbook data. |
| Data Integrity Auditor | PASS | Real schema verified independently per facility (never assumed identical); ratios verified as true 0–1 fractions with correct zone-vs-facility denominators; no fake U-capacity; no fake history backfill; missing months render as gaps, never zero. |
| Architecture Reviewer | PASS | New writer modules follow the established zip-surgery pattern (`UpsGroupHistoryWriter.ts` precedent) rather than ExcelJS round-trip, preserving VBA/pivots/charts/tables byte-for-byte; IPC trust boundary re-validates status values and image content server-side, never trusting the renderer. |
| UI/UX Reviewer | PASS | Matches existing dark-card visual language; donut/cards/zone table consistent with existing `RackCapacitySummaryCard` styling; operational priority (fast lookup + fast status update) verified via E2E interaction tests. |
| Release Manager | PASS | Version bumped consistently; v2.2.0/v2.2.1 artifacts verified byte-identical/untouched; stale test expectations (nav numeric-prefix selectors, "Rack content must not leak" assertion) identified and corrected rather than bypassed. |

## Known limitations

- Vite renderer chunk advisory above 500 kB remains (carried over from prior
  releases; no functional/runtime failure found).
- Native Microsoft Excel unavailable; K9 image embed and History sheet
  verified via OOXML inspection + ExcelJS re-open + full test suite, not a
  live Excel session. An operator may optionally verify visually in Excel.
- `upsMappingReader.ts`'s cached-value dependency (documented in v2.2.1's
  `KNOWN_TECHNICAL_DEBT.md` item 4) is unrelated to and unchanged by this
  release.

## Release status

**PASS — PRODUCTION RELEASE CERTIFIED**
