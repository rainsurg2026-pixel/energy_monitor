import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { findPreviousRackUnitCapacityRow as findPreviousDomainRow, usagePercent as domainUsagePercent } from "../domain/rackUnitCapacity";

export function findPreviousRackUnitCapacityRow(rows: RackUnitCapacityRow[], month: string): RackUnitCapacityRow | null {
  return findPreviousDomainRow(rows, month);
}

export function usagePercent(row: Pick<RackUnitCapacityRow, "usedU" | "totalU">): number | null {
  return domainUsagePercent(row);
}
