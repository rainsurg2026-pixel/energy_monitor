import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /<main className="min-w-0 flex-1 p-4 pb-20 md:p-6 md:pb-6">/);
assert.match(app, /aria-label=\{lang === "th" \? "เมนูนำทางบนมือถือ" : "Mobile application navigation"\}/);
assert.match(app, /overflow-x-auto/);
assert.match(app, /min-w-\[4\.75rem\] shrink-0/);
assert.match(app, /break-words font-display text-lg/);
assert.match(app, /break-words font-display text-3xl/);

console.log("web-clean-v1 responsive shell: mobile navigation scrolls with fixed hit targets and content reserves bottom-nav space");
