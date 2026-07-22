/**
 * Reads the UPS Summary and UPS Mapping tables directly from the workbook's
 * `Dashboard-FAC` sheet - the same sheet a user sees when opening the
 * workbook in Excel. UMDB / STS / OUDB / AC Power Panel / Capacity are
 * physical wiring/hardware-rating facts that Excel already stores; this is a
 * read-only extraction, not a recalculation. Facilities differ in column
 * layout (Rangsit has no "AC Power Panel" column; Srinakarin's capacity
 * header reads "PPC Capacity (kVA)" instead of "UPS Capacity (kVA)"), so
 * columns are located by header text, never by fixed position.
 */
import ExcelJS from "exceljs";
import type { DashboardUpsMappingReport, DashboardUpsMappingRow, DashboardUpsSummaryRow } from "./reportTypes";

function headerKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in (value as object)) {
    return (value as { richText: Array<{ text: string }> }).richText.map(t => t.text).join("");
  }
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const raw = cell.value;
  const value = raw !== null && typeof raw === "object" && "result" in (raw as object) ? (raw as { result: unknown }).result : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cellText(cell: ExcelJS.Cell): string {
  const raw = cell.value;
  const value = raw !== null && typeof raw === "object" && "result" in (raw as object) ? (raw as { result: unknown }).result : raw;
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && "richText" in (value as object)) {
    return (value as { richText: Array<{ text: string }> }).richText.map(t => t.text).join("").trim() || "—";
  }
  const text = String(value).trim();
  return text === "" ? "—" : text;
}

interface ColumnMap {
  no: number;
  ups: number;
  umdb?: number;
  acPowerPanel?: number;
  sts?: number;
  oudb?: number;
  voltage?: number;
  current?: number;
  loadKw: number;
  loadKva: number;
  capacity: number;
}

function findColumns(row: ExcelJS.Row, requireUmdb: boolean): ColumnMap | null {
  const byKey = new Map<string, number>();
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    byKey.set(headerKey(cell.value), columnNumber);
  });
  const hasUmdb = byKey.has("umdb");
  if (requireUmdb !== hasUmdb) return null;
  const no = byKey.get("no.");
  const ups = byKey.get("ups") ?? byKey.get("ups and ppc");
  if (!no || !ups) return null;
  const loadKwKey = requireUmdb ? "load (kw)" : "total load (kw)";
  const loadKvaKey = requireUmdb ? "load (kva)" : "total load (kva)";
  const loadKw = byKey.get(loadKwKey);
  const loadKva = byKey.get(loadKvaKey);
  const capacity = [...byKey.entries()].find(([key]) => key.includes("capacity"))?.[1];
  if (!loadKw || !loadKva || !capacity) return null;
  return {
    no,
    ups,
    umdb: byKey.get("umdb"),
    acPowerPanel: byKey.get("ac power panel"),
    sts: byKey.get("sts"),
    oudb: byKey.get("oudb"),
    voltage: [...byKey.entries()].find(([key]) => key.startsWith("voltage"))?.[1],
    current: [...byKey.entries()].find(([key]) => key.startsWith("current"))?.[1],
    loadKw,
    loadKva,
    capacity
  };
}

/** Scans Dashboard-FAC top-to-bottom; the last group-summary header found
 *  immediately before the detail (UMDB) table is the authoritative one -
 *  this naturally picks Srinakarin's "UPS and PPC Load Status" table (the
 *  complete 5-group topology) over its earlier, partial "Overall" table. */
function locateTables(sheet: ExcelJS.Worksheet): { summaryHeaderRow: number; detailHeaderRow: number } | null {
  let summaryHeaderRow: number | null = null;
  let detailHeaderRow: number | null = null;
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (findColumns(row, false)) summaryHeaderRow = r;
    if (findColumns(row, true)) {
      detailHeaderRow = r;
      break; // the detail table always follows the group table(s) on Dashboard-FAC
    }
  }
  return summaryHeaderRow && detailHeaderRow ? { summaryHeaderRow, detailHeaderRow } : null;
}

function readRows(sheet: ExcelJS.Worksheet, headerRow: number, columns: ColumnMap): Array<{
  no: number; ups: string; umdb: string; acPowerPanel: string; sts: string; oudb: string;
  voltage: number | null; current: number | null; loadKw: number | null; loadKva: number | null; capacity: number | null;
}> {
  const rows = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const no = cellNumber(row.getCell(columns.no));
    if (no === null) break; // "Total" row or the next section's title marks the end
    rows.push({
      no,
      ups: cellText(row.getCell(columns.ups)),
      umdb: columns.umdb ? cellText(row.getCell(columns.umdb)) : "—",
      acPowerPanel: columns.acPowerPanel ? cellText(row.getCell(columns.acPowerPanel)) : "—",
      sts: columns.sts ? cellText(row.getCell(columns.sts)) : "—",
      oudb: columns.oudb ? cellText(row.getCell(columns.oudb)) : "—",
      voltage: columns.voltage ? cellNumber(row.getCell(columns.voltage)) : null,
      current: columns.current ? cellNumber(row.getCell(columns.current)) : null,
      loadKw: cellNumber(row.getCell(columns.loadKw)),
      loadKva: cellNumber(row.getCell(columns.loadKva)),
      capacity: cellNumber(row.getCell(columns.capacity))
    });
  }
  return rows;
}

function loadPercent(loadKva: number | null, capacity: number | null): number | null {
  return loadKva !== null && capacity !== null && capacity > 0 ? (loadKva / capacity) * 100 : null;
}

export async function readUpsMappingFromBuffer(buffer: Buffer): Promise<DashboardUpsMappingReport | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("Dashboard-FAC");
  if (!sheet) return null;

  const located = locateTables(sheet);
  if (!located) return null;

  const summaryColumns = findColumns(sheet.getRow(located.summaryHeaderRow), false);
  const detailColumns = findColumns(sheet.getRow(located.detailHeaderRow), true);
  if (!summaryColumns || !detailColumns) return null;

  const summary: DashboardUpsSummaryRow[] = readRows(sheet, located.summaryHeaderRow, summaryColumns).map(r => ({
    no: r.no,
    name: r.ups,
    totalLoadKw: r.loadKw,
    totalLoadKva: r.loadKva,
    capacity: r.capacity,
    loadPercent: loadPercent(r.loadKva, r.capacity)
  }));

  const mapping: DashboardUpsMappingRow[] = readRows(sheet, located.detailHeaderRow, detailColumns).map(r => ({
    no: r.no,
    umdb: r.umdb,
    upsId: r.ups,
    acPowerPanel: r.acPowerPanel,
    sts: r.sts,
    oudb: r.oudb,
    voltage: r.voltage,
    current: r.current,
    loadKw: r.loadKw,
    loadKva: r.loadKva,
    capacity: r.capacity,
    loadPercent: loadPercent(r.loadKva, r.capacity)
  }));

  return { sourceSheet: "Dashboard-FAC", summary, mapping };
}
