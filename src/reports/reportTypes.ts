export type ReportStatus = "Complete" | "Partial" | "Validation warning";

/** Product wording shared by the Rack Unit views and every CSV/XLSX/HTML/PDF
 *  Rack Unit export. Must stay identical to the English string rendered by
 *  `WebRackCapacityViews`/`WebSiteRackCapacityComparison`. */
export const RACK_UNIT_CAPACITY_TREND_NOTE = "Rack Unit Capacity Trend Note: Available U represents physical rack space only; actual deployment capacity depends on power, cooling, weight, and contiguous space availability.";

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
export interface ComparisonMetric {
  buildingEnergy: number | null;
  buildingCost: number | null;
  floorEnergy: number | null;
  floorCost: number | null;
  avgRate: number | null;
  floorShare: number | null;
}

export interface SiteComparisonReportSite {
  label: string;
  siteCode: string;
  metrics: ComparisonMetric | null;
  metricsByMonth: Record<string, ComparisonMetric | null>;
  rack: RackCapacityReport | null;
  rackUnit: Array<{ month: string; totalU: number; usedU: number; availableU: number; usagePercent: number | null; availabilityPct: number | null }>;
}

export interface SiteComparisonReportModel {
  referenceMonth: string;
  months: string[];
  sites: SiteComparisonReportSite[];
}

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
  upsDetails: Array<{ no: number; umdb: string; upsId: string; acPowerPanel: string; sts: string; oudb: string; voltage: number | null; current: number | null; loadKw: number | null; loadKva: number | null; capacity: number | null; loadPercent: number | null }>;
  totalUpsKw: number;
  totalUpsKva: number;
  totalUpsEnergyKwh: number;
  detailedVoltageAvg: number | null;
  detailedCurrentSum: number | null;
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

/** One facility's current (live, not month-keyed) Rack Capacity records,
 *  for the Export All Report's Rack Capacity Site Comparison page. Raw
 *  records, not pre-aggregated metrics - calculateRackCapacityMetrics (the
 *  single authoritative Rack Capacity calculation, same one the dashboard
 *  and the primary Rack Capacity PDF page use) is applied at render time,
 *  never re-derived here. */
export interface ReportRackComparisonFacility {
  label: string;
  records: RackRecord[];
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
  /** Web-defined trailing 12-month rows for the Current Facility PDF only. */
  executiveTrendRows?: ReportMonthlyRow[];
  currentRow: ReportMonthlyRow | null;
  engineeringDashboard: EngineeringDashboardSnapshot | null;
  rack: RackCapacityReport | null;
  /** Persisted Rack Capacity History rows (facility total + per-zone), if any. */
  rackHistory: import("../excel/RackCapacityHistoryWriter").RackCapacityHistoryRow[];
  /** Persisted Rack Unit Capacity rows (Month/Total(U)/Used(U)/Available(U)/
   *  Availability %), if any. */
  rackUnitCapacity: import("../excel/RackUnitCapacityWriter").RackUnitCapacityRow[];
  /** The "Rack Unit Capacity Image", as a ready-to-embed data URI, if one is
   *  present - read from the filesystem ImageStorageProvider, never
   *  embedded in the workbook. */
  rackUnitCapacityImageDataUri: string | null;
  /** Caption metadata for the image above (Reporting Month/Last Updated/
   *  Resolution/Captured By) - null exactly when the image itself is null. */
  rackUnitCapacityImageMeta: { savedAt: string; savedBy: string; width: number; height: number } | null;
  /** This facility's own current-row KPIs plus the sibling facility's, for
   *  the Site Comparison PDF page. Null when comparison data is unavailable.
   *  `selfTrend`/`otherTrend` are each facility's own multi-month history
   *  (up to 12 months, ending at the same reference month as `self.month`)
   *  for the "Monthly Energy Consumption Trend" / "Floor 4 Electricity Cost
   *  Trend" charts shown above the comparison table - `otherTrend` is empty
   *  when the sibling workbook is unavailable. */
  comparison: {
    self: ReportComparisonFacility;
    other: ReportComparisonFacility | null;
    selfTrend: ReportMonthlyRow[];
    otherTrend: ReportMonthlyRow[];
  } | null;
  /** This facility's own Rack Capacity records plus the sibling facility's,
   *  for the Rack Capacity Site Comparison PDF page. Null when this
   *  facility itself has no Rack Capacity data (mirrors rackCapacityPage's
   *  own unavailable-data gate). */
  rackComparison: { self: ReportRackComparisonFacility; other: ReportRackComparisonFacility | null } | null;
  /** Selected-month Rack Unit Capacity comparison plus each site's history for
   * the six-month trend. Optional for legacy report callers. */
  rackUnitComparison?: { sites: ReportRackUnitComparisonFacility[] } | null;
}

/** Rack Unit Capacity rows for one side of a site comparison. Keeping this
 * separate from comparison lets the shared report renderer consume the same
 * selected-month and trend data as the export builders. */
export interface ReportRackUnitComparisonFacility {
  label: string;
  rows: import("../excel/RackUnitCapacityWriter").RackUnitCapacityRow[];
}
