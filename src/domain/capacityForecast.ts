import { shiftMonth, yearOf } from "./dates";

export interface TimeSeriesPoint { month: string; value: number; }
export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  forecast: (month: string) => number;
  crosses: (threshold: number) => string | null;
}
export const MIN_FORECAST_HISTORY_MONTHS = 6;

export function linearRegression(data: TimeSeriesPoint[]): RegressionResult | null {
  if (data.length < MIN_FORECAST_HISTORY_MONTHS) return null;
  const monthToOrdinal = (month: string): number => { const [y, m] = month.split("-").map(Number); return y * 12 + (m - 1); };
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
  const forecast = (month: string): number => slope * monthToOrdinal(month) + intercept;
  const crosses = (threshold: number): string | null => {
    if (slope <= 0) return null;
    const x = (threshold - intercept) / slope;
    const year = Math.floor(x / 12);
    const monthIndex = Math.floor(x) % 12;
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  };
  return { slope, intercept, rSquared, forecast, crosses };
}

export const CAPACITY_HEALTH_LEVELS = ["Healthy", "Warning", "Critical"] as const;
export type CapacityHealthLevel = (typeof CAPACITY_HEALTH_LEVELS)[number];
export function getCapacityHealth(value: number, warningThreshold: number, criticalThreshold: number): CapacityHealthLevel {
  if (value >= criticalThreshold) return "Critical";
  if (value >= warningThreshold) return "Warning";
  return "Healthy";
}

export function generateForecast(regression: RegressionResult, startMonth: string, count: number): TimeSeriesPoint[] {
  const forecastPoints: TimeSeriesPoint[] = [];
  let currentMonth = startMonth;
  for (let i = 0; i < count; i++) { forecastPoints.push({ month: currentMonth, value: regression.forecast(currentMonth) }); currentMonth = shiftMonth(currentMonth, 1); }
  return forecastPoints;
}
export function extendWithForecast(history: TimeSeriesPoint[], futureMonths: number): TimeSeriesPoint[] {
  if (history.length < MIN_FORECAST_HISTORY_MONTHS) return history;
  const regression = linearRegression(history);
  if (!regression) return history;
  return [...history, ...generateForecast(regression, shiftMonth(history[history.length - 1].month, 1), futureMonths)];
}
export function isForecastInSameYear(forecastMonth: string, lastHistoricalMonth: string): boolean { return yearOf(forecastMonth) === yearOf(lastHistoricalMonth); }
