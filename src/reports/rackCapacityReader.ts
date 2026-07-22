import ExcelJS from "exceljs";
import type { RackCapacityReport, RackRecord } from "./reportTypes";

const REQUIRED_FIELDS = ["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"] as const;
const HEADER_ALIASES: Record<string, string[]> = {
  "Cabinet Size": ["cabinet size", "cabinet size (wxd cm)", "cabinet size (wxd)"],
};
const VALID_STATUSES = new Set(["In Use", "Available", "Reserved", "Pending Dismantle"]);

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

function increment(map: Map<string, number>, value: string | null): void {
  const key = value && value.trim() !== "" ? value.trim() : "(blank)";
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): Array<{ [key: string]: string | number }> {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, count }));
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
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  const missingRequiredFields: Array<{ rowNumber: number; field: string }> = [];
  const invalidStatuses: Array<{ rowNumber: number; status: string }> = [];
  const invalidDataTypes: Array<{ rowNumber: number; field: string; type: string }> = [];
  const byZone = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byCabinetSize = new Map<string, number>();
  const byDeviceType = new Map<string, number>();

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

    for (const field of REQUIRED_FIELDS) {
      const value = record[field === "Rack Zone" ? "rackZone" : field === "Rack ID" ? "rackId" : field === "Status" ? "status" : field === "Cabinet Size" ? "cabinetSize" : field === "Detail" ? "detail" : field === "Device Type" ? "deviceType" : "remarks"];
      if (value === null) missingRequiredFields.push({ rowNumber, field });
    }
    if (record.rackId) {
      const normalizedId = record.rackId.toLowerCase();
      if (seenIds.has(normalizedId)) duplicateIds.add(record.rackId);
      seenIds.add(normalizedId);
    }
    if (record.status && !VALID_STATUSES.has(record.status)) invalidStatuses.push({ rowNumber, status: record.status });
    increment(byZone, record.rackZone);
    increment(byStatus, record.status);
    increment(byCabinetSize, record.cabinetSize);
    increment(byDeviceType, record.deviceType);
  }

  const toNamedCounts = (map: Map<string, number>, key: string): Array<{ [key: string]: string | number }> =>
    sortedCounts(map).map(item => ({ [key]: item.key, count: item.count }));

  return {
    sourceSheet: "Rack Capacity",
    sourceTable: "Table7",
    sourceSnapshot: null,
    records,
    byZone: toNamedCounts(byZone, "zone") as Array<{ zone: string; count: number }>,
    byStatus: toNamedCounts(byStatus, "status") as Array<{ status: string; count: number }>,
    byCabinetSize: toNamedCounts(byCabinetSize, "cabinetSize") as Array<{ cabinetSize: string; count: number }>,
    byDeviceType: toNamedCounts(byDeviceType, "deviceType") as Array<{ deviceType: string; count: number }>,
    validation: {
      duplicateIds: Array.from(duplicateIds).sort(),
      missingRequiredFields,
      invalidStatuses,
      invalidDataTypes,
      unsupportedUMetrics: [
        "Total U",
        "Used U",
        "Available U",
        "Reserved U",
        "Overall Rack Utilization"
      ]
    }
  };
}
