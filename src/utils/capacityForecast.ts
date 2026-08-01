/**
 * Rack Capacity forecasting (linear regression), saturation point calculation,
 * and threshold health checks. Consolidates forecasting logic previously
 * embedded inside specific UI components into a single, shared, testable
 * utility. Every part of the Rack Capacity UI (KPI cards, forecast charts, etc.)
 * must use this utility.
 */
import { shiftMonth, yearOf } from "./monthUtils";

/** A single historical data point: a month key and a numeric value. */
export interface TimeSeriesPoint {
  month: string;
  value: number;
}

/** The result of a linear regression: slope, intercept, and R² goodness of fit. */
export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  /** A projection of the value at a future month. */
  forecast: (month: string) => number;
  /** The month where the value is projected to cross a given threshold. */
  crosses: (threshold: number) => string | null;
}

/** Business-approved minimum (v2.2.5 review): a forecast is never shown off
 *  fewer than 6 real historical months - below that, every consumer must
 *  show "Insufficient History" rather than a regression with almost no
 *  support. */
export const MIN_FORECAST_HISTORY_MONTHS = 6;

/**
 * Performs a simple linear regression on a time series of month-value pairs.
 *
 * @param data An array of `{ month: "YYYY-MM", value: number }` points.
 * @returns A `RegressionResult` object with slope, intercept, and forecast helpers.
 *   Returns null if the data is insufficient to compute a trend (fewer than
 *   `MIN_FORECAST_HISTORY_MONTHS` points).
 */
export function linearRegression(data: TimeSeriesPoint[]): RegressionResult | null {
  if (data.length < MIN_FORECAST_HISTORY_MONTHS) return null;

  const monthToOrdinal = (month: string): number => {
    const [y, m] = month.split("-").map(Number);
    return y * 12 + (m - 1);
  };

  const points = data.map(d => ({ x: monthToOrdinal(d.month), y: d.value }));
  const n = points.length;

  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);
  const sumYY = points.reduce((sum, p) => sum + p.y * p.y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const rNumerator = n * sumXY - sumX * sumY;
  const rDenominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  const rSquared = rDenominator === 0 ? 1 : Math.pow(rNumerator / rDenominator, 2);

  const forecast = (month: string): number => {
    return slope * monthToOrdinal(month) + intercept;
  };

  const crosses = (threshold: number): string | null => {
    if (slope <= 0) return null; // Value is not increasing, will never cross.
    const x = (threshold - intercept) / slope;
    const year = Math.floor(x / 12);
    const monthIndex = Math.floor(x) % 12;
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  };

  return { slope, intercept, rSquared, forecast, crosses };
}

/** The set of capacity health statuses, from safest to most severe. */
export const CAPACITY_HEALTH_LEVELS = ["Healthy", "Warning", "Critical"] as const;
export type CapacityHealthLevel = (typeof CAPACITY_HEALTH_LEVELS)[number];

/**
 * Determines the capacity health level based on a value and thresholds.
 *
 * @param value The current value (e.g., percentage of capacity used).
 * @param warningThreshold The value at which the status becomes "Warning".
 * @param criticalThreshold The value at which the status becomes "Critical".
 * @returns A `CapacityHealthLevel` string.
 */
export function getCapacityHealth(value: number, warningThreshold: number, criticalThreshold: number): CapacityHealthLevel {
  if (value >= criticalThreshold) return "Critical";
  if (value >= warningThreshold) return "Warning";
  return "Healthy";
}

/**
 * Generates a series of future forecast points based on a regression result.
 * Pure shiftMonth arithmetic (never Date), so month labels can never drift
 * by timezone.
 */
export function generateForecast(regression: RegressionResult, startMonth: string, count: number): TimeSeriesPoint[] {
  const forecastPoints: TimeSeriesPoint[] = [];
  let currentMonth = startMonth;
  for (let i = 0; i < count; i++) {
    forecastPoints.push({ month: currentMonth, value: regression.forecast(currentMonth) });
    currentMonth = shiftMonth(currentMonth, 1);
  }
  return forecastPoints;
}

/**
 * Extends a historical time series with future forecast points. If the history is
 * insufficient for a regression, returns only the historical data. The historical
 * points retain their original values; only future points are forecasted.
 */
export function extendWithForecast(history: TimeSeriesPoint[], futureMonths: number): TimeSeriesPoint[] {
  if (history.length < MIN_FORECAST_HISTORY_MONTHS) return history;

  const regression = linearRegression(history);
  if (!regression) return history;

  const lastHistoricalMonth = history[history.length - 1].month;
  const forecastPoints = generateForecast(regression, shiftMonth(lastHistoricalMonth, 1), futureMonths);

  return [...history, ...forecastPoints];
}

/**
 * Checks if a given forecast month is within the same calendar year as the last
 * historical data point. This helps UIs decide whether to label a forecast point
 * with just the month or "Month YYYY".
 *
 * @param forecastMonth The "YYYY-MM" month of the forecast point.
 * @param lastHistoricalMonth The "YYYY-MM" month of the last actual data point.
 * @returns `true` if the years are the same.
 */
export function isForecastInSameYear(forecastMonth: string, lastHistoricalMonth: string): boolean {
  return yearOf(forecastMonth) === yearOf(lastHistoricalMonth);
}
