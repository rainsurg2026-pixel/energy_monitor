import type { DomainRackRecord } from "./types";

export const RACK_CANONICAL_STATUSES = ["In Use", "Available", "Reserved", "Pending Dismantle"] as const;
export type RackCanonicalStatus = (typeof RACK_CANONICAL_STATUSES)[number];

/** Production Rack Capacity uses these explicit utilization bands for both
 * zone badges and the operator-facing tooltip. Keep the boundary semantics
 * here so the dashboard and focused tests cannot drift apart. */
export const RACK_UTILIZATION_THRESHOLDS = Object.freeze({ attention: 80, high: 85 });
export type RackUtilizationLevel = "Normal" | "Attention" | "High";

export type RackEditableField = "status" | "cabinetSize" | "detail" | "deviceType" | "remarks";

/** Keep UI typography (the multiplication sign) separate from the stored
 * Rack Capacity value. This makes a display-only edit a true no-op. */
export function normalizeRackEditableValue(field: RackEditableField, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  return field === "cabinetSize" ? trimmed.replace(/\s*[×x*]\s*/giu, "*") : trimmed;
}

export function formatRackCabinetSize(value: string | null | undefined): string {
  const normalized = normalizeRackEditableValue("cabinetSize", value);
  return normalized?.replace(/(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/, "$1 × $2") ?? "—";
}

export function rackUtilizationLevel(percent: number | null): RackUtilizationLevel {
  if (percent === null || !Number.isFinite(percent) || percent < RACK_UTILIZATION_THRESHOLDS.attention) return "Normal";
  return percent < RACK_UTILIZATION_THRESHOLDS.high ? "Attention" : "High";
}

export interface RackStatusRatio { count: number; ratio: number | null; }
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
function ratio(count: number, denominator: number): number | null { return denominator > 0 ? count / denominator : null; }

function statusBreakdown(records: DomainRackRecord[], denominator: number) {
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

export function calculateRackCapacityMetrics(records: readonly DomainRackRecord[]): RackCapacityMetrics {
  const total = records.length;
  const facility = statusBreakdown([...records], total);
  const byZone = new Map<string, DomainRackRecord[]>();
  for (const record of records) {
    const zone = record.rackZone ?? "(blank)";
    const list = byZone.get(zone) ?? [];
    list.push(record);
    byZone.set(zone, list);
  }
  const zoneMetrics: RackZoneMetrics[] = Array.from(byZone.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone, zoneRecords]) => ({ zone, total: zoneRecords.length, ...statusBreakdown(zoneRecords, zoneRecords.length) }));
  return { total, ...facility, zoneMetrics };
}

export function formatRatioPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function clampRatio(ratioValue: number | null): number {
  if (ratioValue === null || !Number.isFinite(ratioValue)) return 0;
  return Math.max(0, Math.min(1, ratioValue));
}

export type RackDisplayStatus = "In Use" | "Available" | "Reserved" | "Pending Dismantle" | "Other";
export function statusRatio(m: RackCapacityMetrics | RackZoneMetrics, status: RackDisplayStatus): RackStatusRatio {
  switch (status) {
    case "In Use": return m.inUse;
    case "Available": return m.available;
    case "Reserved": return m.reserved;
    case "Pending Dismantle": return m.pendingDismantle;
    case "Other": return m.other;
  }
}
