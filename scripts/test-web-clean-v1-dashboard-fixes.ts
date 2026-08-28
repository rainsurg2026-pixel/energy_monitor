import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportYearsFromMonths, resolveReportYear } from "../src/ReportContext";
import { openReportPopup, renderReportErrorPopup, renderReportPopup } from "../src/web-clean-v1/exports";

assert.equal(resolveReportYear("2024", ["2025", "2024"], "2025"), "2024");
assert.equal(resolveReportYear("not-a-year", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("2026", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("not-a-year", ["2026"], "2025"), "2026");
assert.deepEqual(reportYearsFromMonths(["2026-02", "2026-07"], ["2025-01", "2025-12", "2026-07"]), ["2026", "2025"], "year selector includes years available outside the initial six-month log window");

let printed = 0;
let written = "";
const popupDocument = {
  readyState: "complete",
  title: "",
  open: () => undefined,
  write: (html: string) => { written = html; },
  close: () => undefined
};
const popup = {
  document: popupDocument,
  closed: false,
  addEventListener: () => undefined,
  setTimeout: (callback: () => void) => { callback(); return 0; },
  focus: () => undefined,
  print: () => { printed += 1; }
} as unknown as Window;

renderReportPopup(popup, "<html><body>report</body></html>", "energy-report");
assert.equal(written, "<html><body>report</body></html>");
assert.equal(popup.document.title, "energy-report");
assert.equal(printed, 1);

// A report popup must never be visually blank while asynchronous report data
// is loading, and a rejected data request must leave a useful visible error
// instead of an empty window that appears to have stalled.
const previousWindow = (globalThis as { window?: unknown }).window;
(popup as unknown as { opener: unknown }).opener = {};
let popupFeatures = "";
(globalThis as { window?: unknown }).window = {
  open: (_url: string, _name: string, features: string) => {
    popupFeatures = features;
    return popup;
  }
};
const loadingPopup = openReportPopup("energy-report-loading");
assert.equal(loadingPopup, popup);
assert.equal(popupFeatures, "popup");
assert.equal((popup as unknown as { opener: unknown }).opener, null);
assert.match(written, /Preparing report/);
assert.equal(popup.document.title, "Preparing report…");
renderReportErrorPopup(popup);
assert.match(written, /Report could not be generated/);
if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
else (globalThis as { window?: unknown }).window = previousWindow;

const appSource = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const rackUnitSummarySource = readFileSync(new URL("../src/components/rack/RackUnitCapacitySummary.tsx", import.meta.url), "utf8");
const rackViewsSource = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityViews.tsx", import.meta.url), "utf8");
const exportSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
const browserE2eSource = readFileSync(new URL("./e2e-web-cdp.mjs", import.meta.url), "utf8");
assert.match(appSource, /HISTORY_DATA_VIEWS/);
assert.match(appSource, /loadedPageKeyRef/);
assert.match(appSource, /const DashboardSummary = lazy\(\(\) => import\("\.\.\/components\/DashboardSummary"\)\)/);
assert.match(appSource, /historyCacheRef/);
assert.match(appSource, /\/history\?scope=\$\{scope\}/);
assert.match(appSource, /historyRequestsRef\.current\.set\(cacheKey, request\)/);
assert.match(appSource, /scope: HistoryScope/);
assert.doesNotMatch(appSource, /RackUnitCapacitySummary imageUploadAvailable=/);
assert.match(appSource, /createWebRackUnitImageProvider/);
assert.match(appSource, /view === "rack-units"/);
assert.match(appSource, /<WebRackUnitCapacityDashboard siteName=\{siteName\}/);
assert.match(rackViewsSource, /Monthly Rack Unit Capacity Image/);
assert.match(rackUnitSummarySource, /provider\?: Pick<IDataProvider, "getRackUnitCapacityImage">/);
assert.match(rackUnitSummarySource, /!provider\?\.getRackUnitCapacityImage/);
assert.match(rackUnitSummarySource, /facilityName \?\? ""/);
assert.match(exportSource, /import\("html2canvas"\)/);
assert.match(exportSource, /import\("jspdf"\)/);
assert.match(exportSource, /scale: PDF_RENDER_SCALE/);
assert.match(exportSource, /toDataURL\("image\/png"\)/);
assert.match(exportSource, /height: Math\.max\(page\.scrollHeight, page\.offsetHeight, 1\)/);
assert.match(exportSource, /pdf\.save\(ensureExtension\(fileName, "pdf"\)\)/);
assert.match(appSource, /exportDesktopPdfFile/);
assert.doesNotMatch(appSource, /openReportPopup/);
assert.match(browserE2eSource, /E2E_REQUIRE_AUTH/);
assert.match(browserE2eSource, /Browser\.downloadProgress/);
assert.match(browserE2eSource, /Network\.responseReceived/);

console.log("web-clean-v1 dashboard fixes: browser PDF/download E2E contract assertions passed");
