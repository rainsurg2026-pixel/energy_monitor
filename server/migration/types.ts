import type { ComputedMonthMetrics } from "../../src/domain/analytics";
import type { EnergyCostCalculation } from "../../src/domain/energyCost";
import type { MonthlyLog } from "../../src/types";
import type { ExcelIntegrityReport, WorkbookValidation } from "../../src/excel/WorkbookReader";

export interface MigrationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  sourceLocation?: string;
  field?: string;
}

export interface CachedEvidenceRecord {
  month: string;
  fieldName: string;
  numericValue: number | null;
  textValue: string | null;
  sourceSheet: string;
  sourceLocation: string;
  formulaVersion: string;
  authoritativeInput: boolean;
}

export interface MigrationSource {
  sourceType: "desktop_workbook";
  sourcePath: string;
  sourceFileName: string;
  sourceFileHash: string;
  readAt: string;
  logs: MonthlyLog[];
  validation: WorkbookValidation;
  integrity: ExcelIntegrityReport;
  cachedEvidence: CachedEvidenceRecord[];
  sourceLocationsByMonth: Record<string, string[]>;
}

export interface MigrationSiteMapping {
  siteCode: string;
  expectedSiteName?: string;
  expectedProfileCode?: string;
}

export interface MigrationCalculation {
  month: string;
  energy: EnergyCostCalculation;
  metrics: ComputedMonthMetrics;
}

export interface MigrationPlan {
  source: MigrationSource;
  mapping: MigrationSiteMapping;
  idempotencyKey: string;
  rowCount: number;
  calculations: MigrationCalculation[];
  issues: MigrationIssue[];
}

export interface MigrationPreview {
  sourceFileName: string;
  sourceFileHash: string;
  siteCode: string;
  idempotencyKey: string;
  months: string[];
  rowCount: number;
  cachedEvidenceCount: number;
  calculatedMonthCount: number;
  errors: MigrationIssue[];
  warnings: MigrationIssue[];
  canImport: boolean;
}

export interface MigrationImportResult {
  status: "imported" | "skipped";
  batchId: number;
  verified: boolean;
  importedMonths: string[];
  cachedEvidenceCount: number;
}
