# Migration Summary — Browser App → Portable Windows Desktop

**Scope**: replace the browser/Google-Sheets deployment with a fully offline
portable Windows application whose primary database is `RST_Dashboard.xlsm`,
preserving every existing feature (reporting framework v2.0, transactional
sync, integrity verification, forecast/benchmark/history/insight dashboards).

## Milestones (one commit each)

| # | Milestone | Commit | Validation |
|---|---|---|---|
| — | Baseline snapshot of the browser app | `7276337` | — |
| 1 | Electron bootstrap (sandboxed window, preload bridge, build scripts) | `0673ba7` | build + lint + launch smoke |
| 2 | Excel provider core (reader, VBA-safe writer, validator, versioning, config store, backups, IPC) | `c86d86a` | 35/35 round-trip assertions vs real workbook |
| 3 | Workbook integration (provider architecture, open/save pipeline, lock UX) | `af6c2d0` | build + lint + auto-open E2E |
| 4 | Local Storage replacement (portable config, offline fonts, theme) | `1f25d24` | build + lint + offline grep + smoke |
| 5 | Desktop features (Settings, Integrity Center, auto-save, recovery, restore, drag & drop) | `b1e0d0c` | 13/13 CDP UI checks |
| 6 | Portable build (`Energy Monitor.exe`, icon, ZIP layout) | `8f85375` | staged portable launch: folders + auto-open beside exe |
| 7 | Testing + documentation (this docs set, final ZIP) | *(current)* | full regression re-run |

## Files added

**Main process** — `src/electron/`: `main.ts`, `preload.ts`, `config.ts`,
`paths.ts`, `ipc/excel.ts`, `ipc/window.ts`, `sync/BackupManager.ts`

**Workbook engine** — `src/excel/`: `ExcelSchema.ts`, `SheetMapper.ts`,
`WorkbookReader.ts`, `WorkbookWriter.ts`, `WorkbookValidator.ts`,
`WorkbookVersion.ts`

**Renderer data layer** — `src/data/`: `IDataProvider.ts`,
`ExcelProvider.ts`, `GoogleSheetsProvider.ts`, `ProviderFactory.ts`; plus
`src/desktop.d.ts`

**Components** — `Toast.tsx`, `WorkbookBar.tsx`, `WelcomePanel.tsx`,
`SettingsPanel.tsx`, `IntegrityCenter.tsx`

**Build/test** — `electron-builder.yml`, `tsconfig.electron.json`,
`build/icon.ico`, `scripts/`: `build-electron.mjs`, `desktop-dev.mjs`,
`run-electron-builder.mjs`, `make-portable-zip.mjs`,
`test-excel-roundtrip.ts`, `e2e-cdp.mjs`

**Docs** — `docs/desktop/` (this set)

## Files modified

- `src/App.tsx` — desktop workbook session (open/save/lock/recovery/
  auto-save), 4th nav tab, provider-driven reports; browser code path kept
- `src/index.css` — offline system fonts, light-theme variable remap
- `package.json` — identity, `main`, scripts, dependency reshuffle (all deps
  are compile-time-bundled → devDependencies)
- `vite.config.ts` (`base: './'`), `tsconfig.json` (exclude main-process
  code), `index.html` (title), `.gitignore`

**Untouched on purpose**: every report/dashboard component,
`sheetsService.ts` (transactional sync + integrity engine),
`ReportContext.tsx`, `utils.ts`, `firebaseAuth.ts`, `types.ts`.

## Key architectural decisions

1. **Surgical zip-level writes.** The workbook contains VBA, a pivot
   table/cache, charts and Excel Tables with calculated columns. ExcelJS
   cannot round-trip those, so writes patch only the four log sheets'
   `<sheetData>` inside the OPC package; everything else is byte-identical
   (verified per save and in tests). ExcelJS remains the reader/validator.
2. **Validate-then-replace saves.** A save that does not round-trip
   identically in memory never reaches disk; the previous file is backed up
   first and replaced atomically.
3. **Provider seam.** The UI consumes `IDataProvider`; Excel and Google
   Sheets are interchangeable implementations. The browser build still runs
   the original Google Sheets pipeline unchanged.
4. **Portable state model.** `config/config.json`, `backup/`, `logs/`,
   `exports/` beside the exe (`PORTABLE_EXECUTABLE_DIR`); no AppData, no
   registry, no Local Storage for business data.
5. **Timestamps sidecar.** The RST sheets have no timestamp columns, so
   per-month "last saved" metadata lives in `<workbook>.appmeta.json` with a
   schema version + upgrade path, leaving the workbook layout untouched.
