import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultReportingPeriod, matchingReportingPeriodPreset, monthsForReportingPeriod, reportingPeriodForPreset, resolveAvailableTrailingMonthRange, resolveTrailingMonthRange } from "../src/web-clean-v1/reportPeriod";

assert.deepEqual(resolveTrailingMonthRange("2026-07", 3), { startMonth: "2026-05", endMonth: "2026-07" });
assert.deepEqual(resolveTrailingMonthRange("2026-01", 3), { startMonth: "2025-11", endMonth: "2026-01" });
assert.deepEqual(resolveTrailingMonthRange("2026-07", 12), { startMonth: "2025-08", endMonth: "2026-07" });
assert.deepEqual(resolveAvailableTrailingMonthRange("2026-07", 12, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]), { startMonth: "2026-01", endMonth: "2026-05" });

const defaultPeriod = defaultReportingPeriod("2026-07", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
assert.equal(defaultPeriod.mode, "range");
assert.deepEqual({ start: defaultPeriod.rangeStart, end: defaultPeriod.rangeEnd }, { start: "2026-05", end: "2026-07" });
assert.deepEqual(monthsForReportingPeriod(["2026-05", "2026-06", "2026-07"], defaultPeriod, "2026-07"), ["2026-05", "2026-06", "2026-07"]);

const lastSix = reportingPeriodForPreset("2026-07", 6, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
assert.deepEqual({ start: lastSix.rangeStart, end: lastSix.rangeEnd }, { start: "2026-02", end: "2026-07" });
assert.equal(matchingReportingPeriodPreset(lastSix, "2026-07", ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]), 6);

const lastTwelve = reportingPeriodForPreset("2026-07", 12, ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
assert.deepEqual({ start: lastTwelve.rangeStart, end: lastTwelve.rangeEnd }, { start: "2025-08", end: "2026-07" });

const custom = { ...lastSix, rangeStart: "2026-03" };
assert.equal(matchingReportingPeriodPreset(custom, "2026-07", ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]), null);
assert.deepEqual(monthsForReportingPeriod(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"], reportingPeriodForPreset("2026-05", 12, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]), "2026-05"), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);

// A trailing preset's END month is always the currently selected Reporting
// Month, never the latest available / current calendar month.
assert.deepEqual((p => ({ start: p.rangeStart, end: p.rangeEnd }))(reportingPeriodForPreset("2026-01", 3, ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-08"])), { start: "2025-11", end: "2026-01" });
assert.deepEqual((p => ({ start: p.rangeStart, end: p.rangeEnd }))(reportingPeriodForPreset("2026-01", 6, ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-08"])), { start: "2025-08", end: "2026-01" });
assert.deepEqual((p => ({ start: p.rangeStart, end: p.rangeEnd }))(reportingPeriodForPreset("2026-01", 12, ["2025-02", "2025-06", "2025-12", "2026-01", "2026-08"])), { start: "2025-02", end: "2026-01" });
// The resolved end never leaks a later available month into the window.
assert.equal(reportingPeriodForPreset("2026-01", 3, ["2026-01", "2026-08"]).rangeEnd, "2026-01");

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
// The Quick Range / Reporting Period is Reports-LOCAL state. Its reconcile
// effect re-resolves an active preset against the selected Reporting Month
// (the local `periodEndMonth`, <= the global `month`) every time it changes -
// it is never anchored to latest-available or the calendar month.
assert.ok(app.includes("reportingPeriodForPreset(periodEndMonth, reportPreset, monthsAvailable)"), "an active preset always ends at the selected Reporting Month");
assert.ok(app.includes("const [reportPreset, setReportPreset] = useState<ReportingPeriodPreset | null>(3)"), "the active trailing preset is tracked Reports-locally (default Last 3 Months)");
assert.match(app, /const choosePreset = \(count: ReportingPeriodPreset\) => updatePeriod\(reportingPeriodForPreset\(periodEndMonth, count, periodMonthsAvailable\), count\);/);
assert.match(app, /const updatePeriod = \(next: ReportingPeriodSelection, preset: ReportingPeriodPreset \| null = null\) => \{/);
// Rack comparison is fed ONLY the global Selected Reporting Month - no period
// label, no Quick Range coupling.
assert.ok(app.includes('<WebSiteRackCapacityComparison month={displayMonth} />'), "rack comparison uses the global Selected Reporting Month");
assert.ok(app.includes("const contextMonth = effectiveMonth(period, periodEndMonth);"), "the report context month resolves from the Reports-local period + selected month");
assert.match(app, /const periodEndMonth = useMemo\(\(\) => \{\s*const available = \[\.\.\.monthsAvailable\]\.filter\(value => value <= month\)\.sort\(\);\s*return available\.at\(-1\) \?\? month;/);
// No non-Reports view reads the Reports-local period-derived values.
assert.doesNotMatch(app, /logs=\{reportingPeriodLogs\}|month=\{activeReportingMonth\}|reportMonths=\{selectedReportingMonths\}/);
// The rack comparison component itself must derive everything from the month
// prop - no internal "latest snapshot / new Date()" period.
const rackComparison = readFileSync(new URL("../src/web-clean-v1/WebSiteRackCapacityComparison.tsx", import.meta.url), "utf8");
assert.ok(rackComparison.includes("loadRackCapacitySnapshot(site.id, month)"), "Rack comparison uses the exact selected month through the shared cache");
assert.match(rackComparison, /\}, \[month\]\);/); // load() request/generation key is the month prop
assert.ok(rackComparison.includes('"No monthly Rack Capacity snapshot"'), "no-data text is month-scoped, not a latest-month fallback");
assert.match(
  rackComparison,
  /site\.site\.name.{0,80}monthLabelLong\(month, "en"\)/,
  "rack comparison labels the selected site and month",
);
assert.doesNotMatch(rackComparison, /new Date\(\)|latestAvailableMonth|latestHistoryMonth/);
assert.ok(app.includes('"Last " + count + " Months"'), "English preset label exists");
assert.ok(app.includes('"ย้อนหลัง " + count + " เดือน"'), "Thai preset label exists");
assert.match(app, /selectedReportMonths/);
assert.match(app, /periodIdentity/);
assert.match(app, /reportingMonths: selectedReportMonths/);
assert.ok(app.includes("filterLogsByPeriod(logs, period, periodEndMonth)"), "the report downloads/preview filter by the Reports-local period");
// The Reports-local period NEVER leaks into a non-Reports view: none of the
// removed parent-level derived values exist any more.
assert.doesNotMatch(app, /reportingPeriodLogs|activeReportingMonth|activeReportingDisplayPeriod|selectedReportingMonths|reportingRackCapacityHistory|reportingRackUnitCapacity|reportingUpsGroupHistory|updateReportingPeriod/);
assert.ok(app.includes("logs={history.logs}") && app.includes("selectedMonth={displayMonth}"), "History gets full history + the global Selected Reporting Month");
assert.ok(app.includes("<WebSiteComparison lang={lang} />"), "Site Comparison is not scoped by the Reports Quick Range");
assert.match(app, /WebReportPreview[\s\S]*month=\{contextMonth\}/);
assert.match(app, /exportAllFacilitiesHtml[\s\S]*contextMonth/);

console.log("web-clean-v1 Reporting Period presets: default, presets, rollover, sparse data, custom range, cache identity, and export synchronization passed");