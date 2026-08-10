import assert from "node:assert/strict";
import JSZip from "jszip";
import { IntegrityService } from "../server/services/integrityService";
import { ReportArtifactService, validatePdfBuffer, validatePngBuffer, type ReportArtifactRenderer } from "../server/services/reportArtifactService";
import { ReportService } from "../server/services/reportService";
import { apiTestRepository } from "../server/testFixtures";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj <</Type /Page>> endobj\n%%EOF", "latin1");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const renderer: ReportArtifactRenderer = { render: async () => ({ pdf, png }) };
const repository = apiTestRepository();
const service = new ReportArtifactService(repository, new ReportService(repository), new IntegrityService(repository), renderer);

validatePdfBuffer(pdf);
validatePngBuffer(png);
const pdfArtifact = await service.build(1, "2026-01", "pdf");
assert.equal(pdfArtifact.contentType, "application/pdf");
assert.equal(pdfArtifact.buffer.subarray(0, 5).toString("ascii"), "%PDF-");

const pngArtifact = await service.build(1, "2026-01", "png");
assert.equal(pngArtifact.contentType, "image/png");
assert.deepEqual([...pngArtifact.buffer.subarray(0, 8)], [...png.subarray(0, 8)]);

const zipArtifact = await service.build(1, "2026-01", "zip");
assert.equal(zipArtifact.contentType, "application/zip");
const zip = await JSZip.loadAsync(zipArtifact.buffer);
const names = Object.keys(zip.files);
assert(names.some(name => name.endsWith(".pdf")), "ZIP contains PDF");
assert(names.some(name => name.endsWith(".xlsx")), "ZIP contains XLSX");
assert(names.includes("Dashboard.png"), "ZIP contains Dashboard.png");
assert(names.includes("UPS_Loads.csv"), "ZIP contains UPS CSV");
assert(names.includes("Air_Conditioning.csv"), "ZIP contains AIR CSV");
assert(names.includes("DC_Panels.csv"), "ZIP contains DC CSV");
assert(names.includes("Energy_Cost.csv"), "ZIP contains energy CSV");
assert(names.includes("IntegrityReport.txt"), "ZIP contains integrity report");
assert(names.includes("README.txt"), "ZIP contains manifest");
assert((await zip.file("README.txt")!.async("string")).includes("headless Chromium"));
console.log("web report artifacts: 14 assertions passed; PDF/PNG validation and Desktop ZIP member contract verified");
