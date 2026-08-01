/**
 * Gauge-related capacity health calculations, converting numeric values
 * into explicit "Healthy", "Warning", "Critical" bands used for UI.
 * Consolidates what used to be separate thresholding logic across components
 * into a single source. Every part of the Rack Capacity UI (gauges, KPI cards,
 * color-coding) must use this utility.
 */
import { CAPACITY_HEALTH_LEVELS, CapacityHealthLevel, getCapacityHealth } from "./capacityForecast";

/** Represents a capacity gauge's thresholds and current value. */
export interface GaugeConfig {
  value: number;
  max: number;
  warningThreshold: number;
  criticalThreshold: number;
}

/**
 * Calculates the health level for a given gauge configuration.
 *
 * @param config The `GaugeConfig` containing value, max, and thresholds.
 * @returns The `CapacityHealthLevel` for the current value.
 */
export function getGaugeHealth(config: GaugeConfig): CapacityHealthLevel {
  const { value, max, warningThreshold, criticalThreshold } = config;
  const percentage = (value / max) * 100;
  return getCapacityHealth(percentage, warningThreshold, criticalThreshold);
}

/**
 * Returns the color (hex code) associated with a given capacity health level.
 * @param level The `CapacityHealthLevel`.
 * @returns A hex color string.
 */
export function getHealthColor(level: CapacityHealthLevel): string {
  switch (level) {
    case "Healthy": return "#10b981"; // green-500
    case "Warning": return "#f59e0b"; // yellow-500
    case "Critical": return "#ef4444"; // red-500
    default: return "#94a3b8"; // slate-400 (for unknown/error states)
  }
}

/**
 * Returns a display-ready label for a given capacity health level.
 * @param level The `CapacityHealthLevel`.
 * @param lang The language ("en" or "th").
 * @returns A localized string.
 */
export function getHealthLabel(level: CapacityHealthLevel, lang: "th" | "en"): string {
  if (lang === "th") {
    switch (level) {
      case "Healthy": return "ปกติ";
      case "Warning": return "เตือน";
      case "Critical": return "วิกฤติ";
      default: return "ไม่ทราบสถานะ";
    }
  } else {
    switch (level) {
      case "Healthy": return "Healthy";
      case "Warning": return "Warning";
      case "Critical": return "Critical";
      default: return "Unknown";
    }
  }
}

/**
 * Returns the health levels in their canonical display order.
 * @returns A readonly array of `CapacityHealthLevel`.
 */
export function getHealthLevelsDisplayOrder(): readonly CapacityHealthLevel[] {
  return CAPACITY_HEALTH_LEVELS;
}

interface UtilizationBand {
  /** Upper bound of this band, exclusive (the last band's is +Infinity). */
  readonly upperBound: number;
  readonly hex: string;
}

/** The five-band utilization gradient: KPI cards, donut "In Use" segment,
 *  zone table, Zone Heatmap, gauge, progress bars, and PDF export all share
 *  this single scale - never re-thresholded per component. */
const UTILIZATION_BANDS: readonly UtilizationBand[] = [
  { upperBound: 60, hex: "#22c55e" }, // 0-60%: green
  { upperBound: 75, hex: "#84cc16" }, // 60-75%: yellow-green
  { upperBound: 85, hex: "#eab308" }, // 75-85%: yellow
  { upperBound: 95, hex: "#f97316" }, // 85-95%: orange
  { upperBound: Infinity, hex: "#ef4444" } // 95-100%+: red
];

/** `65` -> the yellow-green band's hex. `percent` is a 0-100 number (never a
 *  0-1 fraction). Unknown/non-finite input renders as neutral slate, never a
 *  fabricated band. */
export function utilizationColorHex(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return "#94a3b8"; // slate-400
  const clamped = Math.max(0, percent);
  const band = UTILIZATION_BANDS.find(b => clamped < b.upperBound) ?? UTILIZATION_BANDS[UTILIZATION_BANDS.length - 1];
  return band.hex;
}

export interface CapacityHealthScoreInputs {
  /** All four are 0-1 fractions (or null when unknown) - the same
   *  convention as everywhere else in Rack Capacity metrics. */
  usageRatio: number | null;
  availabilityRatio: number | null;
  reservedRatio: number | null;
  pendingDismantleRatio: number | null;
}

/** Business-approved weighting for the Executive Capacity Health Gauge's
 *  0-100 score (v2.2.5 business review, see docs/releases): usage 60%,
 *  availability 25% (applied as the (100 - availability%) pressure term, so
 *  low availability still increases the score), reserved 5%, pending-
 *  dismantle 10%. Unknown inputs contribute their most optimistic value
 *  (0 pressure) rather than being fabricated. */
const HEALTH_SCORE_WEIGHTS = {
  usage: 0.6,
  unavailability: 0.25,
  reserved: 0.05,
  pendingDismantle: 0.1
} as const;

/** Blends usage/availability/reserved/pending-dismantle into a single 0-100
 *  "capacity pressure" score - higher is worse, same direction and same
 *  color bands (`utilizationColorHex`) as the plain utilization gradient. */
export function calculateCapacityHealthScore(inputs: CapacityHealthScoreInputs): number {
  const usage = (inputs.usageRatio ?? 0) * 100;
  const unavailability = (1 - (inputs.availabilityRatio ?? 1)) * 100;
  const reserved = (inputs.reservedRatio ?? 0) * 100;
  const pendingDismantle = (inputs.pendingDismantleRatio ?? 0) * 100;
  const score =
    HEALTH_SCORE_WEIGHTS.usage * usage +
    HEALTH_SCORE_WEIGHTS.unavailability * unavailability +
    HEALTH_SCORE_WEIGHTS.reserved * reserved +
    HEALTH_SCORE_WEIGHTS.pendingDismantle * pendingDismantle;
  return Math.max(0, Math.min(100, score));
}
