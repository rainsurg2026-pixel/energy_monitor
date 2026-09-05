import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultReportingPeriod,
  effectiveMonth,
  filterLogsByPeriod,
  reportingPeriodForPreset,
  type ReportingPeriodSelection
} from "../src/web-clean-v1/reportPeriod";
import { clampMonthToDisplayPeriod } from "../src/web-clean-v1/facilityContext";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// THREE separated time-period concepts
//   A. GLOBAL DISPLAY PERIOD  - Settings-configured allowed month window
//   B. SELECTED REPORTING MONTH - the top-of-page month picker (`month`)
//   C. REPORT QUICK RANGE     - Reports-view-only Last 3/6/12 + From/To
// ---------------------------------------------------------------------------

// --- C is Reports-LOCAL, never lifted to the app shell -----------------------
const reportsBody = app.slice(app.indexOf("function Reports("), app.indexOf("function SettingsPage("));
assert.match(reportsBody, /const \[reportPeriod, setReportPeriod\] = useState<ReportingPeriodSelection>\(\(\) => defaultReportingPeriod\(month\)\)/);
assert.match(reportsBody, /const \[reportPreset, setReportPreset\] = useState<ReportingPeriodPreset \| null>\(3\)/);
assert.match(reportsBody, /const updatePeriod = \(next: ReportingPeriodSelection, preset: ReportingPeriodPreset \| null = null\) => \{/);

// The CleanWebApp shell no longer owns any Reporting Period state or any of
// the derived values that used to leak it into every view.
const shellBody = app.slice(app.indexOf("export default function CleanWebApp()"), app.indexOf("function Reports("));
for (const leaked of [
  "reportingPeriod", "reportingPeriodPreset", "setReportingPeriod", "updateReportingPeriod",
  "reportingPeriodLogs", "activeReportingMonth", "selectedReportingMonths", "selectedReportingMonthSet",
  "reportingRackCapacityHistory", "reportingRackUnitCapacity", "reportingUpsGroupHistory",
  "activeReportingDisplayPeriod", "reportingPeriodEndMonth", "reportingPeriodAvailableMonths"
]) {
  assert.ok(!shellBody.includes(leaked), `CleanWebApp shell must not reference '${leaked}' (Quick Range leak vector)`);
}
assert.ok(!app.includes("onPeriodChange"), "the Reports component no longer takes an onPeriodChange prop");

// --- Non-Reports views read GLOBAL month + full history, never the Quick Range
assert.match(app, /view === "dashboard" && <DashboardView logs=\{history\.logs\} month=\{displayMonth\}/);
assert.match(app, /view === "racks" && siteId && <RackCapacityView[^>]*month=\{displayMonth\}[^>]*rackCapacityHistory=\{historyRackCapacityHistory\}/);
assert.match(app, /view === "rack-units" && siteId && <RackUnitCapacityView[^>]*month=\{displayMonth\}/);
assert.match(app, /<HistoricalCharts logs=\{history\.logs\} lang=\{lang\} selectedMonth=\{displayMonth\} displayPeriod=\{globalDisplayPeriodRange\}/);
assert.match(app, /<HistoricalExplorer logs=\{history\.logs\} lang=\{lang\} selectedMonth=\{displayMonth\} displayPeriod=\{globalDisplayPeriodRange\}/);
assert.match(app, /view === "comparison" && <WebSiteComparison lang=\{lang\} \/>/);
assert.match(app, /view === "rack-comparison" && <WebSiteRackCapacityComparison month=\{displayMonth\} \/>/);
// WebSiteComparison must not keep a `reportMonths` prop that defaults to a new
// [] each render - that made its load useCallback identity churn and refetch
// /site-comparison in a loop once the Reports Quick Range stopped feeding it.
const comparison = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
assert.doesNotMatch(comparison, /reportMonths|activePeriodLabel/);
assert.match(comparison, /const load = useCallback\(async \(\) => \{[\s\S]*\}, \[\]\);/);

// --- A: the Global Display Period is applied CLIENT-side, not just server-side
assert.match(app, /const displayPeriodStart = bootstrap\?\.displayPeriod\.startMonth \?\? null;/);
assert.match(app, /const siteMonthsAvailable = useMemo\(\(\) => \{[\s\S]*union\.filter\(value => value >= displayPeriodStart && value <= displayPeriodEnd\)/);
// B is hard-clamped into A before any non-Reports view sees it.
assert.match(app, /const displayMonth = useMemo\(\(\) => \{[\s\S]*if \(month < displayPeriodStart\) return[\s\S]*if \(month > effectiveDisplayPeriodEnd\) return/);
// Reports receives the clamped month + the clamped month universe as props.
assert.match(app, /<Reports [^>]*month=\{displayMonth\}[^>]*monthsAvailable=\{siteMonthsAvailable\}/);

// --- clearSession no longer resets a (now non-existent) shared period --------
assert.ok(!/setReportingPeriod\(defaultReportingPeriod/.test(app), "clearSession must not touch a shared reporting period");

// ---------------------------------------------------------------------------
// PART 2 / 7 - Global Display Period actually governs, and Settings save
// reconciles the Selected Reporting Month deterministically.
// ---------------------------------------------------------------------------
// Dashboard month resolution is clamped into the window (the `${year}-${period}`
// escape in selectedDashboardMonth cannot target a hidden month).
assert.match(app, /const activeMonth = useMemo\(\(\) => \{\s*const resolved = selectedDashboardMonth\(logs, selectedYear, selectedPeriod, month\);\s*const \[windowStart, windowEnd\] = \(displayPeriod \?\? ""\)\.split\("\.\."\);\s*return windowStart && windowEnd && \(resolved < windowStart \|\| resolved > windowEnd\) \? month : resolved;/);
assert.match(app, /<DashboardView logs=\{history\.logs\} month=\{displayMonth\} displayPeriod=\{globalDisplayPeriodRange\}/);
// Settings save: clear time-window caches + reconcile month to nearest boundary.
assert.match(app, /historyCacheRef\.current\.clear\(\);\s*loadedPageKeyRef\.current = null;\s*setBootstrap\(result\)/);
assert.match(app, /const reconciledMonth = clampMonthToDisplayPeriod\(month, result\.displayPeriod\.startMonth, windowEnd, current\.availableMonths\);/);
assert.ok(!app.includes("latestEnergyMonth(records.logs, candidate)"), "the Settings refresh path no longer jumps to the site's latest month");

// clampMonthToDisplayPeriod: keep-if-valid, else NEAREST boundary (not latest).
assert.equal(clampMonthToDisplayPeriod("2026-07", "2026-01", "2026-12"), "2026-07"); // in range -> unchanged
assert.equal(clampMonthToDisplayPeriod("2026-07", "2026-01", "2026-06"), "2026-06"); // past end -> end
assert.equal(clampMonthToDisplayPeriod("2025-11", "2026-01", "2026-12"), "2026-01"); // before start -> start
assert.equal(clampMonthToDisplayPeriod("2026-12", "2026-01", "2026-06", ["2026-02", "2026-05"]), "2026-05"); // -> nearest available <= end
assert.equal(clampMonthToDisplayPeriod("2025-01", "2026-01", "2026-06", ["2026-02", "2026-05"]), "2026-02"); // -> nearest available >= start

// PART 3 - Dashboard uses the "full" history scope so its trend charts can
// show the whole configured Global Display Period, not the newest 6 months.
assert.match(app, /target === "racks" \|\| target === "rack-units" \? "rack" : target === "entry" \? "dashboard" : "full"/);

// ---------------------------------------------------------------------------
// PART 5 / 6 - the Dashboard trend window is a trailing "Last N Months" that
// slides with the selected month and is NOT clipped to one calendar year, so
// each series keeps its own completeness across the year boundary.
// ---------------------------------------------------------------------------
const trend = readFileSync(new URL("../src/components/EngineeringTrendCharts.tsx", import.meta.url), "utf8");
assert.doesNotMatch(trend, /processed\.filter\(row => row\.month\.startsWith\(`\$\{selectedYear\}-`\)\)/);
assert.match(trend, /const anchorMonth = selectedDashboardMonth\(processed, selectedYear, selectedPeriod, processed\[processed\.length - 1\]!\.month\)/);
assert.match(trend, /recentMonthsThroughSelected/);
assert.match(trend, /return processed\.filter\(row => windowMonths\.has\(row\.month\)\)/);
// missing metric stays null (a per-series gap), the month row is never dropped:
assert.match(trend, /values: trendData\.map\(point => point\[chart\.key\]\)/);

// ---------------------------------------------------------------------------
// Functional: a trailing preset's window always ends at the SELECTED reporting
// month and is independent of the current calendar date.
// ---------------------------------------------------------------------------
const months = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const last3 = reportingPeriodForPreset("2026-07", 3, months);
assert.deepEqual([last3.rangeStart, last3.rangeEnd], ["2026-05", "2026-07"]);
const last6 = reportingPeriodForPreset("2026-07", 6, months);
assert.deepEqual([last6.rangeStart, last6.rangeEnd], ["2026-02", "2026-07"]);
const last12 = reportingPeriodForPreset("2026-07", 12, months);
assert.deepEqual([last12.rangeStart, last12.rangeEnd], ["2025-08", "2026-07"]);

// Global Display Period Jan..Jul 2026: "Last 12" ending Jul 2026 resolves to
// Jan..Jul 2026 (only the months actually inside the window), NOT Aug 2025.
const windowed = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const clamped12 = reportingPeriodForPreset("2026-07", 12, windowed);
assert.deepEqual([clamped12.rangeStart, clamped12.rangeEnd], ["2026-01", "2026-07"]);

// A report download filters full history down to the local period, never widening it.
const logs = months.map(month => ({ month }) as unknown as Parameters<typeof filterLogsByPeriod>[0][number]);
const period: ReportingPeriodSelection = reportingPeriodForPreset("2026-07", 3, months);
const filtered = filterLogsByPeriod(logs, period, "2026-07").map(log => log.month);
assert.deepEqual(filtered, ["2026-05", "2026-06", "2026-07"]);
assert.equal(effectiveMonth(defaultReportingPeriod("2026-07", months), "2026-07"), "2026-07");

console.log("web-clean-v1 time-period isolation: Global Display Period + Selected Reporting Month + Reports-local Quick Range are three separate concepts; the Quick Range never leaves the Reports view");
