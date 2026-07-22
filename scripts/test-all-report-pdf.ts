import { app, BrowserWindow } from "electron";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildReportData } from "../src/reports/reportDataBuilder";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import { validatePdfBuffer } from "../src/electron/ipc/allReportPdf";

async function main(): Promise<void> {
  const workbookPath = path.resolve(process.env.ENERGY_MONITOR_WORKBOOK ?? "DC_Rangsit.xlsm");
  const outputDir = path.resolve(process.env.ENERGY_MONITOR_TEST_EXPORT_DIR ?? path.join("dist-electron", "test-work", "all-report"));
  await app.whenReady();
  const data = await buildReportData({ workbookPath, facility: "Test Facility", selectedMonth: null, appVersion: "test" });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "monthly-power-energy-pdf-test-"));
  const htmlPath = path.join(tempDir, "report.html");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(htmlPath, buildReportHtml(data), "utf8");
  const win = new BrowserWindow({ show: false, width: 1600, height: 1200, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready : true", true);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", landscape: true, preferCSSPageSize: true });
    const validation = validatePdfBuffer(pdf);
    await fs.writeFile(path.join(outputDir, "All_Report.test.pdf"), pdf);
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(outputDir, "All_Report.first-page.png"), image.toPNG());
    console.log(`PDF smoke test passed: ${validation.pageCount} page(s), ${validation.fileSize} bytes.`);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    app.quit();
  }
}

void main().catch(error => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
