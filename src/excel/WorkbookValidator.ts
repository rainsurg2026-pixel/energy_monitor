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

import { AirRecord, DcRecord, EnergyCostRecord, MonthlyLog, UpsRecord } from "../types";
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
      return {
        upsId: asShortString(rec.upsId, `ups[${i}].upsId`),
        voltage: asNumberOrNull(rec.voltage, `ups[${i}].voltage`),
        current: asNumberOrNull(rec.current, `ups[${i}].current`),
        loadKw: asNumberOrNull(rec.loadKw, `ups[${i}].loadKw`),
        loadKva: asNumberOrNull(rec.loadKva, `ups[${i}].loadKva`)
      };
    });

    const airRaw = (raw.air ?? {}) as Record<string, unknown>;
    const air: AirRecord = {
      eb41a: asNumberOrNull(airRaw.eb41a, "air.eb41a"),
      eb41b: asNumberOrNull(airRaw.eb41b, "air.eb41b"),
      eb42a: asNumberOrNull(airRaw.eb42a, "air.eb42a"),
      eb42b: asNumberOrNull(airRaw.eb42b, "air.eb42b")
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

    logs.push({
      month,
      ups,
      air,
      dc,
      energyCost,
      lastSavedUps: asShortStringOrNull(raw.lastSavedUps, "lastSavedUps"),
      lastSavedAir: asShortStringOrNull(raw.lastSavedAir, "lastSavedAir"),
      lastSavedDc: asShortStringOrNull(raw.lastSavedDc, "lastSavedDc"),
      lastSavedEnergyCost: asShortStringOrNull(raw.lastSavedEnergyCost, "lastSavedEnergyCost")
    });
  }

  return logs;
}

export type { WorkbookValidation, ExcelIntegrityReport };
