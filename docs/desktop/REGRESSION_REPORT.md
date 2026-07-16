# Regression Report — Desktop Migration

Method: automated evidence where possible (unit-level round-trip suite +
CDP-driven UI walkthrough against a copy of the production workbook), manual
verification items listed at the end. "Preserved" = same component/logic as
the browser app, now fed by the workbook provider.

## Automated evidence

**Excel engine — `npm run test:excel` (35 assertions, real workbook copy): PASS**

- Read: structure validation, 66 months parsed (2020-12 → 2026-05), UPS/energy values present
- Write: save succeeds, backup created, month count +1 after adding a month
- Round-trip: edited UPS voltage, new-month air/DC/energy values, sidecar timestamp — all identical after re-read; historical values untouched
- Preservation: `vbaProject.bin` **byte-identical**, charts/pivot table/pivot cache/drawings present, `calcChain` dropped cleanly (no dangling parts), `fullCalcOnLoad` + pivot `refreshOnLoad` set, calculated-rate formulas kept, unmanaged "4th Floor Cost" column carried, `Overall_Energy` table range extended
- Safety: Excel owner-file lock detected; second save idempotent; backup rotation works

**UI — `npm run test:e2e` (CDP walkthrough of built app): PASS (13/13)**

- App auto-opens configured workbook; 4-tab desktop navigation
- Dashboard view renders with data (no "unable to load" fallback)
- Entry view: WorkbookBar (file name), UPS table, Google-Sheets board correctly absent when disabled
- History view renders
- Settings & Integrity: Integrity Center, auto-save control, backups section, portable-folders note
- Language switch via Settings updates the UI **and** persists to `config/config.json`

**Portable execution (staged folder): PASS** — `portable=true` detected,
`config/ backup/ logs/ exports/` created beside the exe, bundled workbook
auto-opened on first run (66 months), config written beside the exe.

## Feature-by-feature status

| Feature | Status | Evidence |
|---|---|---|
| Executive Dashboard / Smart Insight | Preserved | component untouched; E2E dashboard check |
| Dashboard Summary | Preserved | untouched; E2E |
| Benchmark / Forecast dashboards | Preserved | untouched; fed by same `syncedLogs` prop |
| Historical Explorer + Trend charts | Preserved | untouched; E2E history check |
| Year filter / rolling trend / compare modes | Preserved | `ReportContext` untouched |
| Data entry (UPS / Air / DC / Energy) | Preserved + now writes to .xlsm | round-trip suite; E2E entry check |
| Historical edit confirmation popup | Preserved | logic untouched |
| Add new month | Preserved | logic untouched; persists on save |
| Data Integrity verification | Preserved + ported to Excel | Integrity Center; report parity with sheetsService (duplicates/missing months/devices/invalid IDs/blank rows) |
| Transactional Google Sheets sync | Preserved (optional) | `sheetsService.ts` untouched; board toggleable in Settings; browser build unchanged |
| PIN lock | Preserved | storage moved to config.json on desktop |
| TH/EN language | Preserved + persisted | E2E round-trip check |
| Workbook Open/Save/Save As/Recent/Drag-drop/Open With | New | M2/M3/M5 tests |
| Auto backup + restore | New | round-trip suite + Settings UI |
| Auto-save + crash recovery | New | code-reviewed; journal file verified in failure path |

## Intentional behavior changes

1. **Reports read the workbook, not Google Sheets** (desktop). The browser
   build (`npm run dev`) behaves exactly as before.
2. **DataManagement panel** (JSON export/import into browser memory, sample
   data, wipe) is hidden on desktop — superseded by the workbook + backups
   + Integrity Center. Still present in the browser build.
3. **Fonts** are system fonts (offline requirement) — Inter/Space
   Grotesk/JetBrains Mono → Segoe UI Variable / Leelawadee UI / Cascadia
   Mono. Slight visual difference, no layout changes.
4. **Report export buttons** show a toast instead of a browser `alert()`
   (the underlying export was and is presentational only).

## Manual verification checklist (recommended before first production use)

- [ ] Open the saved workbook in **Excel**: no repair prompt; Dashboard-FAC
      charts/pivot show newly added months after auto-recalc; macros run.
      *(Automated Excel COM verification was blocked in the build
      environment; all structural checks pass programmatically.)*
- [ ] Enter one real month end-to-end and cross-check the four sheets.
- [ ] Save while the workbook is open in Excel → Retry flow.
- [ ] Restore a backup from Settings.
- [ ] Run from a USB stick / network-less machine (offline check).
