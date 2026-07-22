/**
 * Reads the persisted "2. UPS Group History" worksheet (see
 * src/excel/UpsGroupHistoryWriter.ts) - the workbook's permanent, per-month,
 * per-UPS-Group summary history. Historical Operations Explorer reads this
 * directly instead of recomputing summaries at runtime.
 */
import ExcelJS from "exceljs";
import { UPS_GROUP_HISTORY_SHEET_NAME } from "../excel/UpsGroupHistoryWriter";
import type { UpsGroupHistoryReport, UpsGroupHistoryRow } from "./reportTypes";

function cellNumber(cell: ExcelJS.Cell): number | null {
  const raw = cell.value;
  const value = raw !== null && typeof raw === "object" && "result" in (raw as object) ? (raw as { result: unknown }).result : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cellText(cell: ExcelJS.Cell): string {
  const raw = cell.value;
  const value = raw !== null && typeof raw === "object" && "result" in (raw as object) ? (raw as { result: unknown }).result : raw;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in (value as object)) {
    return (value as { richText: Array<{ text: string }> }).richText.map(t => t.text).join("").trim();
  }
  return String(value).trim();
}

export async function readUpsGroupHistoryFromBuffer(buffer: Buffer): Promise<UpsGroupHistoryReport | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(UPS_GROUP_HISTORY_SHEET_NAME);
  if (!sheet) return null;

  const rows: UpsGroupHistoryRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const facility = cellText(row.getCell(1));
    const month = cellText(row.getCell(2));
    const group = cellText(row.getCell(3));
    if (!month || !group) continue;
    rows.push({
      facility,
      month,
      group,
      totalLoadKw: cellNumber(row.getCell(4)) ?? 0,
      totalLoadKva: cellNumber(row.getCell(5)) ?? 0,
      capacity: cellNumber(row.getCell(6)),
      loadPercent: cellNumber(row.getCell(7)),
      availablePercent: cellNumber(row.getCell(8)),
      monthlyEnergyKwh: cellNumber(row.getCell(9)) ?? 0,
      generatedAt: cellText(row.getCell(10)) || null,
      dataVersion: cellNumber(row.getCell(11))
    });
  }

  return { sourceSheet: UPS_GROUP_HISTORY_SHEET_NAME, rows };
}
