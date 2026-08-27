import type { RackCapacityMetrics } from "./rackCapacity";

/**
 * Availability status used by the cross-site Rack comparison.  The 20% Ready
 * boundary is an explicit presentation assumption: a location with some
 * physical space below that level is Limited, while zero space is Full.
 * Missing snapshots are handled by the caller and are never passed here as a
 * fabricated zero.
 */
export const RACK_AVAILABILITY_READY_RATIO = 0.2;
export type RackAvailabilityStatus = "Ready" | "Limited" | "Full";

export function rackAvailabilityStatus(available: number | null, total: number | null): RackAvailabilityStatus {
  if (available === null || total === null || !Number.isFinite(available) || !Number.isFinite(total) || total <= 0 || available <= 0) return "Full";
  return available / total >= RACK_AVAILABILITY_READY_RATIO ? "Ready" : "Limited";
}

export function rackCountsReconcile(metrics: Pick<RackCapacityMetrics, "total" | "inUse" | "available" | "reserved" | "pendingDismantle" | "other">): boolean {
  return metrics.total === metrics.inUse.count + metrics.available.count + metrics.reserved.count + metrics.pendingDismantle.count + metrics.other.count;
}

export interface RackLocationForRanking {
  siteId: number;
  siteName: string;
  siteOrder: number;
  zone: string;
  available: number;
}

export interface RankedRackLocation extends RackLocationForRanking { rank: number; }

/** Rank physical rack positions only; power, cooling and U capacity are not
 * implied. Site order is supplied by the caller so the tie-break is stable in
 * both PostgreSQL and in-memory test repositories. */
export function rankRackLocations(locations: readonly RackLocationForRanking[]): RankedRackLocation[] {
  return [...locations]
    .sort((left, right) => right.available - left.available || left.siteOrder - right.siteOrder || left.zone.localeCompare(right.zone) || left.siteId - right.siteId)
    .map((location, index) => ({ ...location, rank: index + 1 }));
}

export function isValidRackUnitCapacity(totalU: number, usedU: number): boolean {
  return Number.isFinite(totalU) && Number.isFinite(usedU) && totalU >= 0 && usedU >= 0 && usedU <= totalU;
}
