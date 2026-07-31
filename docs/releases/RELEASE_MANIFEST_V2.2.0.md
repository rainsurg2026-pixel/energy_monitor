# Energy Monitor v2.2.0 Release Manifest

## Release identity

| Field | Value |
|---|---|
| Product | Energy Monitor |
| Version | 2.2.0 |
| Release date | 2026-07-31 |
| Version change | 2.1.0 → 2.2.0 |
| SemVer decision | MINOR — backward-compatible Site Comparison functionality. |
| Git branch | `main` |
| Git commit | `727e4be217d19c35e4ccefa948146c4f7a70bbfd` |
| Source state | Reviewed working tree; unrelated pre-existing changes preserved. |

## Build and package

| Field | Value |
|---|---|
| Production build command | `npm run desktop:build` |
| Portable package command | `npm run portable` |
| ZIP command | `npm run portable:zip` |
| Portable EXE | `release/Energy Monitor-v2.2.0.exe` |
| Absolute EXE path | `D:\Project\Energy_Monitor\release\Energy Monitor-v2.2.0.exe` |
| EXE size | 82,599,634 bytes |
| EXE timestamp | 2026-07-31T13:01:35.000+07:00 |
| EXE SHA-256 | `8229206063306D7EC244F7A700898D378BF64F7A3DDFB9EB10439450AC6BDCD0` |
| Embedded product/version | `Energy Monitor` / `2.2.0` |
| Portable ZIP | `release/Energy Monitor-v2.2.0.zip` |
| ZIP size | 82,811,271 bytes |
| ZIP timestamp | 2026-07-31T13:20:37.000+07:00 |
| ZIP SHA-256 | `3DDAE86F79379D585D8E49888775D2521DB9D4FD815CA6631A3EA31AB182D9AC` |

ZIP command passed. Distribution contains versioned portable EXE, two facility
workbooks, `README.md`, and portable runtime folders.

## Site Comparison acceptance

| Requirement | Result | Evidence |
|---|---|---|
| PUE absent from Site Comparison only | PASS | Component and E2E checks |
| Reference months from workbook monthly records | PASS | Facility comparison unit checks and packaged runtime |
| Shared 3 / 6 / 12 month ranges ending reference month | PASS | 54 facility comparison checks, E2E, packaged runtime |
| Missing data stays `null`, never synthetic zero | PASS | Calendar-series unit checks and chart configuration |
| Required table metrics and Floor 4 share | PASS | Workbook mapping checks, unit tests, packaged table values |
| Two-site Energy Trend and Floor 4 Cost Trend | PASS | E2E and packaged runtime |
| Visible compact K/M/B labels and full-value tooltips | PASS | Formatter checks, E2E, packaged runtime |
| Thai and English Site Comparison | PASS | E2E and packaged runtime |
| Facility isolation | PASS | direct `openMultiple`, facility tests, packaged runtime |

## Validation results

| Gate | Result | Evidence |
|---|---|---|
| Lint + TypeScript | PASS | `npm run lint` |
| Formatting architecture | PASS | `npm run validate:formatting` |
| Site Comparison unit checks | PASS | `npm run test:facility-comparison` — 54 checks |
| Development Electron E2E | PASS | `npm run test:e2e` |
| Excel Rangsit roundtrip | PASS | `npm run test:excel` |
| Excel save formatting | PASS | `npm run test:save-formatting` |
| Energy cost dashboard | PASS | `npm run test:energy-cost-dashboard` |
| Air validation | PASS | `npm run test:air-validation` |
| Srinakarin read/roundtrip/aggregate | PASS | `test:srinakarin`, `test:srinakarin:roundtrip`, `test:srinakarin:aggregate` |
| Facility and dashboard isolation/mapping | PASS | `test:facility-isolation`, `test:dashboard-facility-isolation`, `test:dashboard-config-driven`, `test:dashboard-workbook-mapping` |
| UPS history/migration | PASS | `test:ups-group-history`, `test:ups-group-history-migration` |
| Stress/fault and batch merge | PASS | `test:production-stress-fault`, `test:batch-save-merge` |
| Production build | PASS | `npm run desktop:build`; final `npm run portable` |
| Portable package | PASS | `npm run portable`; `npm run portable:zip` |
| Packaged runtime | PASS | `npm run test:packaged-report` |

## Review gates

| Gate | Result | Evidence |
|---|---|---|
| QA/Test Engineer | PASS | Test matrix above; 3/6/12, reference end, missing data, mappings, labels, tooltips, i18n, regression and portable runtime covered. |
| Data Integrity Auditor | PASS | Stored authoritative Floor 4 cost/rate mapping, direct dual-workbook read, Air field isolation, and before/after source hashes. |
| Architecture Reviewer | PASS | Traced `FacilityComparison` → `ExcelProvider.loadMultipleFacilities` → DesktopBridge → preload → `excel:openMultiple` → workbook reader/facility config. Active facility/current path remain unchanged by multi-read. |
| UI/UX Reviewer | PASS | Filters, responsive chart width/scroll, site row distinction, chart labels/collision strategy, tooltips, and Thai/English verified. |

Named sub-agent sessions were unavailable in this environment. Primary release
review completed each gate against source, automated checks, and packaged
runtime evidence.

## Packaged runtime verification

`npm run test:packaged-report` launched copied `Energy Monitor-v2.2.0.exe`
inside temporary portable root using copied workbooks and then removed fixture.

Verified:

- Startup, portable identity, renderer initialization, and normal shutdown.
- Rangsit and Srinakarin workbook identity and separate Air mappings.
- Site Comparison opens with real reference month data.
- Default 12M and both 3M/6M controls update shared chart/table range.
- Authoritative whole-building reference-month table values match direct
  `openMultiple` reads for both sites.
- Energy and Floor 4 cost chart series render with visible compact labels.
- Full kWh tooltip format works at runtime; Floor 4 cost binds same full-value renderer with `THB` unit. Thai labels and English restoration work.
- Current-page PDF and 11-page All Report PDF exports work.
- Runtime logs contain no startup crash, renderer crash, GPU crash, or
  `did-fail-load` entry.

## Source workbook integrity

| Workbook | Before SHA-256 | Final SHA-256 | Result |
|---|---|---|---|
| `DC_Rangsit.xlsm` | `E27AF603725BC0493265A22BC3D66F49084C44E0C43AA622276965E0AEBD6DD4` | `E27AF603725BC0493265A22BC3D66F49084C44E0C43AA622276965E0AEBD6DD4` | PASS — identical |
| `DC_Srinakarin.xlsm` | `94379D42BE4D597130CB73FD4CFA19451804DF779F32DAC449CD35519D51307C` | `94379D42BE4D597130CB73FD4CFA19451804DF779F32DAC449CD35519D51307C` | PASS — identical |

Tests requiring writes use temporary workbook copies. Portable runtime testing
also stages copied workbooks. Source workbooks remain unchanged.

## Known limitations

- Vite renderer chunk advisory above 500 kB remains. No functional or runtime
  failure found.
- Native Microsoft Excel unavailable. OOXML/VBA/pivot/chart/table structures
  were byte-verified; optional operator Excel smoke test uses copied workbooks.

## Release status

**PASS — PRODUCTION RELEASE CERTIFIED**
