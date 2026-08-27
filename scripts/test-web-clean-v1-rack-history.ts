import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const editors = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityEditors.tsx", import.meta.url), "utf8");
const views = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityViews.tsx", import.meta.url), "utf8");
const entryWorkspace = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkspace.tsx", import.meta.url), "utf8");

assert.match(app, /WebRackCapacityDashboard/);
assert.match(app, /WebRackUnitCapacityDashboard/);
assert.match(app, /"rack-units"/);
assert.match(app, /onDirtyChange=\{setRackDirty\}/);
assert.match(app, /view === "rack-units"/);
assert.match(app, /const target = next === "dashboard" \? "entry" : next/);
assert.match(app, /window\.addEventListener\("beforeunload"/);
assert.match(app, /window\.addEventListener\("popstate"/);
assert.match(app, /You have unsaved changes\. Leave without saving\?/);
assert.match(app, /Stay and Review/);
assert.match(app, /Leave Without Saving/);
assert.doesNotMatch(app, /web-v3/i);

const rackView = app.slice(app.indexOf("function RackCapacityView"), app.indexOf("function Login"));
assert.doesNotMatch(rackView, /WebRackUnitCapacityEditor/);
assert.match(entryWorkspace, /<RackUnitCapacityEntry /);

assert.match(editors, /Cabinet Size \(cm\)/);
assert.match(editors, /No unsaved changes/);
assert.match(editors, /Save 1 Change/);
assert.match(editors, /Discard Changes/);
assert.match(editors, /Your edits will be lost/);

assert.match(views, /Rack Capacity (?:&|&amp;) Utilization/);
assert.match(views, /Rack Unit Capacity (?:&|&amp;) Utilization/);
assert.match(views, /Executive summary of rack unit \(U\) capacity and utilization\./);
assert.match(views, /Available U represents physical rack space only/);
assert.match(views, /Normal: < 80%/);
assert.match(views, /Zones \$\{labels\.slice\(0, -1\)\.join\("[, ]*"\)\}, and \$\{labels\.at\(-1\)\} are over 85% utilized/);
assert.match(views, /85% utilized/);

console.log("web-clean-v1 Rack workspace: split Rack Capacity and Rack Unit Capacity views with protected edits");
