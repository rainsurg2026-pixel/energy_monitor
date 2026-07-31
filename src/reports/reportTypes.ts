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

/** Selected-month values rendered by both the live Engineering Dashboard and
 * the printable All Report.  The dashboard calculation helper owns these
 * derived values so the two surfaces cannot drift. */
export interface EngineeringDashboardSnapshot {
  daysInMonth: number;
  previousMonth: string | null;
  upsGroups: Array<{ name: string; totalKw: number; totalKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }>;
  /** Srinakarin's existing UPS11/12/13 overall view; empty for Rangsit. */
  upsOverallGroups: Array<{ name: string; totalKw: number; totalKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }>;
  upsDetails: Array<{ no: number; umdb: string; upsId: string; acPowerPanel: string; sts: string; oudb: string; voltage: number; current: number; loadKw: number; loadKva: number; capacity: number | null; loadPercent: number | null }>;
  totalUpsKw: number;
  totalUpsKva: number;
  totalUpsEnergyKwh: number;
  detailedVoltageAvg: number | null;
  detailedCurrentSum: number;
  airFields: string[];
  airPrevious: Record<string, number | null>;
  airCurrent: Record<string, number | null>;
  airDifference: Record<string, number | null>;
  airEnergyKwh: number | null;
  dcPanels: Array<{ panelId: string; voltage: number; current: number; dcPowerW: number; acCurrentA: number; acPowerW: number; monthlyEnergyKwh: number }>;
  totalDcPowerW: number;
  totalDcAcCurrentA: number;
  totalDcAcPowerW: number;
  totalDcEnergyKwh: number;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
}

/** Lightweight read-only summary used by the dashboard card. */
export interface RackCapacitySummary {
  totalRacks: number;
  records: RackRecord[];
  byStatus: Array<{ status: string; count: number }>;
  byZone: Array<{ zone: string; count: number }>;
}

/** One other facility's latest-comparable-month KPIs, for the Export All
 *  Report's Site Comparison page. Best-effort: null when the sibling
 *  workbook cannot be read (never blocks the primary report). */
export interface ReportComparisonFacility {
  label: string;
  month: string | null;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
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
  engineeringDashboard: EngineeringDashboardSnapshot | null;
  rack: RackCapacityReport | null;
  /** Persisted Rack Capacity History rows (facility total + per-zone), if any. */
  rackHistory: import("../excel/RackCapacityHistoryWriter").RackCapacityHistoryRow[];
  /** This facility's own current-row KPIs plus the sibling facility's, for
   *  the Site Comparison PDF page. Null when comparison data is unavailable. */
  comparison: { self: ReportComparisonFacility; other: ReportComparisonFacility | null } | null;
}
