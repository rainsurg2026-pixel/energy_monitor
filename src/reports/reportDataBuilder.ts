import path from "path";
import { promises as fs } from "fs";
import type { MonthlyLog } from "../types";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { generateForecast } from "../utils/analytics";
import { normalizeMonthCell } from "../excel/ExcelSchema";
import { readWorkbookFromBuffer } from "../excel/WorkbookReader";
import type { DeviceLists } from "../excel/SheetMapper";
import type { RackCapacityReport } from "./reportTypes";
import { readRackCapacityFromBuffer } from "./rackCapacityReader";
import type {
  ReportBenchmark,
  ReportData,
  ReportForecast,
  ReportMonthlyRow,
  ReportSectionStatus,
  ReportStatus
} from "./reportTypes";

export interface BuildReportOptions {
  workbookPath: string;
  facility: string;
  selectedMonth: string | null;
  appVersion: string;
  devices?: DeviceLists;
}

function displayMonth(month: string | null): string {
  if (!month) return "—";
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function rowStatus(row: ReportMonthlyRow): "Complete" | "Partial" {
  return [
    row.buildingEnergyKwh,
    row.buildingCostThb,
    row.floorEnergyKwh,
    row.floorCostThb,
    row.averageRateThbPerKwh,
    row.floorSharePercent,
    row.upsEnergyKwh,
    row.airEnergyKwh,
    row.dcEnergyKwh
  ].every(value => value !== null)
    ? "Complete"
    : "Partial";
}

function createMonthlyRow(logs: MonthlyLog[], log: MonthlyLog): ReportMonthlyRow {
  const calculation = calculateEnergyCostForMonth(logs, log.month);
  const row: ReportMonthlyRow = {
    month: log.month,
    buildingEnergyKwh: calculation.buildingEnergyKwh,
    buildingCostThb: calculation.buildingElectricityCostThb,
    floorEnergyKwh: calculation.floorEnergyKwh,
    floorCostThb: calculation.floorElectricityCostThb,
    averageRateThbPerKwh: calculation.averageElectricityRateThbPerKwh,
    floorSharePercent: calculation.energySharePercent,
    upsEnergyKwh: calculation.upsEnergyKwh,
    airEnergyKwh: calculation.airEnergyKwh,
    dcEnergyKwh: calculation.dcEnergyKwh,
    status: "Partial"
  };
  row.status = rowStatus(row);
  return row;
}

function buildForecast(rows: ReportMonthlyRow[], metric: "Building Energy" | "Building Cost", steps = 3): ReportForecast | null {
  const values = rows
    .map(row => ({ monthStr: row.month, value: metric === "Building Energy" ? row.buildingEnergyKwh : row.buildingCostThb }))
    .filter((point): point is { monthStr: string; value: number } => point.value !== null);
  if (values.length < 2) return null;
  const result = generateForecast(values, steps);
  return {
    metric,
    unit: metric === "Building Energy" ? "kWh" : "THB",
    lastActualMonth: values[values.length - 1].monthStr,
    horizonMonths: steps,
    points: result.forecast
  };
}

function buildBenchmark(rows: ReportMonthlyRow[]): ReportBenchmark[] {
  const result: ReportBenchmark[] = [];
  for (const metric of ["Building Energy", "Building Cost"] as const) {
    const points = rows
      .map(row => ({ row, value: metric === "Building Energy" ? row.buildingEnergyKwh : row.buildingCostThb }))
      .filter((point): point is { row: ReportMonthlyRow; value: number } => point.value !== null);
    if (points.length < 2) continue;
    const currentPoint = points[points.length - 1];
    const current = currentPoint.value;
    const prior = points.slice(0, -1).map(point => point.value);
    const baseline = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    result.push({
      metric,
      unit: metric === "Building Energy" ? "kWh" : "THB",
      period: currentPoint.row.month,
      current,
      baseline,
      baselineLabel: `Historical average before ${displayMonth(currentPoint.row.month)}`
    });
  }
  return result;
}

function buildInsights(rows: ReportMonthlyRow[], rack: RackCapacityReport | null): string[] {
  const insights: string[] = [];
  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  if (!latest) return insights;
  if (latest.status === "Partial") {
    insights.push(`${displayMonth(latest.month)} has incomplete Energy & Cost or subsystem inputs; unavailable values remain shown as —.`);
  }
  if (latest.airEnergyKwh === null) {
    insights.push(`${displayMonth(latest.month)} Air energy is unavailable because the required previous calendar-month reading is missing.`);
  }
  if (previous && latest.buildingCostThb !== null && previous.buildingCostThb !== null && previous.buildingCostThb !== 0) {
    const growth = ((latest.buildingCostThb - previous.buildingCostThb) / Math.abs(previous.buildingCostThb)) * 100;
    if (growth > 10) insights.push(`Building electricity cost increased ${formatNumber2(growth)}% from ${displayMonth(previous.month)} to ${displayMonth(latest.month)}.`);
  }
  if (rack && rack.validation.duplicateIds.length > 0) {
    insights.push(`Rack validation found ${rack.validation.duplicateIds.length} duplicate Rack ID(s).`);
  }
  if (rack && rack.validation.missingRequiredFields.length > 0) {
    insights.push(`Rack validation found ${rack.validation.missingRequiredFields.length} missing required field(s).`);
  }
  if (insights.length === 0) insights.push(`No Energy, Cost, subsystem, or Rack validation warnings were detected for ${displayMonth(latest.month)}.`);
  return insights;
}

function section(id: string, title: string, included: boolean, reason?: string): ReportSectionStatus {
  return { id, title, included, ...(reason ? { reason } : {}) };
}

function resolveStatus(rows: ReportMonthlyRow[], validationWarnings: string[]): ReportStatus {
  if (validationWarnings.length > 0) return "Validation warning";
  return rows.some(row => row.status === "Partial") ? "Partial" : "Complete";
}

export async function buildReportData(options: BuildReportOptions): Promise<ReportData> {
  const buffer = await fs.readFile(options.workbookPath);
  const read = await readWorkbookFromBuffer(buffer, options.devices);
  if (!read.validation.ok) throw new Error(`Workbook validation failed: ${read.validation.errors.join("; ")}`);

  const logs = [...read.logs].sort((a, b) => a.month.localeCompare(b.month));
  const validationWarnings: string[] = [
    ...read.validation.warnings,
    ...read.integrity.duplicateKeys.map(item => `Duplicate ${item.tab} record for ${item.month}.`),
    ...read.integrity.missingMonths.map(item => `Missing ${item.tab} month ${item.month}.`),
    ...read.integrity.missingDevices.map(item => `Missing ${item.tab} device ${item.deviceId} for ${item.month}.`),
    ...read.integrity.invalidIds.map(item => `Invalid ${item.tab} device ID ${item.rawId} at row ${item.rowNumber}.`)
  ];

  let rack: RackCapacityReport | null = null;
  try {
    rack = await readRackCapacityFromBuffer(buffer);
    if (!rack) validationWarnings.push("Rack Capacity source sheet is unavailable; Rack sections were omitted.");
  } catch (error) {
    validationWarnings.push(`Rack Capacity validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const monthlyRows = logs.map(log => createMonthlyRow(logs, log));
  const normalizedSelectedMonth = normalizeMonthCell(options.selectedMonth);
  const currentRow = (normalizedSelectedMonth ? monthlyRows.find(row => row.month === normalizedSelectedMonth) : null)
    ?? monthlyRows[monthlyRows.length - 1]
    ?? null;
  if (normalizedSelectedMonth && !monthlyRows.some(row => row.month === normalizedSelectedMonth)) {
    validationWarnings.push(`Selected reporting month ${normalizedSelectedMonth} is not present; latest available month was used.`);
  }

  const historicalStart = monthlyRows[0]?.month ?? null;
  const historicalEnd = monthlyRows[monthlyRows.length - 1]?.month ?? null;
  const sourceWorkbook = path.basename(options.workbookPath);
  const rackIncluded = rack !== null;
  const benchmarkIncluded = buildBenchmark(monthlyRows).length > 0;
  const energyForecast = buildForecast(monthlyRows, "Building Energy");
  const costForecast = buildForecast(monthlyRows, "Building Cost");
  const smartInsights = buildInsights(monthlyRows, rack);

  const sections: ReportSectionStatus[] = [
    section("executive", "Executive Summary", monthlyRows.length > 0, "No monthly records are available."),
    section("energy-cost-kpi", "Energy & Cost KPI Summary", currentRow !== null, "No selected or latest monthly record is available."),
    section("energy-trend", "Energy Consumption Trend", monthlyRows.length > 0, "No monthly Energy values are available."),
    section("cost-trend", "Electricity Cost Trend", monthlyRows.length > 0, "No monthly Cost values are available."),
    section("subsystem-summary", "UPS, Air, and DC Summary", monthlyRows.length > 0, "No subsystem records are available."),
    section("historical", "Historical Operations Summary", monthlyRows.length > 0, "No historical records are available."),
    section("monthly-table", "Monthly Energy & Cost Table", monthlyRows.length > 0, "No monthly records are available."),
    section("benchmark", "Benchmark Summary", benchmarkIncluded, "At least two valid Energy or Cost values are required."),
    section("forecast", "Forecast Summary", energyForecast !== null || costForecast !== null, "At least two valid historical values are required."),
    section("insights", "Smart Insights and Data-quality Warnings", smartInsights.length > 0),
    section("rack-summary", "Rack Capacity Summary", rackIncluded, "Rack Capacity source is unavailable or invalid."),
    section("rack-charts", "Rack Capacity Charts", rackIncluded, "Rack Capacity source is unavailable or invalid."),
    section("rack-pivot", "Rack Capacity Pivot Summary", rackIncluded, "Rack Capacity source is unavailable or invalid."),
    section("rack-validation", "Rack Validation Summary", rackIncluded, "Rack Capacity source is unavailable or invalid."),
    section("report-info", "Report Information and Data Source", true)
  ];

  return {
    title: "Monthly Power, Energy & Rack Capacity Report",
    thaiSubtitle: "รายงานสรุปพลังงาน ค่าไฟฟ้า และความจุตู้ Rack",
    facility: options.facility,
    sourceWorkbook,
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    reportingMonth: currentRow?.month ?? null,
    historicalStart,
    historicalEnd,
    status: resolveStatus(monthlyRows, validationWarnings),
    validationWarnings,
    monthlyRows,
    currentRow,
    energyForecast,
    costForecast,
    benchmarks: buildBenchmark(monthlyRows),
    insights: smartInsights,
    rack,
    sections
  };
}
