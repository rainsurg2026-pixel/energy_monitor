import type { MonthlyLog } from "../types";
import { daysInLocalMonthOr30 } from "./dates";

export interface UpsGroupConfig { name: string; ids: string[]; capacity: number | null; }

export interface UpsGroupSummaryRow {
  name: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
}
function normalizeUpsId(id: string): string { return id.replace(/\s+/g, "").toLowerCase(); }

/** Formula matches Dashboard Summary's UPS table exactly. */
export function computeUpsGroupSummary(log: MonthlyLog, upsGroups: UpsGroupConfig[]): UpsGroupSummaryRow[] {
  const daysInMonth = daysInLocalMonthOr30(log.month);
  return upsGroups.map(group => {
    const targetIds = new Set(group.ids.map(normalizeUpsId));
    const members = log.ups.filter(u => targetIds.has(normalizeUpsId(u.upsId)));
    const totalLoadKw = members.reduce((sum, u) => sum + (u.loadKw ?? 0), 0);
    const totalLoadKva = members.reduce((sum, u) => sum + (u.loadKva ?? 0), 0);
    const loadPercent = group.capacity !== null && group.capacity > 0 ? (totalLoadKva / group.capacity) * 100 : null;
    const availablePercent = loadPercent === null ? null : Math.max(0, 100 - loadPercent);
    return { name: group.name, totalLoadKw, totalLoadKva, capacity: group.capacity, loadPercent, availablePercent, monthlyEnergyKwh: totalLoadKw * 24 * daysInMonth };
  });
}
