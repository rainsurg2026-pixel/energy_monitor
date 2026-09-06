import { app, BrowserWindow } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildCurrentFacilityPdfHtml } from "../src/reports/pdf/reportHtml";
import { validateReportHtml } from "../src/reports/pdf/reportSafety";
import { validatePdfBuffer } from "../src/electron/ipc/allReportPdf";
import { shiftMonth } from "../src/utils/monthUtils";

async function main(): Promise<void> {
  const root = process.cwd();
  const workbookPath = path.resolve(process.env.ENERGY_MONITOR_WORKBOOK ?? "DC_Rangsit.xlsm");
  const outputDir = path.resolve(process.env.ENERGY_MONITOR_TEST_EXPORT_DIR ?? path.join("dist-electron", "test-work", "current-facility-report"));
  const facilityId = process.env.ENERGY_MONITOR_FACILITY_ID ?? (path.basename(workbookPath).toLowerCase().includes("srinakarin") ? "srinakarin" : "rangsit");
  const facilityName = process.env.ENERGY_MONITOR_FACILITY ?? "Current Facility Runtime Test";
  const selectedMonth = process.env.ENERGY_MONITOR_SELECTED_MONTH ?? null;
  const dashboard = JSON.parse(await fs.readFile(path.join(root, "config", facilityId, "profile.json"), "utf8")).dashboard;
  await fs.mkdir(outputDir, { recursive: true });
  await app.whenReady();
  const report = await buildReportData({
    workbookPath,
    facility: facilityName,
    selectedMonth,
    appVersion: "current-facility-pdf-runtime-test",
    dashboard
  });
  const capacityMonths = [-2, -1, 0].map(offset => shiftMonth(report.reportingMonth, offset));
  const capacityReport = {
    ...report,
    rackHistory: capacityMonths.map((month, index) => {
      const total = 358;
      const inUse = 292 + index;
      const available = 10 - index;
      const reserved = 32;
      const pendingDismantle = total - inUse - available - reserved;
      return { snapshotMonth: month, facility: facilityName, rackZone: "(Total)", totalRacks: total, inUse, available, reserved, pendingDismantle, other: 0, usagePct: inUse / total, availabilityPct: available / total, reservedPct: reserved / total, pendingDismantlePct: pendingDismantle / total, otherPct: 0, generatedAt: report.generatedAt, dataVersion: 1 };
    }),
    rackUnitCapacity: capacityMonths.map((month, index) => ({ month, totalU: 14121, usedU: 12180 + index * 80, availableU: 1941 - index * 80, availabilityPct: (1941 - index * 80) / 14121 }))
  };
  const html = buildCurrentFacilityPdfHtml(capacityReport);
  validateReportHtml(html);
  const htmlPath = path.join(outputDir, "Current_Facility.test.html");
  await fs.writeFile(htmlPath, html, "utf8");
  const win = new BrowserWindow({ show: false, width: 1600, height: 1200, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready : true", true);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", landscape: true, preferCSSPageSize: true });
    const validation = validatePdfBuffer(pdf);
    if (!html.includes("Capacity Overview") || !html.includes("Rack Capacity Trend") || !html.includes("Rack Unit Capacity Trend")) throw new Error("Capacity Overview runtime fixture did not render both trend charts.");
    if (validation.pageCount < 10) throw new Error("Current Facility PDF runtime output is unexpectedly short: " + validation.pageCount + " page(s).");
    await fs.writeFile(path.join(outputDir, "Current_Facility.test.pdf"), pdf);
    const pagePositions = await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('.cover, .page')).map((element) => element.getBoundingClientRect().top + window.scrollY)", true) as number[];
    const screenshotIndices = [...new Set([1, 3, 10, Math.max(1, pagePositions.length - 2), Math.max(1, pagePositions.length - 1)].filter(index => index < pagePositions.length))];
    for (const index of screenshotIndices) {
      await win.webContents.executeJavaScript("window.scrollTo(0, " + Math.max(0, pagePositions[index] ?? 0) + ");", true);
      await new Promise(resolve => setTimeout(resolve, 80));
      const image = await win.webContents.capturePage();
      await fs.writeFile(path.join(outputDir, "Current_Facility.page-" + String(index + 1).padStart(2, "0") + ".png"), image.toPNG());
    }
    console.log("Current Facility PDF runtime smoke passed: " + validation.pageCount + " page(s), " + validation.fileSize + " bytes, screenshots " + screenshotIndices.length + ".");
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.quit();
  }
}

void main().catch(error => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});