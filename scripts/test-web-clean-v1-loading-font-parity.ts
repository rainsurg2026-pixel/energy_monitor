import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const energy = readFileSync(new URL("../src/web-clean-v1/WebSiteComparison.tsx", import.meta.url), "utf8");
const rack = readFileSync(new URL("../src/web-clean-v1/WebSiteRackCapacityComparison.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

assert.match(energy, /BusyOverlay title=\{copy\.loading\}/);
assert.match(energy, /Loading Site Energy & Cost Comparison…/);
assert.match(energy, /const \[loading, setLoading\] = useState\(true\)/);
assert.match(rack, /BusyOverlay title="Loading Site Rack Capacity Comparison…"/);
assert.doesNotMatch(app, /Saving changes…/);
assert.match(app, /title=\{lang === "th" \? "กำลังโหลด…" : "Loading…"\}/);

assert.match(css, /\.em-shell \.recharts-wrapper text \{\s*font-size: 0\.75rem !important;/);
assert.match(css, /\.em-shell \.recharts-legend-item-text \{\s*font-size: 0\.875rem !important;/);
assert.match(css, /\.em-shell table th,\s*\.em-shell table td \{\s*font-size: 0\.75rem !important;/);

console.log("web-clean-v1 loading/font parity: comparison overlays and 12px data typography verified");
