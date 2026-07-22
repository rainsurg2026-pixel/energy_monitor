/**
 * ExcelSchema - the single description of how the app's domain model maps
 * onto the RST_Dashboard workbook (and any compatible workbook).
 *
 * Both WorkbookReader (ExcelJS) and WorkbookWriter (zip-level patcher) resolve
 * sheets and columns exclusively through this module, so read and write can
 * never disagree about which column means what.
 */

export type TabKey = "UPS" | "AIR" | "DC" | "ENERGY";

/** Field identifiers used by SheetMapper when converting rows <-> MonthlyLog. */
export type FieldId =
  | "month"
  | "deviceId"
  | "voltage"
  | "current"
  | "loadKw"
  | "loadKva"
  | "eb41a"
  | "eb41b"
  | "eb42a"
  | "eb42b"
  | "buildingEnergyKwh"
  | "buildingElectricityCostThb"
  | "floorElectricityCostThb"
  | "averageElectricityRateThbPerKwh"
  | "timestamp";

export interface ColumnSchema {
  field: FieldId;
  /**
   * A header matches when every keyword in one of these groups appears in it
   * (lowercased). First matching column wins; columns already claimed by an
   * earlier field are skipped.
   */
  keywordGroups: string[][];
  required: boolean;
  kind: "month" | "text" | "number" | "timestamp";
  /** Formula/table-managed columns are read for validation but preserved on write. */
  readOnly?: boolean;
}

export interface SheetSchema {
  key: TabKey;
  /** Sheet-name keyword groups, same matching rule as columns. */
  nameKeywordGroups: string[][];
  /** Canonical name used when creating a brand-new workbook. */
  canonicalName: string;
  columns: ColumnSchema[];
  /** One row per month, or one row per month+device. */
  rowGranularity: "month" | "month-device";
}

export const SHEET_SCHEMAS: SheetSchema[] = [
  {
    key: "UPS",
    nameKeywordGroups: [["ups"]],
    canonicalName: "1. UPS Data Log",
    rowGranularity: "month-device",
    columns: [
      { field: "month", keywordGroups: [["month"]], required: true, kind: "month" },
      { field: "deviceId", keywordGroups: [["ups"]], required: true, kind: "text" },
      { field: "voltage", keywordGroups: [["voltage"]], required: true, kind: "number" },
      { field: "current", keywordGroups: [["current"]], required: true, kind: "number" },
      { field: "loadKw", keywordGroups: [["load", "kw)"], ["(kw"]], required: true, kind: "number" },
      { field: "loadKva", keywordGroups: [["kva"]], required: true, kind: "number" },
      { field: "timestamp", keywordGroups: [["timestamp"]], required: false, kind: "timestamp" }
    ]
  },
  {
    key: "AIR",
    nameKeywordGroups: [["air"], ["eb41"], ["eb42"]],
    canonicalName: "2. Air Energy Consumption Log",
    rowGranularity: "month",
    columns: [
      { field: "month", keywordGroups: [["month"]], required: true, kind: "month" },
      { field: "eb41a", keywordGroups: [["eb41a"]], required: true, kind: "number" },
      { field: "eb41b", keywordGroups: [["eb41b"]], required: true, kind: "number" },
      { field: "eb42a", keywordGroups: [["eb42a"]], required: true, kind: "number" },
      { field: "eb42b", keywordGroups: [["eb42b"]], required: false, kind: "number" },
      { field: "timestamp", keywordGroups: [["timestamp"]], required: false, kind: "timestamp" }
    ]
  },
  {
    key: "DC",
    nameKeywordGroups: [["dc"]],
    canonicalName: "3. DC Data Log",
    rowGranularity: "month-device",
    columns: [
      { field: "month", keywordGroups: [["month"]], required: true, kind: "month" },
      { field: "deviceId", keywordGroups: [["panel"], ["dc", "pdb"]], required: true, kind: "text" },
      { field: "voltage", keywordGroups: [["voltage"]], required: true, kind: "number" },
      { field: "current", keywordGroups: [["current"]], required: true, kind: "number" },
      { field: "timestamp", keywordGroups: [["timestamp"]], required: false, kind: "timestamp" }
    ]
  },
  {
    key: "ENERGY",
    nameKeywordGroups: [["electricity", "cost"], ["energy"]],
    canonicalName: "4. Electricity Cost Log",
    rowGranularity: "month",
    columns: [
      { field: "month", keywordGroups: [["month"]], required: true, kind: "month" },
      {
        field: "buildingEnergyKwh",
        keywordGroups: [["building", "energy"], ["consumption", "kwh"]],
        required: true,
        kind: "number"
      },
      {
        field: "buildingElectricityCostThb",
        keywordGroups: [["building", "electricity", "cost"]],
        required: true,
        kind: "number"
      },
      {
        field: "floorElectricityCostThb",
        keywordGroups: [["4th", "floor", "electricity", "cost"]],
        required: false,
        kind: "number",
        readOnly: true
      },
      {
        field: "averageElectricityRateThbPerKwh",
        keywordGroups: [["average", "electricity", "rate"]],
        required: false,
        kind: "number",
        readOnly: true
      },
      { field: "timestamp", keywordGroups: [["timestamp"]], required: false, kind: "timestamp" }
    ]
  }
];

export function getSheetSchema(key: TabKey): SheetSchema {
  const schema = SHEET_SCHEMAS.find(s => s.key === key);
  if (!schema) throw new Error(`Unknown sheet schema key: ${key}`);
  return schema;
}

function matchesKeywordGroups(text: string, groups: string[][]): boolean {
  const lower = text.toLowerCase();
  return groups.some(group => group.every(kw => lower.includes(kw)));
}

/**
 * Resolve which workbook sheet holds each tab. Every schema is matched against
 * the sheet list in order; a sheet claimed by one tab is not offered to the
 * next, so "3. DC Data Log" cannot also match the ENERGY keywords etc.
 */
export function resolveSheetNames(sheetNames: string[]): Partial<Record<TabKey, string>> {
  const result: Partial<Record<TabKey, string>> = {};
  const claimed = new Set<string>();
  for (const schema of SHEET_SCHEMAS) {
    const found = sheetNames.find(
      name => !claimed.has(name) && matchesKeywordGroups(name, schema.nameKeywordGroups)
    );
    if (found) {
      result[schema.key] = found;
      claimed.add(found);
    }
  }
  return result;
}

/**
 * Resolve header text -> field for one sheet. `headers` is a map of column
 * identifier (letter or index) to header text.
 */
export function resolveColumns<K>(
  schema: SheetSchema,
  headers: Array<{ col: K; text: string }>
): { byField: Map<FieldId, K>; missingRequired: FieldId[] } {
  const byField = new Map<FieldId, K>();
  const claimed = new Set<K>();
  for (const column of schema.columns) {
    const found = headers.find(
      h => !claimed.has(h.col) && h.text.trim() !== "" && matchesKeywordGroups(h.text, column.keywordGroups)
    );
    if (found) {
      byField.set(column.field, found.col);
      claimed.add(found.col);
    }
  }
  // Facility profiles may add meters without requiring a code change. Air
  // headers use the stable EBxx[A-C] identifier convention.
  if (schema.key === "AIR") {
    for (const h of headers) {
      const field = h.text.toLowerCase().replace(/\s|\(|\)|_/g, "").match(/^(eb\d+[a-z])/)?.[1];
      if (field && !byField.has(field as FieldId) && !claimed.has(h.col)) {
        byField.set(field as FieldId, h.col);
        claimed.add(h.col);
      }
    }
  }
  const missingRequired = schema.columns
    .filter(c => c.required && !byField.has(c.field))
    .map(c => c.field);
  return { byField, missingRequired };
}

// ---------------------------------------------------------------------------
// Month conversions (Excel 1900 date system)
// ---------------------------------------------------------------------------

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

export function excelSerialToYyyyMm(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 200000) return null;
  const date = new Date(EXCEL_EPOCH_UTC_MS + Math.round(serial) * DAY_MS);
  if (isNaN(date.getTime())) return null;
  // Snap to the intended month even if the serial is a few days off (e.g. a
  // timezone-shifted end-of-previous-month value).
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  if (date.getUTCDate() >= 27) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function yyyyMmToExcelSerial(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(v => parseInt(v, 10));
  return Math.round((Date.UTC(y, m - 1, 1) - EXCEL_EPOCH_UTC_MS) / DAY_MS);
}

const SHORT_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Normalize any cell representation of a month (Excel serial, JS Date from
 * ExcelJS, "YYYY-MM", "01-May-26", "May-26", "2026/05") to canonical YYYY-MM.
 */
export function normalizeMonthCell(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    let year = value.getUTCFullYear();
    let month = value.getUTCMonth() + 1;
    if (value.getUTCDate() >= 27) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  if (typeof value === "number") {
    return excelSerialToYyyyMm(value);
  }

  const str = String(value).trim();
  if (str === "") return null;

  // Pure numeric string -> serial
  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = Number(str);
    if (serial > 30000 && serial < 200000) return excelSerialToYyyyMm(serial);
  }

  // YYYY-MM or YYYY/MM (Buddhist-era years converted)
  let m = str.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    let year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (year > 2500) year -= 543;
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  // YYYY-MM-DD
  m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    let year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (year > 2500) year -= 543;
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  // [DD-]Mon-YY or Mon-YYYY (e.g. "01-May-26", "May-26", "May 2026")
  const parts = str.split(/[-/\s.,]+/).filter(Boolean);
  let monthIdx = -1;
  let year = -1;
  let day = -1;
  for (const part of parts) {
    const clean = part.toLowerCase();
    const idx = SHORT_MONTHS.findIndex(sm => clean.startsWith(sm));
    if (idx !== -1 && monthIdx === -1) {
      monthIdx = idx;
      continue;
    }
    const num = parseInt(part, 10);
    if (isNaN(num)) continue;
    if (num >= 1000) year = num;
    else if (num > 31) year = num >= 70 ? 1900 + num : 2000 + num;
    else if (day === -1) day = num;
    else if (year === -1) year = num >= 70 ? 1900 + num : 2000 + num;
  }
  // A trailing small number with no day slot left is a 2-digit year ("May-26")
  if (year === -1 && day !== -1 && monthIdx !== -1) {
    year = day >= 70 ? 1900 + day : 2000 + day;
    day = -1;
  }
  if (monthIdx !== -1 && year !== -1) {
    if (year > 2500) year -= 543;
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  }

  return null;
}
