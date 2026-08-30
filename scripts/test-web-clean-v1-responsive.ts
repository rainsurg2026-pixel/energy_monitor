import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /<main className="min-w-0 pb-20 md:pb-6">/);
assert.match(app, /aria-label=\{lang === "th" \? "เมนูนำทางบนมือถือ" : "Mobile application navigation"\}/);
assert.match(app, /overflow-x-auto/);
assert.match(app, /min-w-\[5\.75rem\] shrink-0/);
assert.match(app, /font-display text-base font-bold tracking-tight sm:text-lg/);
assert.match(app, /break-words font-display text-3xl/);
assert.match(app, /aria-label=\{lang === "th" \? "à¸™à¸³à¸—à¸²à¸‡à¸«à¸¥à¸±à¸" : "Primary application navigation"\}/);
assert.match(app, /mb-5 hidden gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-1\.5 shadow-md sm:grid sm:grid-cols-2/);

// Navigation proportions are driven only by shared tokens (both bars build
// items from one `nav` array). Labels stay text-sm / compact 11px on mobile; icons were
// rebalanced down (desktop h-12->h-8, mobile h-8->h-6) and the shared desktop
// item box carries the padding so the selected tile reads as balanced while
// long labels still wrap inside their grid cell.
assert.match(app, /const navTextClassName = "text-sm";/);
assert.match(app, /const mobileNavTextClassName = "text-\[11px\] leading-tight text-center";/);
assert.match(app, /const navIconClassName = "h-8 w-8 shrink-0";/);
assert.match(app, /const mobileNavIconClassName = "h-6 w-6 shrink-0";/);
assert.match(app, /const navItemClassName = "flex items-center justify-center gap-2 rounded-xl px-4 py-3";/);
assert.match(app, /className=\{`\$\{navItemClassName\} \$\{navTextClassName\} font-bold transition-all /);
assert.match(app, /gap-1 py-2 \$\{mobileNavTextClassName\} /);
assert.doesNotMatch(app, /py-3\.5/);
assert.doesNotMatch(app, /h-12 w-12/);
assert.doesNotMatch(app, /gap-1 py-2 text-\[10px\]/);

console.log("web-clean-v1 responsive shell: mobile navigation scrolls with fixed hit targets and content reserves bottom-nav space");
