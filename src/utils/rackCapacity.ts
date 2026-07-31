import type { RackRecord } from "../reports/reportTypes";

export const RACK_CANONICAL_STATUSES = ["In Use", "Available", "Reserved", "Pending Dismantle"] as const;
export type RackCanonicalStatus = (typeof RACK_CANONICAL_STATUSES)[number];

/** A single status's count plus its share of the given denominator, stored
 *  as a 0-1 fraction (never a 0-100 number) - format at render time only. */
export interface RackStatusRatio {
  count: number;
  ratio: number | null;
}

export interface RackZoneMetrics {
  zone: string;
  total: number;
  countsByStatus: Record<string, number>;
  inUse: RackStatusRatio;
  available: RackStatusRatio;
  reserved: RackStatusRatio;
  pendingDismantle: RackStatusRatio;
  other: RackStatusRatio;
}

export interface RackCapacityMetrics {
  total: number;
  countsByStatus: Record<string, number>;
  inUse: RackStatusRatio;
  available: RackStatusRatio;
  reserved: RackStatusRatio;
  pendingDismantle: RackStatusRatio;
  other: RackStatusRatio;
  zoneMetrics: RackZoneMetrics[];
}

function ratio(count: number, denominator: number): number | null {
  return denominator > 0 ? count / denominator : null;
}

function statusBreakdown(records: RackRecord[], denominator: number): {
  countsByStatus: Record<string, number>;
  inUse: RackStatusRatio;
  available: RackStatusRatio;
  reserved: RackStatusRatio;
  pendingDismantle: RackStatusRatio;
  other: RackStatusRatio;
} {
  const countsByStatus: Record<string, number> = {};
  let otherCount = 0;
  for (const record of records) {
    const status = record.status ?? "(blank)";
    countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;
    if (!RACK_CANONICAL_STATUSES.includes(status as RackCanonicalStatus)) otherCount++;
  }
  const countOf = (status: RackCanonicalStatus) => countsByStatus[status] ?? 0;
  return {
    countsByStatus,
    inUse: { count: countOf("In Use"), ratio: ratio(countOf("In Use"), denominator) },
    available: { count: countOf("Available"), ratio: ratio(countOf("Available"), denominator) },
    reserved: { count: countOf("Reserved"), ratio: ratio(countOf("Reserved"), denominator) },
    pendingDismantle: { count: countOf("Pending Dismantle"), ratio: ratio(countOf("Pending Dismantle"), denominator) },
    other: { count: otherCount, ratio: ratio(otherCount, denominator) }
  };
}

/** The single authoritative Rack Capacity calculation. Every consumer (cards,
 *  zone table, donut, history snapshot, PDF) must call this rather than
 *  re-deriving counts/ratios independently, so a single fix here fixes every
 *  view at once. Ratios are always 0-1 fractions or null (never 0-100, never
 *  NaN/Infinity) - callers format for display. */
export function calculateRackCapacityMetrics(records: RackRecord[]): RackCapacityMetrics {
  const total = records.length;
  const facility = statusBreakdown(records, total);

  const byZone = new Map<string, RackRecord[]>();
  for (const record of records) {
    const zone = record.rackZone ?? "(blank)";
    const list = byZone.get(zone) ?? [];
    list.push(record);
    byZone.set(zone, list);
  }
  const zoneMetrics: RackZoneMetrics[] = Array.from(byZone.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone, zoneRecords]) => ({
      zone,
      total: zoneRecords.length,
      ...statusBreakdown(zoneRecords, zoneRecords.length)
    }));

  return { total, ...facility, zoneMetrics };
}

/** `0.919831` -> `"91.98%"`. Never pass an already-scaled 0-100 number here. */
export function formatRatioPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}
