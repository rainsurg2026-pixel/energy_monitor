import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /<main className="min-w-0 pb-20 md:pb-6">/);
assert.match(app, /aria-label=\{lang === "th" \? "เมนูนำทางบนมือถือ" : "Mobile application navigation"\}/);
assert.match(app, /overflow-x-auto/);
assert.match(app, /min-w-\[4\.75rem\] shrink-0/);
assert.match(app, /break-words font-display text-lg/);
assert.match(app, /break-words font-display text-3xl/);
assert.match(app, /aria-label=\{lang === "th" \? "à¸™à¸³à¸—à¸²à¸‡à¸«à¸¥à¸±à¸" : "Primary application navigation"\}/);
assert.match(app, /mb-5 grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-1\.5 shadow-md/);

console.log("web-clean-v1 responsive shell: mobile navigation scrolls with fixed hit targets and content reserves bottom-nav space");
