# Developer Guide — Energy Monitor Desktop

## Prerequisites

- Node.js 20+ (developed on 24), npm
- Windows 10/11 x64 (packaging targets Windows)
- No global tools required — everything runs from `node_modules`

> **Path quirk**: the project folder name contains `&`, which breaks the
> `node_modules/.bin` cmd shims on Windows. All npm scripts therefore invoke
> tools via `node node_modules/<pkg>/<bin>.js` directly. Keep doing that for
> any new script.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (browser build, legacy Google Sheets mode) |
| `npm run desktop:dev` | Vite dev server + Electron with HMR |
| `npm run desktop` | Full production build, then run Electron locally |
| `npm run desktop:build` | Build renderer (`dist/`) + main bundle (`dist-electron/`) |
| `npm run portable` | desktop:build + electron-builder → `release/Energy Monitor.exe` |
| `npm run portable:zip` | Stage the portable folder + `release/EnergyMonitor_Portable.zip` |
| `npm run lint` | Typecheck renderer (`tsconfig.json`) + main (`tsconfig.electron.json`) |
| `npm run test:excel` | 35-assertion Excel round-trip test against a copy of the real workbook |
| `npm run test:e2e` | CDP-driven UI walkthrough of the built app (13 checks) |

## Source layout

```
src/
├─ electron/            main process (Node) - bundled to dist-electron/main.cjs
│  ├─ main.ts           window, security, single-instance, Open With
│  ├─ preload.ts        contextBridge → window.desktop
│  ├─ config.ts         config/config.json store
│  ├─ paths.ts          portable roots (PORTABLE_EXECUTABLE_DIR) + logging
│  ├─ ipc/excel.ts      workbook/backup/recovery/export handlers + validation
│  ├─ ipc/window.ts     app info, config, shell handlers
│  └─ sync/BackupManager.ts
├─ excel/               workbook engine (main-process only)
│  ├─ ExcelSchema.ts    sheet/column keyword schema + month conversions
│  ├─ SheetMapper.ts    MonthlyLog[] ⇄ sheet rows, device matching
│  ├─ WorkbookReader.ts ExcelJS read + integrity report
│  ├─ WorkbookWriter.ts JSZip surgical patch + atomic save + lock detection
│  ├─ WorkbookValidator.ts  health summary + IPC payload guard
│  └─ WorkbookVersion.ts    sidecar meta + schema upgrades
├─ data/                renderer data layer
│  ├─ IDataProvider.ts  provider seam (UI never knows the source)
│  ├─ ExcelProvider.ts / GoogleSheetsProvider.ts / ProviderFactory.ts
├─ components/          React components (reports untouched by migration)
├─ desktop.d.ts         typing for window.desktop (import type only)
├─ App.tsx              app shell + workbook session + Sheets pipeline
├─ sheetsService.ts     Google Sheets transactional sync engine (unchanged)
└─ types.ts             domain model (MonthlyLog etc.)
```

Build plumbing: `scripts/build-electron.mjs` (esbuild → CJS bundles),
`scripts/desktop-dev.mjs`, `scripts/run-electron-builder.mjs`,
`scripts/make-portable-zip.mjs`, `electron-builder.yml`.

## Rules that keep this codebase safe

1. **The renderer never touches the filesystem.** Anything new goes through
   an `ipcMain.handle` in `src/electron/ipc/` with payload validation, and is
   exposed as one named function in `preload.ts` + `desktop.d.ts`.
2. **The writer must stay surgical.** Never "simplify" `WorkbookWriter` to an
   ExcelJS full write — it would strip VBA/pivots/charts from the user's
   workbook. Any writer change must keep `npm run test:excel` green,
   including the byte-identical `vbaProject.bin` assertion.
3. **Both sides of the schema live in `ExcelSchema.ts`.** Reader and writer
   resolve sheets/columns only through it, so they can never disagree.
4. **Saves are validate-then-replace.** Patch in memory → re-read → compare →
   backup → temp+rename. Keep that order.
5. **No business data outside the workbook.** Config = `config/config.json`;
   sidecar timestamps = `*.appmeta.json`; nothing in AppData/registry.
6. **UI code talks to `IDataProvider`,** not to `window.desktop` directly
   (the provider seam is what keeps Google Sheets and future providers
   plug-compatible).

## Adding a new managed column (example)

1. Add the field to `types.ts` and the column spec (keywords, kind) to
   `SHEET_SCHEMAS` in `ExcelSchema.ts`.
2. Map it in `SheetMapper.ts` (`rowsToLogs` + `logsToRows`).
3. Bump `SCHEMA_VERSION` in `WorkbookVersion.ts` and add an upgrade step if
   the sidecar shape changes.
4. Extend `validateLogsPayload` in `WorkbookValidator.ts`.
5. Extend the entry UI. The writer picks the column up automatically from the
   schema; run `npm run test:excel`.

## Testing

- **`npm run test:excel`** — copies `RST_Dashboard.xlsm`, then: read →
  modify + add month → save → re-read → 35 assertions (data round-trip,
  VBA byte-identical, pivots/charts/tables preserved, calcChain dropped,
  table ranges extended, lock detection, backup rotation).
- **`npm run test:e2e`** — launches the built app with
  `--remote-debugging-port`, drives it over CDP: all four views, integrity
  center, settings, and a config.json round-trip via the UI. Expects
  `config/config.json` to point at a test workbook (never run it against the
  live one — the entry flow can save).
- Manual checklist: see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
