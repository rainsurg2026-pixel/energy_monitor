/**
 * Single aggregation implementation for "UPS Group" summaries (Total Load
 * kW/kVA, Capacity, Load %, Available %, Monthly Energy). Used by UPS Group
 * History persistence (src/excel/UpsGroupHistoryWriter.ts) so the workbook's
 * permanent history and any other consumer never calculate these values
 * independently - there is exactly one formula, here.
 */
import { MonthlyLog } from "../types";

export interface UpsGroupConfig {
  name: string;
  ids: string[];
  capacity: number | null;
}

export interface UpsGroupSummaryRow {
  name: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
}

function normalizeUpsId(id: string): string {
  return id.replace(/\s+/g, "").toLowerCase();
}

function getDaysInMonth(monthStr: string): number {
  const [yearStr, monthPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthPart, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 30;
  return new Date(year, month, 0).getDate();
}

/** Groups one month's raw UPS/PPC records into the facility's configured UPS
 *  Groups. Formula matches Dashboard Summary's UPS table exactly: monthly
 *  energy = totalKw * 24 * daysInMonth; load% = totalKva / capacity * 100. */
export function computeUpsGroupSummary(log: MonthlyLog, upsGroups: UpsGroupConfig[]): UpsGroupSummaryRow[] {
  const daysInMonth = getDaysInMonth(log.month);
  return upsGroups.map(group => {
    const targetIds = new Set(group.ids.map(normalizeUpsId));
    const members = log.ups.filter(u => targetIds.has(normalizeUpsId(u.upsId)));
    const totalLoadKw = members.reduce((sum, u) => sum + (u.loadKw ?? 0), 0);
    const totalLoadKva = members.reduce((sum, u) => sum + (u.loadKva ?? 0), 0);
    const loadPercent = group.capacity !== null && group.capacity > 0 ? (totalLoadKva / group.capacity) * 100 : null;
    const availablePercent = loadPercent === null ? null : Math.max(0, 100 - loadPercent);
    return {
      name: group.name,
      totalLoadKw,
      totalLoadKva,
      capacity: group.capacity,
      loadPercent,
      availablePercent,
      monthlyEnergyKwh: totalLoadKw * 24 * daysInMonth
    };
  });
}
