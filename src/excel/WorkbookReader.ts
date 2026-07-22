/**
 * WorkbookReader - loads a compatible .xlsm/.xlsx workbook with ExcelJS and
 * converts the four log sheets into MonthlyLog[], together with a validation
 * result (is this a workbook we understand?) and a data-integrity report
 * (duplicates, gaps, unknown device IDs) mirroring the Google Sheets sync.
 *
 * Reading only. Writing goes through WorkbookWriter, which patches the
 * workbook at zip level so macros/pivots/charts survive.
 */

import ExcelJS from "exceljs";
import { promises as fs } from "fs";
import { MonthlyLog } from "../types";
import {
  FieldId,
  SHEET_SCHEMAS,
  SheetSchema,
  TabKey,
  normalizeMonthCell,
  resolveColumns,
  resolveSheetNames
} from "./ExcelSchema";
import { checkWorkbookVersion } from "./WorkbookVersion";
import { DEFAULT_DEVICE_LISTS, DeviceLists, SheetRow, matchDcId, matchUpsId, rowsToLogs } from "./SheetMapper";
import { isSrinakarinWorkbook, readSrinakarinWorkbook } from "./SrinakarinWorkbookAdapter";

export interface WorkbookValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Resolved sheet name per tab (only tabs that were found). */
  sheetNames: Partial<Record<TabKey, string>>;
}

export interface ExcelIntegrityReport {
  duplicateKeys: { tab: TabKey; month: string; deviceId?: string; rowNumbers: number[] }[];
  missingMonths: { tab: TabKey; month: string }[];
  missingDevices: { tab: TabKey; month: string; deviceId: string }[];
  unexpectedBlankRows: { tab: TabKey; rowNumber: number }[];
  invalidIds: { tab: TabKey; rowNumber: number; rawId: string }[];
}

export interface WorkbookReadResult {
  logs: MonthlyLog[];
  validation: WorkbookValidation;
  integrity: ExcelIntegrityReport;
}

interface ParsedTab {
  rows: SheetRow[];
  rawRows: { rowNumber: number; month: string | null; rawDeviceId: string | null; hasAnyValue: boolean }[];
}

function cellToPlainValue(cell: ExcelJS.Cell): string | number | Date | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") {
    const obj = value as ExcelJS.CellFormulaValue & ExcelJS.CellRichTextValue & ExcelJS.CellHyperlinkValue;
    if (obj.richText) return obj.richText.map(rt => rt.text).join("");
    if ("result" in obj && obj.result !== undefined && obj.result !== null) {
      const result = obj.result;
      if (result instanceof Date || typeof result === "number" || typeof result === "string") return result;
      return null;
    }
    if ("hyperlink" in obj && obj.text) return String(obj.text);
  }
  return null;
}

function findHeaderRow(
  worksheet: ExcelJS.Worksheet,
  schema: SheetSchema
): { headerRowNumber: number; byField: Map<FieldId, number>; missingRequired: FieldId[] } | null {
  const maxScan = Math.min(worksheet.rowCount, 15);
  let best: { headerRowNumber: number; byField: Map<FieldId, number>; missingRequired: FieldId[] } | null = null;
  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const headers: Array<{ col: number; text: string }> = [];
    let hasMonth = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = String(cellToPlainValue(cell) ?? "").trim();
      if (text.toLowerCase() === "month") hasMonth = true;
      headers.push({ col: colNumber, text });
    });
    if (!hasMonth) continue;
    const { byField, missingRequired } = resolveColumns(schema, headers);
    const candidate = { headerRowNumber: r, byField, missingRequired };
    if (missingRequired.length === 0) return candidate;
    if (!best) best = candidate;
  }
  return best;
}

function parseTab(worksheet: ExcelJS.Worksheet, schema: SheetSchema, validation: WorkbookValidation): ParsedTab {
  const parsed: ParsedTab = { rows: [], rawRows: [] };
  const header = findHeaderRow(worksheet, schema);
  if (!header) {
    validation.errors.push(
      `Sheet "${worksheet.name}": could not find a header row containing "Month".`
    );
    return parsed;
  }
  if (header.missingRequired.length > 0) {
    validation.errors.push(
      `Sheet "${worksheet.name}": missing required column(s): ${header.missingRequired.join(", ")}.`
    );
    return parsed;
  }

  const monthCol = header.byField.get("month")!;
  const deviceCol = header.byField.get("deviceId");

  for (let r = header.headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const monthRaw = cellToPlainValue(row.getCell(monthCol));
    const month = normalizeMonthCell(monthRaw);

    const values: SheetRow["values"] = {};
    let hasAnyValue = false;
    for (const [field, col] of header.byField) {
      if (field === "month") continue;
      const plain = cellToPlainValue(row.getCell(col));
      const normalized = plain instanceof Date ? plain.toISOString() : plain;
      values[field] = normalized as string | number | null;
      if (normalized !== null && normalized !== "") hasAnyValue = true;
    }

    parsed.rawRows.push({
      rowNumber: r,
      month,
      rawDeviceId: deviceCol ? String(cellToPlainValue(row.getCell(deviceCol)) ?? "") : null,
      hasAnyValue
    });

    if (!month) continue;
    parsed.rows.push({ month, values });
  }
  return parsed;
}

function buildIntegrityReport(tabs: Record<TabKey, ParsedTab>, devices: DeviceLists): ExcelIntegrityReport {
  const report: ExcelIntegrityReport = {
    duplicateKeys: [],
    missingMonths: [],
    missingDevices: [],
    unexpectedBlankRows: [],
    invalidIds: []
  };

  const monthSets: Record<TabKey, Set<string>> = { UPS: new Set(), AIR: new Set(), DC: new Set(), ENERGY: new Set() };

  for (const tab of Object.keys(tabs) as TabKey[]) {
    const { rows, rawRows } = tabs[tab];
    rows.forEach(r => monthSets[tab].add(r.month));

    // Blank / invalid rows
    for (const raw of rawRows) {
      if (!raw.month && raw.hasAnyValue) {
        report.unexpectedBlankRows.push({ tab, rowNumber: raw.rowNumber });
      }
    }

    // Duplicates + unknown device IDs
    const isDeviceTab = tab === "UPS" || tab === "DC";
    const seen = new Map<string, number[]>();
    let i = 0;
    for (const raw of rawRows) {
      if (!raw.month) continue;
      i++;
      let key = raw.month;
      if (isDeviceTab) {
        const rawId = raw.rawDeviceId ?? "";
        const canonical =
          tab === "UPS"
            ? devices.upsIds.find(id => matchUpsId(id, rawId))
            : devices.dcIds.find(id => matchDcId(id, rawId));
        if (!canonical) {
          report.invalidIds.push({ tab, rowNumber: raw.rowNumber, rawId });
          continue;
        }
        key = `${raw.month}|${canonical}`;
      }
      const list = seen.get(key) ?? [];
      list.push(raw.rowNumber);
      seen.set(key, list);
    }
    for (const [key, rowNumbers] of seen) {
      if (rowNumbers.length > 1) {
        const [month, deviceId] = key.split("|");
        report.duplicateKeys.push({ tab, month, deviceId, rowNumbers });
      }
    }

    // Missing devices per month
    if (isDeviceTab) {
      const expected = tab === "UPS" ? devices.upsIds : devices.dcIds;
      const byMonth = new Map<string, string[]>();
      for (const raw of rawRows) {
        if (!raw.month) continue;
        const list = byMonth.get(raw.month) ?? [];
        list.push(raw.rawDeviceId ?? "");
        byMonth.set(raw.month, list);
      }
      for (const [month, ids] of byMonth) {
        for (const exp of expected) {
          const matcher = tab === "UPS" ? matchUpsId : matchDcId;
          if (!ids.some(id => matcher(exp, id))) {
            report.missingDevices.push({ tab, month, deviceId: exp });
          }
        }
      }
    }
  }

  // Months present in one tab but absent from another
  const allMonths = new Set<string>([...monthSets.UPS, ...monthSets.AIR, ...monthSets.DC, ...monthSets.ENERGY]);
  for (const month of allMonths) {
    for (const tab of Object.keys(monthSets) as TabKey[]) {
      if (!monthSets[tab].has(month)) report.missingMonths.push({ tab, month });
    }
  }

  return report;
}

export async function readWorkbookFromBuffer(buffer: Buffer, devices: DeviceLists = DEFAULT_DEVICE_LISTS): Promise<WorkbookReadResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  // Srinakarin has a multi-stage workbook (phase input -> red helper sheets
  // -> green aggregate sheet). Keep the historical four-tab reader intact for
  // Rangsit and dispatch only when the workbook's signature is unambiguous.
  if (isSrinakarinWorkbook(workbook.worksheets.map(ws => ws.name))) {
    return readSrinakarinWorkbook(workbook, devices);
  }

  const validation: WorkbookValidation = { ok: true, errors: [], warnings: [], sheetNames: {} };
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  validation.sheetNames = resolveSheetNames(sheetNames);

  const tabs = {} as Record<TabKey, ParsedTab>;
  for (const schema of SHEET_SCHEMAS) {
    const resolved = validation.sheetNames[schema.key];
    if (!resolved) {
      validation.errors.push(
        `Required sheet for "${schema.canonicalName}" not found. Sheets present: ${sheetNames.join(", ")}.`
      );
      tabs[schema.key] = { rows: [], rawRows: [] };
      continue;
    }
    const worksheet = workbook.getWorksheet(resolved)!;
    tabs[schema.key] = parseTab(worksheet, schema, validation);
  }

  validation.ok = validation.errors.length === 0;

  const logs = validation.ok
    ? rowsToLogs({ UPS: tabs.UPS.rows, AIR: tabs.AIR.rows, DC: tabs.DC.rows, ENERGY: tabs.ENERGY.rows }, devices)
    : [];

  return { logs, validation, integrity: buildIntegrityReport(tabs, devices) };
}

export async function readWorkbookFromFile(filePath: string, devices: DeviceLists = DEFAULT_DEVICE_LISTS): Promise<WorkbookReadResult> {
  const buffer = await fs.readFile(filePath);
  const result = await readWorkbookFromBuffer(buffer, devices);

  // Merge sidecar metadata (last-saved timestamps), upgrading it if it came
  // from an older app version.
  const version = await checkWorkbookVersion(filePath);
  if (version.message) result.validation.warnings.push(version.message);
  for (const log of result.logs) {
    const m = version.meta.months[log.month];
    if (!m) continue;
    log.lastSavedUps = log.lastSavedUps ?? m.lastSavedUps;
    log.lastSavedAir = log.lastSavedAir ?? m.lastSavedAir;
    log.lastSavedDc = log.lastSavedDc ?? m.lastSavedDc;
    log.lastSavedEnergyCost = log.lastSavedEnergyCost ?? m.lastSavedEnergyCost;
  }
  return result;
}
