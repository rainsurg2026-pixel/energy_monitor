import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../src/web-clean-v1/AppNavigationV2.tsx", import.meta.url), "utf8");
const executive = readFileSync(new URL("../src/components/ExecutiveDashboard.tsx", import.meta.url), "utf8");
const capacity = readFileSync(new URL("../src/components/ExecutiveCapacityOverview.tsx", import.meta.url), "utf8");

// The shell reserves content space for the fixed mobile navigation and uses
// the V2 navigation component rather than the legacy duplicated nav arrays.
assert.match(app, /<main className="min-w-0 pb-20 md:pb-6">/);
assert.match(app, /<AppNavigationV2 activeView=\{view\}/);
assert.doesNotMatch(app, /const nav: Array</);

// Desktop navigation: five primary items with Capacity / Reports /
// Settings submenus. It is intentionally a separate renderer from mobile.
assert.match(navigation, /function DesktopNavigation/);
assert.match(navigation, /hidden grid-cols-5/);
for (const label of ["Dashboard", "Data Entry", "Capacity", "Reports", "Settings \/ Profile"]) {
  assert.match(navigation, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(navigation, /Rack Capacity/);
assert.match(navigation, /Rack Unit Capacity/);
assert.match(navigation, /Site Energy & Cost Comparison/);
assert.match(navigation, /Site Rack Capacity & Availability/);
assert.match(navigation, /Export Center/);
assert.match(navigation, /isAdmin && <MenuItem label=.*User Management/);

// Mobile navigation: five fixed primary items, no horizontal scrolling, and
// bottom sheets for secondary destinations.
assert.match(navigation, /function MobileNavigation/);
assert.match(navigation, /fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5/);
for (const label of ["Dashboard", "Entry", "Capacity", "Reports", "More"]) {
  assert.match(navigation, new RegExp(label));
}
assert.match(navigation, /MobileSheetPanel/);
assert.match(navigation, /sheet === "capacity"/);
assert.match(navigation, /sheet === "reports"/);
assert.match(navigation, /sheet === "more"/);
assert.match(navigation, /pb-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\]/);
assert.doesNotMatch(navigation, /overflow-x-auto/);
assert.doesNotMatch(navigation, /min-w-\[5\.75rem\]/);

// Executive V2 uses genuinely separate mobile/desktop renderers while
// sharing the same data/calculation source.
assert.match(executive, /function DesktopHeader/);
assert.match(executive, /function MobileHeader/);
assert.match(executive, /data-testid="executive-desktop-v2"/);
assert.match(executive, /data-testid="executive-mobile-v2"/);
assert.match(executive, /grid grid-cols-4 gap-4/);
assert.match(executive, /grid grid-cols-2 gap-2\.5/);
assert.match(capacity, /layout: "desktop" \| "mobile"/);
assert.match(capacity, /compact = layout === "mobile"/);

console.log("web-clean-v1 responsive shell: Navigation V2 separates desktop/mobile layouts, fixed mobile nav has five items, and Executive V2 has dedicated mobile/desktop renderers");
