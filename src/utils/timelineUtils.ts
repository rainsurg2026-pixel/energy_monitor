/**
 * Utilities for generating and managing the time-based data used in Rack Capacity
 * timelines, history views, and reporting month selection. Consolidates what used
 * to be separate month-array generation logic across components into a single
 * source. Every part of the Rack Capacity UI (timeline, history panel, dropdowns)
 * must use this utility.
 */
import { currentMonth, shiftMonth, yearOf } from "./monthUtils";

/** A simplified data type for representing available historical data. */
export interface SnapshotMetadata {
  month: string;
  facility: string;
}

/**
 * Generates an ordered list of canonical month strings ("YYYY-MM") covering
 * a specified historical period and a number of future months.
 *
 * @param startMonth "YYYY-MM" The earliest month to include.
 * @param endMonth "YYYY-MM" The latest month to include historically.
 * @param futureMonths How many months beyond `endMonth` to include for forecasting.
 * @returns An array of "YYYY-MM" strings, ordered earliest to latest.
 */
export function generateMonthRange(startMonth: string, endMonth: string, futureMonths: number = 0): string[] {
  if (startMonth > endMonth) return [];
  const months: string[] = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    current = shiftMonth(current, 1);
  }
  for (let i = 0; i < futureMonths; i++) {
    months.push(current);
    current = shiftMonth(current, 1);
  }
  return months;
}

/**
 * Filters and sorts a list of available snapshot months based on a given facility.
 *
 * @param allSnapshots An array of `SnapshotMetadata` objects.
 * @param facility The facility to filter by.
 * @returns An array of unique "YYYY-MM" strings, sorted earliest to latest.
 */
export function getAvailableMonthsForFacility(allSnapshots: SnapshotMetadata[], facility: string): string[] {
  const months = new Set<string>();
  for (const snapshot of allSnapshots) {
    if (snapshot.facility === facility) {
      months.add(snapshot.month);
    }
  }
  return Array.from(months).sort();
}

/**
 * Derives the current reporting year from a given reporting month.
 * @param reportingMonth "YYYY-MM" The month for which data is being reported.
 * @returns The "YYYY" year string.
 */
export function getReportingYear(reportingMonth: string): string {
  return yearOf(reportingMonth);
}

/**
 * Returns the currently active month for reporting.
 * @returns "YYYY-MM" string for the current calendar month.
 */
export function getCurrentReportingMonth(): string {
  return currentMonth();
}
