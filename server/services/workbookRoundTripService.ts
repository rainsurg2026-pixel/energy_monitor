import ExcelJS from "exceljs";
import { findLogsMismatch, patchSrinakarinWorkbookBuffer, patchWorkbookBuffer } from "../../src/excel/WorkbookWriter";
import { DEFAULT_DEVICE_LISTS } from "../../src/excel/SheetMapper";
import { readWorkbookFromBuffer } from "../../src/excel/WorkbookReader";
import { isSrinakarinWorkbook } from "../../src/excel/SrinakarinWorkbookAdapter";
import { calculateSrinakarinAggregate } from "../../src/utils/srinakarinPower";
import { HttpError } from "../errors";
import type { BackendRepository } from "../repositories/contracts";
import type { ObjectStorage } from "../storage/objectStorage";

export interface WorkbookRoundTripResult {
  siteId: number;
  sourceFileName: string;
  sourceFileHash: string;
  contentType: string;
  byteSize: number;
  buffer: Buffer;
}

/**
 * Reopens the retained source package, patches only Desktop-managed input
 * sheets, then re-reads and compares the result before returning it. This is
 * intentionally a download service, not a new-workbook generator.
 */
export class WorkbookRoundTripService {
  constructor(private readonly repository: BackendRepository, private readonly objectStorage?: ObjectStorage) {}

  async exportWorkbook(siteId: number): Promise<WorkbookRoundTripResult> {
    if (!this.objectStorage) throw new HttpError(503, "WORKBOOK_RETENTION_UNAVAILABLE", "Workbook source retention is not configured.");
    const site = await this.repository.getSite(siteId);
    if (!site || !site.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    const source = await this.repository.getWorkbookSource(siteId);
    if (!source) throw new HttpError(404, "WORKBOOK_SOURCE_NOT_FOUND", "No retained Desktop workbook is available for this site.");
    const original = await this.objectStorage.get(source.objectKey);
    const currentHash = (await import("node:crypto")).createHash("sha256").update(original).digest("hex");
    if (currentHash !== source.sourceFileHash) throw new HttpError(409, "WORKBOOK_SOURCE_HASH_MISMATCH", "The retained workbook failed its source hash check.");

    const periods = (await this.repository.listPeriods(siteId)).filter(period => period.hasData).sort((a, b) => a.month.localeCompare(b.month));
    const logs = await this.repository.getMonthlyLogs(siteId, periods.map(period => period.month));
    const probe = new ExcelJS.Workbook();
    try { await probe.xlsx.load(original as unknown as ArrayBuffer); }
    catch { throw new HttpError(409, "WORKBOOK_SOURCE_INVALID", "The retained source workbook is not readable."); }
    const srinakarin = isSrinakarinWorkbook(probe.worksheets.map(sheet => sheet.name));
    const patched = srinakarin
      ? await patchSrinakarinWorkbookBuffer(original, logs)
      : (await patchWorkbookBuffer(original, logs, DEFAULT_DEVICE_LISTS)).buffer;
    const reread = await readWorkbookFromBuffer(patched, DEFAULT_DEVICE_LISTS);
    if (!reread.validation.ok) throw new HttpError(500, "WORKBOOK_ROUND_TRIP_FAILED", `Patched workbook failed validation: ${reread.validation.errors.join(" ")}`);
    const expected = srinakarin ? logs.map(log => ({ ...log, ups: calculateSrinakarinAggregate(log) })) : logs;
    const mismatch = findLogsMismatch(expected, reread.logs, DEFAULT_DEVICE_LISTS);
    if (mismatch) throw new HttpError(500, "WORKBOOK_ROUND_TRIP_FAILED", `Patched workbook did not round-trip identically: ${mismatch}`);
    return { siteId, sourceFileName: source.sourceFileName, sourceFileHash: source.sourceFileHash, contentType: source.contentType, byteSize: patched.length, buffer: patched };
  }
}
