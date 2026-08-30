import assert from "node:assert/strict";
import { facilityReportData } from "../src/web-clean-v1/exports";
import { buildReportBodyPages } from "../src/reports/pdf/reportHtml";
import { createEmptyLog } from "../src/utils";

let checks = 0;
const check = (n: string, c: boolean) => { assert.ok(c, n); checks++; };
const log = (m: string) => createEmptyLog(m);
const data = facilityReportData([log("2026-05"), log("2026-06")], "Rangsit", "2026-06");

const body = buildReportBodyPages(data);
const sectionMatches = [...body.matchAll(/<section class="page[^"]*" data-report-section="([a-z-]+)"/g)].map(m => m[1]);
check("every page has a data-report-section", (body.match(/<section class="page/g)?.length ?? 0) === sectionMatches.length);

const order = sectionMatches.filter((v, i) => i === 0 || sectionMatches[i - 1] !== v);
check("current-facility order matches spec 7.1",
  JSON.stringify(order) === JSON.stringify(["executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity"]) ||
  JSON.stringify(order) === JSON.stringify(["executive", "dashboard", "historical", "appendix", "rack-capacity", "rack-unit-capacity", "rack-capacity"]));
check("current facility has NO cross-site pages", !body.includes('data-report-section="site-energy-comparison"') && !body.includes('data-report-section="site-rack-comparison"'));

const onlyRack = buildReportBodyPages(data, ["rack-capacity"]);
check("filter keeps rack-capacity pages", onlyRack.includes('data-report-section="rack-capacity"'));
check("filter drops executive when not selected", !onlyRack.includes('data-report-section="executive"'));

console.log(`report-structure: ${checks} checks passed`);