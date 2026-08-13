import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const historyProvider = readFileSync(new URL("../src/reporting/HistoryProvider.ts", import.meta.url), "utf8");

assert.match(app, /import \{ HistoryProvider \} from "\.\.\/reporting\/HistoryProvider"/);
assert.match(app, /const \[recentReports, setRecentReports\]/);
assert.match(app, /const readRecentReports = \(\): ReportHistoryItem\[\] /);
assert.match(app, /const rememberReport = \(filename: string\)/);
assert.match(app, /crypto\.randomUUID/);
assert.match(app, /HistoryProvider\.add\(item\)/);
assert.match(app, /Recent Reports/);
assert.match(app, /HistoryProvider\.remove\(item\.id\)/);
assert.match(app, /all-facilities-energy-monitor\.xlsx/);
assert.match(app, /site-comparison-\$\{month\}\.xlsx/);
assert.match(historyProvider, /slice\(0, 50\)/);

console.log("web-clean-v1 reports: exports retain a local recent-report history like Desktop");
