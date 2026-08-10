# Energy Monitor v2.2.7 — Reporting Center & Report Builder Design

## Goal

Replace Export Center modal with `Reports & Export` main-navigation workspace.

Keep existing export entry points compatible. Reporting must not modify production workbooks.

## Scope

### Included

- Three-column Report Builder workspace.
- Shared reporting month state.
- Modular reporting architecture in `src/reporting/`.
- Live HTML-based preview reused for preview, PDF, and HTML.
- PDF, Excel, HTML output. Disabled PowerPoint control.
- Persisted recent-report history.
- Keyboard shortcuts and responsive Mahindra CI UI.
- Required regression, integrity, packaged-runtime, portable-artifact, and release gates.

### Excluded

Templates, saved profiles, favorites, scheduling, email delivery, queues, notifications, and persistent thumbnail cache. These need new schemas or backend contracts and are deferred to avoid v2.2.7 regression risk.

## Navigation and Compatibility

Main navigation contains:

1. Dashboard
2. Data Entry
3. Rack Capacity & Utilization
4. Historical Logs
5. Site Comparison
6. Reports & Export
7. Settings

`Reports & Export` replaces Export Center as primary workspace.

- Toolbar Export and `Ctrl+E` navigate to this workspace.
- `Ctrl+P` generates selected report unless focus is an editable field where browser behavior must remain intact.
- Existing `src/reports/*` public entry points remain thin compatibility adapters over canonical reporting services.
- Existing report formats and legacy export flows retain their contracts.

## Reporting Month Boundary

`ReportingMonthContext` is sole month source for reporting domain:

- Reports & Export
- Dashboard
- Historical Explorer
- Rack Capacity & Utilization
- Rack Unit Capacity
- Preview, PDF, HTML, and Excel report output

Context supports:

- `current-month`
- `single-month`
- `month-range`
- `full-history`

Month values use existing reporting-month utilities and normalized `MMM-YY` display. Range validation requires `from <= to`.

Data Entry and workbook-edit month selection stay separate. This prevents reporting navigation from changing workbook write targets.

## Canonical Reporting Architecture

Create `src/reporting/` with focused modules:

| Module | Responsibility |
| --- | --- |
| `ReportController` | Coordinates preview, generation, error state, and history write. |
| `ReportBuilder` | Holds validated report request: type, period, ordered sections, and output options. |
| `ReportRegistry` | Registers sections and resolves report-type defaults into ordered composition. |
| `ReportSection` | Defines section metadata and one renderer contract. |
| `PreviewProvider` | Lazily supplies existing rendered HTML to preview surface. |
| `ExportProvider` | Adapts canonical rendered document into PDF, Excel, or HTML output. |
| `ReportHistory` | Persists report metadata and artifact path; handles history lifecycle. |

No new second rendering engine.

Each report section owns rendering logic:

- `renderExecutiveSummary()`
- `renderDashboardOverview()`
- `renderRackCapacity()`
- `renderRackUnitCapacity()`
- `renderUps()`
- `renderAirConditioning()`
- `renderDcPower()`
- `renderHistorical()`
- `renderSiteComparison()`
- `renderAppendix()`

`All Report` is ordered composition of registered sections. Shared calculations remain in existing domain utilities or extracted once into reporting-domain helpers when needed. No giant `reportHtml.ts` composition file.

## Report Request and Rendering Flow

1. Builder validates selected type, period, facility, sections, and output options.
2. `ReportRegistry` resolves defaults and user-selected ordered section IDs.
3. Controller requests section renderers lazily.
4. Existing HTML renderer produces one canonical document.
5. Preview uses canonical HTML in a sandboxed iframe.
6. PDF/HTML export uses same canonical HTML.
7. Excel provider maps same report data model; it does not replicate report calculations.
8. Successful export writes a history record. Failure preserves last valid preview, sets `Error`, and exposes retry.

Reporting reads workbook/domain data only. It never writes workbook cells, sheets, formatting, or image assets.

## Workspace UI

### Builder — left column

- Report Type:
  - Executive Summary
  - Dashboard Summary
  - Rack Capacity & Utilization
  - Historical Logs
  - Site Comparison
  - Monthly Energy
  - All Report
- Report Period:
  - Current Month
  - Single Month
  - Month Range
  - Full History
- Single Month picker: `MMM-YY`
- Month Range pickers: From / To, same month utilities
- Include Sections:
  - Executive Summary
  - Dashboard Overview
  - Rack Capacity
  - Rack Unit Capacity
  - UPS
  - Air Conditioning
  - DC Power
  - Historical
  - Site Comparison
  - Appendix
- Select All, Select None, section search, keyboard-accessible drag-and-drop reorder.

### Live Preview — center column

- Lazy sandboxed iframe using canonical existing HTML renderer.
- Toolbar: Previous, Next, Fit Width, Zoom, Full Screen.
- Thumbnail strip generated only for visible/needed pages.
- Page indicator.
- Status: `Ready`, `Generating`, `Error`.
- Preview refresh debounced after configuration changes. Existing preview remains shown during failed regeneration.

### Output — right column

- Formats: PDF, Excel, HTML.
- PowerPoint disabled with `Coming Soon`.
- Options:
  - Include Charts
  - Include Images
  - Include KPI
  - Include Appendix
- Paper size and orientation.
- Editable filename with auto default:
  `Energy_Report_<Facility>_<MMM-YY>`
- Large primary `Generate Report` control.

### Recent Reports — bottom section

Persist fields:

- Filename
- Facility
- Month / range / full-history label
- Pages
- Created timestamp
- Artifact path
- Output format

Actions:

- Open
- Reveal Folder
- Delete

Desktop actions use Electron bridge only. Browser mode persists metadata locally and hides unavailable file-system actions safely.

## UI and Accessibility

- Mahindra CI tokens only; no duplicated literal palette.
- Rounded cards, consistent spacing, professional typography.
- Responsive: three columns on wide screens; logical stacked panels on narrow screens.
- Dark-mode-ready semantic tokens.
- Native controls or equivalent keyboard semantics for radios, checkboxes, search, reorder, and toolbar actions.
- Shortcut behavior:
  - `Ctrl+P`: Generate Report
  - `Ctrl+E`: Navigate/focus Reports & Export output
  - `Ctrl+F`: Focus section search
- Shortcuts do not override editable text controls.

## Performance

- Lazy preview and section rendering.
- Memoized canonical report request and output where inputs have not changed.
- Charts render only selected/visible report sections.
- Images use existing cached storage/provider paths.
- Thumbnail generation is deferred and limited to needed pages.
- Avoid rerendering unchanged builder panels during preview zoom/page changes.

## Failure Handling

- Invalid range, empty required selection, or unsafe filename blocks generation with field-level message.
- Renderer/export errors set `Error`, retain prior preview, and offer retry.
- History persistence errors do not invalidate successfully generated artifact; user receives status message.
- Desktop bridge failures are surfaced without exposing local file paths in browser-only runtime.

## Validation and Quality Gates

### Architecture Reviewer

Verify:

- One reporting-month source.
- No duplicate calculations.
- No duplicate renderer pipeline.
- Legacy reports are adapters, not a second implementation.
- No duplicated colors outside design tokens.

### UI/UX Reviewer

Verify:

- Dashboard and preview use consistent Mahindra CI tokens, typography, and spacing.
- Responsive layout remains usable.
- Keyboard and screen-reader behavior works.
- Disabled PowerPoint communicates unavailable state.

### QA / Test Engineer

Run:

- lint
- typecheck
- build
- test
- `test:all-report`
- `test:packaged-report`
- relevant regression tests for month, report composition, history, and shortcuts

### Data Integrity Auditor

- Hash production workbooks before and after all implementation and tests.
- Confirm no workbook content, formatting, sheets, or image assets changed.

### Release Manager

Create:

- `RELEASE_NOTES_V2.2.7.md`
- `RELEASE_MANIFEST_V2.2.7.md`

Build and verify portable artifact and packaged runtime.

## Acceptance Criteria

Release passes only when:

- Reporting Center replaces Export Center.
- Builder, live preview, output controls, report history, Single Month, Month Range, and Full History work.
- Dashboard and report output resolve same Reporting Month.
- Existing HTML renderer is sole HTML/PDF/preview source.
- No duplicated month logic, report calculations, or rendering pipeline.
- Legacy export behavior remains compatible.
- Production workbook integrity hash passes.
- Lint, typecheck, build, tests, all-report, portable, and packaged-runtime gates pass.