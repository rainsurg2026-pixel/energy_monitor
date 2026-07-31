# Energy Monitor v2.1.0 Release Manifest

## Release identity

| Field | Value |
|---|---|
| Product | Energy Monitor |
| Version | 2.1.0 |
| Release date | 2026-07-31 |
| Version change | 2.0.21 → 2.1.0 |
| SemVer decision | MINOR — Site Comparison is new backward-compatible functionality. |
| Git branch | `main` |
| Git commit | `727e4be217d19c35e4ccefa948146c4f7a70bbfd` |
| Source state | Intended release changes uncommitted; artifact built from this reviewed working tree. |

## Build and package

| Field | Value |
|---|---|
| Production build command | `npm run desktop:build` |
| Portable package command | `npm run portable` |
| ZIP command | `npm run portable:zip` |
| Portable EXE | `release/Energy Monitor-v2.1.0.exe` |
| Absolute EXE path | `D:\Project\monthly-power-&-energy-logger\release\Energy Monitor-v2.1.0.exe` |
| EXE size | 82,413,346 bytes |
| EXE timestamp | 2026-07-30T22:50:02.000Z |
| EXE SHA-256 | `B009CDCE649C09E711721BAB422F287AE4A65B2CB9B6F1DB433316B6C8CD5EAE` |
| Embedded product/version | `Energy Monitor` / `2.1.0` |
| Portable ZIP | `release/Energy Monitor-v2.1.0.zip` |
| ZIP size | 82,602,287 bytes |
| ZIP timestamp | 2026-07-30T22:50:06.599Z |
| ZIP SHA-256 | `6E7165B28EC914388AF95005B1A1C75B7197297B60EF27E4CD735B93BDACC17E` |

ZIP inspection passed. Package contains versioned EXE, both facility workbooks,
`README.md`, and empty portable runtime folders: `config/`, `backup/`, `logs/`,
`exports/`.

## Validation results

| Gate | Result | Evidence |
|---|---|---|
| Lint + TypeScript | PASS | `npm run lint` |
| Formatting architecture | PASS | `npm run validate:formatting` |
| Architecture contracts | PASS | `test:dashboard-config-driven`, `test:facility-isolation`, `test:dashboard-facility-isolation`, `test:dashboard-workbook-mapping` |
| Excel Rangsit roundtrip | PASS | `npm run test:excel` |
| Excel save formatting | PASS | `npm run test:save-formatting` — 1,289 checks |
| Air validation | PASS | `npm run test:air-validation` |
| Srinakarin read/roundtrip/aggregate | PASS | `test:srinakarin`, `test:srinakarin:roundtrip`, `test:srinakarin:aggregate` |
| Facility isolation | PASS | 15 checks |
| Dashboard isolation | PASS | 13 checks |
| Dashboard workbook mapping | PASS | 20 checks |
| UPS Group History | PASS | 26 checks; unchanged incremental save is byte-identical |
| UPS History migration | PASS | 11 checks; second open is a true no-op |
| Production stress/fault | PASS | 20 checks; ten no-edit save cycles do not grow workbook |
| Batch save merge | PASS | 8 checks |
| Report data | PASS | `npm run test:all-report` |
| PDF | PASS | `npm run test:all-report:pdf` — 11-page PDF |
| Development Electron E2E | PASS | `npm run test:e2e` — renderer, navigation, comparison, facility config |
| Production build | PASS | `npm run desktop:build` via final `npm run portable` |
| Portable package | PASS | final `npm run portable` + `npm run portable:zip` |
| Packaged runtime | PASS | final `npm run test:packaged-report` |

No standalone `architecture` script is configured in `package.json`. Contract
coverage above is the configured architecture release gate.

## Packaged runtime verification

`npm run test:packaged-report` launched a copied `Energy Monitor-v2.1.0.exe`
inside a temporary portable root. It copied both workbooks before launch and
removed the fixture after completion.

Verified:

- Electron startup and renderer initialization.
- Embedded app version `2.1.0`, portable root, and startup logs.
- Rangsit workbook load: 67 months.
- Srinakarin workbook load: 66 months.
- Facility switch Rangsit → Srinakarin → Rangsit.
- Site Comparison rendering both facilities independently.
- `excel:openMultiple` returns both workbook paths with facility-specific
  devices; Rangsit exposes EB42 and no EB43/44 meters, Srinakarin preserves
  EB43/44 meter values.
- Current-page PDF and 11-page All Report PDF generation.
- Normal `Browser.close` shutdown without force-kill.
- Runtime log inspection: no startup crash, renderer crash, GPU crash, or
  `did-fail-load` entry.

## Source workbook integrity

| Workbook | Before SHA-256 | Final SHA-256 | Result |
|---|---|---|---|
| `DC_Rangsit.xlsm` | `BDDAF0D325124B7974F628CD2AD23D5AF26F0AA742A8DC547582B75FDF1D15F0` | `BDDAF0D325124B7974F628CD2AD23D5AF26F0AA742A8DC547582B75FDF1D15F0` | PASS — identical |
| `DC_Srinakarin.xlsm` | `F146FB69A42D52897013C59BCAEE17307C1B474830C65BE723928F8DF919AD62` | `F146FB69A42D52897013C59BCAEE17307C1B474830C65BE723928F8DF919AD62` | PASS — identical |

Excel tests that write use temporary copied fixtures. Packaged runtime testing
also uses a copied EXE and copied workbooks. No source workbook was modified.

## Known limitations

- Source Dashboard-FAC cache contains pre-existing `#VALUE!` results for some
  source formulas. App calculations use parsed workbook data rather than those
  stale formula caches; regression tests verify persisted values separately.
- Vite reports one renderer chunk above 500 kB after minification. Build and
  packaged runtime pass; defer code splitting until startup/download evidence
  requires it.
- Native Microsoft Excel was not available in this environment. OOXML,
  VBA/pivot/chart/table preservation, and ExcelJS reopen checks passed; an
  operator may still open a copied release workbook in Excel as an additional
  office-client smoke check.

## Release status

**PASS — PRODUCTION RELEASE CERTIFIED**
