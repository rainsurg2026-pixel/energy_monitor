import type { UpsGroupHistoryRow } from "../../src/reports/reportTypes";

export interface CanonicalUpsGroupHistoryRows {
  rows: UpsGroupHistoryRow[];
  duplicateKeys: string[];
  conflictingKeys: string[];
}

export function upsGroupHistoryKey(row: Pick<UpsGroupHistoryRow, "facility" | "month" | "group">): string {
  return `${row.facility.trim().toLowerCase()}\u0000${row.month.trim()}\u0000${row.group.trim().toLowerCase()}`;
}

function sameValues(left: UpsGroupHistoryRow, right: UpsGroupHistoryRow): boolean {
  return left.totalLoadKw === right.totalLoadKw
    && left.totalLoadKva === right.totalLoadKva
    && left.capacity === right.capacity
    && left.loadPercent === right.loadPercent
    && left.availablePercent === right.availablePercent
    && left.monthlyEnergyKwh === right.monthlyEnergyKwh;
}

function generatedAtMs(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * PostgreSQL intentionally keys UPS history by (site, month, group), while
 * old Desktop workbooks can contain repeated snapshots of the same values
 * with different Generated Timestamps. Keep the newest identical snapshot,
 * but fail closed for a same-key value conflict instead of silently dropping
 * an engineering reading during import.
 */
export function canonicalizeUpsGroupHistoryRows(rows: readonly UpsGroupHistoryRow[]): CanonicalUpsGroupHistoryRows {
  const byKey = new Map<string, UpsGroupHistoryRow>();
  const duplicateKeys = new Set<string>();
  const conflictingKeys = new Set<string>();
  for (const row of rows) {
    const key = upsGroupHistoryKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    duplicateKeys.add(key);
    if (!sameValues(existing, row)) {
      conflictingKeys.add(key);
      continue;
    }
    if (generatedAtMs(row.generatedAt) >= generatedAtMs(existing.generatedAt)) byKey.set(key, row);
  }
  return {
    rows: [...byKey.values()].sort((left, right) => upsGroupHistoryKey(left).localeCompare(upsGroupHistoryKey(right))),
    duplicateKeys: [...duplicateKeys].sort(),
    conflictingKeys: [...conflictingKeys].sort()
  };
}
