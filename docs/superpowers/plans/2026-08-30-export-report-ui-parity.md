# Export / Report UI-Parity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Production web Exports & Report experience so PDF and Excel mirror the current app UI, with two export scopes (Current Facility, All Facilities), both cross-site comparisons living inside All Facilities, and Dashboard PNG export removed.

**Architecture:** All work is in the web runtime `src/web-clean-v1/` plus the shared report renderer `src/reports/pdf/reportHtml.ts` and the section registry `src/reporting/`. The single-facility HTML report is factored into `buildReportBodyPages` (cover-less page sequence) so `buildAllFacilitiesReportHtml` can emit one cover + one facility band per site + one trailing cross-site block. A new `SiteComparisonReportModel` is the single N-site input consumed identically by HTML/PDF, Excel, and CSV. Desktop (`src/App.tsx`, `src/reports/reportDataBuilder.ts`, `scripts/test-all-report*.ts`) keeps its existing 2-site behaviour untouched — new markup is additive only.

**Tech Stack:** TypeScript, React 18, Vite, ExcelJS + JSZip (OOXML chart injection), hand-built inline SVG charts, `node --test` / `tsx` test scripts, jsPDF + html2canvas for web PDF.

**Design spec:** `docs/superpowers/specs/2026-08-30-export-report-ui-parity-design.md` (§ references below point there).

## Global Constraints

- **Branch:** `feat/export-report-ui-parity` (already cut from `origin/main` @ `5edaffc`). **Never merge.** No tags/releases. Commit only the changes each task names.
- **No** schema / migrations / RLS / Supabase Production data / Vercel env / auth / WebV3 changes. No Production data writes. No secrets in report output or logs.
- **No new dependencies.** Charts stay hand-built inline SVG in `reportHtml.ts`; Excel charts stay the JSZip-injected OOXML approach in `excelDashboard.ts`.
- **SweetAlert2 only** for UI feedback — do not add `alert()` / ad-hoc banners. The Reports view's existing transient status line stays.
- **GMT+7 formatter** for any user-facing timestamp (`formatTimestamp` / `formatWebSavedTimestamp`). Never raw `Date.toLocaleString()`.
- **Number-formatting gate** (`scripts/validate-number-formatting.mjs`): no `.toFixed(` / `.toLocaleString(` / `Intl.NumberFormat(` in `src/components/**` (whitelist: `TrendLineChart.tsx`). Report/export code under `src/reports/**` and `src/web-clean-v1/**` uses its own helpers: `formatNumber` (2 dp), `formatFixedNumber(v,0)` (0 dp counts), `formatFixedPercentage(v,1)` / `formatUsagePercent1` / `formatRatioPercent1` (1 dp %). Keep using those.
- **Report terminology (verbatim):** cross-site rack page heading = `Site Rack Capacity & Availability Comparison`. Rack status stored `Pending Dismantle` is displayed/exported as `Pending Decommission` everywhere on the comparison surfaces. Rack Unit non-percent = 0 decimals; percent = exactly 1 decimal. `RACK_UNIT_CAPACITY_TREND_NOTE` (from `src/reports/reportTypes.ts:6`) is byte-identical across every surface.
- **Do not regress:** the Site Energy & Cost per-site month filter `item.months.filter(entry => selectedReportMonthSet.has(entry.month))` (`CleanWebApp.tsx:769`, commit `824e3d4`); Rack Capacity exact-month snapshot semantics (no latest fallback); Rack Positions contract (no In Use rows; CSV cols `Site · Snapshot Month · Status · Rack ID · Cabinet Size (cm) · Detail`); Monthly Rack Unit Capacity Image hydration (exact site/month, no fallback, no delete on numeric-only save).
- **Do NOT touch** these tests except where a task explicitly says so: `scripts/test-all-report.ts`, `scripts/test-all-report-pdf.ts` (Desktop contract — additive `data-report-section` markup must not change the text they match). Never change `class` attributes or page order on the Desktop `buildReportHtml` path.
- **Gate suite** (must pass at the end of every phase that touches code):
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
- **Commit messages:** Conventional Commits, and end every commit body with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
  ```
- Windows dev box, Git Bash available. `tsx` CLI at `node_modules/tsx/dist/cli.mjs`. Run single web test scripts with `node node_modules/tsx/dist/cli.mjs scripts/<name>.ts`.

---

## Phase 0 — Default UI language = English

Independent, ships alone. One commit: `fix(i18n): default UI language to English when no saved preference`.

### Task 0.1: Flip the language default, keep a saved "th" honoured

**Files:**
- Modify: `src/web-clean-v1/theme.ts:11`
- Modify: `src/web-clean-v1/CleanWebApp.tsx:138`
- Modify: `src/App.tsx:193`
- Modify: `src/electron/config.ts:49`
- Modify: `scripts/test-web-clean-v1-theme.ts` (assertions on `normalizeLanguage`)
- Create: `scripts/test-web-clean-v1-language-default.ts`
- Modify: `package.json` (add the new script to the `test:phase3` list)

**Interfaces:**
- Produces: `normalizeLanguage(value: string | null): AppLanguage` — unchanged signature; new semantics: returns `"th"` **iff** `value === "th"`, otherwise `"en"`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-web-clean-v1-language-default.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLanguage } from "../src/web-clean-v1/theme";

let checks = 0;
const check = (name: string, cond: boolean) => { assert.ok(cond, name); checks++; };

// normalizeLanguage: English is the default for null / unknown; a saved "th" is honoured.
check("null -> en", normalizeLanguage(null) === "en");
check("unknown -> en", normalizeLanguage("xx") === "en");
check("empty -> en", normalizeLanguage("") === "en");
check("'en' -> en", normalizeLanguage("en") === "en");
check("'th' -> th (honoured)", normalizeLanguage("th") === "th");

// Web app initialises to English.
const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
check("CleanWebApp lang state defaults to en",
  /const \[lang, setLang\] = useState<AppLanguage>\("en"\)/.test(app));

// Desktop initialises to English and its DEFAULT_CONFIG is English.
const desktop = readFileSync("src/App.tsx", "utf8");
check("Desktop lang state defaults to en",
  /const \[lang, setLang\] = useState<"th" \| "en">\("en"\)/.test(desktop));
const cfg = readFileSync("src/electron/config.ts", "utf8");
check("DEFAULT_CONFIG.language is en", /language:\s*"en"/.test(cfg));

// A user who explicitly saved Thai still restores Thai (restore effect only
// calls setLang when the stored value is non-null, and normalizeLanguage("th")==="th").
check("restore effect still respects a stored value",
  /if \(savedLanguage !== null\) setLang\(normalizeLanguage\(savedLanguage\)\)/.test(app));

console.log(`language-default: ${checks} checks passed`);
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-language-default.ts`
Expected: FAIL on the first `normalizeLanguage(null) === "en"` assertion (currently returns `"th"`).

- [ ] **Step 3: Change `normalizeLanguage`**

`src/web-clean-v1/theme.ts:11` — replace:

```ts
export function normalizeLanguage(value: string | null): AppLanguage { return value === "en" ? "en" : "th"; }
```

with:

```ts
// English is the default for a missing or unrecognised value. A preference the
// user explicitly saved as "th" is still honoured on restore.
export function normalizeLanguage(value: string | null): AppLanguage { return value === "th" ? "th" : "en"; }
```

- [ ] **Step 4: Change the web init**

`src/web-clean-v1/CleanWebApp.tsx:138` — replace `useState<AppLanguage>("th")` with `useState<AppLanguage>("en")`. Update the adjacent comment if it names Thai.

- [ ] **Step 5: Change the Desktop init + default config**

`src/App.tsx:193` — replace `useState<"th" | "en">("th")` with `useState<"th" | "en">("en")`; update the `// Language configuration (Thai by default…)` comment on the line above to `// Language configuration (English by default, with Thai toggle; a saved preference wins)`.
`src/electron/config.ts:49` — change `language: "th",` to `language: "en",`.

- [ ] **Step 6: Update the existing theme test**

In `scripts/test-web-clean-v1-theme.ts`, find every assertion about `normalizeLanguage` (search for `normalizeLanguage`). Any that expects `null` / unknown → `"th"` becomes `→ "en"`; keep/adjust one that a stored `"th"` → `"th"`. If the file only checks theme and not language, add:

```ts
check("normalizeLanguage: default is English", normalizeLanguage(null) === "en");
check("normalizeLanguage: stored Thai preserved", normalizeLanguage("th") === "th");
```

(import `normalizeLanguage` alongside the existing `normalizeTheme` import).

- [ ] **Step 7: Register the new script**

`package.json` — in the `test:phase3` script value, add ` scripts/test-web-clean-v1-language-default.ts` to the space-separated list (next to `scripts/test-web-clean-v1-theme.ts`).

- [ ] **Step 8: Run the new test + theme test + phase3 subset**

Run:
```
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-language-default.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-theme.ts
```
Expected: both PASS.

- [ ] **Step 9: Lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/web-clean-v1/theme.ts src/web-clean-v1/CleanWebApp.tsx src/App.tsx src/electron/config.ts scripts/test-web-clean-v1-theme.ts scripts/test-web-clean-v1-language-default.ts package.json
git commit -m "$(cat <<'EOF'
fix(i18n): default UI language to English when no saved preference

normalizeLanguage now returns English for a missing or unrecognised stored
value; a preference the user explicitly saved as "th" is still honoured on
restore. Web and Desktop language state initialise to English and
DEFAULT_CONFIG.language is "en"; existing portable config files are unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 1 — Consolidate export scopes to Current Facility + All Facilities

One commit at the end of the phase: `refactor(exports): consolidate report scopes to current + all`.
This phase wires the new N-site model and 2-scope UI **without** the visual redesign — the cross-site block is rendered through a thin adapter over the existing `buildSiteComparisonReportHtml` so behaviour is preserved and tests stay green. Phase 3 replaces the adapter with the real layout.

### Task 1.1: `SiteComparisonReportModel` + `buildSiteComparisonReportModel`

**Files:**
- Modify: `src/web-clean-v1/exports.ts` (add types + builder near the existing `SiteComparisonExport` at line 104)
- Test: `scripts/test-web-clean-v1-exports.ts` (extend)

**Interfaces:**
- Consumes: `SiteComparisonExport` (`exports.ts:104`), `ComparisonMetric` (`:90`), `RackCapacityReport` (`src/reports/reportTypes.ts`).
- Produces:
  ```ts
  export interface SiteComparisonReportSite {
    label: string;
    siteCode: string;
    metrics: ComparisonMetric | null;                       // reference-month
    metricsByMonth: Record<string, ComparisonMetric | null>; // every month in `months`
    rack: RackCapacityReport | null;                        // exact reference-month snapshot
    rackUnit: Array<{ month: string; totalU: number; usedU: number; availableU: number;
                      usagePercent: number | null; availabilityPct: number | null }>;
  }
  export interface SiteComparisonReportModel {
    referenceMonth: string;
    months: string[];                                        // sorted, ascending, <= referenceMonth
    sites: SiteComparisonReportSite[];                       // ALL sites, sorted by label then implicit input order
  }
  export function buildSiteComparisonReportModel(
    data: SiteComparisonExport, referenceMonth: string,
  ): SiteComparisonReportModel;
  ```

- [ ] **Step 1: Write the failing test** (append to `scripts/test-web-clean-v1-exports.ts`, before the final summary `console.log`)

```ts
// --- SiteComparisonReportModel (N-site shared input) ---
import { buildSiteComparisonReportModel } from "../src/web-clean-v1/exports";
{
  const raw = {
    displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
    months: ["2026-05", "2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" },
        months: [
          { month: "2026-05", metrics: null },
          { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } },
        ],
        rackUnitCapacity: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, usagePercent: 75 }] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" },
        months: [
          { month: "2026-05", metrics: { buildingEnergy: 80, buildingCost: 360, floorEnergy: 30, floorCost: 135, avgRate: 4.5, floorShare: 37.5 } },
          { month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } },
        ],
        rackUnitCapacity: [] },
    ],
  } as any;
  const model = buildSiteComparisonReportModel(raw, "2026-06");
  check("model reference month", model.referenceMonth === "2026-06");
  check("model months ascending & <= ref", JSON.stringify(model.months) === JSON.stringify(["2026-05", "2026-06"]));
  check("model has all sites", model.sites.length === 2);
  check("siteCode carried from server DTO", model.sites[0].siteCode === "rangsit" && model.sites[1].siteCode === "srinakarin");
  check("reference-month metrics resolved", model.sites[0].metrics?.buildingEnergy === 100);
  check("missing month metrics stay null (no fabrication)", model.sites[0].metricsByMonth["2026-05"] === null);
  check("metricsByMonth covers every month", Object.keys(model.sites[1].metricsByMonth).sort().join(",") === "2026-05,2026-06");
  check("rackUnit availabilityPct backfilled as ratio", Math.abs((model.sites[0].rackUnit[0].availabilityPct ?? -1) - 50 / 200) < 1e-9);
  check("site with no rackUnit -> empty array", model.sites[1].rackUnit.length === 0);
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts`
Expected: FAIL — `buildSiteComparisonReportModel` is not exported.

- [ ] **Step 3: Implement the type + builder** in `src/web-clean-v1/exports.ts`, immediately after the `SiteComparisonExport` interface (line 104-111):

```ts
export interface SiteComparisonReportSite {
  label: string;
  siteCode: string;
  metrics: ComparisonMetric | null;
  metricsByMonth: Record<string, ComparisonMetric | null>;
  rack: RackCapacityReport | null;
  rackUnit: Array<{ month: string; totalU: number; usedU: number; availableU: number;
                    usagePercent: number | null; availabilityPct: number | null }>;
}
export interface SiteComparisonReportModel {
  referenceMonth: string;
  months: string[];
  sites: SiteComparisonReportSite[];
}

/** The single N-site comparison shape consumed identically by the HTML/PDF
 *  renderer, the Excel `90`/`91` sheet builders, and the CSV section builder.
 *  Built once from the `/site-comparison` DTO (already Global-Display-Period
 *  scoped). No value is ever fabricated: a month a site has no metrics for
 *  stays `null`; `availabilityPct` is the persisted ratio or `availableU/totalU`,
 *  never a filled zero. */
export function buildSiteComparisonReportModel(
  data: SiteComparisonExport,
  referenceMonth: string,
): SiteComparisonReportModel {
  const months = [...data.months].filter(m => m <= referenceMonth).sort();
  const sites: SiteComparisonReportSite[] = data.sites.map(site => {
    const byMonth: Record<string, ComparisonMetric | null> = {};
    for (const m of months) {
      byMonth[m] = site.months.find(entry => entry.month === m)?.metrics ?? null;
    }
    const rackUnit = (site.rackUnitCapacity ?? []).map(row => ({
      month: row.month,
      totalU: row.totalU,
      usedU: row.usedU,
      availableU: row.availableU,
      usagePercent: row.usagePercent ?? (row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null),
      availabilityPct: row.availabilityPct ?? (row.totalU > 0 ? row.availableU / row.totalU : null),
    }));
    return {
      label: site.site.name,
      siteCode: site.site.code,
      metrics: byMonth[referenceMonth] ?? null,
      metricsByMonth: byMonth,
      rack: (site as { rack?: RackCapacityReport | null }).rack ?? null,
      rackUnit,
    };
  });
  return { referenceMonth, months, sites };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Stage (no commit yet — Phase 1 commits once at the end)**

```bash
git add src/web-clean-v1/exports.ts scripts/test-web-clean-v1-exports.ts
```

### Task 1.2: Add `siteCode` to `ExportFacility` and populate it in `loadAll`

**Files:**
- Modify: `src/web-clean-v1/exports.ts:36` (`ExportFacility` interface)
- Modify: `src/web-clean-v1/CleanWebApp.tsx` (`loadAll`, ~line 736-756)
- Test: `scripts/test-web-clean-v1-exports.ts`

**Interfaces:**
- Produces: `ExportFacility.siteCode?: string` — optional; when absent the Excel builder falls back to a slug of `siteName`.

- [ ] **Step 1: Add the field**

`src/web-clean-v1/exports.ts` — in `interface ExportFacility` (line 36), add after `siteName: string;`:

```ts
  /** Facility short code (e.g. "RST"/"rangsit"), for Excel sheet prefixes and
   *  the Site code column. Falls back to a slug of `siteName` when absent. */
  siteCode?: string;
```

- [ ] **Step 2: Populate it in `loadAll`**

`src/web-clean-v1/CleanWebApp.tsx` — inside `loadAll`, the `sites.map(async site => { … return { siteName: site.name, … } })` object (around line 751): add `siteCode: site.code,` next to `siteName: site.name,`. (`site` is a `FacilitySite` from `bootstrap.sites`, which has `code`.)

- [ ] **Step 3: Add a source-string assertion** in `scripts/test-web-clean-v1-exports.ts`:

```ts
{
  const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
  check("loadAll passes siteCode to ExportFacility", /siteName:\s*site\.name,\s*siteCode:\s*site\.code/.test(app.replace(/\s+/g, " ")));
}
```

(add `import { readFileSync } from "node:fs";` at the top if not already imported.)

- [ ] **Step 4: Run + typecheck**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts && npm run lint`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/web-clean-v1/exports.ts src/web-clean-v1/CleanWebApp.tsx scripts/test-web-clean-v1-exports.ts
```

### Task 1.3: New All-Facilities builder signatures (accept the comparison model)

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — `buildAllFacilitiesCsv` (`:528`), `exportAllFacilitiesCsv` (`:532`), `exportAllFacilitiesExcel` (`:536`), `workbookForFacilities` (`:269`), `exportAllFacilitiesHtml` (`:1094`), `buildAllFacilitiesReportHtml` (`:1109`), `exportAllFacilitiesPdf` (`:1125`)
- Test: `scripts/test-web-clean-v1-exports.ts`, `scripts/test-web-clean-v1-export-feedback.ts`

**Interfaces:**
- Produces (all gain a `comparison: SiteComparisonReportModel | null` parameter; `null` ⇒ omit the cross-site block/sheets):
  ```ts
  buildAllFacilitiesCsv(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null): string
  exportAllFacilitiesCsv(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null): void
  exportAllFacilitiesExcel(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null): Promise<void>
  workbookForFacilities(facilities: ExportFacility[], comparison?: SiteComparisonReportModel | null)
  exportAllFacilitiesHtml(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): void
  buildAllFacilitiesReportHtml(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, sections?: readonly ReportSectionId[]): string
  exportAllFacilitiesPdf(facilities: ExportFacility[], comparison: SiteComparisonReportModel | null, selectedMonth: string, fileName?: string, sections?: readonly ReportSectionId[]): Promise<void>
  ```

- [ ] **Step 1: Write the failing test** — append to `scripts/test-web-clean-v1-exports.ts`:

```ts
{
  // New signatures accept a comparison model; null keeps prior single-report behaviour.
  const facilities = [{ siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] }] as any;
  const htmlNoCmp = buildAllFacilitiesReportHtml(facilities, null, "2026-06");
  check("all-facilities html builds with null comparison", htmlNoCmp.includes("<!doctype") || htmlNoCmp.includes("<!DOCTYPE"));
  const csvNoCmp = buildAllFacilitiesCsv(facilities, null);
  check("all-facilities csv builds with null comparison", csvNoCmp.includes("# Facility: Rangsit"));
}
```

- [ ] **Step 2: Run it, verify it fails** (arity / type mismatch).

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts`
Expected: FAIL (TS build error or runtime arity error).

- [ ] **Step 3: Change the signatures**

For **this task only**, thread `comparison` through as an unused-except-passthrough parameter; the actual cross-site rendering/sheets land in Task 1.5 (adapter) and Phase 3/4 (real). Concretely:

- `buildAllFacilitiesCsv(facilities, comparison)` — after the per-facility `map(buildFacilityCsv).join("\n\n")`, if `comparison` is non-null append the existing site-comparison sections built from the model (Task 1.5 provides `siteComparisonSectionsFromModel`). For now: `return blocks + (comparison ? "\n\n" + crossSiteCsvAdapter(comparison) : "");` where `crossSiteCsvAdapter` is added in Task 1.5. Until then, stub it: `const crossSiteCsvAdapter = (_m: SiteComparisonReportModel) => "";` at module scope with a `// Phase 1.5` comment.
- `exportAllFacilitiesCsv(facilities, comparison)` → `download(buildAllFacilitiesCsv(facilities, comparison), "all-facilities-energy-monitor.csv", "text/csv;charset=utf-8")`.
- `workbookForFacilities(facilities, comparison?)` — add the param; body unchanged for now.
- `exportAllFacilitiesExcel(facilities, comparison)` → `writeInteractiveExcelWorkbook(await workbookForFacilities(facilities, comparison))` then download.
- `buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections?)` — reorder params (comparison second). Body unchanged for now (per-facility `buildReportHtml` join); Task 1.5 appends the adapter block.
- `exportAllFacilitiesHtml` / `exportAllFacilitiesPdf` — reorder params to `(facilities, comparison, selectedMonth, fileName?, sections?)`, forward to `buildAllFacilitiesReportHtml`.

- [ ] **Step 4: Update the two call sites in `CleanWebApp.tsx`**

In the `cards("all", …)` handlers (around line 967) and the `exportAllFacilitiesHtml` / `exportAllFacilitiesPdf` wrappers (around line 918-919), thread a `comparison` argument. Build it once per handler:

```ts
const comparisonModel = buildSiteComparisonReportModel(await loadComparison(), contextMonth);
```

- csv: `exportAllFacilitiesCsv(await loadAll({ includeRack: true, includeImage: false }), buildSiteComparisonReportModel(await loadComparison(), contextMonth))`
- excel: same pattern with `exportAllFacilitiesExcel`
- html: `exportAllFacilitiesHtml(await loadAll({ includeRack: true, includeImage: true }), buildSiteComparisonReportModel(await loadComparison(), contextMonth), contextMonth)`
- pdf: same with `exportAllFacilitiesPdf`

Import `buildSiteComparisonReportModel` in the `exports` import block at `CleanWebApp.tsx:18`.

- [ ] **Step 5: Update `test-web-clean-v1-export-feedback.ts`**

Search for `buildAllFacilitiesReportHtml(` — update any call in that test to the new param order `(facilities, null, month, …)`.

- [ ] **Step 6: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-export-feedback.ts
```
Expected: PASS.

- [ ] **Step 7: Stage**

```bash
git add src/web-clean-v1/exports.ts src/web-clean-v1/CleanWebApp.tsx scripts/test-web-clean-v1-exports.ts scripts/test-web-clean-v1-export-feedback.ts
```

### Task 1.4: `ExportScope` → 2 members; remove the comparison card + copy

**Files:**
- Modify: `src/web-clean-v1/CleanWebApp.tsx` — `type ExportScope` (`:630`), `exportStageLabel` (`:635`), `reportCopy` th/en objects (`:693`, `:696`), the `cards("comparison", …)` call and its filename constants (`:967`), `previewContextLabel` (`:893-897`), the scoped-preview effect `comparison` branch (`:859-892`)
- Test: `scripts/test-web-clean-v1-export-feedback.ts`, `scripts/test-web-clean-v1-reports.ts`, `scripts/test-web-report-preview.ts`

**Interfaces:**
- Produces: `type ExportScope = "current" | "all"`.

- [ ] **Step 1: Update the failing tests first**

`scripts/test-web-clean-v1-export-feedback.ts` — change the assertion at line ~11:

```ts
check("ExportScope has exactly current + all",
  /type ExportScope = "current" \| "all"/.test(app) &&
  !/["']comparison["']/.test(app.match(/type ExportScope[^\n]*/)?.[0] ?? ""));
check("useState default scope is current", /useState<ExportScope>\("current"\)/.test(app));
check("no standalone Site Energy & Cost Comparison export card",
  !/reportCopy\.comparison/.test(app) && !/cards\("comparison"/.test(app));
```

`scripts/test-web-clean-v1-reports.ts` — remove/replace the three-scope filename assertions (search `site-comparison-`); assert instead:

```ts
check("all-facilities filenames present", /all-facilities-energy-monitor\.(csv|xlsx|html|pdf)/.test(app));
check("no site-comparison scope filenames", !/site-comparison-\$\{contextMonth\}/.test(app));
```

`scripts/test-web-report-preview.ts` — the `overrideHtml` / scope-routing assertion: replace the `comparison`→`buildSiteComparisonReportHtml` expectation with:

```ts
check("preview override only for the all scope",
  /overrideHtml=\{exportScope === "current" \? null : scopedPreview\?\.html \?\? null\}/.test(app));
check("no comparison preview branch",
  !/exportScope === "comparison"/.test(app) && !/buildSiteComparisonReportHtml/.test(app));
```

- [ ] **Step 2: Run the tests, verify they fail**

Run:
```
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-export-feedback.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-reports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-report-preview.ts
```
Expected: FAIL.

- [ ] **Step 3: Narrow the type**

`CleanWebApp.tsx:630` — `type ExportScope = "current" | "all" | "comparison";` → `type ExportScope = "current" | "all";`

- [ ] **Step 4: Fix `exportStageLabel`**

`CleanWebApp.tsx:635` — the function body branches on `scope === "all"`. No change needed to logic, but remove any `comparison` mention if present. Verify it still compiles with the narrower type.

- [ ] **Step 5: Remove the comparison copy keys**

In both `reportCopy` objects (`:693` th, `:696` en) delete the `comparison:` and `comparisonDesc:` entries. (Leave `all` / `allDesc`.)

- [ ] **Step 6: Remove the comparison card + preview branch**

- `CleanWebApp.tsx:967` — delete the third `cards("comparison", reportCopy.comparison, reportCopy.comparisonDesc, { … }, { … })` invocation entirely (the `{ csv: … pdf: … }` handler object and the `site-comparison-${contextMonth}.*` filename object with it).
- Change the wrapping grid class from `xl:grid-cols-3` to `xl:grid-cols-2` (search `xl:grid-cols-3` in that `<div className="mt-4 grid gap-4 …">`).
- Scoped-preview effect (`:859-892`): delete the `else { // comparison }` branch; keep `if (exportScope === "all")`. The effect's `if (exportScope === "current") { setScopedPreview(null); … return; }` guard stays.
- `previewContextLabel` (`:893-897`): drop the `: exportScope === "all" ? … : \`${reportCopy.comparison} · ${contextMonth}\`` tail — becomes a plain ternary `exportScope === "current" ? currentLabel : allLabel`.
- Remove now-unused imports from the `exports` import (`:18`): `buildSiteComparisonReportHtml`, `exportSiteComparisonCsv`, `exportSiteComparisonExcel`, `exportSiteComparisonHtml`, `exportSiteComparisonPdf as exportSiteComparisonPdfFile`, and the local `exportSiteComparisonPdf` wrapper (`:920`). Also `loadComparison` stays (used by the `all` path now).

- [ ] **Step 7: Run the tests + phase3 web subset**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-export-feedback.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-reports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-report-preview.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
```
Expected: PASS.

- [ ] **Step 8: Stage**

```bash
git add src/web-clean-v1/CleanWebApp.tsx scripts/test-web-clean-v1-export-feedback.ts scripts/test-web-clean-v1-reports.ts scripts/test-web-report-preview.ts
```

### Task 1.5: Cross-site adapter (behaviour-preserving) + wire it into All Facilities

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — add `siteComparisonSectionsFromModel`, `crossSiteCsvAdapter`, and a cross-site HTML fragment adapter; wire into `buildAllFacilitiesCsv`, `workbookForFacilities`, `buildAllFacilitiesReportHtml`
- Test: `scripts/test-web-clean-v1-exports.ts`

**Interfaces:**
- Consumes: `SiteComparisonReportModel` (Task 1.1), the existing `siteComparisonExportSections(data: SiteComparisonExport, referenceMonth)` (`:570`), `buildSiteComparisonReportHtml` internals.
- Produces:
  ```ts
  // internal, not exported
  function siteComparisonSectionsFromModel(model: SiteComparisonReportModel): ExportTableSection[]
  function crossSiteReportPagesAdapter(model: SiteComparisonReportModel, sections?: readonly ReportSectionId[]): string  // returns "<section class='page' data-report-section='site-energy-comparison'>…" pages
  ```

**Note:** This task keeps the *existing* 2-site energy/rack page markup (via a `SiteComparisonExport`-shaped view of the model) so no test regresses. Phase 3 (Task 3.2/3.3) replaces `crossSiteReportPagesAdapter` with the N-site layout.

- [ ] **Step 1: Write the failing test**

```ts
{
  const facilities = [
    { siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] },
    { siteName: "Srinakarin", siteCode: "srinakarin", logs: [log("2026-06")] },
  ] as any;
  const model = buildSiteComparisonReportModel({
    displayPeriod: { startMonth: "2026-06", endMonth: "2026-06" },
    months: ["2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } }], rackUnitCapacity: [] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } }], rackUnitCapacity: [] },
    ],
  } as any, "2026-06");
  const html = buildAllFacilitiesReportHtml(facilities, model, "2026-06");
  check("all-facilities html includes the energy comparison heading", html.includes("Site Comparison") || html.includes("Site Energy"));
  check("all-facilities html tags a cross-site energy section", html.includes('data-report-section="site-energy-comparison"'));
  const csv = buildAllFacilitiesCsv(facilities, model);
  check("all-facilities csv appends SITE_COMPARISON section", csv.includes("# Section: SITE_COMPARISON"));
  check("all-facilities csv keeps a per-facility block", csv.includes("# Facility: Rangsit"));
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement the adapters** in `exports.ts`:

```ts
/** Phase 1 adapter: view the N-site model through the existing
 *  SiteComparisonExport shape so the current section/HTML builders can consume
 *  it unchanged. Phase 3/4 replace this with the real N-site layout. */
function modelAsSiteComparisonExport(model: SiteComparisonReportModel): SiteComparisonExport {
  return {
    displayPeriod: { startMonth: model.months[0] ?? model.referenceMonth, endMonth: model.referenceMonth },
    months: model.months,
    sites: model.sites.map(site => ({
      site: { id: 0, code: site.siteCode, name: site.label },
      months: model.months.map(m => ({ month: m, metrics: site.metricsByMonth[m] ?? null })),
      rack: site.rack ?? null,
      rackUnitCapacity: site.rackUnit.map(r => ({
        month: r.month, totalU: r.totalU, usedU: r.usedU, availableU: r.availableU,
        usagePercent: r.usagePercent ?? undefined, availabilityPct: r.availabilityPct ?? undefined,
      })),
    })),
  };
}

function siteComparisonSectionsFromModel(model: SiteComparisonReportModel): ExportTableSection[] {
  return siteComparisonExportSections(modelAsSiteComparisonExport(model), model.referenceMonth);
}

function crossSiteReportPagesAdapter(model: SiteComparisonReportModel, sections?: readonly ReportSectionId[]): string {
  // Reuse the existing 2-site report body, then re-tag its comparison pages with
  // data-report-section so Phase 2's attribute filter keeps them.
  const view = modelAsSiteComparisonExport(model);
  const [primary, secondary] = model.sites;
  const selfRack = primary?.rack ?? null;
  const otherRack = secondary?.rack ?? null;
  const full = buildSiteComparisonReportHtml(view, model.referenceMonth, selfRack, otherRack, sections);
  // Slice out just the <section class="page"> comparison pages (drop cover + head + script).
  const bodyStart = full.indexOf("</main>") + "</main>".length;
  const scriptStart = full.indexOf('<script>document.body.dataset.reportReady="true";</script>');
  return full.slice(bodyStart, scriptStart)
    .replace(/<section class="page"/g, '<section class="page" data-report-section="site-energy-comparison"');
}
```

Then:
- `buildAllFacilitiesCsv(facilities, comparison)`: replace the earlier `crossSiteCsvAdapter` stub with
  `const cross = comparison ? "\n\n" + siteComparisonSectionsFromModel(comparison).map(s => "# Section: " + s.name + "\n" + csvSection(s)).join("\n\n") : "";`
  and `return blocks + cross;`.
- `buildAllFacilitiesReportHtml(facilities, comparison, selectedMonth, sections?)`: after the per-facility `.join(...)` of report bodies, before the closing wrapper, insert `comparison ? crossSiteReportPagesAdapter(comparison, sections) : ""`. (Exact insertion point per the current template-literal structure at `:1109-1118`.)
- `workbookForFacilities(facilities, comparison?)`: after the per-facility sheets loop, `if (comparison) { for (const section of siteComparisonSectionsFromModel(comparison)) addTableSheet(workbook, "Comparison", section.name, section.headers, section.rows); }`.

- [ ] **Step 4: Run + full web export test + all-report (Desktop unaffected).**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-export-feedback.ts
npm run test:all-report
```
Expected: PASS.

- [ ] **Step 5: Stage.**

### Task 1.6: Delete the orphaned popup/`print*` family and dead helpers

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — remove `openReportPopup` (`:901`), `renderReportErrorPopup` (`:919`), `renderReportPopup` (`:931`), `printDesktopPdf` (`:951`), `printSiteComparisonPdf` (`:1046`), `printAllFacilitiesPdf` (`:1131`), `popupStatusHtml`, `writePopupDocument`, `siteComparisonReportForDownload` (`:1006`), `buildSiteComparisonReportHtml` (`:1120`), `exportSiteComparisonCsv/Excel/Html/Pdf`, `workbookForSiteComparison`, and dead helpers `parseCsvLine` (`:132`), `monthSet` (`:173`)
- Modify: `scripts/test-web-clean-v1-exports.ts`, `scripts/test-web-clean-v1-dashboard-fixes.ts` — remove assertions referencing the deleted popup functions
- Modify: `scripts/test-web-clean-v1-pdf-capture.ts` — keep (it asserts `exports.ts` internal PDF rasterization, unrelated)

**⚠ Ordering:** `crossSiteReportPagesAdapter` (Task 1.5) calls `buildSiteComparisonReportHtml`. Before deleting it, **inline** the small amount it needs: `buildSiteComparisonReportHtml` = `buildReportHtml(siteComparisonReportForDownload(data, referenceMonth, selfRack, otherRack), sections)`. Move `siteComparisonReportForDownload` to a private `buildTwoSiteComparisonReportData(...)` kept **only** for the adapter until Phase 3 removes the adapter. Do NOT delete `siteComparisonReportForDownload`'s logic yet — rename it private and keep it.

- [ ] **Step 1: Grep every reference**

Run: `grep -rn "openReportPopup\|renderReportPopup\|renderReportErrorPopup\|printDesktopPdf\|printSiteComparisonPdf\|printAllFacilitiesPdf\|workbookForSiteComparison\|exportSiteComparisonCsv\|exportSiteComparisonExcel\|exportSiteComparisonHtml\|exportSiteComparisonPdf\|parseCsvLine\|\bmonthSet\b" src/ scripts/`
Expected: references only in `src/web-clean-v1/exports.ts` and a handful of `scripts/test-web-clean-v1-*.ts`.

- [ ] **Step 2: Update the tests** — in `scripts/test-web-clean-v1-exports.ts` and `scripts/test-web-clean-v1-dashboard-fixes.ts`, delete the assertion blocks that import/reference `openReportPopup`, `renderReportPopup`, `renderReportErrorPopup`, `printSiteComparisonPdf`, `printAllFacilitiesPdf`, `exportSiteComparison*`, `workbookForSiteComparison`. Leave everything else.

- [ ] **Step 3: Delete the code** — remove the six popup/print functions, `popupStatusHtml`, `writePopupDocument`, `exportSiteComparisonCsv/Excel/Html/Pdf`, `workbookForSiteComparison`, `parseCsvLine`, `monthSet`. Rename `siteComparisonReportForDownload` → private `buildTwoSiteComparisonReportData` (still used by `crossSiteReportPagesAdapter`). Keep `buildSiteComparisonReportHtml` **only if** the adapter still calls it — otherwise inline its one line into the adapter and delete it too.

- [ ] **Step 4: Run the gate suite subset**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-dashboard-fixes.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-pdf-capture.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-report-preview.ts
npm run test:all-report
```
Expected: PASS.

- [ ] **Step 5: Full gate suite**

Run the entire Global Constraints gate suite.
Expected: PASS.

- [ ] **Step 6: Commit Phase 1**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(exports): consolidate report scopes to current + all

- Introduce SiteComparisonReportModel + buildSiteComparisonReportModel as the
  single N-site comparison input; add ExportFacility.siteCode.
- Reports page: ExportScope is now current | all; the standalone Site Energy &
  Cost Comparison card, copy, filenames, and preview branch are removed. The
  All Facilities scope now carries the cross-site comparison data.
- All-Facilities builders take a comparison model (null keeps the prior
  single-report output). Behaviour-preserving cross-site adapter in place; the
  N-site visual layout lands in a later commit.
- Delete the orphaned popup / window.print() PDF family and the dead helpers
  parseCsvLine / monthSet; remove the standalone exportSiteComparison* surface.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 2 — Section registry split + cover/body extraction

One commit: `feat(reports): split site-comparison section and extract report body pages`.

### Task 2.1: Split the `site-comparison` section id into two

**Files:**
- Modify: `src/reporting/reportingTypes.ts:12` (`ReportSectionId`)
- Modify: `src/reporting/ReportRegistry.ts` (the `sections` array)
- Test: `scripts/test-web-clean-v1-reports.ts` (or a new `scripts/test-report-registry.ts` registered in `test:phase3`)

**Interfaces:**
- Produces: `ReportSectionId` gains `"site-energy-comparison" | "site-rack-comparison"` and **loses** `"site-comparison"`. `ReportRegistry.all()` returns both new entries with titles `"Site Energy & Cost Comparison"` and `"Site Rack Capacity & Availability Comparison"`.

- [ ] **Step 1: Write the failing test** — create `scripts/test-report-registry.ts`:

```ts
import assert from "node:assert/strict";
import { ReportRegistry } from "../src/reporting/ReportRegistry";
let checks = 0;
const check = (n: string, c: boolean) => { assert.ok(c, n); checks++; };

const ids = ReportRegistry.all().map(s => s.id);
check("has site-energy-comparison", ids.includes("site-energy-comparison"));
check("has site-rack-comparison", ids.includes("site-rack-comparison"));
check("no legacy site-comparison id", !ids.includes("site-comparison" as never));
const energy = ReportRegistry.all().find(s => s.id === "site-energy-comparison");
const rack = ReportRegistry.all().find(s => s.id === "site-rack-comparison");
check("energy title", energy?.title === "Site Energy & Cost Comparison");
check("rack title", rack?.title === "Site Rack Capacity & Availability Comparison");
check("forType('site-comparison') still returns both",
  ReportRegistry.forType("site-comparison").map(s => s.id).sort().join(",") === "site-energy-comparison,site-rack-comparison");
console.log(`report-registry: ${checks} checks passed`);
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-report-registry.ts`

- [ ] **Step 3: Edit `reportingTypes.ts:12`**

```ts
export type ReportSectionId = "executive" | "dashboard" | "rack-capacity" | "rack-unit-capacity" | "ups" | "air-conditioning" | "dc" | "historical" | "site-energy-comparison" | "site-rack-comparison" | "appendix";
```

- [ ] **Step 4: Edit `ReportRegistry.ts`** — replace the single `{ id: "site-comparison", title: "Site Comparison", reportTypes: ["site-comparison", "all"] }` line with:

```ts
  { id: "site-energy-comparison", title: "Site Energy & Cost Comparison", reportTypes: ["site-comparison", "all"] },
  { id: "site-rack-comparison", title: "Site Rack Capacity & Availability Comparison", reportTypes: ["site-comparison", "all"] },
```

- [ ] **Step 5: Fix compile fallout**

Run: `npm run lint`
Fix every `site-comparison` string literal typed as `ReportSectionId` (grep `"site-comparison"` in `src/`). In `src/reports/pdf/reportHtml.ts` `filterReportHtmlBySections`, temporarily map both new ids the way `site-comparison` was mapped (Task 2.3 rewrites this function anyway).

- [ ] **Step 6: Register + run the test**

`package.json` — add `scripts/test-report-registry.ts` to `test:phase3`.
Run: `node node_modules/tsx/dist/cli.mjs scripts/test-report-registry.ts && npm run lint`
Expected: PASS.

- [ ] **Step 7: Stage.**

### Task 2.2: Extract `buildReportBodyPages`; add `includeCover` option

**Files:**
- Modify: `src/reports/pdf/reportHtml.ts` — `buildReportHtml` (`:680-707`)
- Test: `scripts/test-web-clean-v1-exports.ts` + `scripts/test-all-report.ts` must still pass unchanged

**Interfaces:**
- Produces:
  ```ts
  export function buildReportBodyPages(data: ReportData, sections?: readonly ReportSectionId[]): string
  // buildReportHtml keeps its callable shape; second arg is normalised:
  export function buildReportHtml(
    data: ReportData,
    opts?: readonly ReportSectionId[] | { sections?: readonly ReportSectionId[]; includeCover?: boolean },
  ): string
  ```
- `includeCover` defaults to `true`. A bare array second arg ⇒ `{ sections: arg, includeCover: true }`.

- [ ] **Step 1: Write the failing test** — append to `scripts/test-web-clean-v1-exports.ts`:

```ts
{
  import_facilityReportData: {} // (facilityReportData already imported in this file)
  const data = facilityReportData([log("2026-06")], "Rangsit", "2026-06");
  const withCover = buildReportHtml(data);
  const noCover = buildReportHtml(data, { includeCover: false });
  check("default build has a cover", withCover.includes('<main class="cover">'));
  check("includeCover:false drops the cover", !noCover.includes('<main class="cover">'));
  check("includeCover:false keeps the body pages", noCover.includes('<section class="page"'));
  check("bare array second arg still works (back-compat)",
    buildReportHtml(data, ["executive"]).includes('<main class="cover">'));
  const body = buildReportBodyPages(data);
  check("buildReportBodyPages returns only page sections (no doctype/head)",
    !body.includes("<!doctype") && !body.includes("<head>") && body.trim().startsWith('<section class="page"'));
}
```

(add `buildReportBodyPages` to the `../src/reports/pdf/reportHtml` import in the test.)

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Refactor `buildReportHtml`**

In `src/reports/pdf/reportHtml.ts`, split the current `buildReportHtml` (`:680`) body:

```ts
export function buildReportBodyPages(data: ReportData, selectedSections?: readonly ReportSectionId[]): string {
  const executive = executiveDashboardPage(data);
  const dashboard = data.engineeringDashboard ? engineeringDashboard(data, data.engineeringDashboard) : "";
  const executiveTrend = trendPage(/* …unchanged args… */);
  const trendPages: Array<[string, string, string, Array<number | null>, string]> = [ /* …unchanged… */ ];
  const body =
    `${executive}${executiveTrend}${dashboard}` +
    trendPages.map(([title, unit, color, values, explanation]) =>
      trendPage(title, unit, [{ name: title, color, values }], data.monthlyRows, explanation, "FACILITY TREND ANALYTICS")).join("") +
    `<section class="page"><h2>Monthly Energy &amp; Cost Table</h2>${monthlyTable(data.monthlyRows)}</section>` +
    `${comparisonPage(data)}${rackCapacityPage(data)}${renderRackUnitCapacityExecutivePage(data)}` +
    `${rackUnitComparisonPage(data)}${capacityHealthPage(data)}${rackComparisonPage(data)}`;
  return selectedSections !== undefined ? filterReportBodySections(body, selectedSections) : body;
}

export function buildReportHtml(
  data: ReportData,
  opts?: readonly ReportSectionId[] | { sections?: readonly ReportSectionId[]; includeCover?: boolean },
): string {
  const norm = Array.isArray(opts) ? { sections: opts, includeCover: true }
    : { includeCover: true, ...(opts ?? {}) };
  const range = `${formatMonth(data.historicalStart)} – ${formatMonth(data.historicalEnd)}`;
  const cover = norm.includeCover
    ? `<main class="cover"><h1>${escapeHtml(data.title)}</h1><h2>${escapeHtml(data.thaiSubtitle)}</h2><div class="meta">Facility: ${escapeHtml(data.facility)}<br>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}<br>Historical range: ${escapeHtml(range)}</div></main>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>${REPORT_CSS}</style></head><body>${cover}${buildReportBodyPages(data, norm.sections)}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}
```

Extract the giant inline `<style>…</style>` string into a module const `REPORT_CSS` (copy it verbatim from the current template — it is referenced by `buildAllFacilitiesReportHtml` in Task 3.1).

Rename `filterReportHtmlBySections` → `filterReportBodySections` and change it to operate on a **body fragment** (no cover/script slicing — it already splits on `<section class="page">`; drop the `bodyStart`/`scriptStart` slicing and just `pages = body.split(...)`, filter, `return kept.join("")`). Keep the existing keep-rules for this task (Task 2.3 switches them to attribute-based).

- [ ] **Step 4: Run the web + Desktop report tests**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
npm run test:all-report
npm run test:all-report:pdf
node node_modules/tsx/dist/cli.mjs scripts/test-rack-unit-capacity.ts
```
Expected: PASS (Desktop output byte-identical — cover default is `true`).

- [ ] **Step 5: Stage.**

### Task 2.3: `data-report-section` attributes on every page + attribute-based filter

**Files:**
- Modify: `src/reports/pdf/reportHtml.ts` — every function that emits `<section class="page">` (`executiveDashboardPage`, `trendPage`, `engineeringDashboard`, the Monthly table page, `comparisonPage`, `rackCapacityPage`, `renderRackUnitCapacityExecutivePage`, `rackUnitTrendPage`, `rackUnitComparisonPage`, `capacityHealthPage`, `rackComparisonPage`); rewrite `filterReportBodySections`
- Test: `scripts/test-web-clean-v1-report-structure.ts` (new, registered in `test:phase3`)

**Interfaces:**
- Produces: each page carries `data-report-section="<id>"`. Mapping:
  | Page (h2 text) | attribute |
  |---|---|
  | Executive Dashboard | `executive` |
  | trend pages with eyebrow `EXECUTIVE DASHBOARD · TREND ANALYTICS` | `executive` |
  | Building Energy Dashboard (both) | `dashboard` |
  | trend pages with eyebrow `FACILITY TREND ANALYTICS` | `historical` |
  | Monthly Energy & Cost Table | `appendix` |
  | Rack Capacity and Utilization | `rack-capacity` |
  | Rack Unit Capacity and Utilization / Six-Month Trend | `rack-unit-capacity` |
  | Capacity Health and Zone Heatmap | `rack-capacity` |
  | Site Comparison / comparison trend pages (eyebrow `SITE COMPARISON`) | `site-energy-comparison` |
  | Rack Unit Capacity Comparison | `site-rack-comparison` |
  | Rack Capacity Site Comparison | `site-rack-comparison` |
- `filterReportBodySections(body, sections)`: split on `(?=<section class="page)`, keep a page iff its `data-report-section` value ∈ `sections`, **or** it has no attribute (defensive: keep). Preserve order.

- [ ] **Step 1: Write the failing test** — `scripts/test-web-clean-v1-report-structure.ts`:

```ts
import assert from "node:assert/strict";
import { facilityReportData } from "../src/web-clean-v1/exports";
import { buildReportHtml, buildReportBodyPages } from "../src/reports/pdf/reportHtml";
import { createEmptyLog } from "../src/utils";

let checks = 0;
const check = (n: string, c: boolean) => { assert.ok(c, n); checks++; };
const log = (m: string) => createEmptyLog(m);

const data = facilityReportData([log("2026-05"), log("2026-06")], "Rangsit", "2026-06");

// every page tagged
const body = buildReportBodyPages(data);
const sectionMatches = [...body.matchAll(/<section class="page[^"]*" data-report-section="([a-z-]+)"/g)].map(m => m[1]);
check("every page has a data-report-section", (body.match(/<section class="page/g)?.length ?? 0) === sectionMatches.length);

// Current-Facility section order (no cross-site pages, comparison data is null)
const order = sectionMatches.filter((v, i) => i === 0 || sectionMatches[i - 1] !== v);
check("current-facility order matches spec 7.1",
  JSON.stringify(order) === JSON.stringify([
    "executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity",
  ]) || JSON.stringify(order) === JSON.stringify([
    "executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity", "rack-capacity",
  ]));
check("current facility has NO cross-site pages",
  !body.includes('data-report-section="site-energy-comparison"') &&
  !body.includes('data-report-section="site-rack-comparison"'));

// section filter keeps only selected
const onlyRack = buildReportBodyPages(data, ["rack-capacity"]);
check("filter keeps rack-capacity pages", onlyRack.includes('data-report-section="rack-capacity"'));
check("filter drops executive when not selected", !onlyRack.includes('data-report-section="executive"'));

console.log(`report-structure: ${checks} checks passed`);
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Add the attribute** to every `<section class="page …">` emitter in `reportHtml.ts`. Example for `rackCapacityPage` (`:582`): `<section class="page" data-report-section="rack-capacity">`. For `trendPage` (`:195`, `:231`): it is shared — pass the attribute in via the existing `sectionLabel` param's caller, OR add a `reportSection` param to `trendPage` and thread it from each call site (executive trend → `executive`, the 6 facility trends → `historical`, comparison trends → `site-energy-comparison`). The dashboard block (`:287`) emits **two** `<section class="page dashboard-page">` — tag both `dashboard`.

- [ ] **Step 4: Rewrite `filterReportBodySections`**

```ts
function filterReportBodySections(body: string, selectedSections: readonly ReportSectionId[]): string {
  const selected = new Set<string>(selectedSections);
  return body
    .split(/(?=<section class="page)/)
    .filter(page => page.startsWith('<section class="page'))
    .filter(page => {
      const m = page.match(/data-report-section="([a-z-]+)"/);
      return !m || selected.has(m[1]);
    })
    .join("");
}
```

- [ ] **Step 5: Register + run**

`package.json` — add `scripts/test-web-clean-v1-report-structure.ts` to `test:phase3`.
Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-report-structure.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
npm run test:all-report
npm run test:all-report:pdf
```
Expected: PASS. `test-all-report.ts` matches on `<h2>` text and `class="page trend-page"` — the added `data-report-section` attribute does not touch either.

- [ ] **Step 6: Stage.**

### Task 2.4: Nav label rename (D4)

**Files:**
- Modify: `src/web-clean-v1/CleanWebApp.tsx:492` (the `nav` array item `rack-comparison`)
- Modify: `src/reports/pdf/reportHtml.ts` — `rackComparisonPage` heading (`:539`) `<h2>Rack Capacity Site Comparison</h2>` → keep for Desktop? **No** — this heading is shared. See note.
- Test: `scripts/test-web-clean-v1-reports.ts` or `scripts/test-web-clean-v1-branding.ts`

**Note on the shared heading:** `scripts/test-all-report.ts` asserts `<h2>Rack Capacity Site Comparison</h2>` for the Desktop report. Do **not** rename that heading in `reportHtml.ts`. The renamed heading `Site Rack Capacity & Availability Comparison` is used **only** by the new N-site cross-site rack pages built in Phase 3 (`buildCrossSiteComparisonPages`). This task changes **only** the web nav label.

- [ ] **Step 1: Write the failing test** (append to `scripts/test-web-clean-v1-reports.ts`):

```ts
{
  const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
  check("nav EN label renamed", app.includes('"Site Rack Capacity & Availability Comparison"'));
  check("nav TH label updated", app.includes("เปรียบเทียบความจุและพื้นที่ว่างของแร็คระหว่างไซต์"));
  check("old short EN nav label gone", !app.includes('"Site Rack Capacity Comparison"'));
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Edit the nav array** — `CleanWebApp.tsx:492`, the `{ id: "rack-comparison", label: lang === "th" ? "เปรียบเทียบความจุแร็คระหว่างไซต์" : "Site Rack Capacity Comparison", icon: Building2 }` entry:

```ts
{ id: "rack-comparison", label: lang === "th" ? "เปรียบเทียบความจุและพื้นที่ว่างของแร็คระหว่างไซต์" : "Site Rack Capacity & Availability Comparison", icon: Building2 },
```

- [ ] **Step 4: Run**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-reports.ts && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Full gate suite, then commit Phase 2**

Run the entire gate suite.

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(reports): split site-comparison section and extract report body pages

- ReportSectionId: replace site-comparison with site-energy-comparison and
  site-rack-comparison; ReportRegistry gains both, forType('site-comparison')
  returns the pair.
- reportHtml: extract buildReportBodyPages (cover-less page sequence);
  buildReportHtml gains { sections, includeCover } (bare-array arg still works);
  the style block moves to REPORT_CSS.
- Every report page carries data-report-section; filterReportBodySections is
  attribute-based. Desktop output is byte-identical (cover default true, no
  class/order/text change).
- Web nav: "Site Rack Capacity & Availability Comparison" (EN) + Thai.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 3 — PDF cross-site redesign (N-site layout, one cover)

One commit: `feat(exports): rebuild All Facilities PDF for app UI parity`.
Replaces the Phase-1 adapter with the real layout. Desktop path untouched.

### Task 3.1: One All-Facilities cover + per-facility band pages

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — `buildAllFacilitiesReportHtml` (`:1109`)
- Modify: `src/reports/pdf/reportHtml.ts` — export `REPORT_CSS` and a `facilityBandPage(name: string): string` helper
- Test: `scripts/test-web-clean-v1-report-structure.ts`

**Interfaces:**
- Consumes: `REPORT_CSS` (Task 2.2), `buildReportBodyPages` (Task 2.2), `facilityReportData` (`exports.ts:664`).
- Produces:
  ```ts
  // reportHtml.ts
  export const REPORT_CSS: string
  export function facilityBandPage(facilityName: string): string
    // -> '<section class="page facility-band" data-report-section="facility-header"><h2>Facility: <name></h2></section>'
  ```

- [ ] **Step 1: Write the failing test** — append to `scripts/test-web-clean-v1-report-structure.ts`:

```ts
import { buildAllFacilitiesReportHtml, buildSiteComparisonReportModel } from "../src/web-clean-v1/exports";
{
  const facilities = [
    { siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] },
    { siteName: "Srinakarin", siteCode: "srinakarin", logs: [log("2026-06")] },
  ] as any;
  const html = buildAllFacilitiesReportHtml(facilities, null, "2026-06");
  check("exactly one cover for All Facilities", (html.match(/<main class="cover">/g) ?? []).length === 1);
  check("cover names All Facilities", /<main class="cover">[\s\S]*Facility: All Facilities/.test(html));
  check("one facility band per site",
    (html.match(/data-report-section="facility-header"/g) ?? []).length === 2);
  check("bands name each site", html.includes("Facility: Rangsit") && html.includes("Facility: Srinakarin"));
  check("single <head>/<style>", (html.match(/<style>/g) ?? []).length === 1);
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Add `facilityBandPage` + export `REPORT_CSS`** in `reportHtml.ts`. Add `.facility-band{…}` styling to `REPORT_CSS` (a page-break page with a large `<h2>` — reuse existing `.page h2` styling; minimal addition).

- [ ] **Step 4: Rewrite `buildAllFacilitiesReportHtml`**

```ts
export function buildAllFacilitiesReportHtml(
  facilities: ExportFacility[],
  comparison: SiteComparisonReportModel | null,
  selectedMonth: string,
  sections?: readonly ReportSectionId[],
): string {
  const coverMeta = `Facility: All Facilities<br>Reporting month: ${escapeHtmlLocal(selectedMonth)}<br>Sites: ${facilities.map(f => escapeHtmlLocal(f.siteName)).join(", ")}`;
  const cover = `<main class="cover"><h1>Data Center Energy &amp; Facility Monitor</h1><h2>All Facilities Report</h2><div class="meta">${coverMeta}</div></main>`;
  const perFacility = facilities.map(f => {
    const data = reportDataFromFacility(f);              // existing private helper in exports.ts
    return facilityBandPage(f.siteName) + buildReportBodyPages(data, sections);
  }).join("");
  const cross = comparison ? buildCrossSiteComparisonPages(comparison, sections) : "";   // Task 3.2/3.3
  return `<!doctype html><html><head><meta charset="utf-8"><title>All Facilities Report</title><style>${REPORT_CSS}</style></head><body>${cover}${perFacility}${cross}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}
```

`escapeHtmlLocal` = the small escape helper already in `exports.ts` (or import `escapeHtml` if exported; otherwise add a 1-line local). `reportDataFromFacility` is the existing private helper (`exports.ts:700`). For this task, stub `buildCrossSiteComparisonPages` to call the Phase-1 `crossSiteReportPagesAdapter` so the phase compiles; Task 3.2/3.3 replace the body.

- [ ] **Step 5: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-report-structure.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
npm run test:all-report
```
Expected: PASS.

- [ ] **Step 6: Stage.**

### Task 3.2: `buildCrossSiteComparisonPages` — energy section (4 charts + N-site table)

**Files:**
- Modify: `src/reports/pdf/reportHtml.ts` — add `buildCrossSiteComparisonPages(model, sections?)` and its energy sub-renderer
- Test: `scripts/test-web-clean-v1-report-structure.ts`

**Interfaces:**
- Consumes: `SiteComparisonReportModel` (import the type into `reportHtml.ts` from `../../web-clean-v1/exports` — or move the type to `reportTypes.ts` to avoid a web→reports import; **prefer** moving `SiteComparisonReportModel` + `SiteComparisonReportSite` to `src/reports/reportTypes.ts` and re-exporting from `exports.ts`).
- Produces:
  ```ts
  export function buildCrossSiteComparisonPages(
    model: SiteComparisonReportModel, sections?: readonly ReportSectionId[],
  ): string
  ```
  Energy pages carry `data-report-section="site-energy-comparison"`. Charts: 4 — Total Building Energy, 4th Floor Energy, Total Building Cost, Estimated 4th Floor Cost — one series per site, reusing `trendPage(...)` with a `TrendSeries[]` and null gaps (`connectNulls` behaviour is already "gap on null"). The N-site table has one row per site for `model.referenceMonth`: `Facility | Whole Building Energy (kWh) | Whole Building Cost (THB) | 4th Floor Energy (kWh) | Estimated 4th Floor Cost (THB) | Average Rate (THB/kWh) | 4th Floor Share (%)`, values via `format2`, `—` for null, `%` appended on the share column only.

- [ ] **Step 1: Write the failing test**

```ts
{
  const model = buildSiteComparisonReportModel({
    displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
    months: ["2026-05", "2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [
        { month: "2026-05", metrics: { buildingEnergy: 95, buildingCost: 475, floorEnergy: 38, floorCost: 190, avgRate: 5, floorShare: 40 } },
        { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } }],
        rackUnitCapacity: [] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [
        { month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } }],
        rackUnitCapacity: [] },
    ],
  } as any, "2026-06");
  const pages = buildCrossSiteComparisonPages(model);
  check("energy pages tagged site-energy-comparison", pages.includes('data-report-section="site-energy-comparison"'));
  check("has all 4 energy chart titles",
    pages.includes("Total Building Energy Consumption Trend") &&
    pages.includes("4th Floor Energy Consumption Trend") &&
    pages.includes("Total Building Electricity Cost Trend") &&
    pages.includes("Estimated 4th Floor Electricity Cost Trend"));
  check("no Average Rate / Floor Share chart",
    !pages.includes("Average Unit Rate Trend") && !pages.includes("4th Floor Share Trend"));
  check("N-site energy table has both sites", pages.includes("Rangsit") && pages.includes("Srinakarin"));
  check("Srinakarin's missing 2026-05 renders as a gap, not zero",
    !/Srinakarin[\s\S]{0,400}>0<\/text>/.test(pages));  // no fabricated 0 label
}
```

(import `buildCrossSiteComparisonPages` from `reportHtml`.)

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement the energy sub-renderer.** Skeleton (fill chart args from the existing `trendPage` signature — `trendPage(title, unit, series: TrendSeries[], rows, explanation, sectionLabel?, reportSection?)`; add the `reportSection` param from Task 2.3):

```ts
function crossSiteEnergyPages(model: SiteComparisonReportModel): string {
  const rows = model.months.map(m => ({ month: m } as ReportMonthlyRow)); // x-axis anchor
  const seriesFor = (pick: (mm: ComparisonMetric) => number | null, colorIdx: number) =>
    model.sites.map((s, i) => ({
      name: comparisonFacilityLabel(s.label),
      color: siteColour(s.label),
      values: model.months.map(mo => { const mm = s.metricsByMonth[mo]; return mm ? pick(mm) : null; }),
    }));
  const charts =
    trendPage("Total Building Energy Consumption Trend", "kWh", seriesFor(mm => mm.buildingEnergy, 0), rows,
      "Whole-building monthly energy per site for the selected window.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("4th Floor Energy Consumption Trend", "kWh", seriesFor(mm => mm.floorEnergy, 1), rows,
      "4th Floor monthly energy per site.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("Total Building Electricity Cost Trend", "THB", seriesFor(mm => mm.buildingCost, 2), rows,
      "Whole-building monthly electricity cost per site.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("Estimated 4th Floor Electricity Cost Trend", "THB", seriesFor(mm => mm.floorCost, 3), rows,
      "Estimated 4th Floor electricity cost per site.", "SITE COMPARISON", "site-energy-comparison");
  const tableRows = model.sites.map(s => {
    const mm = s.metrics;
    return [
      escapeHtml(comparisonFacilityLabel(s.label)),
      format2(mm?.buildingEnergy), format2(mm?.buildingCost), format2(mm?.floorEnergy),
      format2(mm?.floorCost), format2(mm?.avgRate),
      mm?.floorShare == null ? "—" : `${format2(mm.floorShare)}%`,
    ];
  });
  const table = tableFn(
    ["Facility", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)",
     "Estimated 4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"],
    tableRows);
  return charts +
    `<section class="page" data-report-section="site-energy-comparison"><h2>Site Energy &amp; Cost Comparison</h2>` +
    `<p class="note">Reference month: ${escapeHtml(formatMonth(model.referenceMonth))}</p>${table}</section>`;
}
```

`tableFn` = the existing `table(...)` helper (`:52`); `format2` accepts `number | null | undefined`. `siteColour` / `comparisonFacilityLabel` already exist (`:587`, `:498`).

- [ ] **Step 4: Wire into `buildCrossSiteComparisonPages`**

```ts
export function buildCrossSiteComparisonPages(model: SiteComparisonReportModel, sections?: readonly ReportSectionId[]): string {
  const body = crossSiteEnergyPages(model) + crossSiteRackPages(model);   // rack in Task 3.3
  return sections !== undefined ? filterReportBodySections(body, sections) : body;
}
```

- [ ] **Step 5: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-report-structure.ts
npm run test:all-report
```
Expected: PASS.

- [ ] **Step 6: Stage.**

### Task 3.3: `buildCrossSiteComparisonPages` — rack section (N-site, live-UI parity)

**Files:**
- Modify: `src/reports/pdf/reportHtml.ts` — add `crossSiteRackPages(model)`
- Test: `scripts/test-web-clean-v1-report-structure.ts`

**Interfaces:**
- Consumes: `calculateRackCapacityMetrics` (`:5` import), `rackPositionExportRows` (`:5` import), `RACK_UNIT_CAPACITY_TREND_NOTE` (`:2`), the model's `sites[].rack` / `sites[].rackUnit`.
- Produces: pages tagged `data-report-section="site-rack-comparison"`, in this order (all per-site, N sites, matching `WebSiteRackCapacityComparison`):
  1. **Site Rack Capacity & Availability Comparison** — per-site summary line/cards: `Available Now` (`available.count`), `Total Racks`, `In Use`, `Reserved`, `Pending Decommission`, `Availability %` (`formatFixedPercentage(available.count/total*100, 1)` — 1 dp), `Status` (`Ready` if `available/total ≥ 0.2`, `Full` if `available ≤ 0`, else `Limited` — reuse `rackAvailabilityStatus` from `src/domain/rackComparison.ts`). Sites with `rack === null` → "Unavailable", **excluded from any reconciliation total**.
  2. **Rack Capacity by Zone** — per-site segmented bars (In Use / Available / Reserved / Pending Decommission), shared scale = max zone total across sites.
  3. **Rack Capacity Details — <site>** — table `Zone | Total | In Use | Available | Reserved | Pending Decommission` per site.
  4. **Rack Positions — <site>** — grouped Available / Reserved / Pending Decommission, columns `Rack ID | Cabinet Size (cm) | Detail`; the `Pending Dismantle → Pending Decommission` relabel is already done by `rackPositionExportRows`.
  5. **Rack Unit Capacity Comparison** — per site: `Total U | Used U | Available U | Usage % | Availability %` (0 dp counts, 1 dp %), plus a 6-month trend table `Site | Month | Total U | Used U | Available U | Usage % | Availability %`.
  6. **Rack Unit Capacity Trend Note** (`RACK_UNIT_CAPACITY_TREND_NOTE`, verbatim).

- [ ] **Step 1: Write the failing test**

```ts
{
  // model with rack + rackUnit for one site, none for the other
  const rangsitRecords = [
    { rowNumber: 1, rackZone: "A", rackId: "A-01", status: "In Use", cabinetSize: "60x100", detail: null, deviceType: null, remarks: null },
    { rowNumber: 2, rackZone: "A", rackId: "A-02", status: "Available", cabinetSize: "60x100", detail: "spare", deviceType: null, remarks: null },
    { rowNumber: 3, rackZone: "B", rackId: "B-01", status: "Reserved", cabinetSize: "60x120", detail: "held", deviceType: null, remarks: null },
    { rowNumber: 4, rackZone: "B", rackId: "B-02", status: "Pending Dismantle", cabinetSize: "60x120", detail: "EOL", deviceType: null, remarks: null },
  ];
  const model = {
    referenceMonth: "2026-06", months: ["2026-06"],
    sites: [
      { label: "Rangsit", siteCode: "rangsit", metrics: null, metricsByMonth: { "2026-06": null },
        rack: { sourceSheet: "Rack Capacity", sourceTable: "Table7", sourceSnapshot: "2026-06", records: rangsitRecords, byZone: [], byStatus: [], byCabinetSize: [], byDeviceType: [], validation: { duplicateIds: [], missingRequiredFields: [], invalidStatuses: [], invalidDataTypes: [], unsupportedUMetrics: [] } },
        rackUnit: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, usagePercent: 75, availabilityPct: 0.25 }] },
      { label: "Srinakarin", siteCode: "srinakarin", metrics: null, metricsByMonth: { "2026-06": null }, rack: null, rackUnit: [] },
    ],
  } as any;
  const pages = buildCrossSiteComparisonPages(model);
  check("rack pages tagged site-rack-comparison", pages.includes('data-report-section="site-rack-comparison"'));
  check("heading uses the full renamed term", pages.includes("Site Rack Capacity &amp; Availability Comparison"));
  check("per-site summary shows Pending Decommission (not Dismantle)",
    pages.includes("Pending Decommission") && !/Rack Positions[\s\S]*Pending Dismantle/.test(pages));
  check("Rack Positions never lists an In Use row", !/Rack Positions[\s\S]*A-01/.test(pages));
  check("Rack Positions lists Available + Reserved + Pending Decommission rows",
    pages.includes("A-02") && pages.includes("B-01") && pages.includes("B-02"));
  check("site with no snapshot shows Unavailable, no zone table",
    pages.includes("Unavailable") && !/Rack Capacity Details — Srinakarin/.test(pages));
  check("rack-unit comparison shows 1-dp percentages", /Usage[\s\S]{0,80}75\.0%/.test(pages) || pages.includes("75.0%"));
  check("trend note verbatim", pages.includes("Available U represents physical rack space only"));
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `crossSiteRackPages(model)`.** Reuse: `donutSvg` / segmented bar markup patterns already in the file; `calculateRackCapacityMetrics`; `rackPositionExportRows`; `formatInteger` (0 dp), `formatUsagePercent1` / `formatRatioPercent1` (1 dp). Import `rackAvailabilityStatus` from `../../domain/rackComparison`. Build sections 1–6 in order; skip sites with `rack === null` in sections 2–4 (list them under an "Unavailable" note in section 1). Section 5 iterates `model.sites` where `rackUnit` has a row for `referenceMonth` (validate `usedU ≤ totalU`, non-negative — else list under an "excluded" note).

- [ ] **Step 4: Remove the Phase-1 adapter path** — `buildCrossSiteComparisonPages` no longer calls `crossSiteReportPagesAdapter`. In `exports.ts`, delete `crossSiteReportPagesAdapter`, `modelAsSiteComparisonExport`, `siteComparisonSectionsFromModel`'s HTML use (keep it for CSV/Excel — it still adapts to `siteComparisonExportSections`), and `buildTwoSiteComparisonReportData` / `buildSiteComparisonReportHtml` **iff** nothing else references them (grep first).

- [ ] **Step 5: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-report-structure.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
npm run test:all-report
npm run test:all-report:pdf
```
Expected: PASS.

- [ ] **Step 6: Stage.**

### Task 3.4: Verify Current Facility is unchanged + full gate + commit

- [ ] **Step 1: Add the Current-Facility isolation assertion** to `scripts/test-web-clean-v1-report-structure.ts`:

```ts
{
  const cf = buildReportHtml(facilityReportData([log("2026-06")], "Rangsit", "2026-06"));
  check("Current Facility PDF has no cross-site pages",
    !cf.includes('data-report-section="site-energy-comparison"') &&
    !cf.includes('data-report-section="site-rack-comparison"'));
  check("Current Facility PDF has exactly one cover", (cf.match(/<main class="cover">/g) ?? []).length === 1);
}
```

- [ ] **Step 2: Run the new test, then the full gate suite.**

- [ ] **Step 3: Commit Phase 3**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(exports): rebuild All Facilities PDF for app UI parity

- One All-Facilities cover + one facility-band page per site + one trailing
  cross-site block (no per-facility cover, no empty placeholder pages).
- buildCrossSiteComparisonPages: N-site energy section (4 charts matching the
  live WebSiteComparison: Total Building Energy, 4th Floor Energy, Total Building
  Cost, Estimated 4th Floor Cost; no Average-Rate/Share chart) + N-site energy
  table; N-site rack section (per-site summary + Rack Capacity by Zone + per-site
  Details + Rack Positions + Rack Unit Capacity Comparison + Trend Note),
  "Site Rack Capacity & Availability Comparison" heading, "Pending Decommission"
  terminology, sites with no snapshot shown Unavailable and excluded from totals.
- Current Facility report unchanged; Desktop reportHtml path unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 4 — Excel workbook redesign

One commit: `feat(exports): rebuild Excel workbook for app UI parity`.

### Task 4.1: Presentation-first sheet ordering + title rows (`workbookForFacilities`)

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — `workbookForFacilities` (`:269-344`)
- Modify: `src/web-clean-v1/excelDashboard.ts` — `addInteractiveDashboard` sheet-name prefix (if it hard-codes `<prefix>-Dashboard`)
- Test: `scripts/test-web-clean-v1-exports.ts` (the sheet-name assertion at `:85`)

**Interfaces:**
- Produces: a helper `sheetOrderName(facilityCode: string | undefined, order: number, title: string): string` — `<CODE> <NN> <title>` clamped to 31 chars (drop the code for single-facility workbooks; abbreviate `title` when needed). Presentation sheets get orders `01..07`; raw sheets `20..39`; hidden `Dashboard_Data` stays last.

- [ ] **Step 1: Update the sheet-name assertion** in `scripts/test-web-clean-v1-exports.ts:~85`. The current list checks unprefixed names (`UPS_Loads`, `Energy_Cost`, …). Change to assert:
  - presentation sheets exist and are ordered before raw: the first 7 non-hidden sheet names start with `01 `..`07 ` (single-facility) or `<CODE> 01 `..`<CODE> 07 ` (multi);
  - every raw sheet name contains one of the legacy tokens (`UPS_Loads`, `Air_Inputs`, `DC_Inputs`, `Energy_Cost`, `Saved_Records`, `Saved_Values`, `Raw_Inputs`, `Calculated_Energy`, `Dashboard-FAC`, `Rack Capacity History`, `UPS Group History`, `Rack Capacity Raw`, `Rack Unit Capacity`) and appears **after** index 6;
  - `Dashboard_Data` is hidden and is the last sheet.

```ts
{
  const wb = await workbookForFacilities([{ siteName: "Rangsit", siteCode: "RST", logs: [log("2026-06")] }] as any);
  const visible = wb.worksheets.filter((s: any) => s.state !== "hidden").map((s: any) => s.name);
  check("first 7 visible sheets are the 01..07 presentation set",
    visible.slice(0, 7).every((n: string, i: number) => n.startsWith(String(i + 1).padStart(2, "0") + " ")));
  const rawIdx = wb.worksheets.findIndex((s: any) => /UPS_Loads/.test(s.name));
  check("raw input sheets come after presentation sheets", rawIdx >= 7);
  const last = wb.worksheets[wb.worksheets.length - 1];
  check("Dashboard_Data hidden and last", /Dashboard_Data/.test(last.name) && last.state === "hidden");
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Add `sheetOrderName` + reorder.** In `workbookForFacilities`, build sheets in this sequence per facility, using `sheetOrderName`:
  - `01 Dashboard` = the existing `addInteractiveDashboard` visible sheet (rename its sheet to the ordered name; keep the hidden `Dashboard_Data` name but move it to the very end and set `.state = "hidden"`).
  - `02 Executive` — new small sheet: title row + Executive KPI block (Building vs 4th Floor energy & cost, 4th-floor share) computed from the facility's `logs` via `calculateEnergyCostForMonth` for the reference month. (Reuse the numbers `facilityReportData` already computes — call it once and read `currentRow` / `monthlyRows`.)
  - `03 Engineering` — title row + the selected-month engineering tables (UPS group + detail mapping, Air per-meter GWh + monthly diff, DC panel, Overall Energy & Cost). Source: `buildEngineeringDashboardSnapshot` output (the same `EngineeringDashboardSnapshot` the PDF uses). Emit as plain rows.
  - `04 Rack Capacity` — title row + `RACK_CAPACITY_SUMMARY` + `RACK_CAPACITY_DETAILS` + `RACK_POSITIONS` sections (from `facilityExportSections`).
  - `05 Rack Unit Capacity` — title row + `RACK_UNIT_CAPACITY` + `RACK_UNIT_TREND` + `RACK_UNIT_TREND_NOTE` + `RACK_UNIT_CAPACITY_IMAGES` sections.
  - `06 History` — title row + Energy & Cost history + UPS Group History + Air history + DC history + Rack Capacity Monthly History + Rack Unit Capacity History (month-indexed).
  - `07 Trends` — title row + month-indexed columns for the 5 facility trend series (Energy / Cost / UPS / Air / DC).
  - then the existing raw sheets (`UPS_Loads` … `Rack Capacity Raw`), renamed with `20..` prefixes.
  - `Dashboard_Data` hidden, last.
  Apply to each presentation sheet: `sheet.getRow(1)` = full title; `sheet.views = [{ state: "frozen", ySplit: 2 }]`; sensible `column.width`; `numFmt` per column (`#,##0.00` for 2-dp money/energy, `0.0%` for analytics percent, `mmm-yy` for month cells).

- [ ] **Step 4: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-excel-roundtrip.ts
```
Expected: PASS.

- [ ] **Step 5: Stage.**

### Task 4.2: `workbookForFacilities(facilities, comparison?)` emits sheets `90`/`91`

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — `workbookForFacilities`
- Test: `scripts/test-web-clean-v1-exports.ts`

**Interfaces:**
- Consumes: `SiteComparisonReportModel`, `siteComparisonExportSections` (re-typed in Task 4.3 to take the model, or via the `modelAsSiteComparisonExport` adapter kept for CSV/Excel).
- Produces: when `comparison` is non-null, two trailing sheets after all per-facility raw sheets:
  - `90 Site Energy Comparison` (title row "Site Energy & Cost Comparison") — summary block (one row/site for `referenceMonth`) + 4 month-indexed trend tables (Total Building Energy, 4th Floor Energy, Total Building Cost, Estimated 4th Floor Cost). Numeric cells numeric; `%` → `0.0%`; missing months blank.
  - `91 Site Rack Comparison` (title row "Site Rack Capacity & Availability Comparison") — `RACK_CAPACITY_SUMMARY`, `RACK_CAPACITY_DETAILS`, `RACK_POSITIONS`, `RACK_UNIT_CAPACITY_COMPARISON`, `RACK_UNIT_TREND_COMPARISON`, `RACK_UNIT_TREND_NOTE` (from `siteComparisonExportSections`).

- [ ] **Step 1: Write the failing test**

```ts
{
  const model = buildSiteComparisonReportModel({
    displayPeriod: { startMonth: "2026-06", endMonth: "2026-06" }, months: ["2026-06"],
    sites: [
      { site: { id: 1, code: "RST", name: "Rangsit" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } }], rackUnitCapacity: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, usagePercent: 75 }] },
      { site: { id: 2, code: "SRN", name: "Srinakarin" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } }], rackUnitCapacity: [] },
    ],
  } as any, "2026-06");
  const wb = await workbookForFacilities([
    { siteName: "Rangsit", siteCode: "RST", logs: [log("2026-06")] },
    { siteName: "Srinakarin", siteCode: "SRN", logs: [log("2026-06")] },
  ] as any, model);
  const names = wb.worksheets.map((s: any) => s.name);
  check("has 90 Site Energy Comparison", names.some((n: string) => n.startsWith("90 ")));
  check("has 91 Site Rack Comparison", names.some((n: string) => n.startsWith("91 ")));
  const idx90 = names.findIndex((n: string) => n.startsWith("90 "));
  const idxRaw = names.findIndex((n: string) => /UPS_Loads/.test(n));
  check("comparison sheets come after per-facility raw sheets", idx90 > idxRaw);
  const s90 = wb.worksheets.find((s: any) => s.name.startsWith("90 "));
  const cell = s90.getSheetValues().flat().find((v: any) => v === 100);
  check("90 keeps energy numeric", typeof cell === "number");
  const wbNoCmp = await workbookForFacilities([{ siteName: "Rangsit", siteCode: "RST", logs: [log("2026-06")] }] as any);
  check("no comparison -> no 90/91", !wbNoCmp.worksheets.some((s: any) => s.name.startsWith("90 ") || s.name.startsWith("91 ")));
}
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement** the `90`/`91` sheet builders inside `workbookForFacilities`, appended after the per-facility loop when `comparison` is provided. Sheet `91` = one `addTableSheet`-style block per `siteComparisonExportSections(modelAsSiteComparisonExport(comparison), comparison.referenceMonth)` section, all on one sheet with section sub-headers. Sheet `90` = summary rows built directly from `comparison.sites[].metrics` + 4 trend tables from `comparison.sites[].metricsByMonth`.

- [ ] **Step 4: Run**

Run:
```
npm run lint
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-excel-roundtrip.ts
```
Expected: PASS.

- [ ] **Step 5: Stage.**

### Task 4.3: Remove the standalone site-comparison Excel surface + re-type sections

**Files:**
- Modify: `src/web-clean-v1/exports.ts` — `siteComparisonExportSections` / `buildSiteComparisonCsv` re-typed to accept `SiteComparisonReportModel`; `exportAllFacilitiesExcel` / `exportAllFacilitiesCsv` pass the model through
- Modify: any remaining `scripts/test-web-clean-v1-exports.ts` blocks that call `siteComparisonExportSections` / `buildSiteComparisonCsv` with the old `SiteComparisonExport` shape

- [ ] **Step 1: Re-type** `siteComparisonExportSections(model: SiteComparisonReportModel)` and `buildSiteComparisonCsv(model: SiteComparisonReportModel)` — drop the `referenceMonth` param (read `model.referenceMonth`). Internally keep using `modelAsSiteComparisonExport` if that is the least-churn path, or port the section builders to read the model directly (preferred for DRY — `ponytail` review will flag the adapter as duplication if it survives).

- [ ] **Step 2: Update the callers** — `buildAllFacilitiesCsv`, `workbookForFacilities` `91` builder, and the existing `test-web-clean-v1-exports.ts` comparison-section tests (the `824e3d4` regression block ~line 402-437 — feed it a `SiteComparisonReportModel` built via `buildSiteComparisonReportModel` from the same fixture, keep the same value assertions).

- [ ] **Step 3: Run the full gate suite.**

- [ ] **Step 4: Commit Phase 4**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(exports): rebuild Excel workbook for app UI parity

- Per facility: presentation sheets 01 Dashboard .. 07 Trends in app order
  (title rows, frozen headers, column widths, number formats), then the raw
  input/audit sheets (20+), then the hidden Dashboard_Data feed last.
- All Facilities: trailing sheets 90 Site Energy Comparison (summary + 4 trend
  tables) and 91 Site Rack Comparison, built from SiteComparisonReportModel.
- siteComparisonExportSections / buildSiteComparisonCsv now take the shared
  model; the standalone workbookForSiteComparison / exportSiteComparison* Excel
  path is gone.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 5 — Remove Dashboard PNG web export

One commit: `fix(dashboard): remove PNG web export`.

### Task 5.1: `exportFormats` prop on `UniversalFilterBar`; drop the PNG branch

**Files:**
- Modify: `src/components/UniversalFilterBar.tsx` — `UniversalFilterBarProps` (`:26`), the destructure (`:41`), the export-button map (`:329`)
- Modify: `src/web-clean-v1/CleanWebApp.tsx` — `exportDashboard` (`:566`), the PNG `else` branch (`:584-586`), the `<UniversalFilterBar>` usage (`:591`)
- Modify: `scripts/test-web-clean-v1-dashboard-parity.ts:18`

**Interfaces:**
- Produces: `UniversalFilterBarProps.exportFormats?: readonly ("pdf" | "excel" | "csv" | "png")[]` — default `["pdf", "excel", "csv", "png"]` (Desktop unchanged). Web passes `["pdf", "excel", "csv"]`.

- [ ] **Step 1: Update the failing test** — `scripts/test-web-clean-v1-dashboard-parity.ts:18`:

```ts
assert.match(app, /const exportDashboard = \(format: "pdf" \| "excel" \| "csv"\)/);
assert.doesNotMatch(app, /Dashboard PNG export requires the Desktop app/);
assert.match(app, /exportFormats=\{\["pdf", "excel", "csv"\]\}/);
```

- [ ] **Step 2: Run, verify it fails.**

Run: `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-dashboard-parity.ts`

- [ ] **Step 3: `UniversalFilterBar.tsx`**

- In `UniversalFilterBarProps` add: `exportFormats?: readonly ("pdf" | "excel" | "csv" | "png")[];`
- In the destructure add `exportFormats = ["pdf", "excel", "csv", "png"]`.
- Line 329: `{["pdf", "excel", "csv", "png"].map((fmt) => (` → `{exportFormats.map((fmt) => (`.
- Leave `onExport?: (format: "pdf" | "excel" | "csv" | "png") => void;` unchanged (Desktop still needs `png`).

- [ ] **Step 4: `CleanWebApp.tsx`**

- Line 566: `const exportDashboard = (format: "pdf" | "excel" | "csv" | "png") => {` → `(format: "pdf" | "excel" | "csv") => {`.
- Lines 584-586: delete the `} else { notify(lang === "th" ? "การส่งออก PNG ต้องใช้ Desktop app" : "Dashboard PNG export requires the Desktop app."); }` branch. The chain ends at `else if (format === "pdf") { … }` (now exhaustive).
- Line 591: `<UniversalFilterBar lang={lang} onExport={exportDashboard} facility={null} upsGroupNames={upsGroupNames} reportViews={DASHBOARD_REPORT_VIEWS} />` → add `exportFormats={["pdf", "excel", "csv"]}`.
- If `lang` is now unused inside `exportDashboard`, that's fine — it is still used elsewhere in `DashboardView`.

- [ ] **Step 5: Run**

Run:
```
npm run lint
npm run build
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-dashboard-parity.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-dashboard-fixes.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-pdf-capture.ts
```
Expected: PASS. (`test-dashboard-facility-isolation.ts` asserts the **Desktop** `<UniversalFilterBar>` string verbatim — do NOT add `exportFormats` to that Desktop usage; verify that test still passes.)

- [ ] **Step 6: Full gate suite, then commit**

```bash
git add src/components/UniversalFilterBar.tsx src/web-clean-v1/CleanWebApp.tsx scripts/test-web-clean-v1-dashboard-parity.ts
git commit -m "$(cat <<'EOF'
fix(dashboard): remove PNG web export

Production web Dashboard toolbar is now PDF | EXCEL | CSV. UniversalFilterBar
gains an exportFormats prop (default keeps Desktop's 4 buttons incl. PNG); the
web host passes the three-format list and exportDashboard drops the
"requires the Desktop app" PNG branch. Desktop PNG snapshot, rack-unit image
upload, MIME validation, and the internal PDF rasterization are untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 6 — Test hardening, sample artifacts, reconciliation

One commit: `test(exports): scope, order, reconciliation, N-site and PNG-removal coverage`.

### Task 6.1: Positive Site Energy & Cost regression through the production path

**Files:**
- Modify: `scripts/test-web-clean-v1-exports.ts`

- [ ] **Step 1: Add the positive assertion** (keep the existing negative documentation block from `824e3d4`):

```ts
{
  // POSITIVE: the real production path keeps every energy/cost metric for the
  // selected month (regression guard for the entry.month filter semantics).
  const raw = {
    displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
    months: ["2026-05", "2026-06"],
    sites: [{ site: { id: 1, code: "RST", name: "Rangsit" }, months: [
      { month: "2026-05", metrics: { buildingEnergy: 111, buildingCost: 555, floorEnergy: 44, floorCost: 222, avgRate: 5, floorShare: 39.6 } },
      { month: "2026-06", metrics: { buildingEnergy: 222, buildingCost: 999, floorEnergy: 88, floorCost: 444, avgRate: 4.5, floorShare: 39.6 } },
    ], rackUnitCapacity: [] }],
  } as any;
  const model = buildSiteComparisonReportModel(raw, "2026-06");
  const sections = siteComparisonExportSections(model);
  const site = sections.find(s => s.name === "SITE_COMPARISON");
  const row = site!.rows[0].map(String).join("|");
  check("selected month energy/cost survive (not blank)",
    row.includes("222") && row.includes("999") && row.includes("88") && row.includes("444"));
  check("non-selected month row is absent", !site!.rows.some(r => r.map(String).join("|").includes("111")));
  const csv = buildSiteComparisonCsv(model);
  check("CSV keeps the selected-month metrics", csv.includes("222") && csv.includes("999"));
}
```

- [ ] **Step 2: Run:** `node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts` → PASS.

- [ ] **Step 3: Stage.**

### Task 6.2: Reconciliation harness + sample artifacts

**Files:**
- Create: `scripts/gen-export-ui-parity-samples.ts` (not registered in gates — a manual/CI-optional generator)
- Create: `docs/superpowers/plans/2026-08-30-export-report-ui-parity-reconciliation.md` (filled by running the harness)

- [ ] **Step 1: Write the generator** — build a fixed multi-site fixture (`ExportFacility[]` + `SiteComparisonReportModel` from an inline `SiteComparisonExport`), then write to `dist-electron/test-work/export-ui-parity/`:
  - `current-facility.html` = `buildReportHtml(facilityReportData(...))`
  - `all-facilities.html` = `buildAllFacilitiesReportHtml(facilities, model, ref)`
  - `current-facility.csv` = `buildFacilityCsv(facilities[0])`
  - `all-facilities.csv` = `buildAllFacilitiesCsv(facilities, model)`
  - `current-facility.xlsx` / `all-facilities.xlsx` = `writeInteractiveExcelWorkbook(await workbookForFacilities(...))`
  Print a reconciliation table to stdout: for each metric (Building Energy, Building Cost, Floor Energy, Floor Cost, Average Rate, Floor Share; Rack Total/In Use/Available/Reserved/Pending Decommission; Rack Unit Total U/Used U/Available U/Usage %/Availability %) show the value as it appears in the HTML table cell, the CSV cell, and the XLSX cell, and `OK`/`MISMATCH`.

- [ ] **Step 2: Run it**

Run: `node node_modules/tsx/dist/cli.mjs scripts/gen-export-ui-parity-samples.ts`
Expected: all rows `OK` (formatting-only differences — decimals / `%` glyph / date mask — are allowed and annotated; a raw value mismatch fails).

- [ ] **Step 3: Paste the printed table** into `docs/superpowers/plans/2026-08-30-export-report-ui-parity-reconciliation.md` with a one-line note per formatting-only difference.

- [ ] **Step 4: PDF + Excel visual review** — open `all-facilities.html` and `current-facility.html` in a browser (or via the `frontend-visual-qa` skill) and page through for: clipping, overlap, invisible text, broken page breaks, cut charts/tables, header-detached-from-table, stretched images, wrong site/month, blank pages, inconsistent typography/KPI formatting. Open the two `.xlsx` in Excel/LibreOffice: check sheet names/order/count, presentation-before-raw, cell types, number formats, `%`, widths, frozen panes, charts, no accidental blanks, no wrong site/month. Record findings in the reconciliation doc.

- [ ] **Step 5: Stage the generator + docs.**

### Task 6.3: Register everything, run the full suite, commit

- [ ] **Step 1:** Confirm `package.json` `test:phase3` lists: `scripts/test-web-clean-v1-language-default.ts`, `scripts/test-report-registry.ts`, `scripts/test-web-clean-v1-report-structure.ts` (the others were already present).

- [ ] **Step 2: Run the entire Global Constraints gate suite + every new script.**

- [ ] **Step 3: Commit Phase 6**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(exports): scope, order, reconciliation, N-site and PNG-removal coverage

- Positive Site Energy & Cost regression through buildSiteComparisonReportModel
  -> siteComparisonExportSections / buildSiteComparisonCsv (keeps the negative
  824e3d4 documentation assertion).
- report-structure suite: per-page data-report-section, Current-Facility order,
  no cross-site pages in Current Facility, one All-Facilities cover + bands,
  N-site energy/rack coverage, 1-dp rack-unit percentages.
- report-registry suite: the site-comparison split.
- language-default suite (Phase 0).
- gen-export-ui-parity-samples.ts + reconciliation doc.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

---

## Phase 7 — Documentation sync

One commit: `docs(exports): sync report/export docs with the two-scope model`.

### Task 7.1: Update the affected docs

**Files:**
- Modify: `docs/web-clean-v1/DESKTOP_WEB_PARITY_AUDIT.md` (anything describing the 3-scope model, the standalone site-comparison export, or web Dashboard PNG parity)
- Modify: `docs/PROJECT_STATE.md` (if it tracks export scopes / features)
- Modify: `CHANGELOG.md` (add an entry under the current unreleased section)
- Check (modify only if they mention the changed behaviour): `docs/desktop/KNOWN_TECHNICAL_DEBT.md`, `docs/governance/AI_ENGINEERING_PLAYBOOK.md`, `README.md`

- [ ] **Step 1: Grep the docs tree**

Run: `grep -rn "comparison scope\|Site Energy & Cost Comparison export\|Dashboard PNG\|three export scopes\|current | all | comparison" docs/ README.md CHANGELOG.md`

- [ ] **Step 2: Edit only the lines that are now wrong.** Reuse-before-rewrite: change the specific sentence, do not restructure a doc. Note the two scopes, the cross-site block inside All Facilities, the default-English language change, and the removed web Dashboard PNG action.

- [ ] **Step 3: Commit**

```bash
git add docs/ CHANGELOG.md README.md 2>/dev/null; git add -A
git commit -m "$(cat <<'EOF'
docs(exports): sync report/export docs with the two-scope model

Two export scopes (Current Facility, All Facilities); both cross-site
comparisons live inside All Facilities; web Dashboard toolbar is PDF/Excel/CSV;
default UI language is English with a saved Thai preference honoured.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRKYuRFnLXdEX83qmh3bCt
EOF
)"
```

- [ ] **Step 4: Push the branch (no merge)**

```bash
git push -u origin feat/export-report-ui-parity
```

- [ ] **Step 5: Final report** — produce Part 37 deliverables A–V (audit, RTK findings, mapping table, final PDF order, final Excel order, exclusions, two-scope confirmation, All-Facilities-has-both confirmation, Current-Facility-excludes-cross-site confirmation, toolbar options, PNG-removal-safe confirmation, files changed, sample visual-review result, Excel review result, reconciliation result, tests added, gate results, skill-review findings, branch, commit SHAs, working-tree status, Preview UAT checklist).

---

## Self-Review

**Spec coverage:**

- §2 D1 sequencing — this plan is the implementation phase after approval. ✓
- §2 D2 Executive+Engineering only — Phase 3 renders only `executive` + `dashboard` per facility; Benchmark/Forecast never emitted. ✓
- §2 D3 Current Facility per-facility sections, no cross-site — Task 3.4 asserts it. ✓
- §2 D4 nav label — Task 2.4. ✓
- §2 D5 / §12a default English — Phase 0. ✓
- §6 two scopes — Task 1.4. ✓
- §6.2 Current Facility PDF = §7.1, History tables Excel-only — Task 2.3 order test + Task 4.1 `06 History` sheet. ✓
- §6.3 / §7.2 All Facilities structure — Task 3.1 (one cover + bands) + 3.2/3.3 (cross-site block once). ✓
- §7.4 `buildReportBodyPages` / `includeCover` / `filterReportBodySections` — Task 2.2 + 2.3. ✓
- §7.5 `SiteComparisonReportModel` + signatures + siteCode + null semantics — Task 1.1, 1.2, 1.3, 3.3. ✓
- §8 Excel order 01–07 → 90/91 → raw → hidden — Task 4.1 + 4.2. ✓
- §9 registry split + attribute filter — Task 2.1 + 2.3. ✓
- §10 Live Preview 2-scope, All builds comparison model — Task 1.3 + 1.4. ✓
- §11 contract preservation — Task 3.3 (Rack Positions no In Use, Pending Decommission), Task 6.1 (energy month filter), Rack Unit image untouched (no task modifies `rackUnitImage.ts` / `RackUnitCapacityEntry.tsx`). ✓
- §12 Dashboard PNG — Phase 5. ✓
- §13 report context not controls — no task reproduces filter controls; `buildCrossSiteComparisonPages` emits resolved reference-month only. ✓ (No dedicated task needed — it is an omission constraint.)
- §14 CSV/HTML consistency — Task 1.5 (All Facilities CSV appends SITE_COMPARISON sections), Task 3.x (HTML mirrors PDF). ✓
- §15 canonical mapping — Task 6.2 reconciliation harness. ✓
- §16 tests — Phase 6 + per-task tests. ✓
- §17 sample artifacts — Task 6.2. ✓
- §18 reconciliation — Task 6.2. ✓
- §19 performance — no task re-touches `loadComparison` fan-out; caches reused (Task 1.4 keeps `comparisonCacheRef`). ✓
- §20 commit plan — Phases 0–7 map 1:1 to spec commits 0–7. ✓
- §21 gates — Global Constraints + every phase's final step. ✓
- §22 review gates — handled by the execution sub-skill (subagent review between tasks) + Phase 6 visual reviews. ✓
- §23 risks — `test-all-report` re-run after every `reportHtml.ts` edit (Tasks 2.2, 2.3, 3.1, 3.2, 3.3); Desktop `<UniversalFilterBar>` string left untouched (Task 5.1 Step 5 note); N-site model is the single input (Task 1.1) so no per-format duplication; language flip isolated in Phase 0 with test updates. ✓
- §24 exclusions — Data Entry / Settings / User Management / Benchmark / Forecast never emitted; no task adds them. ✓

**Placeholder scan:** the large SVG chart/rack renderers in Tasks 3.2/3.3 are given as skeletons with exact signatures, exact reused helpers, and exact test contracts rather than full 200-line bodies — the tests pin the behaviour and the reused helpers (`trendPage`, `donutSvg`, `table`, `calculateRackCapacityMetrics`, `rackPositionExportRows`) are all pre-existing. This is the intended granularity for a renderer built iteratively against a pinned test + the live preview; every other task has complete code.

**Type consistency:** `SiteComparisonReportModel` / `SiteComparisonReportSite` field names (`metrics`, `metricsByMonth`, `rack`, `rackUnit`, `siteCode`, `label`, `referenceMonth`, `months`, `sites`) are used identically in Tasks 1.1, 1.3, 1.5, 3.2, 3.3, 4.2, 6.1. `buildReportHtml(data, opts?)` / `buildReportBodyPages(data, sections?)` / `filterReportBodySections(body, sections)` names are consistent across Tasks 2.2, 2.3, 3.1, 3.2. `buildCrossSiteComparisonPages(model, sections?)` consistent Tasks 3.2–3.4. `exportFormats` prop name consistent Task 5.1. `sheetOrderName` consistent Task 4.1/4.2.
