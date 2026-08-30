import assert from "node:assert/strict";
import { ReportRegistry } from "../src/reporting/ReportRegistry";
let checks = 0;
const check = (n: string, c: boolean) => { assert.ok(c, n); checks++; };

const ids = ReportRegistry.all().map(s => s.id);
check("has site-energy-comparison", ids.includes("site-energy-comparison"));
check("has site-rack-comparison", ids.includes("site-rack-comparison"));
check("no legacy site-comparison id", !ids.includes("site-comparison" as never));
const energy = ReportRegistry.all().find(s => s.id === "site-energy-comparison");
const rack = ReportRegistry.all().find(s => s.id === "site-rack-comparison");
check("energy title", energy?.title === "Site Energy & Cost Comparison");
check("rack title", rack?.title === "Site Rack Capacity & Availability Comparison");
check("forType('site-comparison') still returns both",
  ReportRegistry.forType("site-comparison").map(s => s.id).sort().join(",") === "site-energy-comparison,site-rack-comparison");
console.log(`report-registry: ${checks} checks passed`);
