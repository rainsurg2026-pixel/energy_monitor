import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clean = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const exportsSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/web-clean-v1/api.ts", import.meta.url), "utf8");

for (const source of [clean, exportsSource]) {
  assert.match(source, /Data Center Energy & Facility Monitor/);
  assert.doesNotMatch(source, /Energy Monitor Web v3|Energy Monitor Report|Energy Monitor Site Comparison|Energy Monitor All Facilities/);
}
assert.match(api, /Data-Center-Energy-Facility-Monitor/);
assert.match(clean, /break-words[^>]*>Data Center Energy & Facility Monitor/);
assert.match(api, /Data-Center-Energy-Facility-Monitor-\$\{month\}\.pdf/);

console.log("web-clean-v1 branding: login, shell, report titles, and filenames use the approved product name");
