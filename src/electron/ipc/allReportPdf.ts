import { BrowserWindow } from "electron";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildReportHtml } from "../../reports/pdf/reportHtml";
import type { ReportData } from "../../reports/reportTypes";

export type AllReportProgressStage = "preparing" | "validating" | "rendering" | "building" | "saving" | "completed";

export class ExportCancelledError extends Error {
  constructor() {
    super("Export canceled.");
    this.name = "ExportCancelledError";
  }
}

export function validatePdfBuffer(buffer: Buffer): { pageCount: number; fileSize: number } {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF validation failed: invalid PDF header.");
  }
  const pageCount = (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  if (pageCount < 1) throw new Error("PDF validation failed: no pages were generated.");
  return { pageCount, fileSize: buffer.length };
}

export async function renderAllReportPdf(
  data: ReportData,
  onProgress: (stage: AllReportProgressStage, detail?: string) => void,
  isCanceled: () => boolean
): Promise<{ buffer: Buffer; pageCount: number; fileSize: number }> {
  if (isCanceled()) throw new ExportCancelledError();
  const html = buildReportHtml(data);
  if (/\bPUE\b|\bCO2\b|<img\b/i.test(html)) {
    throw new Error("Report validation failed: forbidden content was included.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "monthly-power-energy-report-"));
  const htmlPath = path.join(tempDir, "report.html");
  await fs.writeFile(htmlPath, html, "utf8");
  let reportWindow: BrowserWindow | null = null;
  try {
    onProgress("rendering", "Preparing printable report");
    reportWindow = new BrowserWindow({
      show: false,
      width: 1600,
      height: 1200,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await reportWindow.loadFile(htmlPath);
    if (isCanceled()) throw new ExportCancelledError();
    await reportWindow.webContents.executeJavaScript(
      "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true",
      true
    );
    await reportWindow.webContents.executeJavaScript(
      "document.body && document.body.dataset.reportReady === 'true'",
      true
    );
    onProgress("building", "Rendering A4 landscape PDF");
    const buffer = await reportWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      landscape: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      footerTemplate: '<div style="width:100%;font:8px sans-serif;color:#657488;text-align:center"><span class="pageNumber"></span> of <span class="totalPages"></span></div>'
    });
    if (isCanceled()) throw new ExportCancelledError();
    const validation = validatePdfBuffer(buffer);
    return { buffer, ...validation };
  } finally {
    if (reportWindow && !reportWindow.isDestroyed()) reportWindow.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
