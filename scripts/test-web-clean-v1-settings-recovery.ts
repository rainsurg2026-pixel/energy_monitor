import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

// /bootstrap intentionally rejects when no global display period exists. An
// admin must still be able to open Settings and create the first row with the
// repository's documented expected_row_version=0 create precondition.
assert.match(app, /const settingsDisplayPeriod = bootstrap\?\.displayPeriod \?\? \{ startMonth: month, endMonth: month, rowVersion: 0 \}/);
assert.match(app, /view === "settings" \? <SettingsPage displayPeriod=\{settingsDisplayPeriod\}/);
assert.doesNotMatch(app, /view === "settings" && bootstrap/);
assert.match(app, /setBootstrap\(result\); setSiteId\(current\?\.id \?\? null\); setFacilityError\(null\);/);
assert.match(app, /first\.latestAvailableMonth \?\? \(result\.displayPeriod\.endMonth < todayMonth\(\) \? result\.displayPeriod\.endMonth : todayMonth\(\)\)/);
assert.match(app, /await loadMonth\(siteId, selected, history\); setFacilityError\(null\);/);

console.log("web-clean-v1 settings recovery: initial display-period setup remains reachable after bootstrap failure");
