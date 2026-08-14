import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveReportYear } from "../src/ReportContext";
import { openReportPopup, renderReportErrorPopup, renderReportPopup } from "../src/web-clean-v1/exports";

assert.equal(resolveReportYear("2024", ["2025", "2024"], "2025"), "2024");
assert.equal(resolveReportYear("not-a-year", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("2026", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("not-a-year", ["2026"], "2025"), "2026");

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
assert.match(appSource, /HISTORY_DATA_VIEWS/);
assert.match(appSource, /loadedPageKeyRef/);
assert.match(appSource, /const DashboardSummary = lazy\(\(\) => import\("\.\.\/components\/DashboardSummary"\)\)/);
assert.match(appSource, /historyCacheRef/);
assert.match(appSource, /\/history\?scope=\$\{scope\}/);
assert.match(appSource, /historyRequestsRef\.current\.set\(cacheKey, request\)/);
assert.match(appSource, /scope: HistoryScope/);
assert.doesNotMatch(appSource, /RackUnitCapacitySummary imageUploadAvailable=/);
assert.match(appSource, /createWebRackUnitImageProvider/);
assert.match(appSource, /<RackUnitCapacitySummary provider=\{rackUnitImageProvider\}/);
assert.match(rackUnitSummarySource, /provider\?: Pick<IDataProvider, "getRackUnitCapacityImage">/);
assert.match(rackUnitSummarySource, /!provider\?\.getRackUnitCapacityImage/);

console.log("web-clean-v1 dashboard fixes: 23 assertions passed");
