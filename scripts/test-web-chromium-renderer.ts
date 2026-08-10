import assert from "node:assert/strict";
import { ChromiumReportArtifactRenderer, validatePdfBuffer, validatePngBuffer } from "../server/services/reportArtifactService";

const renderer = new ChromiumReportArtifactRenderer();
const artifacts = await renderer.render("<!doctype html><html><head><style>body{font-family:Arial} .page{width:1200px;height:800px;padding:40px}</style></head><body><section class='page'><h1>Energy Monitor Desktop parity renderer</h1><p>Rendered artifact contract.</p></section></body></html>");
validatePdfBuffer(artifacts.pdf);
validatePngBuffer(artifacts.png);
assert(artifacts.pdf.length > 1_000, "PDF renderer produced a non-empty artifact");
assert(artifacts.png.length > 1_000, "PNG renderer produced a non-empty artifact");
console.log(`web chromium renderer: PASS (PDF ${artifacts.pdf.length} bytes, PNG ${artifacts.png.length} bytes)`);
