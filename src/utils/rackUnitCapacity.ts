import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";

/** The latest Rack Unit Capacity row strictly before `month`, or null if
 *  none exists. Shared by the Dashboard executive summary
 *  (RackUnitCapacitySummary.tsx) and the Export All Report PDF
 *  (reportHtml.ts) so "previous month" can never drift between the two
 *  surfaces - single source of truth for this lookup. */
export function findPreviousRackUnitCapacityRow(rows: RackUnitCapacityRow[], month: string): RackUnitCapacityRow | null {
  const prior = rows.filter(row => row.month < month).sort((a, b) => a.month.localeCompare(b.month));
  return prior.length > 0 ? prior[prior.length - 1] : null;
}

/** Used/Total as a 0-100 percentage, or null when Total is 0 - the same
 *  guarded division the Dashboard's own usage-percent calculations use. */
export function usagePercent(row: Pick<RackUnitCapacityRow, "usedU" | "totalU">): number | null {
  return row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null;
}
