import type { RackCapacitySummary } from "../reports/reportTypes";
import type { RackApiSnapshot } from "./WebRackCapacityEditors";

/** Keep analytical metrics and the Data Entry summary on the same row draft. */
export function rackSummaryFromSnapshot(snapshot: RackApiSnapshot | null): RackCapacitySummary | null {
  if (!snapshot) return null;
  const byStatus = new Map<string, number>();
  const byZone = new Map<string, number>();
  const records = snapshot.records.map(record => {
    const zone = record.rackZone ?? "(blank)";
    const status = record.status ?? "(blank)";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    return { ...record, rowNumber: record.rowNumber ?? 0 };
  });
  return { totalRacks: records.length, records, byStatus: Array.from(byStatus, ([status, count]) => ({ status, count })), byZone: Array.from(byZone, ([zone, count]) => ({ zone, count })) };
}
