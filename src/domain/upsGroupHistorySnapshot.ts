import type { MonthlyLog } from "../types";
import { computeUpsGroupSummary } from "./upsGroupAggregation";
import { getUpsGroupTopology } from "./upsGroupTopology";

export interface UpsGroupHistorySnapshotRow {
  month: string;
  group: string;
  totalLoadKw: number;
  totalLoadKva: number;
  capacity: number | null;
  loadPercent: number | null;
  availablePercent: number | null;
  monthlyEnergyKwh: number;
}

/**
 * The real "2. UPS Group History" row set for one already-saved month,
 * computed with the exact same shared formula Desktop uses to generate
 * that persisted sheet (computeUpsGroupSummary) - never a simplified or
 * invented Web-only calculation. Returns null when the facility has no
 * known UPS group topology, so callers never fabricate a row set for a
 * facility this module doesn't recognize.
 */
export function computeUpsGroupHistorySnapshot(facilityCode: string, log: MonthlyLog): UpsGroupHistorySnapshotRow[] | null {
  const topology = getUpsGroupTopology(facilityCode);
  if (!topology || topology.length === 0) return null;
  return computeUpsGroupSummary(log, topology).map(row => ({
    month: log.month,
    group: row.name,
    totalLoadKw: row.totalLoadKw,
    totalLoadKva: row.totalLoadKva,
    capacity: row.capacity,
    loadPercent: row.loadPercent,
    availablePercent: row.availablePercent,
    monthlyEnergyKwh: row.monthlyEnergyKwh
  }));
}
