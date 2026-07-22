import type { ForecastPoint } from "../utils/analytics";

export type ReportStatus = "Complete" | "Partial" | "Validation warning";

/** One persisted row from the "2. UPS Group History" worksheet. */
export interface UpsGroupHistoryRow {
  facility: string;
  month: string;
  group: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
  generatedAt: string | null;
  dataVersion: number | null;
}

export interface UpsGroupHistoryReport {
  sourceSheet: string;
  rows: UpsGroupHistoryRow[];
}

export interface ReportMonthlyRow {
  month: string;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
  upsEnergyKwh: number | null;
  airEnergyKwh: number | null;
  dcEnergyKwh: number | null;
  status: "Complete" | "Partial";
}

export interface RackRecord {
  rowNumber: number;
  rackZone: string | null;
  rackId: string | null;
  status: string | null;
  cabinetSize: string | null;
  detail: string | null;
  deviceType: string | null;
  remarks: string | null;
}

export interface RackValidationSummary {
  duplicateIds: string[];
  missingRequiredFields: Array<{ rowNumber: number; field: string }>;
  invalidStatuses: Array<{ rowNumber: number; status: string }>;
  invalidDataTypes: Array<{ rowNumber: number; field: string; type: string }>;
  unsupportedUMetrics: string[];
}

export interface RackCapacityReport {
  sourceSheet: string;
  sourceTable: string;
  sourceSnapshot: string | null;
  records: RackRecord[];
  byZone: Array<{ zone: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byCabinetSize: Array<{ cabinetSize: string; count: number }>;
  byDeviceType: Array<{ deviceType: string; count: number }>;
  validation: RackValidationSummary;
}

/** UPS Summary row - Dashboard-FAC's group-level table (e.g. "UPS 11",
 *  "PPC 41"), read directly from the workbook, not recalculated. */
export interface DashboardUpsSummaryRow {
  no: number;
  name: string;
  totalLoadKw: number | null;
  totalLoadKva: number | null;
  capacity: number | null;
  /** Derived: totalLoadKva / capacity * 100. Null when capacity is unknown. */
  loadPercent: number | null;
}

/** UPS Mapping row - Dashboard-FAC's detailed UMDB/STS/OUDB hardware
 *  mapping table, read directly from the workbook. `acPowerPanel` is "—"
 *  for facilities whose Dashboard-FAC layout has no such column. */
export interface DashboardUpsMappingRow {
  no: number;
  umdb: string;
  upsId: string;
  acPowerPanel: string;
  sts: string;
  oudb: string;
  voltage: number | null;
  current: number | null;
  loadKw: number | null;
  loadKva: number | null;
  capacity: number | null;
  /** Derived: loadKva / capacity * 100. Null when capacity is unknown. */
  loadPercent: number | null;
}

export interface DashboardUpsMappingReport {
  sourceSheet: string;
  summary: DashboardUpsSummaryRow[];
  mapping: DashboardUpsMappingRow[];
}

/** Lightweight read-only summary used by the dashboard card. */
export interface RackCapacitySummary {
  totalRacks: number;
  records: RackRecord[];
  byStatus: Array<{ status: string; count: number }>;
  byZone: Array<{ zone: string; count: number }>;
}

export interface ReportBenchmark {
  metric: "Building Energy" | "Building Cost";
  unit: "kWh" | "THB";
  period: string;
  current: number;
  baseline: number;
  baselineLabel: string;
}

export interface ReportForecast {
  metric: "Building Energy" | "Building Cost";
  unit: "kWh" | "THB";
  lastActualMonth: string;
  horizonMonths: number;
  points: ForecastPoint[];
}

export interface ReportSectionStatus {
  id: string;
  title: string;
  included: boolean;
  reason?: string;
}

export interface ReportData {
  title: string;
  thaiSubtitle: string;
  facility: string;
  sourceWorkbook: string;
  generatedAt: string;
  appVersion: string;
  reportingMonth: string | null;
  historicalStart: string | null;
  historicalEnd: string | null;
  status: ReportStatus;
  validationWarnings: string[];
  monthlyRows: ReportMonthlyRow[];
  currentRow: ReportMonthlyRow | null;
  energyForecast: ReportForecast | null;
  costForecast: ReportForecast | null;
  benchmarks: ReportBenchmark[];
  insights: string[];
  rack: RackCapacityReport | null;
  sections: ReportSectionStatus[];
}
