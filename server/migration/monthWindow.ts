import type { MigrationSource } from "./types";

function isWithinMonthWindow(month: string, startMonth?: string, endMonth?: string): boolean {
  return (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth);
}

/**
 * Keep only the selected reporting-month window for a controlled import.
 * Current-state rack snapshots and attachments outside the window are omitted
 * so an incremental historical import cannot collide with already-live rows.
 */
export function filterMigrationSourceToMonthWindow(source: MigrationSource, startMonth?: string, endMonth?: string): MigrationSource {
  if (!startMonth && !endMonth) return source;
  const keep = (month: string) => isWithinMonthWindow(month, startMonth, endMonth);
  return {
    ...source,
    logs: source.logs.filter(log => keep(log.month)),
    cachedEvidence: source.cachedEvidence.filter(entry => keep(entry.month)),
    sourceLocationsByMonth: Object.fromEntries(Object.entries(source.sourceLocationsByMonth).filter(([month]) => keep(month))),
    rackCapacitySnapshot: source.rackCapacitySnapshot && keep(source.rackCapacitySnapshot.month) ? source.rackCapacitySnapshot : null,
    rackCapacityHistoryRows: source.rackCapacityHistoryRows.filter(row => keep(row.snapshotMonth)),
    rackUnitCapacityRows: source.rackUnitCapacityRows.filter(row => keep(row.month)),
    upsGroupHistoryRows: source.upsGroupHistoryRows.filter(row => keep(row.month)),
    rackUnitCapacityImages: source.rackUnitCapacityImages?.filter(image => keep(image.reportingMonth))
  };
}
