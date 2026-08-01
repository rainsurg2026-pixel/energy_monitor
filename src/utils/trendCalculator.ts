/**
 * Utility for calculating trends between two numerical values, typically
 * from different months. Consolidates what used to be separate delta/percentage
 * calculations across UI components into a single source. Every part of the
 * Rack Capacity UI (trend arrows, KPI cards, etc.) must use this utility.
 */

/** The direction of a trend. */
export type TrendDirection = "Up" | "Down" | "Stable" | "Unknown";

/**
 * Calculates the absolute delta between two numbers.
 * @param current The current value.
 * @param previous The previous value.
 * @returns The difference (`current - previous`).
 */
export function calculateDelta(current: number, previous: number): number {
  return current - previous;
}

/**
 * Calculates the percentage change between two numbers.
 * @param current The current value.
 * @param previous The previous value.
 * @returns The percentage change ((current - previous) / previous) * 100).
 *   Returns 0 if `previous` is 0 and `current` is 0.
 *   Returns `Infinity` if `previous` is 0 and `current` is non-zero (division by zero).
 */
export function calculatePercentageDelta(current: number, previous: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : Infinity;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * Determines the direction of a trend based on the delta.
 * @param delta The numeric difference between current and previous values.
 * @param tolerance Optional: A small number to consider values within as "Stable". Defaults to 0.
 * @returns A `TrendDirection` string.
 */
export function getTrendDirection(delta: number, tolerance: number = 0): TrendDirection {
  if (Math.abs(delta) <= tolerance) {
    return "Stable";
  }
  return delta > 0 ? "Up" : "Down";
}

/**
 * Returns a display-ready string representation of the trend direction.
 * @param direction The `TrendDirection`.
 * @param lang The language ("en" or "th").
 * @returns A localized string.
 */
export function getTrendLabel(direction: TrendDirection, lang: "th" | "en"): string {
  if (lang === "th") {
    switch (direction) {
      case "Up": return "เพิ่มขึ้น";
      case "Down": return "ลดลง";
      case "Stable": return "คงที่";
      default: return "ไม่ทราบ";
    }
  } else {
    switch (direction) {
      case "Up": return "Up";
      case "Down": return "Down";
      case "Stable": return "Stable";
      default: return "Unknown";
    }
  }
}
