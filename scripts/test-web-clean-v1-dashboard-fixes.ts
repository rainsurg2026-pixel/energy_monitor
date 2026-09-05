import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportYearsFromMonths, resolveReportYear } from "../src/ReportContext";

assert.equal(resolveReportYear("2024", ["2025", "2024"], "2025"), "2024");
assert.equal(resolveReportYear("not-a-year", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("2026", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("not-a-year", ["2026"], "2025"), "2026");
assert.deepEqual(reportYearsFromMonths(["2026-02", "2026-07"], ["2025-01", "2025-12", "2026-07"]), ["2026", "2025"], "year selector includes years available outside the initial six-month log window");


const appSource = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const rackUnitSummarySource = readFileSync(new URL("../src/components/rack/RackUnitCapacitySummary.tsx", import.meta.url), "utf8");
const rackViewsSource = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityViews.tsx", import.meta.url), "utf8");
const exportSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
const browserE2eSource = readFileSync(new URL("./e2e-web-cdp.mjs", import.meta.url), "utf8");
const dashboardSummarySource = readFileSync(new URL("../src/components/DashboardSummary.tsx", import.meta.url), "utf8");
// Engineering View > Air Conditioning Energy Consumption: every EB meter GWh
// display cell uses fixed six-decimal formatting, while the derived kWh total
// keeps its own existing formatter.
assert.match(dashboardSummarySource, /formatFixedNumber, formatNumber2/);
assert.equal((dashboardSummarySource.match(/formatFixedNumber\(value, 6\)/g) ?? []).length, 3);
assert.match(dashboardSummarySource, /airEnergyKwh[^\n]*formatNumber2\(calcs\.airEnergyKwh\)/);
assert.match(appSource, /HISTORY_DATA_VIEWS/);
assert.match(appSource, /loadedPageKeyRef/);
assert.match(appSource, /const DashboardSummary = lazy\(\(\) => import\("\.\.\/components\/DashboardSummary"\)\)/);
assert.match(appSource, /historyCacheRef/);
assert.match(appSource, /\/history\?scope=\$\{scope\}/);
assert.match(appSource, /historyRequestsRef\.current\.set\(cacheKey, request\)/);
assert.match(appSource, /scope: HistoryScope/);
assert.doesNotMatch(appSource, /RackUnitCapacitySummary imageUploadAvailable=/);
assert.match(appSource, /createWebRackUnitImageProvider/);
assert.match(appSource, /view === "rack-units"/);
assert.match(appSource, /<WebRackUnitCapacityDashboard siteName=\{siteName\}/);
assert.match(rackViewsSource, /Monthly Rack Unit Capacity Image/);
assert.match(rackUnitSummarySource, /provider\?: Pick<IDataProvider, "getRackUnitCapacityImage">/);
assert.match(rackUnitSummarySource, /!provider\?\.getRackUnitCapacityImage/);
assert.match(rackUnitSummarySource, /facilityName \?\? ""/);

// Monthly Rack Unit Capacity Image — the live Rack Unit Capacity & Utilization
// page section, held to the approved four-state contract and exact-lookup semantics.
const rackUnitImageSource = readFileSync(new URL("../src/web-clean-v1/rackUnitImage.ts", import.meta.url), "utf8");
const reportPreviewSource = readFileSync(new URL("../src/web-clean-v1/WebReportPreview.tsx", import.meta.url), "utf8");
// 1. Section is rendered on the live page with the exact-site image provider.
assert.match(appSource, /const imageProvider = useMemo\(\(\) => createWebRackUnitImageProvider\(siteId\), \[siteId\]\)/);
assert.match(appSource, /<WebRackUnitCapacityDashboard [^>]*imageProvider=\{imageProvider\}/);
assert.match(rackViewsSource, /<RackUnitImage provider=\{imageProvider\} facilityName=\{facilityName\} month=\{month\} \/>/);
// 2. Exact siteId + selected reporting month, never a latest-month fallback.
assert.match(appSource, /getRackUnitCapacityImage: async \(facility, reportingMonth\) => \{\s*const image = await loadWebRackUnitCapacityImage\(siteId, reportingMonth\)/);
assert.match(rackUnitImageSource, /No latest-month fallback is allowed/);
assert.match(rackUnitImageSource, /\/rack-unit-capacity\?siteId=\$\{siteId\}&month=\$\{encodeURIComponent\(reportingMonth\)\}/);
// 3/4/5. Four distinct render states: loading, image, no-data, error.
assert.match(rackViewsSource, /Loading Monthly Rack Unit Capacity Image…/);
assert.match(rackViewsSource, /<img src=\{image\.dataUri\}[^>]*object-contain/);
assert.match(rackViewsSource, /No Monthly Rack Unit Capacity Image is available for this reporting month\./);
assert.match(rackViewsSource, /Unable to load Monthly Rack Unit Capacity Image\./);
assert.match(rackViewsSource, /\.catch\(\(\) => \{ if \(!cancelled\) \{ setImage\(null\); setError\(true\); \} \}\)/);
// 6. Site/month switch cannot surface a stale prior image: in-flight guard + keyed remount.
assert.match(rackViewsSource, /let cancelled = false;/);
assert.match(rackViewsSource, /return \(\) => \{ cancelled = true; \};/);
assert.match(rackViewsSource, /<RackCapacityProvider key=\{`\$\{siteName \?\? ""\}:\$\{month\}`\}/);
// 7. Export/report path is untouched and shares the same underlying loader.
assert.match(reportPreviewSource, /loadWebRackUnitCapacityImage\(siteId, month\)\.catch\(\(\) => null\)/);
assert.match(reportPreviewSource, /rackUnitCapacityImageDataUri: rackUnitImage\?\.dataUri \?\? null/);

// Site Energy & Cost Comparison export: chart scope follows Quick Period,
// except a one-month report deliberately expands only the chart window to the
// trailing 12 available months. Per-site rows are still filtered by `.month`.
assert.match(appSource, /selectedReportMonths\.length === 1/);
assert.match(appSource, /recentMonthsThroughSelected\(result\.months, selectedMonth, 12\)/);
assert.match(appSource, /months: item\.months\.filter\(entry => chartMonthSet\.has\(entry\.month\)\)/);
assert.doesNotMatch(appSource, /item\.months\.filter\(value => chartMonthSet\.has\(value\)\)/);
assert.match(exportSource, /import\("html2canvas"\)/);
assert.match(exportSource, /import\("jspdf"\)/);
assert.match(exportSource, /const renderScale = compact \? 1\.5 : PDF_RENDER_SCALE/);
assert.match(exportSource, /scale: renderScale/);
assert.match(exportSource, /compact \? canvas\.toDataURL\("image\/jpeg", 0\.82\) : canvas\.toDataURL\("image\/png"\)/);
assert.match(exportSource, /height: Math\.max\(page\.scrollHeight, page\.offsetHeight, 1\)/);
assert.match(exportSource, /pdf\.save\(ensureExtension\(fileName, "pdf"\)\)/);
assert.match(appSource, /exportDesktopPdfFile/);
assert.doesNotMatch(appSource, /openReportPopup/);
assert.match(browserE2eSource, /E2E_REQUIRE_AUTH/);
assert.match(browserE2eSource, /Browser\.downloadProgress/);
assert.match(browserE2eSource, /Network\.responseReceived/);

// Regression: switching sites while staying on the Rack Unit Capacity (or any
// rack) view used to leave the KPI/trend panels empty until the view was
// remounted. Root cause: selectSite() always primed the "dashboard" history
// scope, whose payload is disjoint from the "rack" scope, so the background
// dashboard response overwrote the rack payload and the page-key was left
// pointing at ":dashboard" so the effect never re-fetched. The fix routes both
// selectSite() and the page-load effect through one scopeForView() helper and
// keys the loaded page by the live view.
assert.match(appSource, /const scopeForView = \(target: View\): HistoryScope =>/);
// Dashboard/History/Reports/Comparisons -> "full" (charts must be able to show
// the whole Global Display Period); only Data Entry keeps the light scope.
assert.match(appSource, /target === "racks" \|\| target === "rack-units" \? "rack" : target === "entry" \? "dashboard" : "full"/);
assert.match(appSource, /const scope: HistoryScope = scopeForView\(view\);/);
assert.match(appSource, /const scope = scopeForView\(view\); const records = await loadHistory\(id, \{ force: true, scope \}\);/);
assert.match(appSource, /loadedPageKeyRef\.current = `\$\{id\}:\$\{view\}`;/);
assert.doesNotMatch(appSource, /loadedPageKeyRef\.current = `\$\{id\}:dashboard`/);

// Progressive prefetch after login/site switch warms the other history scopes
// without ever calling setHistory (the disjoint payloads would blank the
// mounted view), so History, Reports, and Rack views reopen near-instantly.
assert.match(appSource, /const prefetchHistoryScopes = useCallback\(\(id: number\) => \{/);
assert.match(appSource, /for \(const scope of \["full", "rack"\] as const\) void loadHistory\(id, \{ scope, prefetch: true \}\)/);
assert.match(appSource, /options: \{ force\?: boolean; scope\?: HistoryScope; prefetch\?: boolean \}/);
assert.match(appSource, /if \(!options\.prefetch\) void request\.then\(showResult, \(\) => undefined\);/);
assert.match(appSource, /prefetchHistoryScopes\(first\.id\);/);
assert.match(appSource, /loadedPageKeyRef\.current = `\$\{id\}:\$\{view\}`; prefetchHistoryScopes\(id\);/);

// Regression: a facility switch must preserve the user's selected Reporting
// Month. selectSite() used to recompute the month from the new site's
// latestAvailableMonth / latestEnergyMonth on every switch, silently jumping
// A -> B -> A off the month the user picked. It now reloads the SAME month for
// the new site; if that month has no data on the new site, loadMonth() renders
// the normal empty state and the month still does not change.
assert.match(appSource, /const scope = scopeForView\(view\); const records = await loadHistory\(id, \{ force: true, scope \}\);[^;]*await loadMonth\(id, month, records\);/);
assert.doesNotMatch(appSource, /await loadMonth\(id, latestEnergyMonth\(/);
assert.doesNotMatch(appSource, /const candidate = nextSite\.latestAvailableMonth/);
// Initial load still resolves the default month (not a site switch).
assert.match(appSource, /const energyMonth = latestEnergyMonth\(initialHistory\.logs, initialMonth\);/);
// After a Global Display Period change the Settings refresh path RECONCILES the
// selected month: it is kept when still in range, otherwise snapped to the
// nearest valid boundary - never "jump to the site's latest month".
assert.match(appSource, /const reconciledMonth = clampMonthToDisplayPeriod\(month, result\.displayPeriod\.startMonth, windowEnd, current\.availableMonths\);/);
assert.match(appSource, /await loadMonth\(current\.id, reconciledMonth, records\);/);
assert.doesNotMatch(appSource, /await loadMonth\(current\.id, latestEnergyMonth\(records\.logs, candidate\), records\);/);
// The Reporting Period reconcile effect now lives INSIDE the Reports component
// (Reports-local state). It reacts to a site change but only ever re-derives
// the local period, never the global month, so the Quick Range stays isolated.
assert.match(appSource, /\}, \[monthsAvailable, periodEndMonth, reportPreset, siteId\]\);/);
const reconcileEffect = appSource.slice(appSource.indexOf("if (monthsAvailable.length === 0) return;"), appSource.indexOf("}, [monthsAvailable, periodEndMonth, reportPreset, siteId]);"));
assert.ok(!reconcileEffect.includes("setMonth("), "the reporting-period reconcile effect never resets the reporting month");

console.log("web-clean-v1 dashboard fixes: browser PDF/download E2E contract assertions passed");
