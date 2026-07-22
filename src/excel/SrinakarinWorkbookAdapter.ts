import ExcelJS from "exceljs";
import { MonthlyLog, UpsRecord, DcRecord, EnergyCalculationProfile, SrinakarinInputSnapshot } from "../types";
import { normalizeMonthCell } from "./ExcelSchema";
import { DeviceLists } from "./SheetMapper";
import type { ExcelIntegrityReport, WorkbookReadResult, WorkbookValidation } from "./WorkbookReader";

/**
 * Reader for the Srinakarin workbook layout.  The workbook intentionally has
 * several purple input sheets and red/green helper sheets; the helper sheets
 * are the authoritative intermediate values used by Dashboard-FAC.
 */

export const SRINAKARIN_SHEETS = {
  upsPhase: "1.1 UPS Data Log By Phase",
  upsAggregate: "1. UPS Data Log",
  upsAverage: "1.2 UPS Data Log_Average",
  acAverage: "1.5 AC PPC Log_Average",
  ac43Average: "1.5.1 AC PPC Log_Average(43AB)",
  acPhase: "1.4 AC PPC Log By Phase",
  ac43Phase: "1.4.1 AC PPC Log By Phase(43AB)",
  ppc43Current: "1.6 AC PPC43 (A)",
  ppc43Panel: "1.7 AC PPC43 Panel (A)",
  air: "2. Air Energy Consumption Log",
  dc: "3. DC Data Log",
  energy: "4. Electricity Cost Log"
} as const;

export const SRINAKARIN_CALCULATION: EnergyCalculationProfile = {
  upsGroups: [
    ["UPS41A", "UPS41B"],
    ["PPC41A", "PPC41B"],
    ["PPC42A", "PPC42B"],
    ["PPC43A", "PPC43B"],
    ["PPC44A", "PPC44B"]
  ],
  dcIds: ["DC PDB41A", "DC PDB41B"],
  airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"]
};

function plain(cell: ExcelJS.Cell): string | number | Date | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") {
    const obj = value as ExcelJS.CellFormulaValue & ExcelJS.CellRichTextValue & ExcelJS.CellHyperlinkValue;
    if (obj.richText) return obj.richText.map(part => part.text).join("");
    if ("result" in obj && obj.result !== null && obj.result !== undefined) {
      return typeof obj.result === "number" || typeof obj.result === "string" || obj.result instanceof Date
        ? obj.result
        : null;
    }
    if ("text" in obj && obj.text) return String(obj.text);
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function keyOf(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerRow(ws: ExcelJS.Worksheet): { row: number; headers: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const headers = new Map<string, number>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const value = plain(cell);
      if (value !== null && String(value).trim() && !headers.has(keyOf(String(value)))) {
        headers.set(keyOf(String(value)), col);
      }
    });
    if ([...headers.keys()].some(key => key === "month")) return { row: r, headers };
  }
  return null;
}

function firstColumn(headers: Map<string, number>, predicates: Array<(key: string) => boolean>): number | null {
  for (const [key, col] of headers) {
    if (predicates.every(predicate => predicate(key))) return col;
  }
  return null;
}

function mergeLog(map: Map<string, MonthlyLog>, month: string): MonthlyLog {
  const existing = map.get(month);
  if (existing) return existing;
  const created: MonthlyLog = {
    month,
    ups: [],
    air: {
      eb41a: null,
      eb41b: null,
      eb42a: null,
      eb42b: null,
      eb43a: null,
      eb43b: null,
      eb44a: null,
      eb44b: null,
      meters: {}
    },
    dc: [],
    energyCost: { buildingEnergyKwh: null, buildingElectricityCostThb: null },
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null,
    energyCalculation: SRINAKARIN_CALCULATION,
    srinakarinInputs: {
      upsPhase: {},
      acPhase: {},
      ppc43Current: {},
      ppc43Panel: {}
    }
  };
  map.set(month, created);
  return created;
}

function mergeUps(log: MonthlyLog, record: UpsRecord): void {
  const current = log.ups.find(item => item.upsId.replace(/[^a-z0-9]/gi, "").toLowerCase() === record.upsId.replace(/[^a-z0-9]/gi, "").toLowerCase());
  if (!current) {
    log.ups.push(record);
    return;
  }
  current.voltage = record.voltage ?? current.voltage;
  current.current = record.current ?? current.current;
  current.loadKw = record.loadKw ?? current.loadKw;
  current.loadKva = record.loadKva ?? current.loadKva;
}

function readAverageSheet(
  ws: ExcelJS.Worksheet,
  logs: Map<string, MonthlyLog>,
  devicePredicates: Array<(key: string) => boolean>
): void {
  const header = headerRow(ws);
  if (!header) return;
  const monthCol = header.headers.get("month");
  const deviceCol = firstColumn(header.headers, devicePredicates);
  const voltageCol = firstColumn(header.headers, [key => key.includes("voltage")]);
  const currentCol = firstColumn(header.headers, [key => key.includes("current")]);
  const loadKwCol = firstColumn(header.headers, [key => key.includes("kw")]);
  const loadKvaCol = firstColumn(header.headers, [key => key.includes("kva")]);
  if (!monthCol || !deviceCol) return;

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const month = normalizeMonthCell(plain(row.getCell(monthCol)));
    const rawId = plain(row.getCell(deviceCol));
    if (!month || rawId === null || String(rawId).trim() === "") continue;
    const log = mergeLog(logs, month);
    mergeUps(log, {
      upsId: String(rawId).trim(),
      voltage: voltageCol ? numberValue(plain(row.getCell(voltageCol))) : null,
      current: currentCol ? numberValue(plain(row.getCell(currentCol))) : null,
      loadKw: loadKwCol ? numberValue(plain(row.getCell(loadKwCol))) : null,
      loadKva: loadKvaCol ? numberValue(plain(row.getCell(loadKvaCol))) : null
    });
  }
}

function readAirSheet(ws: ExcelJS.Worksheet, logs: Map<string, MonthlyLog>): void {
  const header = headerRow(ws);
  if (!header) return;
  const monthCol = header.headers.get("month");
  if (!monthCol) return;
  const meterColumns = [...header.headers.entries()]
    .map(([key, col]) => {
      const match = key.match(/^(eb\d+[a-z])/);
      return match ? ([match[1], col] as const) : null;
    })
    .filter((entry): entry is readonly [string, number] => entry !== null);
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const month = normalizeMonthCell(plain(row.getCell(monthCol)));
    if (!month) continue;
    const log = mergeLog(logs, month);
    const meters = { ...(log.air.meters ?? {}) };
    for (const [key, col] of meterColumns) {
      const value = numberValue(plain(row.getCell(col)));
      meters[key] = value;
      if (key in log.air) {
        (log.air as unknown as Record<string, number | null | undefined>)[key] = value;
      }
      if (["eb43a", "eb43b", "eb44a", "eb44b"].includes(key)) {
        (log.air as unknown as Record<string, number | null | undefined>)[key] = value;
      }
    }
    log.air.meters = meters;
  }
}

function readDcSheet(ws: ExcelJS.Worksheet, logs: Map<string, MonthlyLog>): void {
  const header = headerRow(ws);
  if (!header) return;
  const monthCol = header.headers.get("month");
  const deviceCol = firstColumn(header.headers, [key => key.includes("panel") || key.includes("dc")]);
  const voltageCol = firstColumn(header.headers, [key => key.includes("voltage")]);
  const currentCol = firstColumn(header.headers, [key => key.includes("current")]);
  if (!monthCol || !deviceCol) return;
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const month = normalizeMonthCell(plain(row.getCell(monthCol)));
    const id = plain(row.getCell(deviceCol));
    if (!month || id === null || String(id).trim() === "") continue;
    const log = mergeLog(logs, month);
    const record: DcRecord = {
      panelId: String(id).trim(),
      voltage: voltageCol ? numberValue(plain(row.getCell(voltageCol))) : null,
      current: currentCol ? numberValue(plain(row.getCell(currentCol))) : null
    };
    const existing = log.dc.find(item => item.panelId.replace(/[^a-z0-9]/gi, "").toLowerCase() === record.panelId.replace(/[^a-z0-9]/gi, "").toLowerCase());
    if (existing) {
      existing.voltage = record.voltage ?? existing.voltage;
      existing.current = record.current ?? existing.current;
    } else log.dc.push(record);
  }
}

function readEnergySheet(ws: ExcelJS.Worksheet, logs: Map<string, MonthlyLog>): void {
  const header = headerRow(ws);
  if (!header) return;
  const monthCol = header.headers.get("month");
  const buildingEnergyCol = firstColumn(header.headers, [key => key.includes("building"), key => key.includes("energy") || key.includes("consumption")]);
  const buildingCostCol = firstColumn(header.headers, [key => key.includes("building"), key => key.includes("cost")]);
  if (!monthCol || !buildingEnergyCol || !buildingCostCol) return;
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const month = normalizeMonthCell(plain(row.getCell(monthCol)));
    if (!month) continue;
    const log = mergeLog(logs, month);
    log.energyCost = {
      buildingEnergyKwh: numberValue(plain(row.getCell(buildingEnergyCol))),
      buildingElectricityCostThb: numberValue(plain(row.getCell(buildingCostCol)))
    };
  }
}

function readInputRows(
  ws: ExcelJS.Worksheet,
  logs: Map<string, MonthlyLog>,
  onRow: (log: MonthlyLog, id: string, values: Record<string, number | null>) => void
): void {
  const header = headerRow(ws);
  if (!header) return;
  const monthCol = header.headers.get("month");
  const idCol = firstColumn(header.headers, [key => key.includes("ups") || key.includes("panel") || key.includes("acpower")]);
  if (!monthCol || !idCol) return;
  const valueColumns = new Map<string, number>();
  for (const [key, col] of header.headers) {
    if (key === "month" || col === idCol) continue;
    valueColumns.set(key, col);
  }
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const month = normalizeMonthCell(plain(row.getCell(monthCol)));
    const rawId = plain(row.getCell(idCol));
    if (!month || rawId === null || String(rawId).trim() === "") continue;
    const values: Record<string, number | null> = {};
    for (const [key, col] of valueColumns) values[key] = numberValue(plain(row.getCell(col)));
    onRow(mergeLog(logs, month), String(rawId).trim(), values);
  }
}

function readSrinakarinInputs(workbook: ExcelJS.Workbook, logs: Map<string, MonthlyLog>): void {
  const valueByPrefix = (values: Record<string, number | null>, prefix: string): number | null => {
    const key = Object.keys(values).find(candidate => candidate === prefix || candidate.startsWith(prefix));
    return key ? values[key] ?? null : null;
  };
  const upsPhase = workbook.getWorksheet(SRINAKARIN_SHEETS.upsPhase);
  if (upsPhase) readInputRows(upsPhase, logs, (log, id, values) => {
    log.srinakarinInputs!.upsPhase[id] = {
      voltage: valueByPrefix(values, "voltage"),
      current: valueByPrefix(values, "current"),
      loadKw: valueByPrefix(values, "loadkw"),
      loadKva: valueByPrefix(values, "loadkva")
    };
  });
  const acPhase = workbook.getWorksheet(SRINAKARIN_SHEETS.acPhase);
  if (acPhase) readInputRows(acPhase, logs, (log, id, values) => {
    log.srinakarinInputs!.acPhase[id] = { voltage: valueByPrefix(values, "voltage"), current: valueByPrefix(values, "current") };
  });
  const ac43Phase = workbook.getWorksheet(SRINAKARIN_SHEETS.ac43Phase);
  if (ac43Phase) readInputRows(ac43Phase, logs, (log, id, values) => {
    log.srinakarinInputs!.acPhase[id] = { voltage: valueByPrefix(values, "voltage"), current: valueByPrefix(values, "current") };
  });
  const ppc43Current = workbook.getWorksheet(SRINAKARIN_SHEETS.ppc43Current);
  if (ppc43Current) readInputRows(ppc43Current, logs, (log, id, values) => {
    log.srinakarinInputs!.ppc43Current[id] = valueByPrefix(values, "panelcurrenta");
  });
  const ppc43Panel = workbook.getWorksheet(SRINAKARIN_SHEETS.ppc43Panel);
  if (ppc43Panel) readInputRows(ppc43Panel, logs, (log, id, values) => {
    log.srinakarinInputs!.ppc43Panel[id] = { loadKw: valueByPrefix(values, "loadkw"), loadKva: valueByPrefix(values, "loadkva") };
  });
}

function emptyIntegrity(): ExcelIntegrityReport {
  return { duplicateKeys: [], missingMonths: [], missingDevices: [], unexpectedBlankRows: [], invalidIds: [] };
}

export function isSrinakarinWorkbook(sheetNames: string[]): boolean {
  return sheetNames.includes(SRINAKARIN_SHEETS.upsAverage)
    && sheetNames.includes(SRINAKARIN_SHEETS.air)
    && sheetNames.includes(SRINAKARIN_SHEETS.energy);
}

export function readSrinakarinWorkbook(workbook: ExcelJS.Workbook, _devices?: DeviceLists): WorkbookReadResult {
  const logs = new Map<string, MonthlyLog>();
  const validation: WorkbookValidation = { ok: true, errors: [], warnings: [], sheetNames: {} };
  const names = workbook.worksheets.map(ws => ws.name);
  for (const [key, name] of Object.entries(SRINAKARIN_SHEETS)) {
    if (names.includes(name)) validation.sheetNames[key as keyof WorkbookValidation["sheetNames"]] = name;
    else validation.warnings.push(`Srinakarin helper sheet not found: ${name}`);
  }

  const upsAggregate = workbook.getWorksheet(SRINAKARIN_SHEETS.upsAggregate);
  const ups = workbook.getWorksheet(SRINAKARIN_SHEETS.upsAverage);
  const ac = workbook.getWorksheet(SRINAKARIN_SHEETS.acAverage);
  const ac43 = workbook.getWorksheet(SRINAKARIN_SHEETS.ac43Average);
  const air = workbook.getWorksheet(SRINAKARIN_SHEETS.air);
  const dc = workbook.getWorksheet(SRINAKARIN_SHEETS.dc);
  const energy = workbook.getWorksheet(SRINAKARIN_SHEETS.energy);
  if (ups) readAverageSheet(ups, logs, [key => key.includes("ups")]);
  else validation.errors.push(`Required Srinakarin sheet not found: ${SRINAKARIN_SHEETS.upsAverage}`);
  if (ac) readAverageSheet(ac, logs, [key => key.includes("panel") || key.includes("ac") || key.includes("ppc")]);
  if (ac43) readAverageSheet(ac43, logs, [key => key.includes("panel") || key.includes("ac") || key.includes("ppc")]);
  if (air) readAirSheet(air, logs);
  else validation.errors.push(`Required Srinakarin sheet not found: ${SRINAKARIN_SHEETS.air}`);
  if (dc) readDcSheet(dc, logs);
  else validation.errors.push(`Required Srinakarin sheet not found: ${SRINAKARIN_SHEETS.dc}`);
  if (energy) readEnergySheet(energy, logs);
  else validation.errors.push(`Required Srinakarin sheet not found: ${SRINAKARIN_SHEETS.energy}`);
  // Dashboard-FAC reads this green aggregate for its UPS/PPC load chain. It
  // is intentionally read last so the monthly output remains authoritative
  // when a helper sheet still contains an older cached formula result.
  if (upsAggregate) readAverageSheet(upsAggregate, logs, [key => key.includes("ups") || key.includes("ppc")]);
  else validation.errors.push(`Required Srinakarin sheet not found: ${SRINAKARIN_SHEETS.upsAggregate}`);
  readSrinakarinInputs(workbook, logs);
  for (const log of logs.values()) {
    for (const [phaseId, reading] of Object.entries(log.srinakarinInputs?.upsPhase ?? {})) {
      const baseId = phaseId.replace(/\s+-\s+[RST]$/i, "").trim();
      const ups = log.ups.find(item => item.upsId.replace(/\s+/g, "").toLowerCase() === baseId.replace(/\s+/g, "").toLowerCase());
      if (ups) ups.phases = { ...(ups.phases ?? {}), [phaseId.slice(-1).toUpperCase()]: reading };
    }
  }

  validation.ok = validation.errors.length === 0;
  return { logs: [...logs.values()].sort((a, b) => a.month.localeCompare(b.month)), validation, integrity: emptyIntegrity() };
}
