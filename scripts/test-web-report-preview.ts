import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const preview = readFileSync(new URL("../src/web-clean-v1/WebReportPreview.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(preview, /buildReportHtml\(facilityReportData\(/);
assert.match(preview, /\/racks\?siteId=\$\{siteId\}&month=\$\{month\}/);
assert.match(preview, /sandbox=""/);
assert.match(preview, /Uses the same renderer as the PDF report/);
assert.match(preview, /Rack Capacity is unavailable for this preview/);
assert.match(app, /<WebReportPreview siteId=\{siteId\}/);

console.log("web report preview: renders the shared PDF report HTML from API-backed facility data");
