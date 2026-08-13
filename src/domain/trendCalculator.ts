export type TrendDirection = "Up" | "Down" | "Stable" | "Unknown";
export function calculateDelta(current: number, previous: number): number { return current - previous; }
export function calculatePercentageDelta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : Infinity;
  return ((current - previous) / previous) * 100;
}
export function getTrendDirection(delta: number, tolerance = 0): TrendDirection {
  if (Math.abs(delta) <= tolerance) return "Stable";
  return delta > 0 ? "Up" : "Down";
}
