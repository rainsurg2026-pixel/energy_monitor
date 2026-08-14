import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const comparison = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const apiService = readFileSync(new URL("../server/services/apiService.ts", import.meta.url), "utf8");

assert.match(comparison, /api<SiteComparisonExport>\("\/site-comparison"\)/);
assert.match(comparison, /function WebSiteComparison\(\{ lang = "th" \}/);
assert.match(comparison, /\/racks\?siteId=\$\{site\.site\.id\}&month=\$\{referenceMonth\}/);
assert.match(comparison, /\/rack-unit-capacity\?siteId=\$\{site\.site\.id\}&month=\$\{referenceMonth\}/);
assert.match(comparison, /Floor 4 Electricity Cost Trend/);
assert.match(comparison, /Rack Capacity and Utilization/);
assert.match(comparison, /Rack Unit Capacity and Utilization/);
assert.match(comparison, /LabelList/);
assert.match(comparison, /isAnimationActive=\{false\}/);
assert.match(comparison, /fill=\{siteColour\(index\)\}/);
assert.match(comparison, /formatMonthLabel/);
assert.match(comparison, /formatCompact/);
assert.match(comparison, /grid-cols-1/);
assert.match(comparison, /rack-usage/);
assert.match(comparison, /No rack snapshot for this month/);
assert.match(comparison, /No rack-unit snapshot for this month/);
assert.match(comparison, /const copy = th \?/);
assert.match(comparison, /ความจุแร็คและการใช้งาน/);
assert.match(comparison, /ความจุหน่วยแร็คและการใช้งาน/);
assert.match(app, /const WebSiteComparison = lazy\(\(\) => import\("\.\/WebSiteComparison"\)\)/);
assert.match(app, /\{view === "comparison" && <WebSiteComparison lang=\{lang\} \/>\}/);
assert.doesNotMatch(app, /function SiteComparison\(/);
assert.match(apiService, /rackUnitCapacity/);
assert.match(apiService, /hasObject/);
assert.match(apiService, /const \[periods, rackHistory, rackUnitRows\] = await Promise\.all/);

console.log("web site comparison: uses only isolated API snapshots and does not infer missing rack capacity");
