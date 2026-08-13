import type { DomainRackUnitCapacityRow } from "./types";

export function findPreviousRackUnitCapacityRow<T extends DomainRackUnitCapacityRow>(rows: readonly T[], month: string): T | null {
  const prior = rows.filter(row => row.month < month).sort((a, b) => a.month.localeCompare(b.month));
  return prior.length > 0 ? prior[prior.length - 1] : null;
}
export function usagePercent(row: Pick<DomainRackUnitCapacityRow, "usedU" | "totalU">): number | null {
  return row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null;
}
