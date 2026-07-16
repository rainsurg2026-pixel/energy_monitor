/**
 * Export Center (RC6) - native desktop exports, no browser downloads.
 *
 *   export:pdf   - current window rendered to PDF (Chromium print engine)
 *   export:png   - current window captured to PNG
 *   export:excel - report workbook (.xlsx) built with ExcelJS from the logs
 *   export:zip   - one package: PDF + XLSX + per-section CSVs + window PNG
 *                  + integrity report text
 *
 * Every export goes through the native save dialog (defaulting to the
 * portable exports/ folder) and is logged with the EXPORT category.
 */

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { BrowserWindow, IpcMainInvokeEvent, dialog, ipcMain } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { MonthlyLog } from "../../types";
import { PayloadError, validateLogsPayload } from "../../excel/WorkbookValidator";
import { ensureDir, getExportsDir, log } from "../paths";

function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new PayloadError("No window for export.");
  return win;
}

function safeBaseName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" && raw.trim() !== "" ? raw : fallback;
  return path.basename(name).replace(/[<>:"/\\|?*]/g, "_").slice(0, 120);
}

async function askSavePath(
  win: BrowserWindow,
  defaultName: string,
  ext: string,
  filterName: string
): Promise<string | null> {
  // Test hook: automated tests cannot drive native dialogs, so an explicit
  // env var short-circuits to a fixed directory. Never set in production.
  if (process.env.ENERGY_MONITOR_TEST_EXPORT_DIR) {
    const dir = await ensureDir(process.env.ENERGY_MONITOR_TEST_EXPORT_DIR);
    return path.join(dir, `${defaultName}.${ext}`);
  }
  const exportsDir = await ensureDir(getExportsDir());
  const result = await dialog.showSaveDialog(win, {
    title: "Export",
    defaultPath: path.join(exportsDir, `${defaultName}.${ext}`),
    filters: [{ name: filterName, extensions: [ext] }]
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

type Result = { ok: true; path: string } | { ok: true; canceled: true } | { ok: false; code: string; message: string };

async function wrap(operation: string, fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[EXPORT] ${operation} failed: ${message}`);
    return { ok: false, code: err instanceof PayloadError ? "BAD_PAYLOAD" : "ERROR", message };
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function buildPdf(win: BrowserWindow): Promise<Buffer> {
  return win.webContents.printToPDF({ printBackground: true, pageSize: "A4", landscape: true });
}

async function buildPng(win: BrowserWindow): Promise<Buffer> {
  const image = await win.webContents.capturePage();
  return image.toPNG();
}

async function buildReportWorkbook(logs: MonthlyLog[], meta: { facility: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Energy Monitor";
  wb.created = new Date();

  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF312E81" } },
    alignment: { horizontal: "center" }
  };
  const applyHeader = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const summary = wb.addWorksheet("Summary");
  summary.addRows([
    ["Energy Monitor Report"],
    ["Facility", meta.facility],
    ["Generated", new Date().toISOString()],
    ["Months", logs.length],
    ["Range", logs.length > 0 ? `${logs[0].month} – ${logs[logs.length - 1].month}` : "-"]
  ]);
  summary.getColumn(1).width = 14;
  summary.getColumn(2).width = 40;
  summary.getCell("A1").font = { bold: true, size: 14 };

  const ups = wb.addWorksheet("UPS Loads");
  ups.addRow(["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"]);
  for (const l of logs) for (const u of l.ups) ups.addRow([l.month, u.upsId, u.voltage, u.current, u.loadKw, u.loadKva]);
  applyHeader(ups);
  ups.columns.forEach(c => (c.width = 16));

  const air = wb.addWorksheet("Air Conditioning");
  air.addRow(["Month", "EB41A (GWh)", "EB41B (GWh)", "EB42A (GWh)", "EB42B (GWh)"]);
  for (const l of logs) air.addRow([l.month, l.air.eb41a, l.air.eb41b, l.air.eb42a, l.air.eb42b]);
  applyHeader(air);
  air.columns.forEach(c => (c.width = 16));

  const dc = wb.addWorksheet("DC Power Panels");
  dc.addRow(["Month", "DC Panel", "Voltage (V)", "Current (A)"]);
  for (const l of logs) for (const d of l.dc) dc.addRow([l.month, d.panelId, d.voltage, d.current]);
  applyHeader(dc);
  dc.columns.forEach(c => (c.width = 16));

  const energy = wb.addWorksheet("Energy & Cost");
  energy.addRow(["Month", "Building Energy (kWh)", "Electricity Cost (THB)"]);
  for (const l of logs) energy.addRow([l.month, l.energyCost.buildingEnergyKwh, l.energyCost.buildingElectricityCostThb]);
  applyHeader(energy);
  energy.columns.forEach(c => (c.width = 22));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerExportIpc(): void {
  ipcMain.handle("export:pdf", (event, raw: unknown) =>
    wrap("pdf", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const win = windowFor(event);
      const base = safeBaseName(body.defaultName, "Report");
      const target = await askSavePath(win, base, "pdf", "PDF Document");
      if (!target) return { ok: true, canceled: true };
      await fs.writeFile(target, await buildPdf(win));
      log.info(`[EXPORT] pdf -> ${target}`);
      return { ok: true, path: target };
    })
  );

  ipcMain.handle("export:png", (event, raw: unknown) =>
    wrap("png", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const win = windowFor(event);
      const base = safeBaseName(body.defaultName, "Dashboard");
      const target = await askSavePath(win, base, "png", "PNG Image");
      if (!target) return { ok: true, canceled: true };
      await fs.writeFile(target, await buildPng(win));
      log.info(`[EXPORT] png -> ${target}`);
      return { ok: true, path: target };
    })
  );

  ipcMain.handle("export:excel", (event, raw: unknown) =>
    wrap("excel", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const win = windowFor(event);
      const logs = validateLogsPayload(body.logs);
      const facility = typeof body.facility === "string" ? body.facility.slice(0, 100) : "Facility";
      const base = safeBaseName(body.defaultName, `${facility}_Report`);
      const target = await askSavePath(win, base, "xlsx", "Excel Workbook");
      if (!target) return { ok: true, canceled: true };
      await fs.writeFile(target, await buildReportWorkbook(logs, { facility }));
      log.info(`[EXPORT] excel -> ${target}`);
      return { ok: true, path: target };
    })
  );

  ipcMain.handle("export:zip", (event, raw: unknown) =>
    wrap("zip", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const win = windowFor(event);
      const logs = validateLogsPayload(body.logs);
      const facility = typeof body.facility === "string" ? body.facility.slice(0, 100) : "Facility";
      const base = safeBaseName(body.defaultName, `${facility}_Report`);

      const csvs = Array.isArray(body.csvs)
        ? (body.csvs as Array<Record<string, unknown>>)
            .filter(c => typeof c?.name === "string" && typeof c?.content === "string")
            .slice(0, 10)
            .map(c => ({ name: safeBaseName(c.name, "data.csv"), content: String(c.content).slice(0, 20_000_000) }))
        : [];
      const integrityText =
        typeof body.integrityText === "string" ? body.integrityText.slice(0, 5_000_000) : null;

      const target = await askSavePath(win, base, "zip", "ZIP Package");
      if (!target) return { ok: true, canceled: true };

      const zip = new JSZip();
      zip.file(`${base}.pdf`, await buildPdf(win));
      zip.file(`${base}.xlsx`, await buildReportWorkbook(logs, { facility }));
      zip.file("Dashboard.png", await buildPng(win));
      for (const csv of csvs) zip.file(csv.name, csv.content);
      if (integrityText) zip.file("IntegrityReport.txt", integrityText);

      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
      await fs.writeFile(target, buffer);
      log.info(`[EXPORT] zip -> ${target} (${csvs.length} csvs, integrity=${Boolean(integrityText)})`);
      return { ok: true, path: target };
    })
  );
}
