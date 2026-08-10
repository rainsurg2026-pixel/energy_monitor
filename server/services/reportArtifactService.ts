import { existsSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import type { MonthlyLog } from "../../src/types";
import { buildSectionCsvs } from "../../src/utils/exportData";
import { buildReportWorkbookBuffer } from "../../src/reporting/reportWorkbook";
import type { BackendRepository, RackSnapshotRecord, RackUnitSnapshotRecord } from "../repositories/contracts";
import { HttpError } from "../errors";
import type { IntegrityService, WebIntegrityReport } from "./integrityService";
import type { ReportService } from "./reportService";

export type ReportArtifactFormat = "pdf" | "png" | "zip";

export interface RenderedReportArtifacts {
  pdf: Buffer;
  png: Buffer;
}

export interface ReportArtifactRenderer {
  render(html: string): Promise<RenderedReportArtifacts>;
}

function isHostedRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function localChromiumCandidates(): string[] {
  return [
    process.env.CHROME_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

async function executablePath(): Promise<string> {
  if (isHostedRuntime()) return chromium.executablePath();
  const candidate = localChromiumCandidates()[0];
  if (!candidate) throw new HttpError(503, "REPORT_RENDERER_UNAVAILABLE", "A Chromium renderer is not configured for PDF/PNG export.");
  return candidate;
}

/**
 * Real artifact renderer. Desktop uses Electron's Chromium print/capture
 * primitives; Web uses the same Chromium engine through Puppeteer. The
 * browser is deliberately server-side so a print dialog or canvas shim can
 * never be mistaken for a saved PDF/PNG artifact.
 */
export class ChromiumReportArtifactRenderer implements ReportArtifactRenderer {
  async render(html: string): Promise<RenderedReportArtifacts> {
    const hosted = isHostedRuntime();
    const browser = await puppeteer.launch({
      executablePath: await executablePath(),
      headless: true,
      args: hosted ? chromium.args : ["--disable-gpu", "--no-sandbox"]
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "load" });
      await page.emulateMediaType("print");
      const pdf = Buffer.from(await page.pdf({
        printBackground: true,
        format: "A4",
        landscape: true,
        preferCSSPageSize: true
      }));
      await page.emulateMediaType("screen");
      const png = Buffer.from(await page.screenshot({ type: "png", fullPage: true }));
      validatePdfBuffer(pdf);
      validatePngBuffer(png);
      return { pdf, png };
    } finally {
      await browser.close();
    }
  }
}

export function validatePdfBuffer(buffer: Buffer): void {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF artifact does not contain a valid PDF header.");
  if (!buffer.toString("latin1").includes("/Type /Page")) throw new Error("PDF artifact contains no page object.");
}

export function validatePngBuffer(buffer: Buffer): void {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, signature.length).equals(signature)) throw new Error("PNG artifact does not contain a valid PNG signature.");
}

function safeFilename(value: string, extension: string): string {
  const base = path.basename(value).replace(/[<>:"/\\|?*]/g, "_").slice(0, 120) || "Energy_Monitor_Report";
  return `${base}.${extension}`;
}

function integrityText(report: WebIntegrityReport): string {
  return [
    "DATA INTEGRITY REPORT",
    "=====================",
    `Facility:  ${report.facility}`,
    `Validated: ${report.validatedAt}`,
    `Scope:     ${report.scope}`,
    `Structure: ${report.structureOk ? "VALID" : "INVALID"}`,
    `Months:    ${report.monthCount} (${report.firstMonth ?? "-"} .. ${report.lastMonth ?? "-"})`,
    "",
    `Missing months:   ${report.missingMonths.length}`,
    ...report.missingMonths.map(month => `  - ${month}`),
    `Missing sections: ${report.missingSections.length}`,
    ...report.missingSections.map(item => `  - ${item.month}: ${item.sections.join(", ")}`),
    `Duplicate months: ${report.duplicateMonths.length}`,
    ...report.duplicateMonths.map(month => `  - ${month}`),
    `Invalid months:   ${report.invalidMonths.length}`,
    ...report.invalidMonths.map(month => `  - ${month}`),
    ...report.errors.map(error => `ERROR: ${error}`),
    ...report.warnings.map(warning => `WARNING: ${warning}`)
  ].join("\r\n");
}

function exportManifest(facility: string, base: string, csvNames: string[]): string {
  return [
    "ENERGY MONITOR EXPORT PACKAGE",
    "=============================",
    `Facility: ${facility}`,
    `Package: ${base}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "CONTENTS",
    `${base}.pdf        Current report rendered by headless Chromium`,
    `${base}.xlsx       Styled workbook export`,
    "Dashboard.png          Current report PNG rendered by headless Chromium",
    ...csvNames.map(name => `${name.padEnd(24, " ")} Section CSV export`),
    "IntegrityReport.txt    Web integrity report",
    "",
    "PDF and PNG are generated as files by the server-side Chromium renderer; no browser print dialog is involved."
  ].join("\r\n");
}

function snapshotForWorkbook(snapshot: RackSnapshotRecord | null): RackSnapshotRecord | null { return snapshot; }

export class ReportArtifactService {
  constructor(
    private readonly repository: BackendRepository,
    private readonly reportService: ReportService,
    private readonly integrityService: IntegrityService,
    private readonly renderer: ReportArtifactRenderer = new ChromiumReportArtifactRenderer()
  ) {}

  async build(siteId: number, month: unknown, format: ReportArtifactFormat, options: Parameters<ReportService["buildAllReport"]>[2] = {}): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const report = await this.reportService.buildAllReport(siteId, month, options);
    const base = report.filename;
    const artifacts = await this.renderer.render(report.html);
    if (format === "pdf") return { buffer: artifacts.pdf, filename: safeFilename(base, "pdf"), contentType: "application/pdf" };
    if (format === "png") return { buffer: artifacts.png, filename: safeFilename(base, "png"), contentType: "image/png" };

    const periods = (await this.repository.listPeriods(siteId)).filter(period => period.hasData).sort((a, b) => a.month.localeCompare(b.month));
    const logs = await this.repository.getMonthlyLogs(siteId, periods.map(period => period.month));
    const snapshots: RackSnapshotRecord[] = [];
    const rackUnitSnapshots: RackUnitSnapshotRecord[] = [];
    for (const period of periods) {
      const rack = snapshotForWorkbook(await this.repository.getRackSnapshot(siteId, period.month));
      if (rack) snapshots.push(rack);
      const rackUnit = await this.repository.getRackUnitSnapshot(siteId, period.month);
      if (rackUnit) rackUnitSnapshots.push(rackUnit);
    }
    const workbook = Buffer.from(await buildReportWorkbookBuffer(logs, report.facility, snapshots, rackUnitSnapshots));
    const csvs = buildSectionCsvs(logs);
    const integrity = await this.integrityService.buildReport(siteId);
    const zip = new JSZip();
    zip.file(safeFilename(base, "pdf"), artifacts.pdf);
    zip.file(safeFilename(base, "xlsx"), workbook);
    zip.file("Dashboard.png", artifacts.png);
    for (const csv of csvs) zip.file(csv.name, csv.content);
    zip.file("IntegrityReport.txt", integrityText(integrity));
    zip.file("README.txt", exportManifest(report.facility, base, csvs.map(csv => csv.name)));
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
    return { buffer, filename: safeFilename(base, "zip"), contentType: "application/zip" };
  }
}

export function assertMonthlyLogs(logs: readonly MonthlyLog[]): void {
  if (logs.some(log => !/^\d{4}-\d{2}$/.test(log.month))) throw new Error("Report export received an invalid month key.");
}
