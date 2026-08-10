import { createHash } from "node:crypto";
import { readWorkbookFromBuffer } from "../../src/excel/WorkbookReader";
import { readUpsGroupHistoryFromBuffer } from "../../src/reports/upsGroupHistoryReader";
import { readRackCapacityHistoryFromBuffer } from "../../src/excel/RackCapacityHistoryWriter";
import { readRackCapacityFromBuffer } from "../../src/reports/rackCapacityReader";
import { readRackUnitCapacityFromBuffer } from "../../src/excel/RackUnitCapacityWriter";
import { readRackUnitCapacityImageForMonth, readRackUnitCapacityImageHistoryFromBuffer } from "../../src/excel/RackUnitCapacityImageHistoryWriter";
import { assertStrictMonth, isAllowedMonth, type DisplayPeriod } from "../policies/displayPeriod";
import { HttpError } from "../errors";
import type { BackendRepository, RackUnitImageRecord, SiteRecord, WorkbookSourceRecord } from "../repositories/contracts";
import type { ObjectStorage } from "../storage/objectStorage";

function monthOfDate(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function sourceHash(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }

export interface WorkbookImportResult {
  siteId: number;
  sourceFileName: string;
  sourceFileHash: string;
  importedMonths: string[];
  validation: { ok: boolean; errors: string[]; warnings: string[]; sheetNames: Record<string, string> };
  integrity: { duplicateKeys: unknown[]; missingMonths: unknown[]; missingDevices: unknown[]; unexpectedBlankRows: unknown[]; invalidIds: unknown[] };
  rackCapacitySnapshotMonth: string | null;
  rackUnitCapacityMonths: string[];
  rackCapacityHistoryMonths: string[];
  upsGroupHistoryMonths: string[];
  rackUnitCapacityImageMonths: string[];
  idempotent: boolean;
}

export class ImportService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date(), private readonly objectStorage?: ObjectStorage, private readonly imageStorage?: ObjectStorage) {}

  private async requireSite(siteId: number): Promise<SiteRecord> {
    const site = await this.repository.getSite(siteId);
    if (!site || !site.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    return site;
  }

  private async requirePeriod(): Promise<DisplayPeriod> {
    const settings = await this.repository.getGlobalSettings();
    if (!settings) throw new HttpError(503, "DISPLAY_PERIOD_NOT_CONFIGURED", "Global Display Period has not been configured.");
    return settings;
  }

  async importWorkbook(siteId: number, sourceFileName: unknown, buffer: Buffer, correlationId: string, actorUserId: number, options: { restoreSource?: WorkbookSourceRecord } = {}): Promise<WorkbookImportResult> {
    await this.requireSite(siteId);
    const period = await this.requirePeriod();
    if (buffer.length === 0) throw new HttpError(400, "EMPTY_WORKBOOK", "The workbook file is empty.");
    let parsed: Awaited<ReturnType<typeof readWorkbookFromBuffer>>;
    try { parsed = await readWorkbookFromBuffer(buffer); }
    catch { throw new HttpError(400, "INVALID_WORKBOOK", "The uploaded file is not a readable Excel workbook."); }
    if (!parsed.validation.ok) throw new HttpError(400, "WORKBOOK_VALIDATION_FAILED", parsed.validation.errors.slice(0, 20).join(" "));
    if (parsed.logs.length === 0) throw new HttpError(400, "WORKBOOK_HAS_NO_DATA", "The workbook contains no readable monthly data.");
    let upsGroupHistory: Awaited<ReturnType<typeof readUpsGroupHistoryFromBuffer>> = null;
    try { upsGroupHistory = await readUpsGroupHistoryFromBuffer(buffer); }
    catch (error) { throw new HttpError(400, "UPS_GROUP_HISTORY_VALIDATION_FAILED", error instanceof Error ? error.message : "UPS Group History sheet could not be validated."); }
    let rackCapacity: Awaited<ReturnType<typeof readRackCapacityFromBuffer>> = null;
    try { rackCapacity = await readRackCapacityFromBuffer(buffer); }
    catch (error) { throw new HttpError(400, "RACK_CAPACITY_VALIDATION_FAILED", error instanceof Error ? error.message : "Rack Capacity sheet could not be validated."); }
    let rackUnitCapacityRows: Awaited<ReturnType<typeof readRackUnitCapacityFromBuffer>> = [];
    try { rackUnitCapacityRows = await readRackUnitCapacityFromBuffer(buffer); }
    catch (error) { throw new HttpError(400, "RACK_UNIT_CAPACITY_VALIDATION_FAILED", error instanceof Error ? error.message : "Rack Unit Capacity sheet could not be validated."); }
    let rackCapacityHistoryRows: Awaited<ReturnType<typeof readRackCapacityHistoryFromBuffer>> = [];
    try { rackCapacityHistoryRows = await readRackCapacityHistoryFromBuffer(buffer); }
    catch (error) { throw new HttpError(400, "RACK_CAPACITY_HISTORY_VALIDATION_FAILED", error instanceof Error ? error.message : "Rack Capacity History sheet could not be validated."); }
    let imageHistoryRows: Awaited<ReturnType<typeof readRackUnitCapacityImageHistoryFromBuffer>> = [];
    try { imageHistoryRows = await readRackUnitCapacityImageHistoryFromBuffer(buffer); }
    catch (error) { throw new HttpError(400, "RACK_UNIT_IMAGE_HISTORY_VALIDATION_FAILED", error instanceof Error ? error.message : "Rack Unit Capacity image history could not be validated."); }
    const duplicateImageMonths = imageHistoryRows.map(row => row.reportingMonth).filter((month, index, all) => all.indexOf(month) !== index);
    if (duplicateImageMonths.length > 0) throw new HttpError(400, "DUPLICATE_RACK_UNIT_IMAGE_MONTH", `Workbook contains more than one Rack Unit Capacity image for: ${[...new Set(duplicateImageMonths)].join(", ")}.`);
    const asOf = monthOfDate(this.now());
    for (const imageRow of imageHistoryRows) {
      try { assertStrictMonth(imageRow.reportingMonth, "Rack Unit Capacity image month"); } catch { throw new HttpError(400, "INVALID_RACK_UNIT_IMAGE_MONTH", `Rack Unit Capacity image month ${imageRow.reportingMonth} is invalid.`); }
      if (!isAllowedMonth(imageRow.reportingMonth, period)) throw new HttpError(400, "MONTH_OUTSIDE_DISPLAY_PERIOD", `Rack Unit Capacity image month ${imageRow.reportingMonth} is outside the Global Display Period.`);
      if (imageRow.reportingMonth > asOf) throw new HttpError(400, "FUTURE_RACK_UNIT_IMAGE_MONTH", `Rack Unit Capacity image month ${imageRow.reportingMonth} is in the future.`);
    }
    const logs = [...parsed.logs].sort((a, b) => a.month.localeCompare(b.month));
    const duplicateMonths = logs.map(log => log.month).filter((month, index, all) => all.indexOf(month) !== index);
    if (duplicateMonths.length > 0) throw new HttpError(400, "DUPLICATE_WORKBOOK_MONTH", `Workbook contains duplicate month records: ${[...new Set(duplicateMonths)].join(", ")}.`);
    for (const log of logs) {
      try { assertStrictMonth(log.month, "month"); } catch { throw new HttpError(400, "INVALID_WORKBOOK_MONTH", `Workbook contains invalid month ${log.month}.`); }
      if (!isAllowedMonth(log.month, period)) throw new HttpError(400, "MONTH_OUTSIDE_DISPLAY_PERIOD", `Workbook month ${log.month} is outside the Global Display Period.`);
      if (log.month > asOf) throw new HttpError(400, "FUTURE_WORKBOOK_MONTH", `Workbook month ${log.month} is in the future.`);
    }
    if (!this.objectStorage) throw new HttpError(503, "WORKBOOK_RETENTION_UNAVAILABLE", "Workbook source retention is not configured; import is disabled until object storage is available.");
    const hash = sourceHash(buffer);
    const normalizedName = typeof sourceFileName === "string" && sourceFileName.trim() ? sourceFileName.trim().slice(0, 255) : "uploaded-workbook.xlsx";
    const contentType = /\.xlsm$/i.test(normalizedName)
      ? "application/vnd.ms-excel.sheet.macroEnabled.12"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const objectKey = `sites/${siteId}/workbooks/${hash}/${normalizedName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const importedMonths = logs.map(log => log.month);
    const rackCapacitySnapshotMonth = rackCapacity ? [...importedMonths].at(-1) ?? null : null;
    const rackUnitCapacityMonths = rackUnitCapacityRows.map(row => row.month).sort();
    const hashAlreadyImported = await this.repository.hasImportedSourceHash(siteId, hash);
    const currentSource = await this.repository.getWorkbookSource(siteId);
    if (options.restoreSource && (options.restoreSource.siteId !== siteId || options.restoreSource.sourceFileHash !== hash)) {
      throw new HttpError(409, "WORKBOOK_BACKUP_HASH_MISMATCH", "The selected workbook backup does not match its retained object.");
    }
    if (hashAlreadyImported && currentSource && !options.restoreSource) {
      return {
        siteId,
        sourceFileName: normalizedName,
        sourceFileHash: hash,
        importedMonths,
        validation: parsed.validation,
        integrity: parsed.integrity,
        rackCapacitySnapshotMonth,
        rackUnitCapacityMonths,
        rackCapacityHistoryMonths: [...new Set(rackCapacityHistoryRows.map(row => row.snapshotMonth))].sort(),
        upsGroupHistoryMonths: [...new Set((upsGroupHistory?.rows ?? []).map(row => row.month))].sort(),
        rackUnitCapacityImageMonths: [...new Set(imageHistoryRows.map(row => row.reportingMonth))].sort(),
        idempotent: true
      };
    }
    const imageUploads: Array<{ input: Omit<RackUnitImageRecord, "siteId" | "savedAt"> & { siteId: number; savedAt?: string; correlationId: string }; bytes: Buffer }> = [];
    try {
      if (!options.restoreSource) await this.objectStorage.put(objectKey, buffer, contentType);
      if (imageHistoryRows.length > 0 && !this.imageStorage) throw new HttpError(503, "RACK_UNIT_IMAGE_STORAGE_UNAVAILABLE", "Rack Unit Capacity image storage is not configured; import cannot retain Desktop image history.");
      for (const row of imageHistoryRows) {
        const image = await readRackUnitCapacityImageForMonth(buffer, row.facility, row.reportingMonth);
        if (!image) throw new HttpError(400, "RACK_UNIT_IMAGE_MISSING", `Rack Unit Capacity image is missing for ${row.facility} ${row.reportingMonth}.`);
        const imageHash = createHash("sha256").update(image.bytes).digest("hex");
        const extension = image.mimeType === "image/jpeg" ? "jpg" : "png";
        const objectKeyForImage = `sites/${siteId}/rack-unit-images/${sourceHash(buffer)}/${row.reportingMonth}.${extension}`;
        const savedAt = Number.isNaN(Date.parse(row.timestamp)) ? undefined : new Date(row.timestamp).toISOString();
        const input = { siteId, month: row.reportingMonth, objectKey: objectKeyForImage, contentType: image.mimeType, byteSize: image.bytes.length, sha256: imageHash, width: image.width, height: image.height, savedBy: row.user.trim() || "desktop-workbook", savedAt, correlationId };
        await this.imageStorage!.put(objectKeyForImage, image.bytes, image.mimeType);
        imageUploads.push({ input, bytes: image.bytes });
      }
      await this.repository.withTransaction(async transaction => {
        if (!hashAlreadyImported || options.restoreSource) {
          const periods = await transaction.listPeriods(siteId);
          for (const log of logs) {
            const existing = periods.find(item => item.month === log.month);
            await transaction.saveMonthlyLog({
              siteId,
              log,
              expectedRowVersion: existing?.rowVersion ?? null,
              correlationId,
              actorUserId,
              provenance: { sourceType: "web-workbook-import", sourceFileHash: hash, sourceFileName: normalizedName, sourceLocation: "web-upload" }
            });
          }
          if (rackCapacity && rackCapacitySnapshotMonth) {
            const existing = await transaction.getRackSnapshot(siteId, rackCapacitySnapshotMonth);
            await transaction.saveRackSnapshot({ siteId, month: rackCapacitySnapshotMonth, records: rackCapacity.records, expectedRowVersion: existing?.rowVersion ?? null, correlationId, actorUserId });
          }
          for (const row of rackUnitCapacityRows) {
            const existing = await transaction.getRackUnitSnapshot(siteId, row.month);
            await transaction.saveRackUnitSnapshot({ siteId, month: row.month, totalU: row.totalU, usedU: row.usedU, expectedRowVersion: existing?.rowVersion ?? null, correlationId, actorUserId });
          }
          await transaction.saveRackCapacityHistory({ siteId, rows: rackCapacityHistoryRows, correlationId, actorUserId });
          if (upsGroupHistory && upsGroupHistory.rows.length > 0) await transaction.saveUpsGroupHistory({ siteId, sourceSheet: upsGroupHistory.sourceSheet, rows: upsGroupHistory.rows, correlationId, actorUserId });
          for (const image of imageUploads) await transaction.saveRackUnitImage(image.input);
        }
        if (options.restoreSource) await transaction.restoreWorkbookSourceCurrent(siteId, options.restoreSource.id);
        else await transaction.saveWorkbookSource({ siteId, sourceFileName: normalizedName, sourceFileHash: hash, objectKey, contentType, byteSize: buffer.length, actorUserId, correlationId });
      });
    } catch (error) {
      if (!options.restoreSource) await this.objectStorage.delete(objectKey).catch(() => undefined);
      // A restore reuses the immutable source/image keys of a previously
      // retained workbook. Those objects may already be referenced by the
      // current projection, so never delete them as transaction cleanup. A
      // failed restore can leave an orphan only when the object did not exist
      // before; that is safer than deleting a valid object used by another
      // retained version.
      if (!options.restoreSource) {
        for (const image of imageUploads) await this.imageStorage?.delete(image.input.objectKey).catch(() => undefined);
      }
      throw error;
    }
    return {
      siteId,
      sourceFileName: normalizedName,
      sourceFileHash: hash,
      importedMonths,
      validation: parsed.validation,
      integrity: parsed.integrity,
      rackCapacitySnapshotMonth,
      rackUnitCapacityMonths,
      rackCapacityHistoryMonths: [...new Set(rackCapacityHistoryRows.map(row => row.snapshotMonth))].sort(),
      upsGroupHistoryMonths: [...new Set((upsGroupHistory?.rows ?? []).map(row => row.month))].sort(),
      rackUnitCapacityImageMonths: [...new Set(imageHistoryRows.map(row => row.reportingMonth))].sort(),
      idempotent: false
    };
  }
}
