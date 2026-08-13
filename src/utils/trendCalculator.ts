/** Compatibility adapter for domain trend arithmetic plus display labels. */
export { calculateDelta, calculatePercentageDelta, getTrendDirection } from "../domain/trendCalculator";
export type { TrendDirection } from "../domain/trendCalculator";

export function getTrendLabel(direction: import("../domain/trendCalculator").TrendDirection, lang: "th" | "en"): string {
  if (lang === "th") {
    switch (direction) {
      case "Up": return "เพิ่มขึ้น";
      case "Down": return "ลดลง";
      case "Stable": return "คงที่";
      default: return "ไม่ทราบ";
    }
  }
  switch (direction) {
    case "Up": return "Up";
    case "Down": return "Down";
    case "Stable": return "Stable";
    default: return "Unknown";
  }
}
