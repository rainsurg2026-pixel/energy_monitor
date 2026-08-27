import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /const BenchmarkDashboard = lazy\(\(\) => import\("\.\.\/components\/BenchmarkDashboard"\)\)/);
assert.match(app, /const ForecastDashboard = lazy\(\(\) => import\("\.\.\/components\/ForecastDashboard"\)\)/);
assert.match(app, /const DASHBOARD_REPORT_VIEWS = \["executive", "dashboard", "benchmark", "forecast"\] as const/);
assert.match(app, /selectedReportView === "benchmark" && <BenchmarkDashboard logs=\{logs\} lang=\{lang\} \/>/);
assert.match(app, /selectedReportView === "forecast" && <ForecastDashboard logs=\{logs\} lang=\{lang\} \/>/);
assert.match(app, /const HistoricalCharts = lazy\(\(\) => import\("\.\.\/components\/HistoricalCharts"\)\)/);
assert.match(app, /<HistoricalCharts logs=\{history\.logs\} lang=\{lang\} selectedMonth=\{month\}/);
assert.match(app, /dataSourceLabel=\{lang === "th" \? "แหล่งข้อมูล: Production API" : "Source: Production API"\}/);

assert.match(app, /const exportDashboard = \(format: "pdf" \| "excel" \| "csv" \| "png"\)/);
assert.match(app, /<UniversalFilterBar lang=\{lang\} onExport=\{exportDashboard\} facility=\{null\} upsGroupNames=\{upsGroupNames\}/);

console.log("web-clean-v1 dashboard: exposes Desktop Benchmark and Forecast tabs from API-backed monthly logs");
