import type { MonthlyLog } from "../types";
import { buildCombinedCsv, buildSectionCsvs } from "../utils/exportData";
import { calculateEnergyCostForMonth } from "../domain/energyCost";
import { buildEngineeringDashboardSnapshot } from "../domain/engineeringDashboard";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { ReportData, ReportMonthlyRow } from "../reports/reportTypes";

function download(content: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(logs: MonthlyLog[], siteName: string): void {
  download(buildCombinedCsv(logs), `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.csv`, "text/csv;charset=utf-8");
}

export async function exportExcel(logs: MonthlyLog[], siteName: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const section of buildSectionCsvs(logs)) {
    const sheet = workbook.addWorksheet(section.name.replace(".csv", "").slice(0, 31));
    for (const row of section.content.split("\n")) sheet.addRow(row.split(","));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    sheet.columns.forEach(column => { column.width = 22; });
  }
  const data = await workbook.xlsx.writeBuffer();
  download(data, `${siteName.replace(/[^a-z0-9]+/giu, "-")}-energy-monitor.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function reportRows(logs: MonthlyLog[]): ReportMonthlyRow[] {
  return [...logs].sort((left, right) => left.month.localeCompare(right.month)).map(log => {
    const calculation = calculateEnergyCostForMonth(logs, log.month);
    return {
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
      status: calculation.floorEnergyKwh === null ? "Partial" : "Complete"
    };
  });
}

/** Desktop's print HTML, populated only with the selected facility's API DTOs. */
export function printDesktopPdf(logs: MonthlyLog[], siteName: string, selectedMonth: string): void {
  const rows = reportRows(logs);
  const current = rows.find(row => row.month === selectedMonth) ?? null;
  const data: ReportData = {
    title: "Energy Monitor Report",
    thaiSubtitle: "รายงานการใช้พลังงานและระบบวิศวกรรม",
    facility: siteName,
    sourceWorkbook: "Supabase PostgreSQL",
    generatedAt: new Date().toISOString(),
    appVersion: "2.3.1 Web Clean v1",
    reportingMonth: selectedMonth,
    historicalStart: rows[0]?.month ?? null,
    historicalEnd: rows.at(-1)?.month ?? null,
    status: current?.status === "Complete" ? "Complete" : "Partial",
    validationWarnings: current?.status === "Partial" ? ["The selected month has incomplete source readings."] : [],
    monthlyRows: rows,
    currentRow: current,
    engineeringDashboard: buildEngineeringDashboardSnapshot(logs, selectedMonth, null),
    rack: null,
    rackHistory: [],
    rackUnitCapacity: [],
    rackUnitCapacityImageDataUri: null,
    rackUnitCapacityImageMeta: null,
    comparison: null,
    rackComparison: null
  };
  const popup = window.open("", "energy-monitor-report", "noopener,noreferrer");
  if (!popup) throw new Error("The report window was blocked by the browser.");
  popup.document.open();
  popup.document.write(buildReportHtml(data));
  popup.document.close();
  popup.addEventListener("load", () => popup.print(), { once: true });
}
