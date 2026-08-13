import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const comparison = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(comparison, /api<SiteComparisonExport>\("\/site-comparison"\)/);
assert.match(comparison, /function WebSiteComparison\(\{ lang = "th" \}/);
assert.match(comparison, /\/racks\?siteId=\$\{site\.site\.id\}&month=\$\{referenceMonth\}/);
assert.match(comparison, /\/rack-unit-capacity\?siteId=\$\{site\.site\.id\}&month=\$\{referenceMonth\}/);
assert.match(comparison, /Floor 4 Electricity Cost Trend/);
assert.match(comparison, /Rack Capacity and Utilization/);
assert.match(comparison, /Rack Unit Capacity and Utilization/);
assert.match(comparison, /No rack snapshot for this month/);
assert.match(comparison, /No rack-unit snapshot for this month/);
assert.match(app, /import WebSiteComparison from "\.\/WebSiteComparison"/);
assert.match(app, /\{view === "comparison" && <WebSiteComparison lang=\{lang\} \/>\}/);
assert.doesNotMatch(app, /function SiteComparison\(/);

console.log("web site comparison: uses only isolated API snapshots and does not infer missing rack capacity");
