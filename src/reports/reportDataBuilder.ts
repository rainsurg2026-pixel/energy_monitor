import path from "path";
import { promises as fs } from "fs";
import type { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { normalizeMonthCell } from "../excel/ExcelSchema";
import { readWorkbookFromBuffer } from "../excel/WorkbookReader";
import { buildEngineeringDashboardSnapshot } from "../utils/engineeringDashboard";
import type { DashboardUpsTopology } from "../utils/engineeringDashboard";
import type { DeviceLists } from "../excel/SheetMapper";
import { readUpsMappingFromBuffer } from "./upsMappingReader";
import type { ReportData, ReportMonthlyRow, ReportStatus } from "./reportTypes";

export interface BuildReportOptions {
  workbookPath: string;
  facility: string;
  selectedMonth: string | null;
  appVersion: string;
  dashboard?: DashboardUpsTopology;
  devices?: DeviceLists;
}

function rowStatus(row: ReportMonthlyRow): "Complete" | "Partial" {
  return [row.buildingEnergyKwh, row.buildingCostThb, row.floorEnergyKwh, row.floorCostThb, row.averageRateThbPerKwh, row.floorSharePercent, row.upsEnergyKwh, row.airEnergyKwh, row.dcEnergyKwh].every(value => value !== null) ? "Complete" : "Partial";
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

function resolveStatus(rows: ReportMonthlyRow[], validationWarnings: string[]): ReportStatus {
  if (validationWarnings.length > 0) return "Validation warning";
  return rows.some(row => row.status === "Partial") ? "Partial" : "Complete";
}

export async function buildReportData(options: BuildReportOptions): Promise<ReportData> {
  const buffer = await fs.readFile(options.workbookPath);
  const read = await readWorkbookFromBuffer(buffer, options.devices);
  if (!read.validation.ok) throw new Error(`Workbook validation failed: ${read.validation.errors.join("; ")}`);

  const logs = [...read.logs].sort((a, b) => a.month.localeCompare(b.month));
  const validationWarnings = [
    ...read.validation.warnings,
    ...read.integrity.duplicateKeys.map(item => `Duplicate ${item.tab} record for ${item.month}.`),
    ...read.integrity.missingMonths.map(item => `Missing ${item.tab} month ${item.month}.`),
    ...read.integrity.missingDevices.map(item => `Missing ${item.tab} device ${item.deviceId} for ${item.month}.`),
    ...read.integrity.invalidIds.map(item => `Invalid ${item.tab} device ID ${item.rawId} at row ${item.rowNumber}.`)
  ];
  const allMonthlyRows = logs.map(log => createMonthlyRow(logs, log));
  const selectedMonth = normalizeMonthCell(options.selectedMonth);
  const currentRow = (selectedMonth ? allMonthlyRows.find(row => row.month === selectedMonth) : null) ?? allMonthlyRows.at(-1) ?? null;
  if (selectedMonth && !allMonthlyRows.some(row => row.month === selectedMonth)) validationWarnings.push(`Selected reporting month ${selectedMonth} is not present; latest available month was used.`);
  const monthlyRows = currentRow ? allMonthlyRows.filter(row => row.month <= currentRow.month).slice(-12) : [];
  const upsMapping = await readUpsMappingFromBuffer(buffer);
  const engineeringDashboard = currentRow ? buildEngineeringDashboardSnapshot(logs, currentRow.month, upsMapping, options.dashboard) : null;

  return {
    title: "Monthly Power & Energy Report",
    thaiSubtitle: "รายงานสรุปพลังงานและค่าไฟฟ้า",
    facility: options.facility,
    sourceWorkbook: path.basename(options.workbookPath),
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    reportingMonth: currentRow?.month ?? null,
    historicalStart: monthlyRows[0]?.month ?? null,
    historicalEnd: monthlyRows.at(-1)?.month ?? null,
    status: resolveStatus(monthlyRows, validationWarnings),
    validationWarnings,
    monthlyRows,
    currentRow,
    engineeringDashboard,
    rack: null
  };
}
