import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const desktopApp = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const filterBar = readFileSync(new URL("../src/components/UniversalFilterBar.tsx", import.meta.url), "utf8");
const reportContext = readFileSync(new URL("../src/ReportContext.tsx", import.meta.url), "utf8");
const benchmark = readFileSync(new URL("../src/components/BenchmarkDashboard.tsx", import.meta.url), "utf8");
const engineering = readFileSync(new URL("../src/components/DashboardSummary.tsx", import.meta.url), "utf8");
const executive = readFileSync(new URL("../src/components/ExecutiveDashboard.tsx", import.meta.url), "utf8");
const historical = readFileSync(new URL("../src/components/HistoricalCharts.tsx", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../src/domain/analytics.ts", import.meta.url), "utf8");
const rackContext = readFileSync(new URL("../src/components/rack/RackCapacityContext.tsx", import.meta.url), "utf8");

assert.match(app, /const BenchmarkDashboard = lazy\(\(\) => import\("\.\.\/components\/BenchmarkDashboard"\)\)/);
assert.match(app, /const DASHBOARD_REPORT_VIEWS = \["executive", "dashboard", "benchmark"\] as const/);
assert.doesNotMatch(app, /SmartInsightPanel/, "Executive View no longer renders Smart Facility Analytics Panel");
assert.match(app, /selectedReportView === "benchmark" && <BenchmarkDashboard logs=\{logs\} lang=\{lang\} \/>/);

// Forecast is removed from both hosted Web and Desktop, not merely hidden.
assert.equal(existsSync(new URL("../src/components/ForecastDashboard.tsx", import.meta.url)), false);
assert.equal(existsSync(new URL("../src/components/rack/Forecast.tsx", import.meta.url)), false);
for (const source of [app, desktopApp, filterBar, reportContext, rackContext]) {
  assert.doesNotMatch(source, /forecast/iu);
}
assert.doesNotMatch(analytics, /generateForecast|ForecastPoint|linearRegression/);
assert.match(reportContext, /stored === "dashboard" \|\| stored === "benchmark" \|\| stored === "history" \? stored : "executive"/);

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
const categoryBlock = filterBar.slice(filterBar.indexOf("const engineeringCategories"), filterBar.indexOf("const monthOptions"));
assert.doesNotMatch(categoryBlock, /value: "PUE"/);
assert.doesNotMatch(categoryBlock, /value: "Carbon"/);

// Benchmark filter state remains shared through ReportContext.
assert.match(reportContext, /selectedBenchmarkReference/);
assert.match(benchmark, /selectedBenchmarkReference/);

// No unsourced benchmark targets or carbon conversion values are exposed in V2.
assert.doesNotMatch(benchmark, /industryPueTarget|companyPueTarget|assume 5%|assume 10%|Green DC Standard|ESG Target/);
assert.doesNotMatch(filterBar, /value="carbonEmissionKg"/);
assert.match(analytics, /const carbonEmissionKg = null/);
assert.doesNotMatch(analytics, /totalEnergyKwh \* 0\.4991/);

// Executive and Engineering summary cards stay data-backed and cross-view aligned.
assert.match(executive, /buildingEnergyKwh/);
assert.match(executive, /buildingElectricityCostThb/);
assert.match(executive, /grid grid-cols-2 gap-4 lg:grid-cols-4/);
assert.match(engineering, /data-testid="engineering-operational-totals"/);
for (const label of ["2.1 Total UPS and PPC Load Status – DCM 4th Floor", "2.2 Total Air", "2.3 Total DC Power Panels"]) assert.ok(engineering.includes(label), `Engineering summary includes ${label}`);
assert.match(historical, /4th Floor Total Accumulation/);
assert.match(historical, /4th Floor Monthly Average/);

// Engineering remains expanded and adds a Web-only sticky section navigator.
assert.match(engineering, /data-testid="engineering-sticky-nav"/);
assert.match(engineering, /IntersectionObserver/);
assert.match(engineering, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
for (const id of ["engineering-ups", "engineering-air", "engineering-dc", "engineering-overall"]) {
  assert.match(engineering, new RegExp(id));
}

assert.match(app, /const exportDashboard = \(format: "pdf" \| "excel" \| "csv"\)/);
assert.doesNotMatch(app, /Dashboard PNG export requires the Desktop app/);

console.log("web-clean-v1 dashboard parity: Forecast removed from Web/Desktop runtime, Filter Bar V2 and Benchmark remain data-backed, and sticky Engineering navigation passed");
