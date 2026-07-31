# Energy Monitor v2.2.3 Release Manifest

## Release identity

| Field | Value |
|---|---|
| Product | Energy Monitor |
| Version | 2.2.3 |
| Release date | 2026-07-31 |
| Version change | 2.2.2 → 2.2.3 |
| SemVer decision | MINOR — new Rack Unit Capacity worksheet/section, multi-field rack editing, explicit Month/Year History-snapshot selection, K9 image relocation; backward-compatible, no existing cell/range contract broken (Rack Capacity History gains an automatic, idempotent format migration). |
| Git branch | `main` |
| Parent commit | `40a0dec` ("release: Energy Monitor v2.2.2") |
| Release commit | `a06691f` ("release: Energy Monitor v2.2.3") |
| Release tag | `v2.2.3` |
| Source state | Reviewed working tree; no unrelated changes present. |

## Feature summary

Extends v2.2.2's Rack Capacity Management with:

| Aspect | Before (v2.2.2) | After (v2.2.3) |
|---|---|---|
| Editable Table7 fields | Status only | Status, Cabinet Size, Detail, Device Type (any combination in one staged change; all-or-nothing conflict semantics) |
| Page heading / nav tab | "Rack Capacity Overview" / "Rack Capacity" | "Rack Capacity and Utilization" (EN+TH); internal route key unchanged |
| Page order | Editor, Overview, History | Overview, Rack Unit Capacity, Editor, History |
| History snapshot month | Auto-detected from `Dashboard-FAC!H1` only | Explicit, shared Month/Year selector (UI-controlled); auto-detect remains the fallback when omitted |
| U-capacity (rack-unit space) | Not available in either workbook | New "Rack Unit Capacity" sheet: Month, Total (U), Used (U), Available (U) [derived], Availability Capacity (%) [derived] |
| K9 image location/label | `Rack Capacity` sheet, "Rack Capacity Image (K9)" | `Rack Unit Capacity` sheet, "Rack Unit Capacity Image"; existing images migrated automatically, idempotently, on next save |
| Rack Capacity History Month/percent formatting | `SnapshotMonth` text; `*Pct` columns unstyled | `SnapshotMonth` real Excel date (`mmm-yy`); all five `*Pct` columns styled `0.00%` (values still 0–1 fractions); existing rows migrate automatically |
| PDF section | "Rack Capacity Overview" | "Rack Capacity and Utilization" + new Rack Unit Capacity block/image/trend page |

## What changed (source)

| File | Change |
|---|---|
| `src/excel/ExcelZipUtils.ts` | New: browser-safe OOXML primitives (`WorkbookError`, `getAttr`, `entryText`, `ensureExactCellFormatStyles`, `workbookMonthSerial`, `workbookUsesDate1904`, `resolveRelationshipTarget`) extracted from `WorkbookWriter.ts` so Rack Capacity/Rack Unit Capacity modules never pull `fs`/`path`/`ExcelJS` into the renderer bundle. Fixes a real bug: the style-reuse lookup now scopes to the actual `<numFmts>` registry instead of scanning the whole `styles.xml` (a `<dxf>`-scoped `<numFmt>` was colliding with a builtin numFmtId on real production data). |
| `src/excel/WorkbookWriter.ts` | Re-exports the above (unchanged call sites); no behavior change. |
| `src/excel/RackCapacityHistoryWriter.ts` | Month now a real Excel date (`mmm-yy`); all `*Pct` columns styled `0.00%`; new `migrateRackCapacityHistoryFormats()` idempotent migration entry point. |
| `src/excel/RackCapacityWriter.ts` | `applyRackCapacityFieldChanges` (renamed from `applyRackCapacityStatusChanges`): multi-field staged edits, all-or-nothing per-row conflict check. New `migrateRackCapacityImageToUnitCapacity()` (one-time K9 image relocation, idempotent). `saveRackCapacityFieldChanges` gains an explicit optional `snapshotMonth` param. |
| `src/excel/SheetImageWriter.ts` | New: the generic K9-image-embed logic, extracted so both `RackCapacityWriter.ts` and `RackUnitCapacityWriter.ts` can use it without a circular import between them. |
| `src/excel/RackUnitCapacityWriter.ts` | New: browser-safe "Rack Unit Capacity" sheet/table creation, upsert-by-month, and read functions (including the embedded image reader used by the PDF builder). |
| `src/excel/RackUnitCapacitySaveWriter.ts` | New: Node-only save orchestration (lock/backup/atomic write) for Rack Unit Capacity, kept separate from the browser-safe reader/writer module. |
| `src/components/RackUnitCapacityPanel.tsx` | New: Month/Year selector, Total (U)/Used (U) inputs, live Available (U)/Availability % preview, "Rack Unit Capacity Image" upload (moved from the Editor). |
| `src/components/RackCapacityEditor.tsx` | Multi-field editable cells (Cabinet Size/Detail/Device Type); image upload removed (moved to the new panel); shared Month/Year selector added, passed as `snapshotMonth` on save. |
| `src/components/RackCapacitySummaryCard.tsx` | Heading/subtitle renamed; no `Table7` exposure in any UI string, including the empty-state fallback. |
| `src/App.tsx` | Page order: Overview → Rack Unit Capacity → Editor → History. Nav tab label renamed (route key unchanged). Shared `rackCapacityMonth` state. |
| `src/reports/reportDataBuilder.ts`, `reportTypes.ts`, `src/reports/pdf/reportHtml.ts` | New `rackUnitCapacity`/`rackUnitCapacityImageDataUri` report fields; PDF section renamed; new Rack Unit Capacity block (KPIs + embedded image) and Availability % trend page. |
| `src/electron/ipc/excel.ts`, `preload.ts`, `desktop.d.ts`, `src/data/IDataProvider.ts`, `ExcelProvider.ts` | New `excel:saveRackUnitCapacity` IPC channel + server-side validation (real "YYYY-MM", non-negative Total/Used); `excel:saveRackCapacity` gains a validated optional `snapshotMonth`; `OpenWorkbookPayload`/`DataSnapshot` carry persisted `rackUnitCapacity` rows. |

## Build and package

| Field | Value |
|---|---|
| Production build command | `npm run desktop:build` |
| Portable package command | `npm run portable` |
| ZIP command | `npm run portable:zip` |
| Portable EXE | `release/Energy Monitor-v2.2.3.exe` |
| Absolute EXE path | `D:\Project\Energy_Monitor\release\Energy Monitor-v2.2.3.exe` |
| EXE size | 82,564,269 bytes |
| EXE timestamp | 2026-07-31T22:52:57+07:00 |
| EXE SHA-256 | `ABDFD87696135E145FE2B6C9967BCB441BA5140AC542DCD90C34A4CDAE41713A` |
| Embedded product/version | `Energy Monitor` / `2.2.3` |
| Portable ZIP | `release/Energy Monitor-v2.2.3.zip` |
| ZIP size | 82,764,073 bytes |
| ZIP timestamp | 2026-07-31T22:06:23+07:00 |
| ZIP SHA-256 | `91ED705E68449155347431D6A9022226C41E5FB454271B634CE4FE7DF41CABEC` |

`Energy Monitor-v2.2.0.exe` (SHA-256 `8229206063306D7EC244F7A700898D378BF64F7A3DDFB9EB10439450AC6BDCD0`),
`Energy Monitor-v2.2.1.exe` (SHA-256 `074A2E2FFDB89E9653F2DB2A99E4A25E3A18A7F10D9CB70D63FA9913C12876B8`), and
`Energy Monitor-v2.2.2.exe` (SHA-256 `4A9AEAEBFB789962A563D517DB422B954D03E044F2EF698CFF0AD3B421054C50`)
were re-verified byte-identical to their previously certified hashes and were
not modified or overwritten by this release.

## Validation results

| Gate | Result | Evidence |
|---|---|---|
| Lint + TypeScript (renderer + electron/excel configs) | PASS | `tsc --noEmit` on both `tsconfig.json` and `tsconfig.electron.json` |
| Production build | PASS | `npm run build` (pre-existing >500kB chunk advisory only; 2728 modules, no `fs`/`path` browser-externalization warnings) |
| Rack Capacity metrics (domain model) | PASS | `npm run test:rack-capacity-metrics` |
| Rack Capacity write (multi-field, all-or-nothing conflicts) | PASS | `npm run test:rack-capacity-write` — both facilities: single-field + multi-field (all 4 fields in one change), partial-conflict all-or-nothing rejection, byte-preservation |
| Rack Capacity image validation | PASS | `npm run test:rack-capacity-image` |
| Rack Capacity image embed (K9 OOXML, now targeting Rack Unit Capacity) | PASS | `npm run test:rack-capacity-image-embed` |
| Rack Capacity image migration (old sheet → new sheet) | PASS | `node scripts/test-rack-capacity-image-migration.ts` (new) — both facilities: no-op with nothing to migrate, exact byte/aspect-ratio preservation, old parts fully removed only after new embed succeeds, idempotent second run, fresh uploads land on the new sheet |
| Rack Capacity History (real Excel date + `0.00%` styles + migration) | PASS | `npm run test:rack-capacity-history` — both facilities, plus explicit `snapshotMonth` override proven to take effect (not silently fall back), legacy text-Month migration with Dec/Jan timezone-boundary safety |
| Rack Unit Capacity (new) | PASS | `node scripts/test-rack-unit-capacity.ts` (new, 60 checks per facility) — sheet/table creation (idempotent), correct column spelling, real date + `0.00%`/`mmm-yy` styles, Available/Availability derivation, upsert-by-month, table `ref`/`autoFilter` extension, full save pipeline (lock/backup/atomic-write, real file), combined Total/Used+image save, image read-back, PDF rendering (both "not yet available" and "data present" paths) |
| Excel Rangsit roundtrip | PASS | `npm run test:excel` |
| Excel save formatting (1,289 checks) | PASS | `npm run test:save-formatting` |
| Energy cost / Dashboard-FAC cross-check | PASS | `npm run test:energy-cost-dashboard` |
| Air validation | PASS | `npm run test:air-validation` |
| Srinakarin read/roundtrip/aggregate | PASS | `test:srinakarin`, `test:srinakarin:roundtrip`, `test:srinakarin:aggregate` |
| RC3 regression | PASS | `npm run test:rc3` |
| Facility isolation | PASS | `npm run test:facility-isolation` |
| Site Comparison | PASS | `npm run test:facility-comparison` |
| Dashboard facility isolation / config-driven / workbook-mapping | PASS | `test:dashboard-facility-isolation`, `test:dashboard-config-driven`, `test:dashboard-workbook-mapping` |
| UPS Group History + migration | PASS | `test:ups-group-history`, `test:ups-group-history-migration` |
| Batch-save merge | PASS | `npm run test:batch-save-merge` |
| All-report data (renamed heading, no `Table7` leak, Rack Unit Capacity "not yet available" + trend page) | PASS | `npm run test:all-report`, both facilities |
| All-report PDF render (real Electron print-to-PDF) | PASS | `npm run test:all-report:pdf` — 15 pages, valid PDF |
| Development Electron E2E (incl. new Rack Unit Capacity save round-trip, section DOM order, shared Month/Year selector) | PASS | `npm run test:e2e` — 48 checks, 0 failures, confirmed source workbooks left unchanged |
| Packaged portable runtime | PASS | `npm run test:packaged-report` against `Energy Monitor-v2.2.3.exe` (see below) |

## Packaged runtime verification

`npm run test:packaged-report` launched a copy of `Energy Monitor-v2.2.3.exe`
in an isolated temp root with copies of both production workbooks, via CDP.

Verified:

- Startup, renderer init, normal shutdown.
- Workbook open for both facilities (Rangsit 67 months, Srinakarin 66
  months).
- Language config persistence.
- Facility switch (Rangsit → Srinakarin) with no cross-contamination.
- Current-page PDF export and Export All Report PDF (15 pages) both succeed.
- No startup crash, renderer crash, or `did-fail-load` entries in the
  runtime log.
- Source production workbooks were copied into the test's isolated temp root
  before use; the real `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` were not
  touched (confirmed by re-hashing — see Source workbook integrity).

Microsoft Excel was not available in this environment; native Excel opening
of the Rack Unit Capacity sheet/image was not fabricated. OOXML-level
(ExcelJS re-open, structural verification) and application-level evidence
stands in its place, consistent with this project's established precedent
for this limitation.

## Source workbook integrity

No production workbook change was required for this release — the Rack Unit
Capacity sheet, the relocated image, and the History format migration are
all created/applied only the first time a real user performs a save through
the app.

| Workbook | SHA-256 before this release's work | SHA-256 after | Result |
|---|---|---|---|
| `DC_Rangsit.xlsm` | `592C60661B0A7346154A0BD249671BBD527C6FF6C2E1807CC44A0CDEAF77EF76` | `592C60661B0A7346154A0BD249671BBD527C6FF6C2E1807CC44A0CDEAF77EF76` | PASS — identical |
| `DC_Srinakarin.xlsm` | `508448BB8F3CB08D2CFF7085864F784C8864D07C053FB2223E39AA764C29F13A` | `508448BB8F3CB08D2CFF7085864F784C8864D07C053FB2223E39AA764C29F13A` | PASS — identical |

(These are the v2.2.1/v2.2.2-certified hashes; re-verified unchanged
throughout this release's development and testing — all Rack Capacity/Rack
Unit Capacity write/image/history tests operate exclusively on copies under
`dist-electron/test-work/` or an isolated temp root.)

## Review gates

| Gate | Result | Evidence |
|---|---|---|
| QA/Test Engineer | PASS | 2 new test files (Rack Unit Capacity: 60 checks/facility; image migration: 16 checks/facility) + updates to 3 existing suites, full pre-existing regression matrix (0 regressions), dev E2E (extended with 12 new Rack Unit Capacity checks), packaged runtime — all against real production workbook data. |
| Data Integrity Auditor | PASS | U-capacity confirmed absent from both workbooks before this release (direct OOXML inspection) and never inferred from rack count; Available (U)/Availability Capacity (%) derived by exactly one authoritative calculation; History percentages remain true 0–1 fractions with real `0.00%` styling (a real pre-existing styling bug on production data was found and fixed, not merely worked around). |
| Architecture Reviewer | PASS | Browser-bundle-safety regression (accidentally pulling `fs`/`path` into the renderer) caught and fixed via a clean module split (`ExcelZipUtils.ts`, `SheetImageWriter.ts`, `RackUnitCapacitySaveWriter.ts`), consistent with the codebase's established "browser-safe reader/writer vs. Node-only save orchestration" pattern; new writer logic follows the existing zip-surgery precedent, never ExcelJS round-trip. |
| UI/UX Reviewer | PASS | Page restructuring matches the specified order (Overview → Rack Unit Capacity → Editor → History); shared Month/Year selector avoids two disagreeing controls; no internal workbook terminology (`Table7`) leaks into any UI string, verified by an explicit E2E/PDF-test assertion. |
| Release Manager | PASS | Version bumped consistently; v2.2.0/v2.2.1/v2.2.2 artifacts re-verified byte-identical/untouched; stale test expectations (old heading text, blanket `<img>` prohibition) identified and corrected rather than bypassed. |

## Known limitations

- Vite renderer chunk advisory above 500 kB remains (carried over from prior
  releases; no functional/runtime failure found).
- Native Microsoft Excel unavailable; Rack Unit Capacity sheet/table, the
  relocated K9 image, and the History format migration verified via OOXML
  inspection + ExcelJS re-open + full test suite, not a live Excel session.
  An operator may optionally verify visually in Excel.
- `upsMappingReader.ts`'s cached-value dependency (documented in v2.2.1's
  `KNOWN_TECHNICAL_DEBT.md` item 4) is unrelated to and unchanged by this
  release.

## Release status

**PASS — PRODUCTION RELEASE CERTIFIED**
