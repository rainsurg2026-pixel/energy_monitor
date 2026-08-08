import { getComparisonDisplayMonths as domainDisplayMonths, getComparisonMonths as domainMonths, getDefaultComparisonReferenceMonth as domainDefaultReference, buildFacilityComparisonMetrics as domainMetrics } from "../domain/facilityComparison";
import type { ComparisonDisplayRange, ComparisonHistory, FacilityComparisonMetrics } from "../domain/facilityComparison";

export type { ComparisonDisplayRange, ComparisonHistory, FacilityComparisonMetrics };

function currentReportingMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getComparisonMonths(histories: readonly ComparisonHistory[]): string[] {
  return domainMonths(histories, currentReportingMonth());
}

export function getDefaultComparisonReferenceMonth(histories: readonly ComparisonHistory[]): string | null {
  return domainDefaultReference(histories, currentReportingMonth());
}

export const getComparisonDisplayMonths = domainDisplayMonths;

export function buildFacilityComparisonMetrics(logs: readonly import("../types").MonthlyLog[]): Map<string, FacilityComparisonMetrics> {
  return domainMetrics(logs, currentReportingMonth());
}
