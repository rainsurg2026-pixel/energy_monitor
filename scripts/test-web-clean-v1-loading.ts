import assert from "node:assert/strict";
import { INITIAL_HISTORY_MONTHS, historyMonthsForScope } from "../server/services/historyScope";
import { readFileSync } from "node:fs";

const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"];
assert.equal(INITIAL_HISTORY_MONTHS, 6);
assert.deepEqual(historyMonthsForScope(months, "dashboard"), ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]);
assert.deepEqual(historyMonthsForScope(months, "full"), months);
assert.deepEqual(historyMonthsForScope(months, "rack"), months);
assert.deepEqual(historyMonthsForScope([], "dashboard"), []);

const apiService = readFileSync(new URL("../server/services/apiService.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
assert.match(apiService, /historyMonthsForScope/);
assert.match(app, /Unable to load facilities/);
assert.match(app, /setFacilityError\(`Unable to load facilities/);
assert.match(app, /setNotice\(`Unable to load/);
assert.match(app, /initialHistoryLoading/);
assert.match(app, /setInitialHistoryLoading\(false\)/);
assert.match(app, /setFacilityLoading\(false\)/);
assert.match(app, /setHistory\(\{ months: \[\], logs: \[\] \}\)/);
assert.match(app, /availableMonths=\{history\.months\}/);
assert.match(app, /onYearChange=\{loadHistoricalYear\}/);
assert.match(app, /loadHistory\(siteId, \{ scope: "full" \}\)/);

console.log("web-clean-v1 loading: six-month initial window and non-destructive recovery contract passed");
