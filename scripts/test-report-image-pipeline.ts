import { validateReportHtml } from "../src/reports/pdf/reportSafety";

function expectFailure(html: string, label: string): void {
  try { validateReportHtml(html); } catch { return; }
  throw new Error(`${label} was unexpectedly accepted.`);
}

// Regression for v2.2.6: a valid ImageStorageProvider data URI must reach
// Chromium; missing-image placeholders have no image and must also remain valid.
validateReportHtml('<section class="page"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Rack Unit Capacity Image"></section>');
validateReportHtml('<section class="page"><div class="rack-unit-capacity-image-placeholder">Rack Unit Capacity image not yet captured</div></section>');
expectFailure('<img src="file:///C:/secret.png">', "file URI");
expectFailure('<img src="https://example.test/image.png">', "network URI");
expectFailure('<img src="data:image/gif;base64,R0lGODlh">', "unsupported image MIME");
console.log("Report image pipeline safety regression passed: image, missing-image placeholder, and unsafe source cases.");
