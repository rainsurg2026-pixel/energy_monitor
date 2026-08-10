import { createHash } from "node:crypto";
import { HttpError } from "../errors";
import type { BackendRepository, WorkbookSourceRecord } from "../repositories/contracts";
import type { ObjectStorage } from "../storage/objectStorage";
import { ImportService, type WorkbookImportResult } from "./importService";

export interface WorkbookBackupSummary {
  id: number;
  sourceFileName: string;
  sourceFileHash: string;
  contentType: string;
  byteSize: number;
  importedAt: string;
  actorUserId: number | null;
  isCurrent: boolean;
}

export class WorkbookBackupService {
  constructor(private readonly repository: BackendRepository, private readonly objectStorage: ObjectStorage | undefined, private readonly importService: ImportService) {}

  async list(siteId: number): Promise<WorkbookBackupSummary[]> {
    const records = await this.repository.listWorkbookSources(siteId);
    const current = await this.repository.getWorkbookSource(siteId);
    return records.map(record => this.summary(record, current?.id === record.id));
  }

  async restore(siteId: number, sourceId: number, actorUserId: number, correlationId: string): Promise<WorkbookImportResult> {
    if (!this.objectStorage) throw new HttpError(503, "WORKBOOK_RETENTION_UNAVAILABLE", "Workbook backup storage is not configured.");
    const record = (await this.repository.listWorkbookSources(siteId)).find(item => item.id === sourceId);
    if (!record) throw new HttpError(404, "WORKBOOK_BACKUP_NOT_FOUND", "The workbook backup was not found.");
    const buffer = await this.objectStorage.get(record.objectKey);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== record.sourceFileHash) throw new HttpError(503, "WORKBOOK_BACKUP_CORRUPT", "The retained workbook backup failed its SHA-256 integrity check.");
    return this.importService.importWorkbook(siteId, record.sourceFileName, buffer, correlationId, actorUserId, { restoreSource: record });
  }

  private summary(record: WorkbookSourceRecord, isCurrent: boolean): WorkbookBackupSummary {
    return { id: record.id, sourceFileName: record.sourceFileName, sourceFileHash: record.sourceFileHash, contentType: record.contentType, byteSize: record.byteSize, importedAt: record.importedAt, actorUserId: record.actorUserId, isCurrent };
  }
}
