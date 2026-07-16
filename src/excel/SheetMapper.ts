/**
 * SheetMapper - converts between the app's MonthlyLog domain model and the
 * flat per-sheet row shape used by the workbook, plus the device-ID matching
 * rules shared with the Google Sheets sync (duplicated here because this
 * module runs in the Electron main process, where renderer modules with
 * browser dependencies cannot be imported).
 */

import { MonthlyLog, UpsRecord, DcRecord } from "../types";
import { FieldId, TabKey } from "./ExcelSchema";

export const DEFAULT_UPS_IDS = [
  "UPS 11A",
  "UPS 11B",
  "UPS 13A",
  "UPS 13B",
  "UPS 14C",
  "UPS 15A (PPC44A)",
  "UPS 15B (PPC44B)"
];

export const DEFAULT_DC_IDS = ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"];

export function matchUpsId(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ca = String(a).replace(/\s+/g, "").toLowerCase();
  const cb = String(b).replace(/\s+/g, "").toLowerCase();
  if (ca === cb) return true;
  for (const unit of ["ups11a", "ups11b", "ups13a", "ups13b", "ups14c", "ups15a", "ups15b"]) {
    if (ca.includes(unit) && cb.includes(unit)) return true;
  }
  return ca.includes(cb) || cb.includes(ca);
}

export function matchDcId(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ca = String(a).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const cb = String(b).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (ca === cb) return true;
  return ca.includes(cb) || cb.includes(ca);
}

export function parseSafeNumber(val: unknown): number | null {
  if (val === "" || val === undefined || val === null) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const str = String(val).replace(/,/g, "").trim();
  if (str === "") return null;
  const num = Number(str);
  return isNaN(num) ? null : num;
}

/** One parsed data row: canonical month + field values. */
export interface SheetRow {
  month: string; // YYYY-MM
  values: Partial<Record<FieldId, string | number | null>>;
}

export function createEmptyLog(month: string): MonthlyLog {
  return {
    month,
    ups: DEFAULT_UPS_IDS.map(id => ({
      upsId: id,
      voltage: null,
      current: null,
      loadKw: null,
      loadKva: null
    })),
    air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null },
    dc: DEFAULT_DC_IDS.map(id => ({ panelId: id, voltage: null, current: null })),
    energyCost: { buildingEnergyKwh: null, buildingElectricityCostThb: null },
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null
  };
}

/**
 * Merge parsed rows of all four tabs into MonthlyLog[]. Unknown device rows
 * are ignored (reported upstream by the integrity report); missing devices
 * stay at their null defaults.
 */
export function rowsToLogs(rowsByTab: Record<TabKey, SheetRow[]>): MonthlyLog[] {
  const logs = new Map<string, MonthlyLog>();
  const getLog = (month: string): MonthlyLog => {
    let log = logs.get(month);
    if (!log) {
      log = createEmptyLog(month);
      logs.set(month, log);
    }
    return log;
  };

  for (const row of rowsByTab.UPS) {
    const log = getLog(row.month);
    const rawId = String(row.values.deviceId ?? "");
    const target = log.ups.find(u => matchUpsId(u.upsId, rawId));
    if (!target) continue;
    target.voltage = parseSafeNumber(row.values.voltage);
    target.current = parseSafeNumber(row.values.current);
    target.loadKw = parseSafeNumber(row.values.loadKw);
    target.loadKva = parseSafeNumber(row.values.loadKva);
    if (row.values.timestamp) log.lastSavedUps = String(row.values.timestamp);
  }

  for (const row of rowsByTab.AIR) {
    const log = getLog(row.month);
    log.air = {
      eb41a: parseSafeNumber(row.values.eb41a),
      eb41b: parseSafeNumber(row.values.eb41b),
      eb42a: parseSafeNumber(row.values.eb42a),
      eb42b: parseSafeNumber(row.values.eb42b)
    };
    if (row.values.timestamp) log.lastSavedAir = String(row.values.timestamp);
  }

  for (const row of rowsByTab.DC) {
    const log = getLog(row.month);
    const rawId = String(row.values.deviceId ?? "");
    const target = log.dc.find(d => matchDcId(d.panelId, rawId));
    if (!target) continue;
    target.voltage = parseSafeNumber(row.values.voltage);
    target.current = parseSafeNumber(row.values.current);
    if (row.values.timestamp) log.lastSavedDc = String(row.values.timestamp);
  }

  for (const row of rowsByTab.ENERGY) {
    const log = getLog(row.month);
    log.energyCost = {
      buildingEnergyKwh: parseSafeNumber(row.values.buildingEnergyKwh),
      buildingElectricityCostThb: parseSafeNumber(row.values.buildingElectricityCostThb)
    };
    if (row.values.timestamp) log.lastSavedEnergyCost = String(row.values.timestamp);
  }

  return Array.from(logs.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Expand MonthlyLog[] to the flat row lists the writer emits, in canonical
 * order (months ascending; devices in their canonical order).
 */
export function logsToRows(logs: MonthlyLog[]): Record<TabKey, SheetRow[]> {
  const sorted = [...logs].sort((a, b) => a.month.localeCompare(b.month));
  const result: Record<TabKey, SheetRow[]> = { UPS: [], AIR: [], DC: [], ENERGY: [] };

  for (const log of sorted) {
    const orderedUps: UpsRecord[] = DEFAULT_UPS_IDS.map(
      id =>
        log.ups.find(u => matchUpsId(u.upsId, id)) ?? {
          upsId: id,
          voltage: null,
          current: null,
          loadKw: null,
          loadKva: null
        }
    );
    for (const ups of orderedUps) {
      result.UPS.push({
        month: log.month,
        values: {
          deviceId: ups.upsId,
          voltage: ups.voltage,
          current: ups.current,
          loadKw: ups.loadKw,
          loadKva: ups.loadKva,
          timestamp: log.lastSavedUps
        }
      });
    }

    result.AIR.push({
      month: log.month,
      values: {
        eb41a: log.air.eb41a,
        eb41b: log.air.eb41b,
        eb42a: log.air.eb42a,
        eb42b: log.air.eb42b,
        timestamp: log.lastSavedAir
      }
    });

    const orderedDc: DcRecord[] = DEFAULT_DC_IDS.map(
      id => log.dc.find(d => matchDcId(d.panelId, id)) ?? { panelId: id, voltage: null, current: null }
    );
    for (const dc of orderedDc) {
      result.DC.push({
        month: log.month,
        values: {
          deviceId: dc.panelId,
          voltage: dc.voltage,
          current: dc.current,
          timestamp: log.lastSavedDc
        }
      });
    }

    result.ENERGY.push({
      month: log.month,
      values: {
        buildingEnergyKwh: log.energyCost.buildingEnergyKwh,
        buildingElectricityCostThb: log.energyCost.buildingElectricityCostThb,
        timestamp: log.lastSavedEnergyCost
      }
    });
  }

  return result;
}

/**
 * Row identity used to carry unmanaged ("extra") cells across a rewrite.
 * Device IDs are reduced to their unit token so "UPS 15A (PPC44A)" and
 * "UPS 15A" produce the same key.
 */
export function rowKey(tab: TabKey, month: string, deviceId?: string | null): string {
  if (tab === "UPS" || tab === "DC") {
    const clean = String(deviceId ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (tab === "UPS") {
      const unit = clean.match(/ups(\d{2}[a-c])/);
      if (unit) return `${month}|ups${unit[1]}`;
    } else {
      const unit = clean.match(/pdb(\d+[a-b])/);
      if (unit) return `${month}|pdb${unit[1]}`;
    }
    return `${month}|${clean}`;
  }
  return month;
}
