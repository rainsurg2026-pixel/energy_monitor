import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /import RackCapacityHistoryPanel from "\.\.\/components\/rack\/RackCapacityHistoryPanel"/);
assert.match(app, /import \{ Forecast as RackCapacityForecast \} from "\.\.\/components\/rack\/Forecast"/);
assert.match(app, /import \{ RackUnitCapacitySummary \} from "\.\.\/components\/rack\/RackUnitCapacitySummary"/);
assert.match(app, /import \{ StickyHeader as RackCapacityStickyHeader \} from "\.\.\/components\/rack\/StickyHeader"/);
assert.match(app, /import \{ ExecutiveKpiCards as RackCapacityExecutiveKpiCards \} from "\.\.\/components\/rack\/ExecutiveKpiCards"/);
assert.match(app, /import \{ CapacityAlerts \} from "\.\.\/components\/rack\/CapacityAlerts"/);
assert.match(app, /import \{ CapacityGauge \} from "\.\.\/components\/rack\/CapacityGauge"/);
assert.match(app, /rackCapacityHistory=\{history\.rackCapacityHistory \?\? \[\]\}/);
assert.match(app, /rackCapacityHistory=\{rackCapacityHistory\}/);
assert.match(app, /<RackCapacityHistoryPanel \/>/);
assert.match(app, /<RackCapacityForecast \/>/);
assert.match(app, /rackUnitCapacity=\{rackUnitCapacity\}/);
assert.match(app, /<RackUnitCapacitySummary \/>/);
assert.match(app, /<RackCapacityStickyHeader \/>/);
assert.match(app, /<CapacityAlerts \/>/);
assert.match(app, /<RackCapacityExecutiveKpiCards \/>/);
assert.match(app, /<CapacityGauge \/>/);

console.log("web-clean-v1 Rack workspace: reuses Desktop monthly history and forecast with API-backed snapshots");
