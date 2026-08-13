import ExcelJS from "exceljs";
import type { RackCapacityReport, RackRecord } from "./reportTypes";
import { deriveRackCapacityReport } from "./rackCapacityReportBuilder";

const REQUIRED_FIELDS = ["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"] as const;
const HEADER_ALIASES: Record<string, string[]> = {
  "Cabinet Size": ["cabinet size", "cabinet size (wxd cm)", "cabinet size (wxd)"],
};

function headerKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim();
  if (typeof value === "object" && "result" in value) {
    const result = value.result;
    return result === null || result === undefined || result === "" ? null : String(result).trim();
  }
  return null;
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): { rowNumber: number; columns: Map<string, number> } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const columns = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const text = cellText(cell.value);
      if (text) columns.set(headerKey(text), columnNumber);
    });
    const resolved = new Map<string, number>();
    for (const field of REQUIRED_FIELDS) {
      const column = [field.toLowerCase(), ...(HEADER_ALIASES[field] ?? []).map(alias => alias.toLowerCase())]
        .map(alias => columns.get(alias))
        .find((value): value is number => value !== undefined);
      if (column) resolved.set(field, column);
    }
    if (resolved.size === REQUIRED_FIELDS.length) return { rowNumber, columns: resolved };
  }
  return null;
}

function table7Range(worksheet: ExcelJS.Worksheet): { startRow: number; endRow: number; columns: Map<string, number> } | null {
  const table = worksheet.getTable("Table7") as (ExcelJS.Table & { table?: { tableRef?: string; columns?: Array<{ name?: string }> } }) | undefined;
  const model = table?.table;
  const match = model?.tableRef?.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/i);
  if (!match || !model?.columns) return null;
  const startRow = Number(match[1]);
  const endRow = Number(match[2]);
  const tableHeader = worksheet.getRow(startRow);
  const columns = new Map<string, number>();
  tableHeader.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const text = cellText(cell.value);
    if (text) columns.set(headerKey(text), columnNumber);
  });
  const resolved = new Map<string, number>();
  for (const field of REQUIRED_FIELDS) {
    const column = [field.toLowerCase(), ...(HEADER_ALIASES[field] ?? []).map(alias => alias.toLowerCase())]
      .map(alias => columns.get(alias)).find((value): value is number => value !== undefined);
    if (column) resolved.set(field, column);
  }
  return resolved.size === REQUIRED_FIELDS.length ? { startRow: startRow + 1, endRow, columns: resolved } : null;
}

export async function readRackCapacityFromBuffer(buffer: Buffer): Promise<RackCapacityReport | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.getWorksheet("Rack Capacity");
  if (!worksheet) return null;

  const header = table7Range(worksheet) ?? (() => {
    const fallback = findHeaderRow(worksheet);
    return fallback ? { ...fallback, startRow: fallback.rowNumber + 1, endRow: worksheet.rowCount } : null;
  })();
  if (!header) throw new Error('Rack Capacity sheet is missing the required Table7 headers.');

  const records: RackRecord[] = [];
  const invalidDataTypes: Array<{ rowNumber: number; field: string; type: string }> = [];

  for (let rowNumber = header.startRow; rowNumber <= header.endRow; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const sourceFields: Array<[string, number]> = Array.from(header.columns.entries());
    for (const [field, column] of sourceFields) {
      const raw = row.getCell(column).value;
      if (raw !== null && raw !== undefined && typeof raw === "object" && !(raw instanceof Date) && !("text" in raw) && !("result" in raw)) {
        invalidDataTypes.push({ rowNumber, field, type: typeof raw });
      }
    }
    const record: RackRecord = {
      rowNumber,
      rackZone: cellText(row.getCell(header.columns.get("Rack Zone")!).value),
      rackId: cellText(row.getCell(header.columns.get("Rack ID")!).value),
      status: cellText(row.getCell(header.columns.get("Status")!).value),
      cabinetSize: cellText(row.getCell(header.columns.get("Cabinet Size")!).value),
      detail: cellText(row.getCell(header.columns.get("Detail")!).value),
      deviceType: cellText(row.getCell(header.columns.get("Device Type")!).value),
      remarks: cellText(row.getCell(header.columns.get("Remarks")!).value)
    };

    // Rows outside Table7 contain charts/formatting and do not have a Rack ID.
    if (!record.rackId && !record.rackZone && !record.status) continue;
    records.push(record);
  }

  return deriveRackCapacityReport(records, "Rack Capacity", "Table7", null, invalidDataTypes);
}
