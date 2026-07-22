import { promises as fs } from "fs";
import path from "path";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";

const workbookPath = path.resolve(process.env.ENERGY_MONITOR_WORKBOOK ?? "DC_Rangsit.xlsm");
const before = await fs.stat(workbookPath);
const report = await buildReportData({
  workbookPath,
  facility: "Test Facility",
  selectedMonth: null,
  appVersion: "test"
});
const html = buildReportHtml(report);

if (!html.includes("Export All Report") && !html.includes("Monthly Power")) throw new Error("Combined report title is missing.");
if ((html.match(/<h2>Monthly Energy &amp; Cost Table<\/h2>/g) ?? []).length !== 1) throw new Error("Monthly table was duplicated or omitted.");
if (/\bPUE\b|\bCO2\b|<img\b/i.test(html)) throw new Error("Forbidden report content was found.");
if (report.monthlyRows.length > 0 && !html.includes("Building Energy")) throw new Error("Energy report data is missing.");
if (report.rack && !html.includes("Rack Capacity")) throw new Error("Rack Capacity section is missing.");
for (const section of ["Executive Summary", "Energy &amp; Cost KPI Summary", "Energy Consumption Trend", "Electricity Cost Trend", "UPS, Air, and DC Summary", "Historical Operations Summary", "Smart Insights and Data-quality Warnings", "Report Information and Data Source"]) {
  if (!html.includes(`<h2>${section}</h2>`)) throw new Error(`Required section is missing: ${section}`);
}
for (const chart of ["Building Energy", "4th Floor Energy", "Building Cost", "4th Floor Cost"]) {
  if (!html.includes(chart)) throw new Error(`Required chart series is missing: ${chart}`);
}
if (!html.includes('Prompt, "Noto Sans Thai", Tahoma, sans-serif')) throw new Error("Offline-safe font stack is missing.");
if (report.rack && !["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"].every(field => html.includes(`<th>${field}</th>`))) {
  throw new Error("Rack inventory fields are incomplete.");
}

const after = await fs.stat(workbookPath);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The source workbook changed during the report test.");
console.log(`All-report data test passed: ${report.monthlyRows.length} month(s), ${report.rack?.records.length ?? 0} rack row(s).`);
