import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
const executive = readFileSync("src/components/ExecutiveDashboard.tsx", "utf8");
const filters = readFileSync("src/components/UniversalFilterBar.tsx", "utf8");
const trend = readFileSync("src/components/TrendLineChart.tsx", "utf8");
const css = readFileSync("src/index.css", "utf8");

assert.match(app, /useState<View>\("dashboard"\)/, "Dashboard must be the initial view");
assert.match(app, /<span className="sm:hidden">Energy Monitor<\/span>/, "mobile header must use compact title");
assert.match(app, /min-w-\[5\.75rem\]/, "mobile nav items need non-overlapping width");
assert.match(executive, /grid-cols-1 min-\[430px\]:grid-cols-2/, "executive KPI cards must stack on narrow phones");
assert.match(executive, /text-xl min-\[430px\]:text-\[1\.35rem\] sm:text-2xl/, "KPI values must scale independently on mobile");
assert.match(filters, /grid-cols-1 min-\[430px\]:grid-cols-2/, "dashboard filters must collapse to one column on narrow phones");
assert.match(filters, /grid w-full grid-cols-2/, "dashboard subview tabs must use a mobile grid");
assert.match(trend, /labels\.length > 6/, "long trend charts must retain a readable mobile scroll width");
assert.match(css, /@media \(max-width: 767px\)/, "mobile typography must be separated from desktop");
assert.match(css, /font-size: 0\.6875rem !important/, "mobile chart and table labels should use 11px baseline");

console.log("web-clean-v1 mobile responsive: dashboard default and mobile layout contracts verified");
