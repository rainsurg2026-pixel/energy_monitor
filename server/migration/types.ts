import type { ComputedMonthMetrics } from "../../src/domain/analytics";
import type { EnergyCostCalculation } from "../../src/domain/energyCost";
import type { MonthlyLog } from "../../src/types";
import type { ExcelIntegrityReport, WorkbookValidation } from "../../src/excel/WorkbookReader";
import type { RackRecord } from "../../src/reports/reportTypes";
import type { RackUnitCapacityRow } from "../../src/excel/RackUnitCapacityWriter";

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
  /** Current Table7 snapshot; the source workbook has no per-row historical rack detail. */
  rackCapacitySnapshot: { month: string; sourceSheet: string; records: RackRecord[] } | null;
  /** Persisted one-row-per-month Rack Unit history from the source workbook. */
  rackUnitCapacityRows: RackUnitCapacityRow[];
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
