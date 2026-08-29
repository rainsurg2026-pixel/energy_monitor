import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { facilityReportData, PDF_EXPORT_SURFACE_CSS } from "../src/web-clean-v1/exports";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import type { MonthlyLog } from "../src/types";

// ---------------------------------------------------------------------------
// Regression: the generated PDF lost table CELL VALUES (near-white text) while
// the Live Preview showed them correctly.
//
// Root cause: the PDF exporter mounts the report into the MAIN document, so
// src/index.css's app-wide readability override
//   html:not(.theme-light) table:not(.dashboard-table) * { color: var(--color-text) !important }
// (default theme --color-text = #f4f7fb, near-white) cascades onto the report's
// <td>/<th>. The Live Preview is fine because it renders the SAME
// buildReportHtml() output inside a sandboxed srcdoc iframe - an isolated
// document index.css never reaches. So this is invisible text, not missing
// data: the identical HTML string feeds both surfaces.
// ---------------------------------------------------------------------------

const log = (month: string, buildingEnergyKwh: number, buildingElectricityCostThb: number): MonthlyLog => ({
  month,
  ups: [],
  air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
  dc: [],
  energyCost: { buildingEnergyKwh, buildingElectricityCostThb },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
});

// 1. The values are present in the capture DOM (the same string the correct
//    Live Preview iframe renders) BEFORE any html2canvas capture runs.
const data = facilityReportData(
  [log("2026-06", 51218.44, 288134.09), log("2026-07", 61341.68, 428915.55)],
  "Srinakarin",
  "2026-07",
  null,
  [],
  [],
  [log("2026-06", 51218.44, 288134.09), log("2026-07", 61341.68, 428915.55)],
  {}
);
const html = buildReportHtml(data);
for (const value of ["61,341.68", "428,915.55", "51,218.44"]) {
  assert.ok(html.includes(value), `report HTML (capture source) contains the table value ${value}`);
}

// 2. Those values are plain text nodes inside <td> (no independently-coloured
//    wrapper span), so an explicit foreground on <td> is inherited by content.
assert.match(html, /<td[^>]*>61,341\.68<\/td>/, "table value renders as bare text in a <td>");
assert.match(html, /<td[^>]*>428,915\.55<\/td>/);
assert.match(html, /<th>[^<]*<\/th>/, "headers are bare-text <th>");

// ---------------------------------------------------------------------------
// The scoped fix.
// ---------------------------------------------------------------------------

// 3. The surface CSS is scoped to the offscreen renderer only, never global,
//    and does not depend on the app's dark/light theme (literal hex, and it
//    redefines the leaked foreground custom properties to a readable value).
assert.ok(PDF_EXPORT_SURFACE_CSS.includes("[data-energy-monitor-pdf-renderer]"), "surface CSS is scoped to the PDF renderer host");
assert.ok(!/:root|\bbody\b|html\s*\{/.test(PDF_EXPORT_SURFACE_CSS), "surface CSS never restyles :root/html/body globally");
assert.ok(PDF_EXPORT_SURFACE_CSS.includes("--color-text:#243247"), "surface CSS redefines the leaked --color-text to a dark print value");
assert.ok(PDF_EXPORT_SURFACE_CSS.includes("--ui-text:#243247"), "surface CSS redefines the leaked --ui-text to a dark print value");
assert.ok(!/var\(--color-text\)|var\(--ui-text\)/.test(PDF_EXPORT_SURFACE_CSS), "surface CSS forces literal colours, not theme variables");

// 4. Explicit readable foreground on report table cells / headers, beating the
//    app rule on specificity (extra attribute selector) AND source order, and
//    forcing -webkit-text-fill-color + opacity so nothing stays faint.
assert.match(PDF_EXPORT_SURFACE_CSS, /table:not\(\.dashboard-table\) td\{color:#1f2937!important;-webkit-text-fill-color:#1f2937!important\}/);
assert.match(PDF_EXPORT_SURFACE_CSS, /table:not\(\.dashboard-table\) th\{color:#40566e!important;-webkit-text-fill-color:#40566e!important;font-weight:bold!important\}/);
assert.match(PDF_EXPORT_SURFACE_CSS, /table:not\(\.dashboard-table\) \*\{color:#243247!important;-webkit-text-fill-color:#243247!important;fill:#243247!important;opacity:1!important\}/);

// 5. The exporter injects the surface style into the host BEFORE capture, and
//    also re-injects it via html2canvas onclone so the rasterised clone
//    carries it regardless.
const exportSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
assert.match(exportSource, /surfaceStyle\.textContent = PDF_EXPORT_SURFACE_CSS;\s*host\.appendChild\(surfaceStyle\);/);
assert.match(exportSource, /onclone: clonedDoc =>/);
assert.match(exportSource, /cloneStyle\.textContent = PDF_EXPORT_SURFACE_CSS;/);
assert.ok(exportSource.indexOf("host.appendChild(surfaceStyle)") < exportSource.indexOf("html2canvas(page"), "surface style is attached before the capture loop");

// 6. Capture waits for font + layout readiness (fonts.ready via
//    waitForReportImages, then a double rAF) - no arbitrary setTimeout.
assert.match(exportSource, /if \(typeof document\.fonts\?\.ready\?\.then === "function"\) await document\.fonts\.ready;/);
assert.match(exportSource, /await new Promise<void>\(resolve => requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => resolve\(\)\)\)\);/);
assert.ok(exportSource.indexOf("await waitForReportImages(host)") < exportSource.indexOf("html2canvas(page"), "fonts/layout are awaited before capture");
assert.doesNotMatch(exportSource, /setTimeout\([^)]*\d{3,}\)[^;]*html2canvas/s);

// 7. Text-heavy report pages stay PNG (no lossy re-compression that eats thin
//    glyphs); the report model / renderer is shared with the preview, not
//    duplicated.
assert.match(exportSource, /canvas\.toDataURL\("image\/png"\), "PNG"/);
assert.match(exportSource, /buildReportHtml\(data, sections\)/);

// 8. index.css still carries the override this fix neutralises (guards against
//    the app rule silently changing shape and the scoped fix drifting).
const appCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
assert.match(appCss, /table:not\(\.dashboard-table\) \*,\s*\n\s*html:not\(\.theme-light\) \.recharts-wrapper text \{\s*\n\s*color: var\(--color-text\) !important;/);
assert.match(appCss, /--color-text: #f4f7fb;/);

console.log("web-clean-v1 PDF capture: report table values survive html2canvas with a scoped, theme-independent print surface");
