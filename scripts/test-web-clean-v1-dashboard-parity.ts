import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const filterBar = readFileSync(new URL("../src/components/UniversalFilterBar.tsx", import.meta.url), "utf8");
const reportContext = readFileSync(new URL("../src/ReportContext.tsx", import.meta.url), "utf8");
const benchmark = readFileSync(new URL("../src/components/BenchmarkDashboard.tsx", import.meta.url), "utf8");
const forecast = readFileSync(new URL("../src/components/ForecastDashboard.tsx", import.meta.url), "utf8");
const engineering = readFileSync(new URL("../src/components/DashboardSummary.tsx", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../src/domain/analytics.ts", import.meta.url), "utf8");

assert.match(app, /const BenchmarkDashboard = lazy\(\(\) => import\("\.\.\/components\/BenchmarkDashboard"\)\)/);
assert.match(app, /const ForecastDashboard = lazy\(\(\) => import\("\.\.\/components\/ForecastDashboard"\)\)/);
assert.match(app, /const DASHBOARD_REPORT_VIEWS = \["executive", "dashboard", "benchmark", "forecast"\] as const/);
assert.match(app, /selectedReportView === "benchmark" && <BenchmarkDashboard logs=\{logs\} lang=\{lang\} \/>/);
assert.match(app, /selectedReportView === "forecast" && <ForecastDashboard logs=\{logs\} lang=\{lang\} \/>/);

// History stays anchored to the Global Reporting Month, never the Reports-local quick range.
assert.match(app, /<HistoricalCharts logs=\{history\.logs\} lang=\{lang\} selectedMonth=\{displayMonth\}/);
assert.match(app, /dataSourceLabel=\{lang === "th" \? "แหล่งข้อมูล: Production API" : "Source: Production API"\}/);

// Filter Bar V2 receives real shell context and can change the actual reporting month.
assert.match(app, /<UniversalFilterBar lang=\{lang\} onExport=\{exportDashboard\}/);
assert.match(app, /siteName=\{siteName\}/);
assert.match(app, /selectedMonth=\{activeMonth\}/);
assert.match(app, /availableMonths=\{availableMonths\}/);
assert.match(app, /onReportingMonthChange=\{onSelectMonth\}/);
assert.match(app, /onRefresh=\{onRefresh\}/);
assert.match(filterBar, /data-testid="filter-bar-v2"/);
assert.match(filterBar, /changeReportingMonth/);
assert.match(filterBar, /setSelectedYear\(year\)/);
assert.match(filterBar, /setSelectedPeriod\(month\)/);

// Advanced filters are view-specific and Engineering does not expose PUE/Carbon categories.
assert.match(filterBar, /data-testid=\{`advanced-filters-\$\{selectedReportView\}`\}/);
assert.match(filterBar, /selectedReportView === "executive"/);
assert.match(filterBar, /selectedReportView === "dashboard"/);
assert.match(filterBar, /selectedReportView === "benchmark"/);
assert.match(filterBar, /selectedReportView === "forecast"/);
const categoryBlock = filterBar.slice(filterBar.indexOf("const engineeringCategories"), filterBar.indexOf("const monthOptions"));
assert.doesNotMatch(categoryBlock, /value: "PUE"/);
assert.doesNotMatch(categoryBlock, /value: "Carbon"/);

// Benchmark/Forecast filter state is shared through ReportContext, not duplicated local state.
assert.match(reportContext, /selectedBenchmarkReference/);
assert.match(reportContext, /forecastMetric/);
assert.match(reportContext, /forecastHorizon/);
assert.match(benchmark, /selectedBenchmarkReference/);
assert.match(forecast, /forecastMetric: metric/);
assert.match(forecast, /forecastHorizon: horizon/);
assert.doesNotMatch(forecast, /data-testid="forecast-filters"/);

// No unsourced benchmark targets or carbon conversion values are exposed in V2.
assert.doesNotMatch(benchmark, /industryPueTarget|companyPueTarget|assume 5%|assume 10%|Green DC Standard|ESG Target/);
assert.doesNotMatch(filterBar, /value="carbonEmissionKg"/);
assert.match(analytics, /const carbonEmissionKg = null/);
assert.doesNotMatch(analytics, /totalEnergyKwh \* 0\.4991/);

// Engineering remains expanded and adds a Web-only sticky section navigator.
assert.match(engineering, /data-testid="engineering-sticky-nav"/);
assert.match(engineering, /IntersectionObserver/);
assert.match(engineering, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
for (const id of ["engineering-ups", "engineering-air", "engineering-dc", "engineering-overall"]) {
  assert.match(engineering, new RegExp(id));
}

assert.match(app, /const exportDashboard = \(format: "pdf" \| "excel" \| "csv"\)/);
assert.doesNotMatch(app, /Dashboard PNG export requires the Desktop app/);

console.log("web-clean-v1 dashboard parity: Filter Bar V2, data-backed Benchmark/Forecast controls, no unsourced Carbon, and sticky Engineering navigation passed");
