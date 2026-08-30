# Export / Report UI-Parity Redesign — Design

- **Date:** 2026-08-30
- **Branch:** `feat/export-report-ui-parity` (cut from `origin/main` @ `5edaffc`, PR #27)
- **Status:** Draft for Product Owner approval. No implementation has started.
- **Supersedes work on:** `fix/export-completeness-and-uat-gates` (abandoned — its PR #27 is already merged).

---

## 1. Goal

Redesign and simplify the Production **Exports & Report** experience so that PDF and
Excel follow the **current** application UI and navigation, with:

1. Export scopes reduced from three to **two**: *Current Facility* and *All Facilities*.
2. The standalone *Site Energy & Cost Comparison* export scope/card removed; both
   cross-site comparison pages consolidated **inside** *All Facilities*.
3. PDF and Excel templates rebuilt to structurally mirror the current app pages,
   headings, terminology, KPI hierarchy, tables, and charts.
4. Dashboard **PNG** export removed from the Production web Dashboard toolbar
   (PDF · EXCEL · CSV only), without touching any legitimate PNG image support.
5. Live Preview scope simplified from `current | all | comparison` to
   `current | all`.

The **current Production application UI is the source of truth**
(`src/main.tsx` → `src/web-clean-v1/CleanWebApp.tsx`). Deleted WebV3, old
screenshots, and the legacy report structure are **not** design authorities.

---

## 2. Locked decisions (from Product Owner)

| # | Decision |
|---|----------|
| D1 | **Sequencing:** full read-only audit → this design doc → PO approval → implement in focused commits. |
| D2 | **Dashboard views in the full report:** only **Executive** and **Engineering** become report sections. **Benchmark** and **Forecast** stay screen-only (they are derived/projected, already blacklisted from the PDF by `scripts/test-all-report.ts`). |
| D3 | **Current Facility depth:** *Current Facility* gains per-facility analytical sections (Executive + Engineering + Rack Capacity + Rack Unit Capacity + History/Trends + Energy). **No cross-site content** in Current Facility. |
| D4 | **Nav label:** rename nav item `rack-comparison` and all report headings to **"Site Rack Capacity & Availability Comparison"** (English), with the Thai translation string updated for Thai-locale users. |
| D5 | **Default language = English (revised per PO review).** Today the app defaults to **Thai** at three points: `src/web-clean-v1/CleanWebApp.tsx:138` (`useState<AppLanguage>("th")`), `src/web-clean-v1/theme.ts:11` (`normalizeLanguage` returns `"th"` for null/unknown), and Desktop `src/App.tsx:193` + `src/electron/config.ts:49` (`language: "th"`). Change the default so that **when there is no saved preference, or the stored value is invalid, the app initializes to English**, while a preference the user explicitly saved as `"th"` is still honoured. Do **not** otherwise rework locale wiring, the `localStorage`/config restore effects, or `document.documentElement.lang` (which follows `lang` state automatically). Add an acceptance test (§16). Exact code points in §12a. |

---

## 3. Hard constraints (do not violate)

- **No schema / migrations / RLS / Supabase Production data / Vercel Production env /
  auth / WebV3 changes.** No Production data writes. No secrets in logs or report output.
- **Two-layer tenant isolation** unaffected (no new tables).
- **SweetAlert2 only** for UI feedback (no `alert()` / ad-hoc banners) — not expected
  to be touched here; the Reports view already uses its own transient status line
  pattern, keep it.
- **GMT+7 shared formatter** for any user-facing timestamp (`formatThaiDateTime` /
  `formatTimestamp` / `formatWebSavedTimestamp`). No raw `Date.toLocaleString()`.
- **Number-formatting gate** (`scripts/validate-number-formatting.mjs`): no
  `.toFixed(` / `.toLocaleString(` / `Intl.NumberFormat(` in `src/components/**`
  (whitelist: `TrendLineChart.tsx`). Report/export code under `src/reports/**` and
  `src/web-clean-v1/**` uses its own helpers (`formatUsagePercent1`,
  `formatFixedNumber`, `formatNumber`, …) — keep using those.
- **No new dependencies** (state lib, icon lib, ORM, validation lib, chart lib).
  Charts stay hand-built inline SVG in `reportHtml.ts`; Excel charts stay the
  JSZip-injected OOXML approach in `excelDashboard.ts`.
- **`.claude/rules/git.md`:** one PR, **never merge**, no tags/releases, commit only
  as instructed. Design doc committed to the feature branch.

---

## 4. Part 1 — Current Production UI audit

Navigation in display order (`CleanWebApp.tsx:492`, routing `:511-518`).

### 4.1 Decision table

| App Page (EN / TH) | View id | Main component | Data source | Period semantics | PDF | Excel | Reason / Notes |
|---|---|---|---|---|---|---|---|
| **Dashboard** / แดชบอร์ด | `dashboard` | `DashboardView` → `UniversalFilterBar` + one of `ExecutiveDashboard`+`SmartInsightPanel` / `DashboardSummary` / `BenchmarkDashboard` / `ForecastDashboard` | `history.logs` (`/sites/:id/history?scope=full`), `upsGroupHistory` | Single month `activeMonth` resolved from YEAR+PERIOD, clamped to Global Display Period | **Yes — Executive + Engineering only** | **Yes — Executive + Engineering only** | Benchmark/Forecast excluded (D2). SmartInsightPanel / Benchmark "Actionable Insights" are advisory prose → excluded. Toolbar PNG removed (Part 20). |
| **Data Entry** / กรอกข้อมูล | `entry` | `WebEntryWorkspace` | `PUT /sites/:id/periods/:month` | Single month | **No** | **No** | CRUD only. Mirror analytical/display content, never CRUD controls. |
| **Rack Capacity** / ความจุแร็ค | `racks` | `WebRackCapacityDashboard` → `RackCapacityDashboardInner` | `useRackCapacitySnapshot` (`/racks?siteId&month`), rendered only when `rack.persisted`; `rackCapacityHistory` | Single global `displayMonth`, exact-month snapshot, **no latest fallback** | **Yes** | **Yes** | 5 metric cards (Total / In Use / Available / Reserved / Pending Dismantle), Overall Capacity Mix, Key Insights, Rack Zone Breakdown. |
| **Rack Unit Capacity** / ความจุ U | `rack-units` | `WebRackUnitCapacityDashboard` → `RackUnitCapacityDashboardInner` | `rackUnitCapacity` rows; image via `loadWebRackUnitCapacityImage(siteId, month)` **exact (site, month)** | Single global `displayMonth` | **Yes** | **Yes** | 5 KPI cards (Total U / Used U / Available U / Usage % / Availability %), U Capacity Mix, Capacity Health gauge + trend-vs-prev (pp), 6-month trend chart, Rack Unit Details table, Trend Note, **Monthly Rack Unit Capacity Image**. |
| **History** / ประวัติ | `history` | `HistoricalCharts` + `HistoricalExplorer` | Full `history.logs`, `upsGroupHistory`, `rackCapacityHistory`, `rackUnitCapacity` | Trailing 3/6/12-month window ending at `displayMonth`, ∩ Global Display Period | **Yes (Trends)** | **Yes (Trends + History tables)** | `HistoricalCharts` = "Facility Trend Analytics" (Energy/Cost/UPS/Air/DC). `HistoricalExplorer` = 5 filtered history tables + Rack Capacity Monthly History. Interactive filtering is screen-only; the underlying series/tables are reportable. |
| **Site Energy & Cost Comparison** / เปรียบเทียบพลังงานและค่าใช้จ่าย | `comparison` | `WebSiteComparison` | `GET /site-comparison` (own fetch, own month + range controls) | Own reference-month select; 4 charts use trailing 3/6/12 | **All Facilities only** | **All Facilities only** | Moves **inside** All Facilities (Part 4/14). Nav page stays as an interactive screen. |
| **Site Rack Capacity & Availability Comparison** / *(TH label updated)* | `rack-comparison` | `WebSiteRackCapacityComparison` | `/sites` + per-site `/racks` + `/rack-unit-capacity` | `month={displayMonth}` | **All Facilities only** | **All Facilities only** | Moves **inside** All Facilities (Part 4/15). 4 sub-sections: Rack Capacity by Zone, per-site Rack Capacity Details, Rack Positions, Rack Unit Capacity Comparison + per-site summary cards. Nav label renamed (D4/D5). |
| **Exports & Report** / ส่งออกและรายงาน | `reports` | `Reports` | Aggregates all of the above per scope | Reports-local Reporting Period (Current/Single/Range/Full + Last 3/6/12) — never mutates other views | *(the export UI itself)* | *(the export UI itself)* | Two scope cards after redesign. |
| **Settings** / ตั้งค่า | `settings` | `SettingsPage` | `PUT /settings/display-period` | — | **No** | **No** | Theme radio + admin Global Display Period. Interactive-only. |
| **User Management** / จัดการผู้ใช้ | `admin` | `Admin` (admin role) | `/admin/users*` | — | **No** | **No** | User CRUD. Interactive-only. |

### 4.2 Dashboard sub-views (all four audited; D2 selects two)

- **Executive View** (`selectedReportView === "executive"`): `ExecutiveDashboard`
  (KPI "Electricity Consumption Comparison" — Whole Building vs 4th Floor kWh + 4th-floor share %;
  KPI "Electricity Cost Comparison" — Whole Building vs 4th Floor THB) + `EngineeringTrendCharts`
  (6 trend charts: 4th Floor Cost, 4th Floor Energy, Avg Rate, UPS Energy, AC Energy, DC Energy)
  + `SmartInsightPanel` (advisory prose → **not** reported).
- **Engineering View** (`selectedReportView === "dashboard"`): `DashboardSummary` — banner + 4 KPI
  cards (Total 4th Floor Energy, Estimated 4th Floor Cost, 4th Floor Energy Share, Avg Electricity Rate)
  + §1 UPS Load Status (1.1 Overall for Srinakarin topology, 1.2 UPS & PPC group table + Total row,
  detailed UMDB/STS/OUDB mapping table) + §2 Air Conditioning Energy (per-meter GWh columns,
  Previous / Current / Monthly Difference rows) + §3 DC Power Panel Load Status (+ Total row)
  + §4 Overall Energy Consumption & Electricity Cost table. This is essentially the existing
  `engineeringDashboard()` PDF page — **reuse it**.
- **Benchmark View** (`benchmark`): PUE Comparative Analytics Matrix, PUE bar chart, PUE trend line,
  hard-coded "Actionable Insights". **Screen-only (D2)** — also relies on `PUE`, which
  `reportSafety.ts` forbids in report HTML.
- **Forecast View** (`forecast`): linear-regression forecast band + R² gauge + local metric/horizon
  controls. **Screen-only (D2)** — projected values; blacklisted by `test-all-report.ts`.

### 4.3 Number / date formatting reference (must match in report output)

| Surface | Rule | Helper |
|---|---|---|
| Dashboard / History / Executive numeric | exactly **2** decimals, grouped; null → `—` | `formatNumber` / `formatNumber2` |
| Rack counts, Rack Unit U values | **0** decimals, grouped | `formatFixedNumber(v, 0)` |
| Rack %, Rack Unit Usage/Availability % | exactly **1** decimal + `%` | `formatFixedPercentage(v, 1)` / `formatUsagePercent1` / `formatRatioPercent1` |
| Some History tables (rack ratios) | 2 decimals + `%` (0–1 ratio input) | `formatRatioPercent(v, 2)` |
| Month labels in report | `formatMonth("2026-06")` → `"Jun 2026"` (PDF), `formatMonthYear` → `"Jun-26"` (charts) | — |
| Timestamps | GMT+7 formatter | `formatTimestamp` |

---

## 5. RTK / scout findings (Part 37-B)

### 5.1 Export architecture (`src/web-clean-v1/exports.ts`, 1138 lines — 100% web layer)

- Two output pipelines: **Blob download** (`export*`, via `download()`), and an
  **orphaned popup + `window.print()`** family. `printDesktopPdf` has **zero
  references anywhere** (not even tests); `openReportPopup` / `renderReportPopup` /
  `renderReportErrorPopup` / `printSiteComparisonPdf` / `printAllFacilitiesPdf` are
  **test-only**. The live UI's PDF buttons use only `exportReportPdfFromHtml`
  (html2canvas + jsPDF Blob download). → **Cleanup candidate:** delete the popup/print
  family + their tests in the refactor commit (Part 15 stale/dead-path removal).
- Dead internal helpers: `parseCsvLine` (`exports.ts:132`), `monthSet` (`:173`) —
  zero references. Remove.
- **`filterReportHtmlBySections`** (`reportHtml.ts:657`) filters by fragile HTML
  substring matching (`page.includes("Executive Dashboard")` etc.). `ups` /
  `air-conditioning` / `dc` have **no independent page** — toggling any one
  keeps/removes the whole 2-page engineering block. → **Redesign:** wrap every
  report page in `<section class="page" data-report-section="<id>">` and filter by
  the attribute, not text. Keeps Select-all / Select-none / search working and makes
  section identity explicit.
- CSV & XLSX **ignore** `selectedReportSections` by design (raw completeness). Only
  HTML/PDF honour it. UI copy already states this. **Keep this contract.**
- `workbookForFacilities` builds ~20 sheets/facility (see §8). `workbookForSiteComparison`
  is plain (no interactive dashboard, no charts).
- Shared model: `ReportData` (`reportTypes.ts:176`) consumed by `buildReportHtml`.
  Web builds it via `exports.ts:facilityReportData` (Desktop uses
  `reportDataBuilder.ts`, which is **not** in the web bundle). `validateReportHtml`
  (`reportSafety.ts`) runs **only** on the Desktop path — the web PDF/HTML output is
  not validated today. → optional hardening: run `validateReportHtml` in a new test.

### 5.2 Current `buildReportHtml` page order (single-facility model)

1. Cover
2. Executive Dashboard (`executiveDashboardPage`)
3. Executive trend page — "Monthly Energy Consumption Trend" (Whole Building + 4th Floor)
4. Engineering "Building Energy Dashboard" — **2 pages** (`engineeringDashboard`)
5. 6 × "Facility Trend Analytics" trend pages (4th Floor Energy, UPS, AC, DC, Cost, Avg Rate)
6. "Monthly Energy & Cost Table"
7. `comparisonPage` — energy Site Comparison (self vs sibling) + 2 comparison trend pages *(gated on `data.comparison`)*
8. `rackCapacityPage` — "Rack Capacity and Utilization"
9. `renderRackUnitCapacityExecutivePage` — "Rack Unit Capacity and Utilization" + "Rack Unit Capacity Six-Month Trend"
10. `rackUnitComparisonPage` — "Rack Unit Capacity Comparison" *(gated on `data.rackUnitComparison`)*
11. `capacityHealthPage` — "Capacity Health and Zone Heatmap"
12. `rackComparisonPage` — "Rack Capacity Site Comparison" *(gated on `data.rackComparison`)*

`scripts/test-all-report.ts` pins: 6 trend pages **before** the Monthly table;
Rack Unit page **after** Rack Capacity page and **before** Capacity Health;
comparison trend charts **above** the comparison table;
`trend-page` count `= 7 + (comparisonEligible ? 2 : 0)`;
**blacklist:** Table of Contents, Executive Summary, Forecast/Benchmark, Capacity
Trend and Forecast, Rack Capacity Monthly Trend, "Report Information and Data Source".

### 5.3 Regression surface

- **Site Energy & Cost month filter** (`CleanWebApp.tsx:769`, commit `824e3d4`):
  `months: item.months.filter(entry => selectedReportMonthSet.has(entry.month))`.
  `sites[].months` are `{month, metrics}` objects — filtering with `Set<string>.has(object)`
  blanks every energy/cost cell. Regression test `test-web-clean-v1-exports.ts:~402-437`.
  **Preserve exactly.**
- Rack Positions contract, Rack Capacity snapshot semantics, Rack Unit formatting,
  Monthly Rack Unit Capacity Image hydration — see §11.
- 3-scope model is encoded in: `test-web-clean-v1-export-feedback.ts:11`
  (`ExportScope` union), `test-web-report-preview.ts` (comparison preview routing),
  `test-web-clean-v1-reports.ts:27-31` (three scope filenames),
  `test-web-site-comparison.ts` (standalone nav view — **stays**).
- Dashboard PNG assertion: `test-web-clean-v1-dashboard-parity.ts:18`.

---

## 6. New two-scope export model (Parts 2, 3, 4, 25)

`type ExportScope = "current" | "all"` — the `"comparison"` member is removed.

### 6.1 Reports page — scope cards

```
Current Facility          All Facilities
CSV | Excel | HTML | PDF   CSV | Excel | HTML | PDF
```

Grid changes from `xl:grid-cols-3` to `xl:grid-cols-2`. `cards()` invoked twice.
The `cards("comparison", …)` call, `reportCopy.comparison` / `comparisonDesc`
copy, and the `site-comparison-<month>.<ext>` filename constants are removed.

### 6.2 Current Facility (Part 3, D3)

Site-specific only.

**PDF / HTML sections** (per selected facility, for the Reports-local Reporting
Period): **Executive → Executive trend → Engineering (2 pages) → Facility Trend
Analytics (6 pages) → Monthly Energy & Cost Table → Rack Capacity & Utilization →
Rack Unit Capacity & Utilization (+ image) → Rack Unit Six-Month Trend → Capacity
Health & Zone Heatmap.** This is the exact §7.1 list.

**History detail tables are Excel-only** — the History page's five filtered tables
(UPS Loads / Air Conditioning / DC Power Panels / Energy & Cost / Rack Capacity
Monthly + Rack Unit Capacity History) are **not** added as PDF pages (the PDF
already represents History through the 6 Facility Trend Analytics pages + the
Monthly Energy & Cost Table, and `scripts/test-all-report.ts` blacklists standalone
"Rack Capacity Monthly Trend" pages). They appear in Excel sheet `06 History`
(§8.1). §7.1 is authoritative for the PDF; there is no "History tables" PDF page —
this resolves the earlier §6.2/§7.1 contradiction.

**No cross-site content:** no `comparisonPage`, no `rackComparisonPage`, no
`rackUnitComparisonPage` — `data.comparison` / `data.rackComparison` /
`data.rackUnitComparison` are `null` for this scope (already the behaviour today;
keep it and add explicit tests).

### 6.3 All Facilities (Part 4)

Complete multi-site report:

```
Facility 1
  <its analytical sections, same order as Current Facility>
Facility 2
  <its analytical sections>
…
Cross-site comparisons
  Site Energy & Cost Comparison
  Site Rack Capacity & Availability Comparison
```

- **One cover for the whole report** (not one per facility — see §7.4 for the
  cover/model boundary and the `buildReportBodyPages` extraction).
- Per facility: a facility band header page + that facility's §7.1 body pages.
- **Then** a single "Cross-site comparisons" block appended **once** (not per
  facility): the Site Energy & Cost Comparison pages + the Site Rack Capacity &
  Availability Comparison pages, built from **one shared N-site comparison model**
  (§7.5) derived from `loadComparison()` output.
- Excel: per-facility sheet groups, then **both** comparison sheets once (see §8).
- Cross-site block is **omitted** when there is only one site in scope (no
  comparison to draw) — not an error.

---

## 7. Final PDF section / page order (Part 37-D)

Each page rendered as `<section class="page" data-report-section="<id>">`.
Section ids are the registry ids (see §9).

### 7.1 Current Facility PDF

| # | Page(s) | `data-report-section` | Mirrors app page |
|---|---|---|---|
| 0 | Cover (facility, reporting month/period, range) | — | — |
| 1 | Executive Dashboard (KPI grid + management insights) | `executive` | Dashboard → Executive View |
| 2 | Executive trend — "Monthly Energy Consumption Trend" | `executive` | Executive View trend |
| 3 | Building Energy Dashboard — page 1 (UPS Load Status [+ Overall], comparison bars) | `dashboard` | Dashboard → Engineering View §1 |
| 4 | Building Energy Dashboard — page 2 (UPS detail mapping, §2 Air Conditioning, §3 DC, §4 Overall Energy & Cost) | `dashboard` (`ups`/`air-conditioning`/`dc` alias to this block) | Engineering View §2–§4 |
| 5 | 6 × Facility Trend Analytics (4th Floor Energy, UPS System Energy, Air Conditioning Energy, DC Power Panel Energy, Estimated 4th Floor Cost, Building Average Electricity Rate) | `historical` | History → Facility Trend Analytics |
| 6 | Monthly Energy & Cost Table | `appendix` | History → Energy & Cost History |
| 7 | Rack Capacity and Utilization (5 KPI cards, status donut, zone detail + Grand Total, Rack Positions) | `rack-capacity` | Rack Capacity page |
| 8 | Rack Unit Capacity and Utilization (2×3 KPI, Used/Available donut, **Monthly Rack Unit Capacity Image**) | `rack-unit-capacity` | Rack Unit Capacity page |
| 9 | Rack Unit Capacity Six-Month Trend (table) | `rack-unit-capacity` | Rack Unit page trend + details |
| 10 | Capacity Health and Zone Heatmap | `rack-capacity` | Rack Capacity / Rack Unit health gauge |

`comparisonPage`, `rackUnitComparisonPage`, `rackComparisonPage` are **omitted**
(their `data.*` inputs are null).

There are **no History-detail-table pages** in the PDF (see §6.2) — History is
represented by rows 5–6 (trend pages + Monthly Energy & Cost Table). The History
detail tables live in Excel sheet `06 History` only.

### 7.2 All Facilities PDF

```
Cover — "All Facilities" · reporting month · period

── Facility: <name 1> ─────────────────────────
  (pages 1–10 above, for facility 1)

── Facility: <name 2> ─────────────────────────
  (pages 1–10 above, for facility 2)
  …

── Cross-site comparisons ─────────────────────
  C1  Site Energy & Cost Comparison
      (4 charts — one series per site — matching the live WebSiteComparison UI,
       WebSiteComparison.tsx:143-148)
      - Total Building Energy Consumption Trend (all sites)             data-report-section="site-energy-comparison"
      - 4th Floor Energy Consumption Trend (all sites)                  "
      - Total Building Electricity Cost Trend (all sites)               "
      - Estimated 4th Floor Electricity Cost Trend (all sites)          "
      (no chart for Average Rate or Floor Share — matches the live UI)
      - Site Energy & Cost Comparison table (one row/site for the
        reference month): Facility | Building Energy (kWh) | Building
        Cost (THB) | 4th Floor Energy (kWh) | Estimated 4th Floor Cost
        (THB) | Average Unit Rate (THB/kWh) | 4th Floor Share (%)       "
  C2  Site Rack Capacity & Availability Comparison
      - Per-site summary cards row (Available Now / Total / In Use /
        Reserved / Pending Decommission / Availability % / Status)      data-report-section="site-rack-comparison"
      - Rack Capacity by Zone (per-site segmented bars, shared scale)   "
      - Rack Capacity Details — per site (Zone | Total | In Use |
        Available | Reserved | Pending Decommission)                    "
      - Rack Positions — per site, grouped Available / Reserved /
        Pending Decommission (Rack ID | Cabinet Size (cm) | Detail)     "
      - Rack Unit Capacity Comparison — per site (Total U | Used U |
        Available U | Usage % | Availability %) + 6-month trend table   "
      - Rack Unit Capacity Trend Note                                   "
```

**Notes / deltas from today:**
- Today's comparison PDF renders **7 empty "No valid values" trend pages + an empty
  Monthly Energy & Cost Table + an empty Rack Capacity page** because it reuses the
  full single-facility template with mostly-null data. The redesign builds the
  cross-site block from a **dedicated** comparison layout — no empty placeholder
  pages.
- Today only the **first two** sites appear in the comparison HTML/PDF
  (`siteComparisonReportForDownload` uses `data.sites[0]`/`[1]`). The redesign
  renders **all** sites — see §7.5 for the N-site model. The 2-site self/sibling
  donut layout (`rackComparisonPage`) is **not reused** for the web All-Facilities
  block; the cross-site rack section uses the per-site summary-card row + per-site
  zone/details/positions tables that the live `WebSiteRackCapacityComparison` uses.
  The existing 2-site `comparisonPage` / `rackComparisonPage` / `rackUnitComparisonPage`
  in `reportHtml.ts` stay **as-is for the Desktop** `reportDataBuilder` path only.
- Terminology: **"Pending Decommission"** everywhere in comparison output (stored
  `Pending Dismantle`), matching the live comparison UI.

### 7.3 Order rationale

Order is derived from app nav: Dashboard (Executive, Engineering) → History (Trends)
→ Rack Capacity → Rack Unit Capacity, then the two Comparison pages last (their nav
position is #6/#7, immediately before Exports). Within All Facilities the per-site
blocks come first (nav #1–#5 content) and the two comparison pages form the trailing
"Cross-site comparisons" block (nav #6–#7).

### 7.4 Cover / model boundary — `buildReportBodyPages`

`buildReportHtml(data, sections?)` today emits a full HTML document:
`<!doctype><html><head><style>…</style></head><body><main class="cover">…</main>
{body pages}<script>…reportReady…</script></body></html>` (`reportHtml.ts:704-707`).
`buildAllFacilitiesReportHtml` (`exports.ts:1109`) calls it **once per facility**, so
today's All-Facilities output has one `<head>`+`<style>` (from the first report) and
**one cover per facility**.

**Change:** extract an internal `buildReportBodyPages(data, sections?): string` in
`reportHtml.ts` that returns only the `<section class="page" data-report-section="…">…
</section>` sequence (no doctype/head/cover/`reportReady` script).

- `buildReportHtml(data, opts?)` — signature becomes
  `buildReportHtml(data, opts?: { sections?: ReportSectionId[]; includeCover?: boolean })`.
  Back-compat: a bare `ReportSectionId[]` second arg is still accepted (normalised to
  `{ sections }`); `includeCover` defaults to `true`. Desktop and Current-Facility
  callers are unchanged in behaviour.
  Implementation = `<!doctype>…<head>` + (`includeCover` ? cover : "") +
  `buildReportBodyPages(data, sections)` + `reportReady` script + `</body></html>`.
- `buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections?)` —
  emits **one** `<!doctype>…<head><style>` (shared), **one** All-Facilities cover
  (`facility: "All Facilities"`, reference month, period, site list), then per
  facility: `<section class="page facility-band" data-report-section="facility-header">
  <h2>Facility: <name></h2></section>` + `buildReportBodyPages(facilityData, sections)`,
  then the cross-site block (`buildCrossSiteComparisonPages(comparisonModel, sections)`),
  then the `reportReady` script.
- **Section filtering:** `filterReportHtmlBySections` is replaced by
  `filterReportBodySections(html, sections)` operating on `data-report-section`
  attributes. The cover and `facility-band` pages are **never** filtered out. The
  cross-site pages are kept iff `site-energy-comparison` / `site-rack-comparison`
  are selected. Select-all / Select-none / search continue to work on
  `ReportRegistry.all()`.
- CSV/XLSX still ignore section selection.

### 7.5 N-site comparison model (single shared input for HTML / PDF / Excel / CSV)

Today `ReportData.comparison` and `ReportData.rackComparison` are `{ self, other }`
2-site shapes, `ExportFacility` has no `siteCode`, and the All-Facilities
CSV/Excel builders take only `facilities: ExportFacility[]` (`exports.ts:269`,
`:528-537`). The redesign introduces one N-site model consumed identically by every
format.

```ts
// new, in src/web-clean-v1/exports.ts
export interface SiteComparisonReportSite {
  label: string;               // site.name
  siteCode: string;            // site.code  (source below)
  /** reference-month energy metrics, null when the site has no data that month */
  metrics: ComparisonMetric | null;
  /** every month in `months`, for the trend charts; missing months → null */
  metricsByMonth: Record<string, ComparisonMetric | null>;
  /** exact reference-month rack snapshot, null when no confirmed snapshot */
  rack: RackCapacityReport | null;
  /** reference-month + up-to-6-month-trailing rack-unit rows */
  rackUnit: Array<{ month: string; totalU: number; usedU: number;
                    availableU: number; usagePercent: number | null;
                    availabilityPct: number | null }>;
}
export interface SiteComparisonReportModel {
  referenceMonth: string;
  months: string[];            // sorted, ≤ referenceMonth window
  sites: SiteComparisonReportSite[];   // ALL sites, sorted name then id
}
```

- **Built once** from `loadComparison()` output (`SiteComparisonExport`) by a new
  `buildSiteComparisonReportModel(data, referenceMonth)`. This is the *only* place
  the comparison shape is assembled; HTML/PDF (`buildCrossSiteComparisonPages`),
  Excel (`sheets 90/91`), and CSV (`siteComparisonExportSections`) all consume it.
- **`siteCode` sources:**
  - comparison path: `SiteComparisonExport.sites[].site.code` (server already sends
    `site: { id, code, name }` — verified).
  - per-facility path: add optional `siteCode?: string` to `ExportFacility`,
    populated in `CleanWebApp.loadAll` from `bootstrap.sites[].code`. Absent →
    fall back to a slug of `siteName` (never blank, never fabricated data).
- **null / no-data semantics (no fabrication):**
  - site with no reference-month `metrics` → energy row cells render `—`; the site
    is still listed. Trend series carries `null` for that month (gap, `connectNulls={false}`).
  - site with no confirmed rack snapshot → summary card shows **"Unavailable"**,
    the site is **excluded from reconciliation totals**, and its zone/details/
    positions tables are omitted (matches `WebSiteRackCapacityComparison`).
  - site with invalid rack-unit values (`usedU > totalU`, negatives) → excluded
    from the Rack Unit Capacity Comparison, listed in an "excluded" note.
  - `Availability %` for rack-unit = `row.availabilityPct ?? (totalU>0 ? availableU/totalU : null)`
    (0–1 ratio), identical to `CleanWebApp.tsx:770` and `exports.ts:559`.
- **Builder signatures** (all gain the model; all `facilities`-only signatures are
  updated, and the standalone site-comparison exports are removed):
  - `buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections?)`
  - `exportAllFacilitiesHtml(facilities, comparison, selectedMonth, fileName?, sections?)`
  - `exportAllFacilitiesPdf(facilities, comparison, selectedMonth, fileName?, sections?)`
  - `exportAllFacilitiesCsv(facilities, comparison)`
  - `exportAllFacilitiesExcel(facilities, comparison)` /
    `workbookForFacilities(facilities, comparison?)`
  - `comparison` is `SiteComparisonReportModel | null`; `null` → cross-site block/
    sheets omitted (single-site tenant).
  - **Removed:** `buildSiteComparisonReportHtml`, `exportSiteComparisonCsv/Excel/Html/Pdf`,
    `printSiteComparisonPdf`, `workbookForSiteComparison`, `siteComparisonReportForDownload`.
    `siteComparisonExportSections` / `buildSiteComparisonCsv` are **kept** but
    re-typed to take `SiteComparisonReportModel` and are called from the
    All-Facilities CSV/Excel builders.

---

## 8. Final Excel sheet order (Part 37-E)

Presentation sheets first (app order), raw/archive sheets after (Part 9).
Sheet-name prefix `NN ` fixes ordering and is stable for tests.

### 8.1 Current Facility workbook

| Order | Sheet | Kind | Content |
|---|---|---|---|
| `01 Dashboard` | presentation | Interactive dashboard (B3 reporting-month dropdown, 10 KPI cards via INDEX/MATCH, mini engineering table, 4 native charts) — the existing `<prefix>-Dashboard`. |
| `02 Executive` | presentation | Executive KPI block only: Building vs 4th Floor energy & cost, 4th-floor share (the trend series live on `07 Trends`). |
| `03 Engineering` | presentation | Selected-month engineering analysis: UPS Load Status (Overall + group + detail mapping), Air Conditioning (per-meter GWh + monthly diff), DC Power Panel, Overall Energy & Cost. |
| `04 Rack Capacity` | presentation | Summary KPIs (Total / In Use / Available / Reserved / Pending Decommission / Other / Usage % / Availability %) + Rack Zone Breakdown + Rack Positions (Available / Reserved / Pending Decommission). |
| `05 Rack Unit Capacity` | presentation | Total U / Used U / Available U / Usage % / Availability % + 6-month trend + Trend Note + image-metadata row (no bytes). |
| `06 History` | presentation | Energy & Cost History, UPS Group History, Air Conditioning History, DC Power Panels History, Rack Capacity Monthly History, Rack Unit Capacity History. |
| `07 Trends` | presentation | The Facility Trend Analytics series (Energy / Cost / UPS / Air / DC) as month-indexed columns for user charting. |
| `20 Raw — UPS_Loads` … | raw | Existing input sheets: `UPS_Loads`, `Air_Inputs`, `DC_Inputs`, `Energy_Cost_Inputs`. |
| `24 Raw — Saved_Records` / `Saved_Values` / `Raw_Inputs` / `Calculated_Energy` | raw | Existing diagnostic/audit sheets (JSON snapshots, calculated energy). |
| `28 Raw — Dashboard-FAC` (+ `UPS` / `Details` / `Air` / `DC`) | raw | Existing Dashboard-FAC mapping sheets. |
| `33 Raw — Rack Capacity Raw` / `Rack Capacity History` / `Rack Unit Capacity` / `UPS Group History` | raw | Existing persisted-history sheets + the section tables from `facilityExportSections`. |
| `40 Dashboard_Data` (hidden) | infra | Existing hidden chart data feed. Stays hidden, stays last. |

### 8.2 All Facilities workbook

For each facility, the `01`–`07` presentation sheets prefixed with the facility code
(e.g. `RST 01 Dashboard`, `SRN 01 Dashboard`), in nav/site order. **Then**:

Excel sheet names are capped at **31 characters**, so the comparison sheets use
short names (the full titles appear in each sheet's title row):

| Order | Sheet name (≤31 chars) | Title row | Content |
|---|---|---|---|
| `90 Site Energy Comparison` | "Site Energy & Cost Comparison" | **Summary block:** one row per site for the reference month — Facility · Site code · Reporting month · Whole Building Energy (kWh) · Whole Building Cost (THB) · 4th Floor Energy (kWh) · Estimated 4th Floor Cost (THB) · Average Rate (THB/kWh) · 4th Floor Share (%). **Trend block:** four month-indexed tables (all sites × months) — Total Building Energy, 4th Floor Energy, Total Building Cost, Estimated 4th Floor Cost — the same four series the live UI and the PDF charts use. Numeric cells numeric; `%` columns `0.0%`; missing months blank (not zero). |
| `91 Site Rack Comparison` | "Site Rack Capacity & Availability Comparison" | `RACK_CAPACITY_SUMMARY` (Site · Snapshot Month · Total · In Use · Available · Reserved · Pending Decommission · Other · Usage % · Availability %), `RACK_CAPACITY_DETAILS` (per zone), `RACK_POSITIONS` (Site · Snapshot Month · Status · Rack ID · Cabinet Size (cm) · Detail), `RACK_UNIT_CAPACITY_COMPARISON`, `RACK_UNIT_TREND_COMPARISON`, `RACK_UNIT_TREND_NOTE`. `%` columns as `0.0%` with 0–1 ratio inputs (matches `exportRatio`). |
| then per-facility raw sheets (`RST 20 Raw — …`, `SRN 20 Raw — …`) | — | Existing raw sheets, after all presentation + comparison sheets. |

Per-facility presentation sheet names must also fit 31 chars — use the facility
**code** prefix (e.g. `RST`, `SRN`): `RST 05 Rack Unit Capacity` (25) is fine;
`SRN 06 History` etc. If a facility code + `NN ` + title would exceed 31, the title
is abbreviated (`Rack Unit Cap`, `Engineering`) and the sheet's title row carries the
full name.

Sheets `90`/`91` are built from the shared `SiteComparisonReportModel` (§7.5), not
from a separate DTO. `workbookForSiteComparison` and the standalone
`exportSiteComparison*` functions are removed; `workbookForFacilities` gains an
optional `comparison` param and emits `90`/`91` when it is non-null.
`ExportFacility` gains `siteCode?: string` (§7.5) so per-facility sheet prefixes and
the `90` "Site code" column resolve from real data.

### 8.3 Excel quality (Part 9)

- Title row + subtitle per presentation sheet; freeze the header row; wrap long
  headings; sensible column widths; consistent section spacing.
- Numeric cells numeric (no text coercion, no scientific notation); month cells as
  real Excel dates (`mmm-yy`); percentages as `0.0%` (analytics) / `0.00%`
  (persisted-history parity) with fraction inputs.
- Charts where practical: keep the 4 native charts on `01 Dashboard`; add a trend
  line chart on `07 Trends` and (all-facilities) `90` if the JSZip-injection helper
  can target them without new deps. If a chart cannot be added safely, ship the
  month-indexed table only — never a broken chart.
- Raw sheets retained for auditability, placed after presentation sheets.

---

## 9. Report section registry changes (Part 13)

`src/reporting/reportingTypes.ts` `ReportSectionId` and `ReportRegistry.ts`:

- **Replace** the single `site-comparison` id with two:
  - `site-energy-comparison` — title "Site Energy & Cost Comparison"
  - `site-rack-comparison` — title "Site Rack Capacity & Availability Comparison"
  - `reportTypes: ["site-comparison", "all"]` retained on both (keeps `forType`
    behaviour; `ReportType` union unchanged).
- Both new sections are **only meaningful for the All Facilities scope**. The
  section picker still lists them; for Current Facility they produce nothing
  (no comparison data), which is acceptable and tested.
- `reportHtml.ts`: `filterReportHtmlBySections` replaced by
  `filterReportBodySections` operating on `data-report-section` attributes (see
  §7.4 for the `buildReportBodyPages` split). Cover / `facility-band` pages are
  never filtered. Mapping:
  - `executive` → Executive page + Executive trend page
  - `dashboard` (and legacy `ups` / `air-conditioning` / `dc`) → both engineering pages
  - `historical` → the 6 Facility Trend Analytics pages
  - `appendix` → Monthly Energy & Cost Table
  - `rack-capacity` → Rack Capacity page + Capacity Health page
  - `rack-unit-capacity` → Rack Unit pages
  - `site-energy-comparison` → cross-site energy pages
  - `site-rack-comparison` → cross-site rack pages
- Select all / Select none / search continue to operate on `ReportRegistry.all()`.
- CSV / XLSX remain complete regardless of selection.

---

## 10. Live Preview simplification (Part 11)

`CleanWebApp.tsx` `Reports` component:

- `exportScope` state: `"current" | "all"`.
- Remove the `comparison` branch of the scoped-preview effect (`:859-892`),
  `previewContextLabel` comparison case, and the `loadComparison`-only preview path.
- **All Facilities preview** must render facility reports **plus** both cross-site
  comparison pages. The preview effect's `all` branch calls `loadAll(...)` **and**
  `loadComparison()` → `buildSiteComparisonReportModel(...)` →
  `buildAllFacilitiesReportHtml(facilities, model, contextMonth, selectedReportSections)`
  (§7.4/§7.5). `previewIdentity` for `all` already keys on the full site set +
  `contextMonth` + `periodIdentity` + sections; the comparison model shares
  `periodIdentity` + `contextMonth`, so no new cache key is needed.
- `WebReportPreview.tsx` itself changes minimally — it already switches on
  `overrideHtml ?? currentFacilityHtml`. `overrideHtml` is non-null only for `all`.
- Preview always reflects what the selected export will contain.

---

## 11. Contract preservation (Parts 14–19)

| Contract | Rule | Source of truth |
|---|---|---|
| **Site Energy & Cost month filter** (14) | `item.months.filter(entry => selectedReportMonthSet.has(entry.month))` — never `has(object)`. Building/Floor Energy & Cost, Average Rate, Floor Share stay populated where source data exists; no fabricated values. | `CleanWebApp.tsx:769`; test `test-web-clean-v1-exports.ts` |
| **Site Rack Capacity & Availability Comparison** (15) | Include, as applicable: Rack Capacity by Zone, per-site Rack Capacity Details, Rack Positions, Rack Unit Capacity Comparison. Current terminology. | `WebSiteRackCapacityComparison.tsx` |
| **Rack Capacity** (16) | Exact monthly snapshot; **no latest fallback**; summary keeps Total / In Use / Available / Reserved / Pending Decommission; details match current UI columns. | `domain/rackCapacity.ts:74`; `rackReportFromSnapshot` returns null when no snapshot |
| **Rack Positions** (17) | Detailed rows only for Available / Reserved / Pending Decommission; **never In Use**. CSV/XLSX cols: Site · Snapshot Month · Status · Rack ID · Cabinet Size (cm) · Detail. Stored `Pending Dismantle` → displayed/exported `Pending Decommission` (`rackCapacity.ts:114`). NO_DATA row when snapshot present but no deployable positions; no rack sections at all when no snapshot. | `domain/rackCapacity.ts:128`; test `:352-372` |
| **Rack Unit Capacity** (18) | Total U / Used U / Available U / Usage % / Availability % / trend / details / Trend Note / Monthly Rack Unit Capacity Image. Non-percent = 0 decimals; percent = **exactly 1 decimal**. Preserve image hydration fix. | `domain/rackUnitCapacity.ts`; `numberFormat.ts`; `reportHtml.ts:62/66` |
| **Monthly Rack Unit Capacity Image** (19) | Data Entry hydrates saved image from DB image metadata (`row.image != null`, not the liveness probe). Analytical page shows image for **exact** site/month. Reports embed image when available. **No latest-month fallback. No stale site/month image. No image deletion on numeric-only save.** | `RackUnitCapacityEntry.tsx:57-89,107-149`; `rackUnitImage.ts:40-59`; `reportHtml.ts:326-352` |

All of these are already correct on `main`; the redesign must not regress them and
must add explicit tests (§13).

---

## 12. Dashboard PNG removal (Parts 20–22)

**Remove (web only):**
- `CleanWebApp.tsx:566` — narrow `exportDashboard` param to `"pdf" | "excel" | "csv"`.
- `CleanWebApp.tsx:584-586` — delete the `else { notify("… Dashboard PNG export
  requires the Desktop app.") }` branch (EN + TH). PDF becomes the terminal branch.
- `CleanWebApp.tsx:591` — pass `exportFormats={["pdf", "excel", "csv"]}` to `<UniversalFilterBar>`.
- `UniversalFilterBar.tsx` — add `exportFormats?: readonly ("pdf"|"excel"|"csv"|"png")[]`
  prop, default `["pdf","excel","csv","png"]` (Desktop unchanged); line 329 maps
  `exportFormats` instead of the hard-coded `["pdf","excel","csv","png"]`.
  `onExport` union keeps `"png"` (Desktop still needs it).
- `scripts/test-web-clean-v1-dashboard-parity.ts:18` — drop `| "png"` from the regex;
  add `assert.doesNotMatch(app, /Dashboard PNG export requires the Desktop app/)`.

**Keep (verified legitimate — do NOT touch):** Desktop `src/App.tsx` / `src/electron/ipc/exportCenter.ts`
PNG snapshot; rack-unit image upload/preview/MIME (`rackUnitImage.ts`,
`RackUnitCapacityEntry.tsx`, `imageValidation.ts`, server storage); report image
embedding + `reportSafety.ts` `data:image/png` allowlist; internal PDF rasterization
`canvas.toDataURL("image/png")` in `exports.ts:863` (asserted by
`test-web-clean-v1-pdf-capture.ts:95` and `-dashboard-fixes.ts:114`); screenshot
test infra.

**Result:** Dashboard toolbar = **PDF · EXCEL · CSV**, three actions, no ghost
spacing, responsive layout unchanged.

### 12a. Default language = English (D5)

Own commit, **before** the export commits so it can be reviewed/reverted in
isolation: `fix(i18n): default UI language to English when no saved preference`.

| Code point | Today | Change |
|---|---|---|
| `src/web-clean-v1/CleanWebApp.tsx:138` | `useState<AppLanguage>("th")` | `useState<AppLanguage>("en")` |
| `src/web-clean-v1/theme.ts:11` `normalizeLanguage` | `value === "en" ? "en" : "th"` | `value === "th" ? "th" : "en"` — a saved `"th"` still returns `"th"`; null / unknown → `"en"` |
| Desktop `src/App.tsx:193` | `useState<"th" \| "en">("th")` | `useState<"th" \| "en">("en")` |
| Desktop `src/electron/config.ts:49` `DEFAULT_CONFIG.language` | `"th"` | `"en"` |

- **A preference the user saved as `"th"` is still honoured**: web restore effect
  (`CleanWebApp.tsx:276`) calls `setLang(normalizeLanguage(saved))` only when
  `saved !== null`; with the new `normalizeLanguage` a stored `"th"` → `"th"`.
  Desktop restores `cfg.language` from the portable config file
  (`App.tsx:1111`, `:1964`), which is untouched for existing installs; only a
  *new* config file (or a missing `language` key filled from `DEFAULT_CONFIG`)
  now starts English.
- Nothing else in the locale wiring changes — `document.documentElement.lang`
  follows `lang` state via the existing effect; the `languageStorageKey` /
  `config.update({language})` write paths are unchanged.
- **Tests to update / add:**
  - `scripts/test-web-clean-v1-theme.ts` and
    `scripts/test-web-clean-v1-settings-recovery.ts` — any assertion that
    `normalizeLanguage(null)` / unknown returns `"th"` flips to `"en"`; a stored
    `"th"` still returns `"th"`.
  - New acceptance test: fresh state (no `energy-monitor:language:*` key) →
    `lang === "en"`; stored `"th"` → `lang === "th"`; stored garbage → `"en"`.
  - Desktop parity: `DEFAULT_CONFIG.language === "en"`; a config with
    `language: "th"` still restores Thai.
- The D4 label-string rename (`rack-comparison` EN + TH) is unaffected by this and
  still lands in the registry/nav commit.

---

## 13. Report context, not controls (Part 24)

The Dashboard `UniversalFilterBar` controls **TREND / CATEGORY / UPS GROUP /
COMPARE do affect the on-screen views** — TREND sets the Executive
`EngineeringTrendCharts` window (`UniversalFilterBar.tsx:218-279`,
`EngineeringTrendCharts.tsx`); CATEGORY toggles which `DashboardSummary` sections
render; UPS GROUP filters the `DashboardSummary` UPS tables; COMPARE adds a
comparison-reference row (`DashboardSummary.tsx:124-350`). What is true is that
**none of them is carried into any export**: the Dashboard-toolbar export passes
only the resolved `activeMonth` and a hard-fixed `["dashboard"]` section with the
full `logs` (`CleanWebApp.tsx:581`), and the Reports-page export does not read
`UniversalFilterBar` state at all (it has its own Reporting Period). Only **YEAR +
PERIOD** resolve to `activeMonth`; `selectedReportView` is screen-only.

Report / Excel output therefore shows **resolved context**, never interactive
controls:
- Reporting Month (resolved from YEAR + PERIOD, or the Reports-local period)
- Reporting Period / window (Reports-local period, or Global Display Period for the
  Dashboard toolbar export)
- Facility / scope
- (Optionally) Report View label for a Dashboard-toolbar snapshot

No "Reporting Year / Trend Window / Category Scope / UPS Group Scope / Comparison
Scope" lines are added — on web they change on-screen filtering but not the
exported dataset, so surfacing them as report context would be misleading. Omit.

---

## 14. CSV / HTML consistency (Part 26)

- **All Facilities CSV / HTML** include the cross-site comparison sections
  (`SITE_COMPARISON`, `RACK_CAPACITY_SUMMARY/_DETAILS`, `RACK_POSITIONS`,
  `RACK_UNIT_CAPACITY_COMPARISON`, `RACK_UNIT_TREND_COMPARISON`,
  `RACK_UNIT_TREND_NOTE`) after the per-facility blocks — reuse
  `siteComparisonExportSections`.
- **Current Facility CSV / HTML** stay strictly site-specific (no comparison sections).
- HTML mirrors the new PDF structure (it is the same `buildReportHtml` output; PDF is
  HTML rasterized).
- CSV/XLSX keep full raw completeness regardless of section selection.

---

## 15. Canonical mapping — UI → report model → PDF → Excel (Part 10 / 37-C)

One resolution path per metric; no per-format business logic.

| Metric | UI source | Report-model field | PDF | Excel |
|---|---|---|---|---|
| Building Energy (kWh) | `WebSiteComparison` KPI / Engineering §4 | `ReportMonthlyRow.buildingEnergyKwh` ← `calculateEnergyCostForMonth` (raw `log.energyCost.buildingEnergyKwh`) | Site Comparison table, Monthly table, Engineering §4 | `03 Engineering`, `06 History`, `90` |
| Building Cost (THB) | same | `buildingCostThb` ← raw `log.energyCost.buildingElectricityCostThb` | same | same |
| 4th Floor Energy (kWh) | Engineering KPI / §4 | `floorEnergyKwh` ← `ups+air+dc` (null if any null) | Executive KPI, Engineering KPI/§4, Monthly table | `02`,`03`,`06`,`90` |
| 4th Floor Cost (THB) | Engineering KPI / §4 | `floorCostThb` ← `avgRate × floorEnergy` | same | same |
| Average Rate (THB/kWh) | Engineering KPI / §4 | `averageRateThbPerKwh` ← `buildingCost / buildingEnergy` | same | same |
| 4th Floor Share (%) | Engineering KPI / §4 | `floorSharePercent` ← `(floor/building)×100` (0–100) | same | same (stored as value, `%` in header) |
| Rack Total / In Use / Available / Reserved / Pending Decommission | Rack Capacity cards / zone table | `calculateRackCapacityMetrics(rack.records)` (exact-month snapshot) | Rack Capacity page, Rack Capacity Site Comparison | `04`, `91` |
| Rack Positions rows | Rack Capacity "Rack Positions" | `rackPositionExportRows(records)` (Available/Reserved/Pending Decommission only) | Rack Positions table | `04`, `91` |
| Total U / Used U / Available U | Rack Unit cards | `RackUnitCapacityRow` + `deriveRackUnitCapacityRow` (`available = total - used`) | Rack Unit page + trend | `05`, `91` |
| Usage % | Rack Unit cards | `usagePercent(row)` = `used/total×100` | Rack Unit page/trend (`formatUsagePercent1`, 1 dp) | `05`, `91` (`0.0%`) |
| Availability % | Rack Unit cards | `row.availabilityPct ?? available/total` (0–1) | `formatRatioPercent1` (×100, 1 dp) | `0.0%` |
| Monthly Rack Unit Capacity Image | Rack Unit page image | `rackUnitCapacityImageDataUri` / `…Meta` (exact site/month) | embedded `<img>` or placeholder | `05` metadata row (no bytes) |

Same source metric resolves identically in UI, PDF, Excel, HTML, CSV. Any divergence
must be a **documented formatting-only** difference (decimals / `%` glyph / date
mask) — otherwise UAT fails (Part 31).

---

## 16. Tests (Part 27)

### 16.0 Desktop vs Web test split (test migration plan)

`scripts/test-all-report.ts` and `scripts/test-all-report-pdf.ts` test the
**Desktop** single-facility report (`buildReportData` from a `.xlsm`, 2-site
`siblingFacility` comparison, `printToPDF`). They **stay Desktop-only and keep
their current assertions**. The redesign must not change the *rendered text* those
tests match:

- Adding `data-report-section="…"` to the wrapping `<section class="page">` is
  additive markup; the `<h2>`/text those tests `.includes()` is unchanged. Run
  `npm run test:all-report` after every `reportHtml.ts` edit.
- The Desktop path keeps calling `buildReportHtml(data, sections?)` with the
  2-member array form (normalised to `{ sections }`, `includeCover: true`) — no
  behavioural change.
- The 2-site `comparisonPage` / `rackComparisonPage` / `rackUnitComparisonPage`
  functions and `filterReportBodySections`' handling of them stay wired for
  Desktop.

The **Web** Current-Facility + All-Facilities structure gets its own suite —
extend `scripts/test-web-clean-v1-exports.ts` and add
`scripts/test-web-clean-v1-report-structure.ts` (registered in `test:phase3`).
Web tests drive the real production builders (`facilityReportData`,
`buildAllFacilitiesReportHtml`, `buildSiteComparisonReportModel`,
`workbookForFacilities`, `siteComparisonExportSections`), never a predicate
re-implemented inside the test.

**Comparison regression — positive, through the production path:** the current
`test-web-clean-v1-exports.ts:~402-437` block asserts the *defective* predicate
(`Set.has(object)`) would blank cells. Keep that as documentation, and **add a
positive assertion**: build a `SiteComparisonReportModel` from a fixture
`SiteComparisonExport` where `selectedReportMonthSet` contains the reference
month, run it through `buildSiteComparisonReportModel` →
`siteComparisonExportSections` / `buildSiteComparisonCsv` /
`buildAllFacilitiesReportHtml`, and assert Building/Floor Energy & Cost, Average
Rate, Floor Share are the fixture values (not `—`) for that month, and that a
non-selected month's row is absent. This exercises the real `entry.month` filter
at `CleanWebApp.tsx:769` semantics via the shared model builder.

### 16.1 Assertions

**Export scope**
1. Only `current` + `all` export cards exist; `ExportScope` union has 2 members;
   `xl:grid-cols-2`; `cards()` called twice.
2. No `comparison` card / copy / filename constants; `assert.doesNotMatch` on
   `site-comparison-` filename literals and `reportCopy.comparison`.
3. Comparison-only preview state/path removed (`test-web-report-preview.ts` updated).
4. Current Facility HTML/PDF excludes cross-site sections (no "Site Comparison" /
   "Site Rack Capacity & Availability Comparison" headings).
5. All Facilities HTML/PDF includes "Site Energy & Cost Comparison".
6. All Facilities HTML/PDF includes "Site Rack Capacity & Availability Comparison".

**Order / structure**
7. PDF `data-report-section` sequence matches §7.1 (Current) and §7.2 (All).
8. Excel presentation sheet order matches §8 (`01`–`07`, then `90`/`91`, then raw).
9. Raw sheets come after all presentation + comparison sheets.
10. Recent Reports is the last persistent child of the Reports section.
11. Report sections picker sits **below** Live Preview (`d2a301a` order preserved).
    Also add `site-energy-comparison` / `site-rack-comparison` appear in
    `ReportRegistry.all()` and toggle via Select all / Select none / search.

**Data**
12. Site Energy & Cost selected-month metrics stay populated — the positive
    production-path regression from §16.0 (Building/Floor Energy & Cost, Average
    Rate, Floor Share) plus the retained negative documentation assertion.
13. Rack Capacity values reconcile UI ↔ PDF ↔ Excel for a fixture snapshot.
14. Rack Positions filtered contract preserved (no In Use rows; 6-column CSV;
    Pending Dismantle→Pending Decommission).
15. Rack Unit values reconcile UI ↔ PDF ↔ Excel.
16. Rack Unit percentage formatting = exactly **1** decimal in report/CSV/XLSX
    analytics output. **Do not touch** the existing `30.0%` report assertions or
    the persisted-XLSM `0.00%` contract (`RackUnitCapacityWriter` /
    `RackCapacityHistoryWriter`) — those are separate and stay as-is.
17. Missing data stays missing/null — no fabricated zeros / filled months / trends
    (cross-site charts carry `null` gaps; a site with no month metrics renders `—`).
18. Cross-site energy report has **4** charts (Total Building Energy, 4th Floor
    Energy, Total Building Cost, Estimated 4th Floor Cost) — matches
    `WebSiteComparison`; no Average-Rate / Floor-Share chart.
19. All Facilities report has exactly **one** cover (`facility: "All Facilities"`),
    one `facility-band` per site, and the cross-site block appears **once**.
20. N-site: with ≥3 sites in the fixture, every site appears in the `90` summary
    rows / energy table and (where it has a snapshot) the `91` rack tables.
21. Single-site scope → cross-site block/sheets omitted, not an error.

**Dashboard**
22. Production Dashboard toolbar exposes PDF / Excel / CSV.
23. Production Dashboard does **not** expose PNG (`exportDashboard` param, filter-bar
    `exportFormats`, no "requires the Desktop app" string); update
    `test-web-clean-v1-dashboard-parity.ts:18` regex.
24. No dead web PNG handler branch remains.

**Image**
25. Rack Unit image export path intact (`data:image/png` embed still asserted).
26. Dashboard PNG removal doesn't break image MIME handling (`imageValidation`,
    `reportSafety` allowlist, server storage content-types unchanged).

**Language (D5 / §12a)**
27. Fresh state (no language key) → `lang === "en"`; stored `"th"` → `"th"`;
    stored garbage → `"en"`. Desktop `DEFAULT_CONFIG.language === "en"`, a config
    with `language: "th"` still restores Thai. Update the `normalizeLanguage`
    assertions in `test-web-clean-v1-theme.ts` / `-settings-recovery.ts`.

**Also:** run `validateReportHtml` over the redesigned web All-Facilities +
Current-Facility HTML in a new test (currently only the Desktop output is validated).

---

## 17. Sample artifacts + reviews (Parts 28–30)

Generate from test fixtures / safe preview data into
`dist-electron/test-work/export-ui-parity/` (git-ignored; not committed):

- Current Facility: PDF, XLSX, HTML, CSV
- All Facilities: PDF, XLSX, HTML, CSV

**PDF visual review:** render via the existing Electron `printToPDF` harness
(`scripts/run-all-report-pdf-test.mjs` pattern) or html2canvas path; inspect every
page for clipping / overlap / invisible text / broken page breaks / cut charts or
tables / header-detached-from-table / stretched images / wrong site or month /
blank pages / inconsistent typography or KPI formatting. Use the `frontend-visual-qa`
skill for the rendered-artifact pass. Report: page count, section order, no-data
presentation, page breaks.

**Excel review:** open programmatically (ExcelJS) + spot-check visually. Verify sheet
names / order / count, presentation-before-raw placement, cell types, number formats,
percentages, widths, frozen panes, charts, no accidental blanks, no wrong site/month.

---

## 18. Data reconciliation (Part 31)

Produce a table `Metric | UI Source | PDF | Excel | Result` for at least:

- Energy: Building Energy, Building Cost, Floor Energy, Floor Cost, Average Rate, Floor Share
- Rack: Total, In Use, Available, Reserved, Pending Decommission
- Rack Unit: Total U, Used U, Available U, Usage %, Availability %

Same-source values must match across formats; any difference must have a documented
formatting-only reason or UAT fails.

---

## 19. Performance (Part 32)

- After removing the `comparison` scope, keep exactly: `allFacilitiesCacheRef`
  (key `periodIdentity:selectedMonth:rack|logs:image|no-image`), `comparisonCacheRef`
  (now consumed by the All Facilities path only, key `periodIdentity:selectedMonth:all-sites`),
  `previewCacheRef` (key `previewIdentity`).
- The All Facilities preview/export builds **one** report model per facility + one
  comparison model, reused across HTML/PDF/preview. Do not add a fetch per section.
- `loadComparison` **already** fans out the per-site `/racks` fetches with
  `Promise.all(result.sites.map(...))` (`CleanWebApp.tsx:764`) — no change needed;
  do not re-touch it.
- Verify no refetch loop from the removed `comparison` preview branch; memo/effect
  deps updated so `exportScope` change to `"all"` does not thrash caches.
- The All Facilities preview now also calls `loadComparison()`; it shares
  `comparisonCacheRef` with (previously) the comparison scope, so the added call is
  cache-served after the first build for a given `periodIdentity:contextMonth`.

---

## 20. Implementation phasing & commits

One branch, focused commits, **no merge**.

| # | Commit (Conventional Commits) | Contents |
|---|---|---|
| 0 | `fix(i18n): default UI language to English when no saved preference` | §12a: `CleanWebApp.tsx:138`, `theme.ts:11` `normalizeLanguage`, Desktop `App.tsx:193`, `config.ts:49`. `normalizeLanguage` assertion updates in `test-web-clean-v1-theme.ts` / `-settings-recovery.ts` + new acceptance test. Isolated so it can be reviewed/reverted alone. |
| 1 | `refactor(exports): consolidate report scopes to current + all` | `ExportScope` 2-member; remove `comparison` card/copy/filenames; Live Preview simplification (`all` branch also builds the comparison model); introduce `SiteComparisonReportModel` + `buildSiteComparisonReportModel`; add `ExportFacility.siteCode`; delete orphaned popup/`print*` family + dead helpers (`parseCsvLine`, `monthSet`) + their tests. **No visual redesign yet** — `buildAllFacilitiesReportHtml` still emits per-facility covers here; cross-site block wired but rendered via a thin adapter over existing 2-site pages. |
| 2 | `feat(reports): split site-comparison registry section in two` | `site-energy-comparison` + `site-rack-comparison` ids + titles; `data-report-section` attributes on every report page; `buildReportBodyPages` extraction + `buildReportHtml({sections, includeCover})`; replace `filterReportHtmlBySections` with `filterReportBodySections`. Run `test:all-report` — rendered text unchanged. |
| 3 | `feat(exports): rebuild PDF template for app UI parity` | One All-Facilities cover + `facility-band` pages; dedicated `buildCrossSiteComparisonPages(model, sections)` (4 energy charts, all-sites energy table, per-site summary cards + zone/details/positions + rack-unit cards, Trend Note) — **no empty placeholder pages**; terminology alignment ("Site Rack Capacity & Availability Comparison", "Pending Decommission"). |
| 4 | `feat(exports): rebuild Excel workbook for app UI parity` | `01`–`07` presentation sheets in app order; `workbookForFacilities(facilities, comparison?)` emits `90`/`91` from the shared model; raw sheets after; titles / freeze panes / widths / number formats; remove `workbookForSiteComparison` + standalone `exportSiteComparison*`. |
| 5 | `fix(dashboard): remove PNG web export` | `UniversalFilterBar` `exportFormats` prop; `CleanWebApp` `exportDashboard` narrowing + branch + message removal; parity test update. |
| 6 | `test(exports): scope, order, reconciliation, PNG-removal, N-site coverage` | All new/updated tests from §16 (incl. §16.0 split + positive comparison regression + N-site + language acceptance); register new scripts in `test:phase3`. |
| 7 | `docs(exports): sync report/export docs` | Update `docs/web-clean-v1/DESKTOP_WEB_PARITY_AUDIT.md` and any doc describing the 3-scope model / dashboard PNG parity / default language. `PROJECT_STATE.md` / `CHANGELOG.md` as applicable. |

(Split may be adjusted if a different grouping is cleaner; commits stay focused.
The design doc's own follow-up revision commit is `docs(exports): revise design per
PO review`.)

Nav label rename (D4) lands in commit 2 (registry/headings) plus the
`CleanWebApp.tsx:492` nav array. Language default (D5) is commit 0.

---

## 21. Full gates (Part 34)

Run and pass, no new exemptions:

```
git diff --check
npm run lint
npm run validate:formatting
npm run build
npm run test:api
npm run test:phase3
npm run test:web-clean-v1-exports
npm run test:all-report
npm run test:all-report:pdf
node node_modules/tsx/dist/cli.mjs scripts/test-rack-unit-capacity.ts
```

plus every new focused export-template test.

## 22. Review gates (Part 35)

RTK (architecture / data-flow / source parity / stale code / scope), `caveman`
(regression / edge cases), `ponytail` (maintainability / duplication), PDF reviewer
(artifact quality), Excel reviewer (workbook quality), final release reviewer (scope
completeness). Resolve real blocking findings before commit.

---

## 23. Open risks

| Risk | Mitigation |
|---|---|
| `scripts/test-all-report.ts` pins the **Desktop** single-facility PDF order very tightly (trend-page counts, blacklist). Adding `data-report-section` attributes must not change rendered text those assertions match. | Attributes are additive on the wrapping `<section>`; text content unchanged. Run `test:all-report` after every reportHtml edit. |
| All-sites rack comparison generalises a today-2-site layout (`rackComparisonPage` self/sibling donuts). | Web All-Facilities uses a **new** `buildCrossSiteComparisonPages` (per-site summary cards + zone/details/positions + rack-unit cards, N sites) built from `SiteComparisonReportModel` (§7.5). The 2-site `rackComparisonPage`/`comparisonPage`/`rackUnitComparisonPage` stay untouched for the Desktop path. No shared-behaviour drift because the model is the single input. |
| **N-site model duplication** — energy/rack metric shaping could get re-implemented in the HTML builder, the Excel builder, and the CSV builder. | One `buildSiteComparisonReportModel` produces `SiteComparisonReportModel`; HTML/PDF, Excel `90`/`91`, and `siteComparisonExportSections`/`buildSiteComparisonCsv` all consume it. `ponytail` review gate checks for duplication. |
| Excel sheet renames break tests asserting exact sheet names (`test-web-clean-v1-exports.ts:85`). | Update those assertions in commit 4/6; keep the underlying section names (`RACK_CAPACITY_SUMMARY` …) stable, only add the `NN ` ordering prefix + presentation sheets. |
| `printToPDF` harness is Desktop-only (`buildReportData` from `.xlsm`); web PDF is html2canvas. | Sample web artifacts via the web `exportReportPdfFromHtml` path in a headless context, or accept HTML-structure review + `validateReportHtml` as the automated gate and do the visual pass on the html2canvas output. |
| Benchmark/Forecast excluded — a stakeholder may expect them. | D2 is explicit and matches the existing PDF blacklist. Documented in §4.2 / §24. |
| **Default-language flip** (§12a) changes `normalizeLanguage` semantics — `test-web-clean-v1-theme.ts` / `-settings-recovery.ts` assert the old `→ "th"` default. | Commit 0 is isolated and updates those assertions + adds an acceptance test; a stored `"th"` preference is still honoured so real users who chose Thai are unaffected. Desktop existing config files unchanged. |
| `test-all-report.ts` counts `class="page trend-page"` (`= 7 + comparisonEligible*2`) — a `data-report-section` on `<section class="page trend-page">` is fine, but adding a class or reordering is not. | Only add the attribute; never touch `class` or page order on the Desktop path. |

---

## 24. Pages intentionally excluded (Part 37-F)

| Excluded | Reason |
|---|---|
| Data Entry | CRUD only — mirror analytical content, not entry controls. |
| Settings | Configuration only. |
| User Management | Admin CRUD only. |
| Dashboard → Benchmark View | Derived PUE benchmarking + hard-coded advice; `PUE` is forbidden in report HTML (`reportSafety.ts`); already blacklisted by `test-all-report.ts`. (D2) |
| Dashboard → Forecast View | Statistical projection (linear regression + confidence band); not source-of-truth data; already blacklisted. (D2) |
| SmartInsightPanel / Benchmark "Actionable Insights" | Advisory narrative prose, not tabular/analytical data. |
| Dashboard `UniversalFilterBar` controls TREND / CATEGORY / UPS GROUP / COMPARE | They filter the on-screen Executive/Engineering views but are **not carried into any export** (Dashboard-toolbar export uses only `activeMonth` + fixed `["dashboard"]`; Reports export ignores them). Shown as resolved context only — see §13. |
| CRUD controls anywhere (Save / Edit / Delete / uploaders / nav / admin) | Report is a representation of analytical/display UI only. |

---

## 25. Deliverable checklist mapped to Part 37

A audit §4 · B RTK findings §5 · C mapping §15 · D PDF order §7 · E Excel order §8 ·
F exclusions §24 · G two scopes §6 · H All Facilities has both comparisons §6.3/§7.2 ·
I Current Facility excludes cross-site §6.2 · J toolbar PDF|EXCEL|CSV §12 ·
K PNG removed safely §12 · L files changed (produced at implementation) ·
M/N sample reviews §17 · O reconciliation §18 · P tests §16 · Q gates §21 ·
R skill reviews §22 · S branch (`feat/export-report-ui-parity`) · T commit SHAs (impl) ·
U working tree (impl) · V Preview UAT checklist (impl, from §17 + §18).
