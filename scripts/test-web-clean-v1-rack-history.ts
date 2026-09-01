import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const editors = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityEditors.tsx", import.meta.url), "utf8");
const views = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityViews.tsx", import.meta.url), "utf8");
const entryWorkspace = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkspace.tsx", import.meta.url), "utf8");
const rackData = readFileSync(new URL("../src/web-clean-v1/rackCapacityData.ts", import.meta.url), "utf8");

assert.match(app, /WebRackCapacityDashboard/);
assert.match(app, /WebRackUnitCapacityDashboard/);
assert.match(app, /"rack-units"/);
assert.match(app, /onRackCapacitySaved=\{async \(\) =>/);
assert.doesNotMatch(app, /setRackDirty/);
assert.match(rackData, /carryForwardCandidate/);
assert.match(rackData, /snapshotRequests/);
assert.match(rackData, /snapshotRequests\.get\(key\) === request/);
assert.match(rackData, /rackCapacityKey\(siteId, month\)/);
assert.match(rackData, /\[month, siteId\]/);
assert.match(rackData, /cancelled/);
assert.match(app, /useRackCapacitySnapshot/);
assert.match(app, /rack\.persisted \? rack\.snapshot : null/);
assert.match(app, /view === "rack-units"/);
// Dashboard navigation is restored: the sidebar item exists and setView no
// longer redirects "dashboard" to "entry".
assert.match(app, /\{ id: "dashboard", label: lang === "th" \? "แดชบอร์ด" : "Dashboard", icon: BarChart3 \}/);
assert.doesNotMatch(app, /next === "dashboard" \? "entry"/);
assert.match(app, /window\.addEventListener\("beforeunload"/);
assert.match(app, /window\.addEventListener\("popstate"/);
assert.match(app, /Unsaved Data Entry changes/);
assert.match(app, /Cancel/);
assert.match(app, /Save & Continue/);
assert.match(app, /Discard/);
assert.doesNotMatch(app, /web-v3/i);

const rackView = app.slice(app.indexOf("function RackCapacityView"), app.indexOf("function Login"));
assert.doesNotMatch(rackView, /WebRackCapacityEditor/);
assert.match(entryWorkspace, /<WebRackCapacityEntrySection /);
assert.match(entryWorkspace, /entry-section-energy[\s\S]*entry-section-rack[\s\S]*entry-section-rack-unit/);

assert.match(editors, /Cabinet Size \(cm\)/);
assert.match(editors, /No unsaved changes/);
assert.match(editors, /Save 1 Change/);
assert.match(editors, /Confirm Monthly Snapshot/);
assert.match(editors, /onRegisterActions/);
assert.match(editors, /onDraftChange/);
assert.match(editors, /initialize: canInitialize/);
assert.match(editors, /buildRackCapacitySavePayload/);
assert.match(editors, /activeSaveKeyRef/);
assert.match(editors, /activeSaveKeyRef\.current !== requestKey/);
assert.match(editors, /return \(\) => \{ activeSaveKeyRef\.current = null; \}/);
assert.match(editors, /snapshot\?\.rowVersion/);
assert.match(editors, /Discard Changes/);
assert.match(editors, /Your edits will be lost/);

assert.match(views, /Rack Capacity (?:&|&amp;) Utilization/);
assert.match(views, /No confirmed Rack Capacity snapshot/);
assert.match(views, /Go to Monthly Data Entry/);
assert.doesNotMatch(views, /<WebRackCapacityEditor/);
assert.match(views, /Rack Unit Capacity (?:&|&amp;) Utilization/);
assert.match(views, /Read-only Rack Unit Capacity \(U\) executive summary/);
assert.match(views, /1U = 1\.75 inches\./);
assert.match(views, /You are using .* of total capacity\. Available capacity is/);
assert.match(views, /Normal: < 80%/);
assert.match(views, /Zones \$\{labels\.slice\(0, -1\)\.join\("[, ]*"\)\}, and \$\{labels\.at\(-1\)\} are over 85% utilized/);
assert.match(views, /85% utilized/);
assert.match(views, /Six-month Rack Unit Capacity Trend/);
assert.match(views, /Overall U Capacity Mix/);

console.log("web-clean-v1 Rack workspace: split Rack Capacity and Rack Unit Capacity views with protected edits");
