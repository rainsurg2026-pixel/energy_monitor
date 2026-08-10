import { createHash } from "node:crypto";
import JSZip from "jszip";
import { readWorkbookFromBuffer, type ExcelIntegrityReport, type WorkbookValidation } from "../../src/excel/WorkbookReader";
import { DEFAULT_DEVICE_LISTS } from "../../src/excel/SheetMapper";

export interface WorkbookPackageEvidence {
  hasVbaProject: boolean;
  pivotCacheCount: number;
  chartCount: number;
  drawingCount: number;
  imageCount: number;
}

export interface WorkbookIntegrityReport {
  scope: "desktop-workbook-package";
  sourceFileName: string;
  sourceFileHash: string;
  validatedAt: string;
  structureOk: boolean;
  validation: WorkbookValidation;
  integrity: ExcelIntegrityReport;
  package: WorkbookPackageEvidence;
}

const emptyIntegrity = (): ExcelIntegrityReport => ({ duplicateKeys: [], missingMonths: [], missingDevices: [], unexpectedBlankRows: [], invalidIds: [] });

export class WorkbookIntegrityService {
  async inspect(sourceFileName: string, buffer: Buffer): Promise<WorkbookIntegrityReport> {
    const sourceFileHash = createHash("sha256").update(buffer).digest("hex");
    const validatedAt = new Date().toISOString();
    const packageEvidence: WorkbookPackageEvidence = { hasVbaProject: false, pivotCacheCount: 0, chartCount: 0, drawingCount: 0, imageCount: 0 };
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
      const names = Object.keys(zip.files);
      packageEvidence.hasVbaProject = names.includes("xl/vbaProject.bin");
      packageEvidence.pivotCacheCount = names.filter(name => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)).length;
      packageEvidence.chartCount = names.filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name)).length;
      packageEvidence.drawingCount = names.filter(name => /^xl\/drawings\/drawing\d+\.xml$/.test(name)).length;
      packageEvidence.imageCount = names.filter(name => /^xl\/media\//.test(name)).length;
    } catch {
      return {
        scope: "desktop-workbook-package",
        sourceFileName,
        sourceFileHash,
        validatedAt,
        structureOk: false,
        validation: { ok: false, errors: ["The upload is not a readable OOXML workbook package."], warnings: [], sheetNames: {} },
        integrity: emptyIntegrity(),
        package: packageEvidence
      };
    }
    try {
      const parsed = await readWorkbookFromBuffer(buffer, DEFAULT_DEVICE_LISTS);
      return { scope: "desktop-workbook-package", sourceFileName, sourceFileHash, validatedAt, structureOk: parsed.validation.ok, validation: parsed.validation, integrity: parsed.integrity, package: packageEvidence };
    } catch {
      return {
        scope: "desktop-workbook-package",
        sourceFileName,
        sourceFileHash,
        validatedAt,
        structureOk: false,
        validation: { ok: false, errors: ["The workbook package could not be parsed by the Desktop v2.3.1 reader."], warnings: [], sheetNames: {} },
        integrity: emptyIntegrity(),
        package: packageEvidence
      };
    }
  }
}
