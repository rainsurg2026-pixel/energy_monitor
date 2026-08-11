import type { RackCapacityReport, RackRecord } from "./reportTypes";

const REQUIRED_FIELDS = ["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"] as const;
const VALID_STATUSES = new Set(["In Use", "Available", "Reserved", "Pending Dismantle"]);

function increment(map: Map<string, number>, value: string | null): void {
  const key = value && value.trim() !== "" ? value.trim() : "(blank)";
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): Array<{ [key: string]: string | number }> {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, count }));
}

/** The single authoritative computation of a RackCapacityReport's derived
 *  fields (byZone/byStatus/byCabinetSize/byDeviceType/validation) from an
 *  already-parsed record list - shared by rackCapacityReader.ts's Excel
 *  reader (Desktop) and API/DB-sourced callers (Web), so the grouping/
 *  validation rules are defined once regardless of where the records came
 *  from. Deliberately has no ExcelJS dependency, so importing it (e.g. for
 *  the Web export bundle) never pulls in the Excel library.
 *  invalidDataTypes is Excel-cell-specific (a raw cell holding an
 *  unexpected object type) and does not apply to already-typed records
 *  from an API/DB source - callers without an Excel buffer pass []. */
export function deriveRackCapacityReport(records: RackRecord[], sourceSheet: string, sourceTable: string, sourceSnapshot: string | null, invalidDataTypes: Array<{ rowNumber: number; field: string; type: string }> = []): RackCapacityReport {
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  const missingRequiredFields: Array<{ rowNumber: number; field: string }> = [];
  const invalidStatuses: Array<{ rowNumber: number; status: string }> = [];
  const byZone = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byCabinetSize = new Map<string, number>();
  const byDeviceType = new Map<string, number>();

  for (const record of records) {
    for (const field of REQUIRED_FIELDS) {
      const value = record[field === "Rack Zone" ? "rackZone" : field === "Rack ID" ? "rackId" : field === "Status" ? "status" : field === "Cabinet Size" ? "cabinetSize" : field === "Detail" ? "detail" : field === "Device Type" ? "deviceType" : "remarks"];
      if (value === null) missingRequiredFields.push({ rowNumber: record.rowNumber, field });
    }
    if (record.rackId) {
      const normalizedId = record.rackId.toLowerCase();
      if (seenIds.has(normalizedId)) duplicateIds.add(record.rackId);
      seenIds.add(normalizedId);
    }
    if (record.status && !VALID_STATUSES.has(record.status)) invalidStatuses.push({ rowNumber: record.rowNumber, status: record.status });
    increment(byZone, record.rackZone);
    increment(byStatus, record.status);
    increment(byCabinetSize, record.cabinetSize);
    increment(byDeviceType, record.deviceType);
  }

  const toNamedCounts = (map: Map<string, number>, key: string): Array<{ [key: string]: string | number }> =>
    sortedCounts(map).map(item => ({ [key]: item.key, count: item.count }));

  return {
    sourceSheet,
    sourceTable,
    sourceSnapshot,
    records,
    byZone: toNamedCounts(byZone, "zone") as Array<{ zone: string; count: number }>,
    byStatus: toNamedCounts(byStatus, "status") as Array<{ status: string; count: number }>,
    byCabinetSize: toNamedCounts(byCabinetSize, "cabinetSize") as Array<{ cabinetSize: string; count: number }>,
    byDeviceType: toNamedCounts(byDeviceType, "deviceType") as Array<{ deviceType: string; count: number }>,
    validation: {
      duplicateIds: Array.from(duplicateIds).sort(),
      missingRequiredFields,
      invalidStatuses,
      invalidDataTypes,
      unsupportedUMetrics: [
        "Total U",
        "Used U",
        "Available U",
        "Reserved U",
        "Overall Rack Utilization"
      ]
    }
  };
}
