# Task 1.3-1.5 Report: two-scope consolidation + N-site model wiring

## Scope completed

- Consolidated the Reports UI to `ExportScope = "current" | "all"`.
- Removed the standalone comparison report card, its Thai/English copy, filenames, preview branch, imports, and local wrapper.
- Wired `buildSiteComparisonReportModel(await loadComparison(), contextMonth)` into the All Facilities CSV, Excel, HTML, PDF, and scoped-preview paths.
- Updated All Facilities builders to accept `SiteComparisonReportModel | null`; `null` preserves the prior per-facility output.
- Added the behaviour-preserving N-site adapter over the existing two-site HTML/section builders. Cross-site CSV/Excel sections and HTML pages are added once, after the facility content.
- Kept Desktop report/popup/print behaviour and the existing Site Energy & Cost per-site month-filter regression block intact. No nav labels were renamed.

## TDD evidence

### RED

1. Added runtime coverage in `scripts/test-web-clean-v1-exports.ts` for:
   - null comparison output for CSV and HTML;
   - model-backed cross-site HTML section tagging;
   - model-backed `SITE_COMPARISON` CSV output while retaining both facility blocks.
2. Ran:

```text
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
```

3. Observed the expected pre-implementation failure:

```text
TypeError: month.split is not a function
at buildAllFacilitiesReportHtml(...)
```

The new model argument was still interpreted as the old `selectedMonth` parameter, proving the test exercised the missing signature/wiring change.

### GREEN

After the minimal implementation and source-contract updates, these passed:

```text
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-exports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-export-feedback.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-reports.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-report-preview.ts
node node_modules/tsx/dist/cli.mjs scripts/test-web-clean-v1-loading.ts
npm run lint
npm run build
npm run test:all-report
```

Results:

- Runtime exports: `web-clean-v1 exports: 7 + 217 assertions passed`.
- All four source-contract tests passed.
- Lint passed: client, Electron, and server TypeScript checks.
- Production Vite build passed.
- Desktop report gate passed: `12 selected-range month(s). Total report pages: 18.`

## Self-review

- `CleanWebApp.tsx` has exactly two scopes and no standalone comparison card/copy/preview route.
- All four All Facilities formats build the comparison model from `loadComparison()` and forward it.
- `buildAllFacilitiesCsv`, `workbookForFacilities`, and `buildAllFacilitiesReportHtml` only add cross-site content when the model is non-null; HTML uses a single appended adapter body.
- `git diff --check` passed.
- Existing `exportSiteComparison*`, popup/print helpers, and related Desktop behavior were deliberately left unchanged for Task 1.6, as required.

## Concerns

None. The Node test runner emits its existing `localStorage is not available` experimental warning; it did not affect any test result.