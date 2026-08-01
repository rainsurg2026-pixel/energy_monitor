/** Presentation-only numeric formatting shared by all UI and report views. */
const groupedTwoDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? groupedTwoDecimal.format(value) : "—";
}

/**
 * Rounds to a fixed number of decimals and returns a NUMBER, not a display
 * string - for chart data points (e.g. Recharts Y-values) that need a real
 * number to plot, never a formatted "91.23%" string. Keeps the one
 * `.toFixed()` call for this out of component files, matching how every
 * other numeric-formatting concern is centralized here.
 */
export function roundToDecimals(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function formatDecimal(value: number | null | undefined, suffix = ""): string {
  const result = formatNumber(value);
  return result === "—" ? result : `${result}${suffix}`;
}

export function formatPercentage(value: number | null | undefined): string {
  const result = formatNumber(value);
  return result === "—" ? result : `${result}%`;
}

export function formatEnergy(value: number | null | undefined, unit = "kWh"): string {
  const result = formatNumber(value);
  return result === "—" ? result : `${result} ${unit}`;
}

/**
 * Space-constrained variant for chart axis ticks only (never tooltips —
 * tooltips must show the full formatNumber value). Abbreviates at the
 * thousand/million scale; below 1,000 it falls back to formatNumber so small
 * ratios (e.g. PUE) still render with the standard 2 decimals.
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return formatNumber(value);
}

/**
 * Compact label for chart data points. Strips trailing zeros, supports
 * B/M/K suffixes. Returns empty string (not "—") for invalid values so
 * chart labels disappear cleanly.
 */
export function formatCompactLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return parseFloat((value / 1_000_000_000).toFixed(2)) + "B";
  if (abs >= 1_000_000) return parseFloat((value / 1_000_000).toFixed(2)) + "M";
  if (abs >= 1_000) return parseFloat((value / 1_000).toFixed(2)) + "K";
  return value.toFixed(2).replace(/\.00$/, "");
}
