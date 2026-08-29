import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const historyProvider = readFileSync(new URL("../src/reporting/HistoryProvider.ts", import.meta.url), "utf8");

assert.match(app, /import \{ HistoryProvider \} from "\.\.\/reporting\/HistoryProvider"/);
assert.match(app, /const \[recentReports, setRecentReports\]/);
assert.match(app, /const readRecentReports = \(\): ReportHistoryItem\[\] /);
assert.match(app, /const rememberReport = \(filename: string\)/);
assert.match(app, /crypto\.randomUUID/);
assert.match(app, /HistoryProvider\.add\(item\)/);
assert.match(app, /const reportContextKey = `\$\{siteName\}\\u0000\$\{contextMonth\}`/);
assert.match(app, /setFileNameCustomized\(false\)/);
// The Reporting Period / Quick Range is owned LOCALLY by the Reports component
// (never lifted to CleanWebApp), so choosing Last 3/6/12 or a custom From/To
// range here cannot move the Dashboard, History, Comparisons, or Rack views.
assert.match(app, /const \[reportPeriod, setReportPeriod\] = useState<ReportingPeriodSelection>\(\(\) => defaultReportingPeriod\(month\)\)/);
assert.match(app, /const \[reportPreset, setReportPreset\] = useState<ReportingPeriodPreset \| null>\(3\)/);
assert.doesNotMatch(app, /onPeriodChange/);
assert.match(app, /const selectedPreset = matchingReportingPeriodPreset\(period, periodEndMonth, periodMonthsAvailable\)/);
assert.match(app, /choosePreset\(count as ReportingPeriodPreset\)/);
assert.match(app, /\[3, 6, 12\]\.map\(count =>/);
assert.match(app, /const contextMonth = effectiveMonth\(period, periodEndMonth\)/);
assert.match(app, /Recent Reports/);
assert.match(app, /HistoryProvider\.remove\(item\.id\)/);
assert.match(app, /all-facilities-energy-monitor\.xlsx/);
assert.match(app, /site-comparison-\$\{contextMonth\}\.xlsx/);
assert.match(app, /exportAllFacilitiesHtml/);
assert.match(app, /exportSiteComparisonHtml/);
assert.match(app, /withExtension\(resolvedFileName, "html"\)/);
const exports = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
assert.match(exports, /export function exportHtml/);
assert.match(exports, /export function exportAllFacilitiesHtml/);
assert.match(exports, /export function exportSiteComparisonHtml/);
assert.match(exports, /text\/html;charset=utf-8/);
assert.match(app, /<WebReportPreview[^>]+logs=\{scopedLogs\} calculationLogs=\{logs\}/);
assert.match(app, /ReportRegistry\.all\(\)/);
assert.match(app, /selectedReportSections/);
assert.match(app, /Choose sections for the preview and PDF\/HTML/);
const preview = readFileSync(new URL("../src/web-clean-v1/WebReportPreview.tsx", import.meta.url), "utf8");
assert.match(preview, /calculationLogs\?: MonthlyLog\[\]/);
assert.match(preview, /facilityReportData\(logs, siteName, month, rack, rackCapacityHistory, rackUnitCapacity, calculationLogs \?\? logs,\s*\{/);
assert.match(preview, /sections\?: readonly ReportSectionId\[\]/);
assert.match(preview, /buildReportHtml\(facilityReportData\(logs, siteName, month, rack, rackCapacityHistory, rackUnitCapacity, calculationLogs \?\? logs,\s*\{/);
const reportHtml = readFileSync(new URL("../src/reports/pdf/reportHtml.ts", import.meta.url), "utf8");
assert.match(reportHtml, /selectedSections\?: readonly ReportSectionId\[\]/);
assert.match(reportHtml, /filterReportHtmlBySections/);
assert.match(historyProvider, /slice\(0, 50\)/);

console.log("web-clean-v1 reports: exports retain a local recent-report history like Desktop");
