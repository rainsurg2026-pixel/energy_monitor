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
assert.match(app, /mb-5 hidden gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-1\.5 shadow-md sm:grid sm:grid-cols-2/);

// Navigation label size is one step above the previous values and shared per
// bar (desktop text-xs -> text-sm, mobile text-[10px] -> text-xs). Icons are
// unchanged and the labels are no longer sized inline per button.
assert.match(app, /const navTextClassName = "text-sm";/);
assert.match(app, /const mobileNavTextClassName = "text-xs";/);
assert.match(app, /px-4 py-3\.5 \$\{navTextClassName\} font-bold transition-all/);
assert.match(app, /gap-1 py-2 \$\{mobileNavTextClassName\} /);
assert.doesNotMatch(app, /px-4 py-3\.5 text-xs font-bold transition-all/);
assert.doesNotMatch(app, /gap-1 py-2 text-\[10px\]/);
assert.match(app, /const navIconClassName = "h-12 w-12 shrink-0";/);
assert.match(app, /const mobileNavIconClassName = "h-8 w-8 shrink-0";/);

console.log("web-clean-v1 responsive shell: mobile navigation scrolls with fixed hit targets and content reserves bottom-nav space");
