import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveReportYear } from "../src/ReportContext";
import { renderReportPopup } from "../src/web-clean-v1/exports";

assert.equal(resolveReportYear("2024", ["2025", "2024"], "2025"), "2024");
assert.equal(resolveReportYear("not-a-year", ["2025", "2024"], "2025"), "2025");
assert.equal(resolveReportYear("2026", ["2025", "2024"], "2025"), "2025");

let printed = 0;
let written = "";
const popup = {
  document: {
    readyState: "complete",
    title: "",
    open: () => undefined,
    write: (html: string) => { written = html; },
    close: () => undefined
  },
  addEventListener: () => undefined,
  setTimeout: (callback: () => void) => { callback(); return 0; },
  focus: () => undefined,
  print: () => { printed += 1; }
} as unknown as Window;

renderReportPopup(popup, "<html><body>report</body></html>", "energy-report");
assert.equal(written, "<html><body>report</body></html>");
assert.equal(popup.document.title, "energy-report");
assert.equal(printed, 1);

const appSource = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
assert.match(appSource, /HISTORY_DATA_VIEWS/);
assert.match(appSource, /loadedPageKeyRef/);

console.log("web-clean-v1 dashboard fixes: 8 assertions passed");
