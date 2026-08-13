import type { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth, normalizedMonth } from "./energyCost";

export type ComparisonDisplayRange = 3 | 6 | 12;
export interface ComparisonHistory { id: string; logs: readonly MonthlyLog[]; }
export interface FacilityComparisonMetrics {
  buildingEnergy: number | null;
  buildingCost: number | null;
  floorEnergy: number | null;
  floorCost: number | null;
  avgRate: number | null;
  floorShare: number | null;
}
function monthsFor(logs: readonly MonthlyLog[], latestAllowedMonth: string): string[] {
  return [...new Set(logs.map(log => normalizedMonth(log.month))
    .filter((month): month is string => month !== null && month <= latestAllowedMonth))].sort();
}

/** Deterministic core. The Desktop adapter supplies the current local month. */
export function getComparisonMonths(histories: readonly ComparisonHistory[], latestAllowedMonth: string): string[] {
  return [...new Set(histories.flatMap(history => monthsFor(history.logs, latestAllowedMonth)))].sort();
}

export function getDefaultComparisonReferenceMonth(histories: readonly ComparisonHistory[], latestAllowedMonth: string): string | null {
  const months = getComparisonMonths(histories, latestAllowedMonth);
  if (months.length === 0) return null;
  const common = months.filter(month => histories.every(history => monthsFor(history.logs, latestAllowedMonth).includes(month)));
  return (common.length > 0 ? common : months).at(-1) ?? null;
}

export function getComparisonDisplayMonths(availableMonths: readonly string[], referenceMonth: string | null, range: ComparisonDisplayRange): string[] {
  const end = referenceMonth ? normalizedMonth(referenceMonth) : null;
  if (!end || !availableMonths.includes(end)) return [];
  const [year, month] = end.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - range, 1));
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function buildFacilityComparisonMetrics(logs: readonly MonthlyLog[], latestAllowedMonth: string): Map<string, FacilityComparisonMetrics> {
  const result = new Map<string, FacilityComparisonMetrics>();
  for (const month of monthsFor(logs, latestAllowedMonth)) {
    const values = calculateEnergyCostForMonth(logs, month);
    result.set(month, {
      buildingEnergy: values.buildingEnergyKwh,
      buildingCost: values.buildingElectricityCostThb,
      floorEnergy: values.floorEnergyKwh,
      floorCost: values.floorElectricityCostThb,
      avgRate: values.averageElectricityRateThbPerKwh,
      floorShare: values.energySharePercent,
    });
  }
  return result;
}
