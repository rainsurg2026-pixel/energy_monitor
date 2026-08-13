import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /import BenchmarkDashboard from "\.\.\/components\/BenchmarkDashboard"/);
assert.match(app, /import ForecastDashboard from "\.\.\/components\/ForecastDashboard"/);
assert.match(app, /const DASHBOARD_REPORT_VIEWS = \["executive", "dashboard", "benchmark", "forecast"\] as const/);
assert.match(app, /selectedReportView === "benchmark" && <BenchmarkDashboard logs=\{logs\} lang=\{lang\} \/>/);
assert.match(app, /selectedReportView === "forecast" && <ForecastDashboard logs=\{logs\} lang=\{lang\} \/>/);
assert.match(app, /import HistoricalCharts from "\.\.\/components\/HistoricalCharts"/);
assert.match(app, /<HistoricalCharts logs=\{history\.logs\} lang="en" displayPeriod=\{bootstrap\?\.displayPeriod\.startMonth\.slice\(0, 4\)\} dataSourceLabel="Source: Production API" \/>/);

console.log("web-clean-v1 dashboard: exposes Desktop Benchmark and Forecast tabs from API-backed monthly logs");
