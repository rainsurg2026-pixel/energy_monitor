/**
 * WorkbookValidator - two responsibilities:
 *
 * 1. Workbook health: condense a WorkbookReadResult into the summary the
 *    Integrity Center displays (structure validity + data-integrity counts).
 *
 * 2. IPC payload validation: the main process never trusts a MonthlyLog[]
 *    coming over IPC from the renderer. Every save goes through
 *    validateLogsPayload, which re-checks shape and value domains before
 *    anything touches the filesystem.
 */

import {
  AirRecord,
  DcRecord,
  EnergyCalculationProfile,
  EnergyCostRecord,
  MonthlyLog,
  PhaseReading,
  SrinakarinInputSnapshot,
  UpsRecord
} from "../types";
import { ExcelIntegrityReport, WorkbookReadResult, WorkbookValidation } from "./WorkbookReader";

export interface WorkbookHealth {
  structureOk: boolean;
  errors: string[];
  warnings: string[];
  monthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  duplicateCount: number;
  missingMonthCount: number;
  missingDeviceCount: number;
  invalidIdCount: number;
  blankRowCount: number;
  /** ISO timestamp of when this validation ran. */
  validatedAt: string;
}

export function summarizeWorkbookHealth(read: WorkbookReadResult): WorkbookHealth {
  const months = read.logs.map(l => l.month).sort();
  return {
    structureOk: read.validation.ok,
    errors: read.validation.errors,
    warnings: read.validation.warnings,
    monthCount: months.length,
    firstMonth: months[0] ?? null,
    lastMonth: months[months.length - 1] ?? null,
    duplicateCount: read.integrity.duplicateKeys.length,
    missingMonthCount: read.integrity.missingMonths.length,
    missingDeviceCount: read.integrity.missingDevices.length,
    invalidIdCount: read.integrity.invalidIds.length,
    blankRowCount: read.integrity.unexpectedBlankRows.length,
    validatedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// IPC payload validation
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 1200; // 100 years of monthly logs - way beyond legitimate use
const MAX_TEXT = 200;

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

function asNumberOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PayloadError(`${label} must be a finite number or null.`);
  }
  if (Math.abs(value) > 1e15) throw new PayloadError(`${label} is out of range.`);
  return value;
}

function asShortStringOrNull(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new PayloadError(`${label} must be a string or null.`);
  if (value.length > MAX_TEXT) throw new PayloadError(`${label} is too long.`);
  return value;
}

function asShortString(value: unknown, label: string): string {
  const str = asShortStringOrNull(value, label);
  if (str === null || str.trim() === "") throw new PayloadError(`${label} is required.`);
  return str;
}

function validateMeterMap(value: unknown, label: string): Record<string, number | null> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${label} must be an object.`);
  const result: Record<string, number | null> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || key.length > MAX_TEXT || /[\r\n]/.test(key)) {
      throw new PayloadError(`${label}.${key} has an invalid field name.`);
    }
    result[key] = asNumberOrNull(rawValue, `${label}.${key}`);
  }
  return result;
}

function validatePhaseMap(value: unknown, label: string): Record<string, PhaseReading> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${label} must be an object.`);
  const result: Record<string, PhaseReading> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const input = (raw ?? {}) as Record<string, unknown>;
    result[key] = {
      voltage: asNumberOrNull(input.voltage, `${label}.${key}.voltage`),
      current: asNumberOrNull(input.current, `${label}.${key}.current`),
      loadKw: asNumberOrNull(input.loadKw, `${label}.${key}.loadKw`),
      loadKva: asNumberOrNull(input.loadKva, `${label}.${key}.loadKva`)
    };
  }
  return result;
}

function validateCalculationProfile(value: unknown, label: string): EnergyCalculationProfile | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${label} must be an object.`);
  const input = value as Record<string, unknown>;
  const groups = input.upsGroups;
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group))) {
    throw new PayloadError(`${label}.upsGroups must be an array of string arrays.`);
  }
  const asStringList = (raw: unknown, field: string): string[] => {
    if (!Array.isArray(raw) || raw.some(item => typeof item !== "string" || item.length > MAX_TEXT)) {
      throw new PayloadError(`${label}.${field} must be an array of strings.`);
    }
    return raw.map(item => String(item));
  };
  return {
    upsGroups: groups.map((group, index) => asStringList(group, `upsGroups[${index}]`)),
    dcIds: asStringList(input.dcIds, "dcIds"),
    airFields: asStringList(input.airFields, "airFields")
  };
}

function validateInputSnapshot(value: unknown, label: string): SrinakarinInputSnapshot | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new PayloadError(`${label} must be an object.`);
  const input = value as Record<string, unknown>;
  const upsPhase = validatePhaseMap(input.upsPhase, `${label}.upsPhase`) ?? {};
  const acPhaseRaw = input.acPhase;
  const acPhase: Record<string, { voltage: number | null; current: number | null }> = {};
  if (acPhaseRaw !== null && acPhaseRaw !== undefined) {
    if (typeof acPhaseRaw !== "object" || Array.isArray(acPhaseRaw)) throw new PayloadError(`${label}.acPhase must be an object.`);
    for (const [key, raw] of Object.entries(acPhaseRaw as Record<string, unknown>)) {
      const item = (raw ?? {}) as Record<string, unknown>;
      acPhase[key] = {
        voltage: asNumberOrNull(item.voltage, `${label}.acPhase.${key}.voltage`),
        current: asNumberOrNull(item.current, `${label}.acPhase.${key}.current`)
      };
    }
  }
  const ppc43Current = validateMeterMap(input.ppc43Current, `${label}.ppc43Current`) ?? {};
  const ppc43PanelRaw = input.ppc43Panel;
  const ppc43Panel: Record<string, { loadKw: number | null; loadKva: number | null }> = {};
  if (ppc43PanelRaw !== null && ppc43PanelRaw !== undefined) {
    if (typeof ppc43PanelRaw !== "object" || Array.isArray(ppc43PanelRaw)) throw new PayloadError(`${label}.ppc43Panel must be an object.`);
    for (const [key, raw] of Object.entries(ppc43PanelRaw as Record<string, unknown>)) {
      const item = (raw ?? {}) as Record<string, unknown>;
      ppc43Panel[key] = {
        loadKw: asNumberOrNull(item.loadKw, `${label}.ppc43Panel.${key}.loadKw`),
        loadKva: asNumberOrNull(item.loadKva, `${label}.ppc43Panel.${key}.loadKva`)
      };
    }
  }
  return { upsPhase, acPhase, ppc43Current, ppc43Panel };
}

export function validateLogsPayload(payload: unknown): MonthlyLog[] {
  if (!Array.isArray(payload)) throw new PayloadError("Logs payload must be an array.");
  if (payload.length > MAX_MONTHS) throw new PayloadError("Logs payload is unreasonably large.");

  const seenMonths = new Set<string>();
  const logs: MonthlyLog[] = [];

  for (const item of payload) {
    if (typeof item !== "object" || item === null) throw new PayloadError("Each log must be an object.");
    const raw = item as Record<string, unknown>;

    const month = asShortString(raw.month, "month");
    if (!MONTH_RE.test(month)) throw new PayloadError(`Invalid month "${month}" (expected YYYY-MM).`);
    if (seenMonths.has(month)) throw new PayloadError(`Duplicate month "${month}" in payload.`);
    seenMonths.add(month);

    if (!Array.isArray(raw.ups) || raw.ups.length > 50) throw new PayloadError(`ups must be an array (month ${month}).`);
    const ups: UpsRecord[] = raw.ups.map((u, i) => {
      const rec = (u ?? {}) as Record<string, unknown>;
      const phases = validatePhaseMap(rec.phases, `ups[${i}].phases`);
      return {
        upsId: asShortString(rec.upsId, `ups[${i}].upsId`),
        voltage: asNumberOrNull(rec.voltage, `ups[${i}].voltage`),
        current: asNumberOrNull(rec.current, `ups[${i}].current`),
        loadKw: asNumberOrNull(rec.loadKw, `ups[${i}].loadKw`),
        loadKva: asNumberOrNull(rec.loadKva, `ups[${i}].loadKva`),
        ...(phases ? { phases } : {})
      };
    });

    const airRaw = (raw.air ?? {}) as Record<string, unknown>;
    const meters = validateMeterMap(airRaw.meters, `air.meters`);
    const air: AirRecord = {
      eb41a: asNumberOrNull(airRaw.eb41a, "air.eb41a"),
      eb41b: asNumberOrNull(airRaw.eb41b, "air.eb41b"),
      eb42a: asNumberOrNull(airRaw.eb42a, "air.eb42a"),
      eb42b: asNumberOrNull(airRaw.eb42b, "air.eb42b"),
      eb43a: asNumberOrNull(airRaw.eb43a, "air.eb43a"),
      eb43b: asNumberOrNull(airRaw.eb43b, "air.eb43b"),
      eb44a: asNumberOrNull(airRaw.eb44a, "air.eb44a"),
      eb44b: asNumberOrNull(airRaw.eb44b, "air.eb44b"),
      ...(meters ? { meters } : {})
    };

    if (!Array.isArray(raw.dc) || raw.dc.length > 50) throw new PayloadError(`dc must be an array (month ${month}).`);
    const dc: DcRecord[] = raw.dc.map((d, i) => {
      const rec = (d ?? {}) as Record<string, unknown>;
      return {
        panelId: asShortString(rec.panelId, `dc[${i}].panelId`),
        voltage: asNumberOrNull(rec.voltage, `dc[${i}].voltage`),
        current: asNumberOrNull(rec.current, `dc[${i}].current`)
      };
    });

    const energyRaw = (raw.energyCost ?? {}) as Record<string, unknown>;
    const energyCost: EnergyCostRecord = {
      buildingEnergyKwh: asNumberOrNull(energyRaw.buildingEnergyKwh, "energyCost.buildingEnergyKwh"),
      buildingElectricityCostThb: asNumberOrNull(energyRaw.buildingElectricityCostThb, "energyCost.buildingElectricityCostThb")
    };

    const energyCalculation = validateCalculationProfile(raw.energyCalculation, `energyCalculation`);
    const srinakarinInputs = validateInputSnapshot(raw.srinakarinInputs, `srinakarinInputs`);
    logs.push({
      month,
      ups,
      air,
      dc,
      energyCost,
      lastSavedUps: asShortStringOrNull(raw.lastSavedUps, "lastSavedUps"),
      lastSavedAir: asShortStringOrNull(raw.lastSavedAir, "lastSavedAir"),
      lastSavedDc: asShortStringOrNull(raw.lastSavedDc, "lastSavedDc"),
      lastSavedEnergyCost: asShortStringOrNull(raw.lastSavedEnergyCost, "lastSavedEnergyCost"),
      ...(energyCalculation ? { energyCalculation } : {}),
      ...(srinakarinInputs ? { srinakarinInputs } : {})
    });
  }

  return logs;
}

export type { WorkbookValidation, ExcelIntegrityReport };
