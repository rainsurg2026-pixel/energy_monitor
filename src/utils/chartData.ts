import type { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth, normalizedMonth } from "./energyCost";

export interface MonthlyChartPoint {
  month: string;
  label: string;
  buildingEnergy: number | null;
  floorEnergy: number | null;
  buildingCost: number | null;
  floorCost: number | null;
  upsEnergy: number | null;
  airEnergy: number | null;
  dcEnergy: number | null;
}

export function buildMonthlyChartData(logs: readonly MonthlyLog[]): MonthlyChartPoint[] {
  const months = Array.from(new Set(logs.map(log => normalizedMonth(log.month)).filter((month): month is string => month !== null))).sort();
  return months.map(month => {
    const values = calculateEnergyCostForMonth(logs, month);
    const [year, monthNumber] = month.split("-").map(Number);
    const label = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    return {
      month,
      label,
      buildingEnergy: values.buildingEnergyKwh,
      floorEnergy: values.floorEnergyKwh,
      buildingCost: values.buildingElectricityCostThb,
      floorCost: values.floorElectricityCostThb,
      upsEnergy: values.upsEnergyKwh,
      airEnergy: values.airEnergyKwh,
      dcEnergy: values.dcEnergyKwh
    };
  });
}
