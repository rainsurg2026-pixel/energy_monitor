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

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
assert.ok(app.includes("defaultReportingPeriod(reportingPeriodEndMonth, reportingPeriodAvailableMonths)"), "default period uses latest available months");
assert.ok(app.includes('"Last " + count + " Months"'), "English preset label exists");
assert.ok(app.includes('"ย้อนหลัง " + count + " เดือน"'), "Thai preset label exists");
assert.match(app, /selectedReportMonths/);
assert.match(app, /periodIdentity/);
assert.match(app, /reportingMonths: selectedReportMonths/);
assert.ok(app.includes("filterLogsByPeriod(logs, period, periodEndMonth)"), "exports filter by active period");
assert.ok(app.includes("reportingPeriodLogs"), "views receive filtered period logs");
assert.ok(app.includes("displayPeriod={activeReportingDisplayPeriod}"), "history charts receive active period");
assert.ok(app.includes("reportMonths={selectedReportingMonths}"), "site comparison receives active months");
assert.ok(app.includes("activePeriodLabel={reportingPeriodLabel(reportingPeriod, lang)}"), "comparison labels use active period");
assert.match(app, /WebReportPreview[\s\S]*month=\{contextMonth\}/);
assert.match(app, /exportAllFacilitiesHtml[\s\S]*contextMonth/);
assert.ok(app.includes("exportSiteComparisonHtml(comparison, contextMonth"), "site comparison export uses the active period");

console.log("web-clean-v1 Reporting Period presets: default, presets, rollover, sparse data, custom range, cache identity, and export synchronization passed");