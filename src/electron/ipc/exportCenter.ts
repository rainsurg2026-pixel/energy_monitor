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
import { randomUUID } from "crypto";
import { MonthlyLog } from "../../types";
import { PayloadError, validateLogsPayload } from "../../excel/WorkbookValidator";
import { ensureDir, getExportsDir, log } from "../paths";
import { calculateEnergyCostForMonth } from "../../utils/energyCost";

type AllReportProgressStage = "preparing" | "validating" | "rendering" | "building" | "saving" | "completed";

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

const allReportJobs = new Map<string, { canceled: boolean }>();

function sendAllReportProgress(event: IpcMainInvokeEvent, requestId: string, stage: AllReportProgressStage, detail?: string): void {
  if (!event.sender.isDestroyed()) event.sender.send("export-progress", { requestId, stage, detail });
}

function requireText(body: Record<string, unknown>, key: string, fallback = ""): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    if (fallback) return fallback;
    throw new PayloadError(`Missing ${key}.`);
  }
  return value.trim();
}

async function savePdfAtomically(win: BrowserWindow, target: string, buffer: Buffer): Promise<boolean> {
  const temporaryPath = `${target}.tmp-${randomUUID()}`;
  const backupPath = `${target}.backup-${randomUUID()}`;
  let backupCreated = false;
  try {
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    const existing = await fs.stat(target).then(() => true).catch(() => false);
    if (existing) {
      const confirmation = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Replace", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        title: "Replace existing PDF?",
        message: "A PDF with this name already exists. Replace it?"
      });
      if (confirmation.response !== 0) {
        await fs.rm(temporaryPath, { force: true });
        return false;
      }
      await fs.rename(target, backupPath);
      backupCreated = true;
    }
    await fs.rename(temporaryPath, target);
    if (backupCreated) await fs.rm(backupPath, { force: true });
    return true;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (backupCreated) {
      await fs.rm(target, { force: true }).catch(() => undefined);
      await fs.rename(backupPath, target).catch(() => undefined);
    }
    throw error;
  }
}

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
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 10 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } }
    }
  };
  const applySheetLayout = (ws: ExcelJS.Worksheet, title: string, description: string) => {
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter.oddHeader = `&B${title}&B`;
    ws.headerFooter.oddFooter = `${meta.facility}  |  ${description}  |  Page &P of &N`;
    ws.properties.defaultRowHeight = 19;
  };
  const applyHeader = (ws: ExcelJS.Worksheet, title: string, description: string) => {
    ws.getRow(1).eachCell(cell => Object.assign(cell, { style: headerStyle }));
    ws.getRow(1).height = 34;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    applySheetLayout(ws, title, description);
    for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
      const row = ws.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } }
        };
        if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        cell.alignment = { vertical: "middle", wrapText: false };
      });
    }
  };

  const summary = wb.addWorksheet("Summary");
  summary.addRows([
    ["Energy Monitor Report"],
    ["Facility", meta.facility],
    ["Generated", new Date().toISOString()],
    ["Months", logs.length],
    ["Range", logs.length > 0 ? `${logs[0].month} – ${logs[logs.length - 1].month}` : "-"]
  ]);
  summary.mergeCells("A1:B1");
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  summary.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
  summary.getRow(1).height = 28;
  summary.addRows([
    [],
    ["Export contents", "Description"],
    ["UPS Loads", "Monthly UPS voltage, current, kW and kVA values."],
    ["Air Conditioning", "Monthly Air meter energy readings from the active workbook schema."],
    ["DC Power Panels", "Monthly DC panel voltage and current readings."],
    ["Energy & Cost", "Authoritative monthly building/4th Floor energy and cost values."],
    ["Formatting", "Filters, frozen headers, print layout, wrapped headers and numeric formats are applied to each detail sheet."]
  ]);
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 78;
  summary.getRow(7).eachCell(cell => Object.assign(cell, { style: headerStyle }));
  for (let rowNumber = 8; rowNumber <= 12; rowNumber++) summary.getRow(rowNumber).alignment = { wrapText: true, vertical: "top" };
  applySheetLayout(summary, "Energy Monitor Report", "Export overview");

  const ups = wb.addWorksheet("UPS Loads");
  ups.addRow(["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"]);
  for (const l of logs) for (const u of l.ups) ups.addRow([l.month, u.upsId, u.voltage, u.current, u.loadKw, u.loadKva]);
  applyHeader(ups, "UPS Loads", "Monthly UPS measurements");
  ups.columns.forEach(c => (c.width = 16));
  for (let row = 2; row <= ups.rowCount; row++) for (const column of [3, 4, 5, 6]) ups.getCell(row, column).numFmt = "#,##0.00";

  const air = wb.addWorksheet("Air Conditioning");
  const airFields = logs.some(log => log.air.meters && Object.keys(log.air.meters).length > 0)
    ? Array.from(new Set(logs.flatMap(log => Object.keys(log.air.meters ?? {})))).sort()
    : ["eb41a", "eb41b", "eb42a", "eb42b"];
  air.addRow(["Month", ...airFields.map(field => `${field.toUpperCase()} (GWh)`)]);
  for (const l of logs) {
    air.addRow([
      l.month,
      ...airFields.map(field => l.air.meters?.[field] ?? (l.air as unknown as Record<string, number | null | undefined>)[field] ?? null)
    ]);
  }
  applyHeader(air, "Air Conditioning", "Monthly air-conditioning energy readings");
  air.columns.forEach(c => (c.width = 16));
  for (let row = 2; row <= air.rowCount; row++) for (let column = 2; column <= airFields.length + 1; column++) air.getCell(row, column).numFmt = "#,##0.0000";

  const dc = wb.addWorksheet("DC Power Panels");
  dc.addRow(["Month", "DC Panel", "Voltage (V)", "Current (A)"]);
  for (const l of logs) for (const d of l.dc) dc.addRow([l.month, d.panelId, d.voltage, d.current]);
  applyHeader(dc, "DC Power Panels", "Monthly DC panel readings");
  dc.columns.forEach(c => (c.width = 16));
  for (let row = 2; row <= dc.rowCount; row++) for (const column of [3, 4]) dc.getCell(row, column).numFmt = "#,##0.00";

  const energy = wb.addWorksheet("Energy & Cost");
  energy.addRow([
    "Month",
    "Building Energy Consumption (kWh)",
    "Building Electricity Cost (THB)",
    "4th Floor Energy Consumption (kWh)",
    "4th Floor Electricity Cost (THB)",
    "Average Electricity Rate (THB/kWh)",
    "4th Floor Energy Share (%)"
  ]);
  for (const l of logs) {
    const energyCost = calculateEnergyCostForMonth(logs, l.month);
    energy.addRow([
      l.month,
      energyCost.buildingEnergyKwh,
      energyCost.buildingElectricityCostThb,
      energyCost.floorEnergyKwh,
      energyCost.floorElectricityCostThb,
      energyCost.averageElectricityRateThbPerKwh,
      energyCost.energySharePercent === null ? null : energyCost.energySharePercent / 100
    ]);
  }
  for (let row = 2; row <= energy.rowCount; row++) {
    for (const column of [2, 3, 4, 5, 6]) energy.getCell(row, column).numFmt = "#,##0.00";
    energy.getCell(row, 7).numFmt = "0.00%";
  }
  applyHeader(energy, "Energy & Cost", "Authoritative monthly energy and cost values");
  energy.columns.forEach(c => (c.width = 22));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildExportManifest(meta: { facility: string; base: string; csvNames: string[] }): string {
  return [
    "ENERGY MONITOR EXPORT PACKAGE",
    "=============================",
    `Facility: ${meta.facility}`,
    `Package: ${meta.base}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "CONTENTS",
    `${meta.base}.pdf        Current dashboard PDF snapshot`,
    `${meta.base}.xlsx       Styled workbook with filtered detail sheets`,
    "Dashboard.png          Dashboard image snapshot",
    ...meta.csvNames.map(name => `${name.padEnd(24, " ")} Section CSV export`),
    "IntegrityReport.txt    Workbook validation and integrity summary",
    "",
    "The source workbook remains unchanged. Blank values are preserved as blank in CSV/XLSX data; no U-capacity metrics are inferred."
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerExportIpc(): void {
  ipcMain.handle("export:all-report", (event, raw: unknown) =>
    wrap("all-report", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const requestId = requireText(body, "requestId");
      const workbookPath = requireText(body, "workbookPath");
      const facility = requireText(body, "facility", "Facility").slice(0, 100);
      const selectedMonth = typeof body.selectedMonth === "string" && body.selectedMonth.trim() !== "" ? body.selectedMonth.trim() : null;
      const appVersion = requireText(body, "appVersion", "Unknown").slice(0, 80);
      const win = windowFor(event);
      const job = { canceled: false };
      allReportJobs.set(requestId, job);
      try {
        const [{ buildReportData }, { ExportCancelledError, renderAllReportPdf, validatePdfBuffer }] = await Promise.all([
          import("../../reports/reportDataBuilder"),
          import("./allReportPdf")
        ]);
        sendAllReportProgress(event, requestId, "preparing", "Re-reading active workbook");
        const data = await buildReportData({ workbookPath, facility, selectedMonth, appVersion });
        if (job.canceled) throw new ExportCancelledError();
        sendAllReportProgress(event, requestId, "validating", `${data.monthlyRows.length} historical month(s), ${data.rack?.records.length ?? 0} rack row(s)`);
        const rendered = await renderAllReportPdf(data, (stage, detail) => sendAllReportProgress(event, requestId, stage, detail), () => job.canceled);
        validatePdfBuffer(rendered.buffer);
        const base = safeBaseName(body.defaultName, `${facility}_All_Report`);
        const target = await askSavePath(win, base, "pdf", "PDF Document");
        if (!target) return { ok: true, canceled: true };
        sendAllReportProgress(event, requestId, "saving", "Validating and saving PDF");
        const saved = await savePdfAtomically(win, target, rendered.buffer);
        if (!saved) return { ok: true, canceled: true };
        log.info(`[EXPORT] all-report -> ${target} (${rendered.pageCount} pages, ${rendered.fileSize} bytes, status=${data.status})`);
        sendAllReportProgress(event, requestId, "completed", `Saved ${path.basename(target)}`);
        return { ok: true, path: target };
      } catch (error) {
        if (error instanceof Error && error.name === "ExportCancelledError") return { ok: false, code: "CANCELED", message: error.message };
        throw error;
      } finally {
        allReportJobs.delete(requestId);
      }
    })
  );

  ipcMain.handle("export:all-report:cancel", (_event, raw: unknown) => {
    const requestId = typeof raw === "string" ? raw : (raw as Record<string, unknown> | null)?.requestId;
    if (typeof requestId === "string") {
      const job = allReportJobs.get(requestId);
      if (job) job.canceled = true;
    }
    return { ok: true };
  });

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
      zip.file("README.txt", buildExportManifest({ facility, base, csvNames: csvs.map(csv => csv.name) }));

      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
      await fs.writeFile(target, buffer);
      log.info(`[EXPORT] zip -> ${target} (${csvs.length} csvs, integrity=${Boolean(integrityText)})`);
      return { ok: true, path: target };
    })
  );
}
