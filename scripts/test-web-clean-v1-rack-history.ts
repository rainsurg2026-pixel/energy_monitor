import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const editors = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityEditors.tsx", import.meta.url), "utf8");

assert.match(app, /const RackCapacityHistoryPanel = lazy\(\(\) => import\("\.\.\/components\/rack\/RackCapacityHistoryPanel"\)\)/);
assert.match(app, /const RackCapacityForecast = lazy\(\(\) => import\("\.\.\/components\/rack\/Forecast"/);
assert.match(app, /const RackUnitCapacitySummary = lazy\(\(\) => import\("\.\.\/components\/rack\/RackUnitCapacitySummary"/);
assert.match(app, /const RackCapacityStickyHeader = lazy\(\(\) => import\("\.\.\/components\/rack\/StickyHeader"/);
assert.match(app, /const RackCapacityExecutiveKpiCards = lazy\(\(\) => import\("\.\.\/components\/rack\/ExecutiveKpiCards"/);
assert.match(app, /const CapacityAlerts = lazy\(\(\) => import\("\.\.\/components\/rack\/CapacityAlerts"/);
assert.match(app, /const CapacityGauge = lazy\(\(\) => import\("\.\.\/components\/rack\/CapacityGauge"/);
assert.match(app, /const RackCapacityTimeline = lazy\(\(\) => import\("\.\.\/components\/rack\/Timeline"/);
assert.match(app, /rackCapacityHistory=\{history\.rackCapacityHistory \?\? \[\]\}/);
assert.match(app, /rackCapacityHistory=\{rackCapacityHistory\}/);
assert.match(app, /<RackCapacityHistoryPanel \/>/);
assert.match(app, /<RackCapacityForecast \/>/);
assert.match(app, /rackUnitCapacity=\{rackUnitCapacity\}/);
assert.match(app, /<RackUnitCapacitySummary provider=\{rackUnitImageProvider\} \/>/);
assert.match(app, /<RackCapacityStickyHeader \/>/);
assert.match(app, /<CapacityAlerts \/>/);
assert.match(app, /<RackCapacityExecutiveKpiCards \/>/);
assert.match(app, /<CapacityGauge \/>/);
assert.match(app, /<RackCapacityTimeline canSelectMonth=\{selected => selected >= allowedStartMonth && selected <= allowedEndMonth\} onMonthSelect=\{onSelectMonth\} \/>/);
assert.match(app, /onSelectMonth=\{selected => void selectMonth\(selected\)\}/);
assert.match(app, /allowedStartMonth=\{bootstrap\?\.displayPeriod\.startMonth \?\? month\}/);
assert.match(app, /allowedEndMonth=\{bootstrap \? \(bootstrap\.displayPeriod\.endMonth < todayMonth\(\) \? bootstrap\.displayPeriod\.endMonth : todayMonth\(\)\) : month\}/);
assert.match(app, /<WebRackUnitCapacityEditor lang=\{lang\}/);
assert.match(editors, /lang\?: "th" \| "en"/);
assert.match(editors, /ความจุหน่วยแร็ก/);
assert.match(editors, /บันทึก snapshot ประจำเดือน/);

console.log("web-clean-v1 Rack workspace: reuses Desktop monthly history and forecast with API-backed snapshots");
