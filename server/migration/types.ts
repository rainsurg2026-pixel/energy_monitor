import type { ComputedMonthMetrics } from "../../src/domain/analytics";
import type { EnergyCostCalculation } from "../../src/domain/energyCost";
import type { MonthlyLog } from "../../src/types";
import type { ExcelIntegrityReport, WorkbookValidation } from "../../src/excel/WorkbookReader";
import type { DashboardUpsMappingReport, RackRecord, UpsGroupHistoryRow } from "../../src/reports/reportTypes";
import type { RackUnitCapacityRow } from "../../src/excel/RackUnitCapacityWriter";
import type { RackCapacityHistoryRow } from "../../src/excel/RackCapacityHistoryWriter";

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

export interface MigrationImageSource {
  siteCode: string;
  reportingMonth: string;
  sourcePath: string;
  bytes: Buffer;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
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
  /** Persisted Desktop Rack Capacity History rows, if the workbook contains them. */
  rackCapacityHistoryRows: RackCapacityHistoryRow[];
  /** Persisted one-row-per-month Rack Unit history from the source workbook. */
  rackUnitCapacityRows: RackUnitCapacityRow[];
  /** Persisted Desktop `2. UPS Group History` rows from the source workbook. */
  upsGroupHistoryRows: UpsGroupHistoryRow[];
  /** External Desktop filesystem images; workbooks do not embed these bytes. */
  rackUnitCapacityImages?: MigrationImageSource[];
  /** Dashboard-FAC summary/detail topology read from the source workbook. */
  dashboardMapping?: DashboardUpsMappingReport | null;
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
  rackCapacityHistoryRowCount: number;
  rackUnitCapacityImageCount: number;
  upsGroupHistoryRowCount: number;
  dashboardMappingRowCount: number;
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
