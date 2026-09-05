import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { facilityReportData, isMemoryConstrainedPdfClient } from "../src/web-clean-v1/exports";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import type { MonthlyLog } from "../src/types";

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

const sourceLogs = [
  log("2026-06", 51218.44, 288134.09),
  log("2026-07", 61341.68, 428915.55)
];
const data = facilityReportData(sourceLogs, "Srinakarin", "2026-07", null, [], [], sourceLogs, {});
const html = buildReportHtml(data);
for (const value of ["61,341.68", "428,915.55", "51,218.44"]) {
  assert.ok(html.includes(value), `report HTML contains ${value}`);
}
assert.match(html, /<td[^>]*>61,341\.68<\/td>/);
assert.match(html, /<th>[^<]*<\/th>/);

// Regression: Live Preview is a srcDoc iframe. The downloadable PDF must use
// the same isolated-document model so the app's dark/light theme cannot leak
// into REPORT_CSS and change the PDF palette.
const exportSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
assert.match(exportSource, /document\.createElement\("iframe"\)/);
assert.match(exportSource, /frame\.srcdoc = html/);
assert.match(exportSource, /frame\.contentDocument/);
assert.match(exportSource, /frameDocument\.querySelectorAll<HTMLElement>\("\.cover, \.page"\)/);
assert.match(exportSource, /frame\.setAttribute\("sandbox", "allow-same-origin"\)/);
assert.match(exportSource, /backgroundColor: "#ffffff"/);
assert.doesNotMatch(exportSource, /PDF_EXPORT_SURFACE_CSS/);
assert.doesNotMatch(exportSource, /new DOMParser\(\)\.parseFromString\(html/);
assert.doesNotMatch(exportSource, /onclone:\s*clonedDoc/);

// Font/image readiness is resolved against the report iframe's own document,
// not the parent app document.
assert.match(exportSource, /root\.ownerDocument\?\.fonts/);
assert.match(exportSource, /await waitForReportImages\(frameDocument\.body\)/);
assert.match(exportSource, /const mobileMemoryMode = isMemoryConstrainedPdfClient\(\)/);
assert.match(exportSource, /mobileMemoryMode \? PDF_MOBILE_RENDER_SCALE : PDF_RENDER_SCALE/);
assert.match(exportSource, /lossy \? canvas\.toDataURL\("image\/jpeg", jpegQuality\) : canvas\.toDataURL\("image\/png"\)/);
assert.match(exportSource, /lossy \? "JPEG" : "PNG"/);
assert.match(exportSource, /canvas\.width = 1/);
assert.match(exportSource, /canvas\.height = 1/);
assert.match(exportSource, /exportReportPdfFromHtml\(buildAllFacilitiesReportHtml[^;]+\{ compact: true \}\)/);
assert.match(exportSource, /buildCurrentFacilityPdfHtml\(data, sections\)/);

assert.equal(isMemoryConstrainedPdfClient({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", platform: "iPad", maxTouchPoints: 5 } as Navigator), true);
assert.equal(isMemoryConstrainedPdfClient({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 } as Navigator), true);
assert.equal(isMemoryConstrainedPdfClient({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 } as Navigator), false);

const reportSource = readFileSync(new URL("../src/reports/pdf/reportHtml.ts", import.meta.url), "utf8");
assert.match(reportSource, /White-report mode/);
assert.match(reportSource, /cover-meta-card,[^}]+background:#fff/);

// The app still contains a theme-level table override; iframe isolation is
// therefore a real protection boundary rather than a cosmetic refactor.
const appCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
assert.match(appCss, /table:not\(\.dashboard-table\) \*/);
assert.match(appCss, /--color-text: #f4f7fb;/);

console.log("web-clean-v1 PDF capture: downloadable PDF uses the same isolated light report document as Live Preview");
