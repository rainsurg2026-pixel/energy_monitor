import type { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth } from "../domain/energyCost";

const numericFormat = "#,##0.00";

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ReportRackCapacitySnapshot {
  month: string;
  records: Array<{
    rowNumber: number | null;
    rackZone: string | null;
    rackId: string | null;
    status: string | null;
    cabinetSize: string | null;
    detail: string | null;
    deviceType: string | null;
    remarks: string | null;
  }>;
}

export interface ReportRackUnitCapacitySnapshot {
  month: string;
  totalU: number;
  usedU: number;
}

/**
 * Builds the Web report workbook as raw OOXML bytes. Keeping this function
 * free of browser-only Blob types lets the API use the exact same workbook
 * builder as the browser download path.
 */
export async function buildReportWorkbookBuffer(
  logs: readonly MonthlyLog[],
  facility: string,
  rackCapacitySnapshots: readonly ReportRackCapacitySnapshot[] = [],
  rackUnitCapacitySnapshots: readonly ReportRackUnitCapacitySnapshot[] = []
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Energy Monitor";
  workbook.created = new Date();
  const headerStyle = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 10 },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF17324D" } },
    alignment: { horizontal: "center" as const, vertical: "middle" as const, wrapText: true }
  };
  const applyHeader = (sheet: typeof workbook.worksheets[number]) => {
    sheet.getRow(1).eachCell(cell => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.alignment = headerStyle.alignment;
    });
    sheet.getRow(1).height = 34;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.eachCell({ includeEmpty: true }, cell => { cell.alignment = { vertical: "middle" }; });
    });
  };
  const ordered = [...logs].sort((a, b) => a.month.localeCompare(b.month));
  const summary = workbook.addWorksheet("Summary");
  summary.addRows([["Energy Monitor Report"], ["Facility", facility], ["Generated", new Date().toISOString()], ["Months", ordered.length], ["Range", ordered.length ? `${ordered[0].month} - ${ordered.at(-1)?.month}` : "-"]]);
  summary.mergeCells("A1:B1");
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  summary.getColumn(1).width = 34;
  summary.getColumn(2).width = 82;

  const ups = workbook.addWorksheet("UPS Loads");
  ups.addRow(["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"]);
  for (const log of ordered) for (const row of log.ups) ups.addRow([log.month, row.upsId, nullableNumber(row.voltage), nullableNumber(row.current), nullableNumber(row.loadKw), nullableNumber(row.loadKva)]);
  applyHeader(ups);
  ups.columns.forEach(column => { column.width = 17; });
  for (let row = 2; row <= ups.rowCount; row++) for (const column of [3, 4, 5, 6]) ups.getCell(row, column).numFmt = numericFormat;

  const airFields = ordered.some(log => Object.keys(log.air.meters ?? {}).length > 0)
    ? [...new Set(ordered.flatMap(log => Object.keys(log.air.meters ?? {})))].sort()
    : ["eb41a", "eb41b", "eb42a", "eb42b"];
  const air = workbook.addWorksheet("Air Conditioning");
  air.addRow(["Month", ...airFields.map(field => `${field.toUpperCase()} (GWh)`)]);
  for (const log of ordered) air.addRow([log.month, ...airFields.map(field => log.air.meters?.[field] ?? (log.air as unknown as Record<string, number | null | undefined>)[field] ?? null)]);
  applyHeader(air);
  air.columns.forEach(column => { column.width = 18; });
  for (let row = 2; row <= air.rowCount; row++) for (let column = 2; column <= air.columnCount; column++) air.getCell(row, column).numFmt = numericFormat;

  const dc = workbook.addWorksheet("DC Power Panels");
  dc.addRow(["Month", "DC Panel", "Voltage (V)", "Current (A)"]);
  for (const log of ordered) for (const row of log.dc) dc.addRow([log.month, row.panelId, nullableNumber(row.voltage), nullableNumber(row.current)]);
  applyHeader(dc);
  dc.columns.forEach(column => { column.width = 18; });
  for (let row = 2; row <= dc.rowCount; row++) for (const column of [3, 4]) dc.getCell(row, column).numFmt = numericFormat;

  const energy = workbook.addWorksheet("Energy & Cost");
  energy.addRow(["Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"]);
  for (const log of ordered) {
    const calculation = calculateEnergyCostForMonth(ordered, log.month);
    energy.addRow([log.month, calculation.buildingEnergyKwh, calculation.buildingElectricityCostThb, calculation.floorEnergyKwh, calculation.floorElectricityCostThb, calculation.averageElectricityRateThbPerKwh, calculation.energySharePercent]);
  }
  applyHeader(energy);
  energy.columns.forEach(column => { column.width = 23; });
  for (let row = 2; row <= energy.rowCount; row++) for (let column = 2; column <= energy.columnCount; column++) energy.getCell(row, column).numFmt = numericFormat;

  if (rackCapacitySnapshots.length > 0) {
    const rack = workbook.addWorksheet("Rack Capacity");
    rack.addRow(["Snapshot Month", "Row", "Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"]);
    for (const snapshot of [...rackCapacitySnapshots].sort((a, b) => a.month.localeCompare(b.month))) for (const record of snapshot.records) rack.addRow([snapshot.month, record.rowNumber, record.rackZone, record.rackId, record.status, record.cabinetSize, record.detail, record.deviceType, record.remarks]);
    applyHeader(rack);
    rack.columns.forEach(column => { column.width = 20; });
  }

  if (rackUnitCapacitySnapshots.length > 0) {
    const rackUnit = workbook.addWorksheet("Rack Unit Capacity");
    rackUnit.addRow(["Month", "Total (U)", "Used (U)", "Available (U)", "Availability Capacity (%)"]);
    for (const snapshot of [...rackUnitCapacitySnapshots].sort((a, b) => a.month.localeCompare(b.month))) rackUnit.addRow([snapshot.month, snapshot.totalU, snapshot.usedU, snapshot.totalU - snapshot.usedU, snapshot.totalU > 0 ? (snapshot.totalU - snapshot.usedU) / snapshot.totalU : null]);
    applyHeader(rackUnit);
    rackUnit.columns.forEach(column => { column.width = 23; });
    for (let row = 2; row <= rackUnit.rowCount; row++) {
      for (const column of [2, 3, 4, 5]) rackUnit.getCell(row, column).numFmt = numericFormat;
      rackUnit.getCell(row, 5).numFmt = "0.00%";
    }
  }

  const rawBuffer = await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer | Uint8Array;
  return rawBuffer instanceof Uint8Array ? new Uint8Array(rawBuffer) : new Uint8Array(rawBuffer);
}
