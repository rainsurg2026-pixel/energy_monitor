import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /import RackCapacityHistoryPanel from "\.\.\/components\/rack\/RackCapacityHistoryPanel"/);
assert.match(app, /import \{ Forecast as RackCapacityForecast \} from "\.\.\/components\/rack\/Forecast"/);
assert.match(app, /rackCapacityHistory=\{history\.rackCapacityHistory \?\? \[\]\}/);
assert.match(app, /rackCapacityHistory=\{rackCapacityHistory\}/);
assert.match(app, /<RackCapacityHistoryPanel \/>/);
assert.match(app, /<RackCapacityForecast \/>/);

console.log("web-clean-v1 Rack workspace: reuses Desktop monthly history and forecast with API-backed snapshots");
