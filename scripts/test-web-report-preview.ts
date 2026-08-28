import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const preview = readFileSync(new URL("../src/web-clean-v1/WebReportPreview.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(preview, /buildReportHtml\(facilityReportData\(/);
assert.match(preview, /calculationLogs, logs, month, rack, rackCapacityHistory, rackUnitCapacity, rackUnitImage, refreshKey, sections, siteName/);
assert.match(preview, /\/racks\?siteId=\$\{siteId\}&month=\$\{month\}/);
assert.match(preview, /sandbox=""/);
assert.match(preview, /Uses the same renderer as the PDF report/);
assert.match(preview, /Rack Capacity is unavailable for this preview/);
assert.match(preview, /const \[zoom, setZoom\] = useState\(85\)/);
assert.match(preview, /aria-label=\{th \? "ลดขนาดตัวอย่างรายงาน" : "Zoom out"\}/);
assert.match(preview, /aria-label=\{th \? "เพิ่มขนาดตัวอย่างรายงาน" : "Zoom in"\}/);
assert.match(preview, /title=\{th \? "ตัวอย่างรายงานของไซต์ปัจจุบัน" : "Current facility report preview"\}/);
assert.match(preview, /minWidth: "640px"/);
assert.match(app, /<WebReportPreview lang=\{lang\} siteId=\{siteId\}/);
assert.match(app, /<WebReportPreview lang=\{lang\} siteId=\{siteId\} siteName=\{siteName\} logs=\{scopedLogs\} calculationLogs=\{logs\} month=\{contextMonth\}/);
assert.doesNotMatch(app, /\{view === "reports" && <WebReportPreview/);

console.log("web report preview: renders the shared PDF report HTML from API-backed facility data");
