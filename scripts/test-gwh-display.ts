import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatGWh } from "../src/utils/numberFormat";

assert.equal(formatGWh(19.58), "19.580000");
assert.equal(formatGWh(10.2), "10.200000");
assert.equal(formatGWh(0.09), "0.090000");
assert.equal(formatGWh(19.583164), "19.583164");
assert.equal(formatGWh(null), "—");
assert.equal(formatGWh(undefined), "—");

const dashboard = readFileSync(new URL("../src/components/DashboardSummary.tsx", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/components/HistoricalExplorer.tsx", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../src/reports/pdf/reportHtml.ts", import.meta.url), "utf8");
const dc = readFileSync(new URL("../src/components/DcTable.tsx", import.meta.url), "utf8");
assert.ok(dashboard.includes("formatGWh(value)"));
assert.ok(history.includes("formatGWh(value)"));
assert.ok(pdf.includes("formatGWh(dashboard.airPrevious[field])") && pdf.includes("formatGWh(dashboard.airDifference[field])"));
assert.ok(!/isVoltageAbnormal && \([\s\S]*?animate-ping/.test(dc));
console.log("GWh display precision and DC voltage indicator checks passed");