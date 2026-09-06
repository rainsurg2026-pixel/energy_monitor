import type { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "./energyCost";
import { formatNumber, formatNumber2 } from "../utils/numberFormatBridge";

export function getDaysInMonth(monthStr: string): number {
  if (!monthStr) return 30;
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStrPart, 10);
  return new Date(year, month, 0).getDate();
}
export function getPreviousMonthStr(monthStr: string): string {
  if (!monthStr) return "";
  const [yearStr, monthStrPart] = monthStr.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStrPart, 10) - 1;
  if (month === 0) { month = 12; year -= 1; }
  return `${year}-${month.toString().padStart(2, "0")}`;
}

export interface ComputedMonthMetrics {
  month: string;
  upsEnergyKwh: number | null;
  airEnergyKwh: number | null;
  dcEnergyKwh: number | null;
  totalEnergyKwh: number | null;
  itEquipmentEnergyKwh: number | null;
  pue: number | null;
  carbonEmissionKg: number | null;
  actualCostThb: number | null;
  estimatedCostThb: number | null;
  avgElectricityRate: number | null;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  dataQualityScore: number;
  facilityHealthScore: number;
  alertsCount: number;
  alerts: string[];
}

export function computeMetricsForMonth(
  log: MonthlyLog,
  previousLog: MonthlyLog | null,
  allLogs: readonly MonthlyLog[] = previousLog ? [previousLog, log] : [log]
): ComputedMonthMetrics {
  let totalUpsKw = 0;
  let totalUpsKva = 0;
  let upsMissingCount = 0;
  const upsAlerts: string[] = [];
  log.ups.forEach(u => {
    if (u.loadKw !== null) totalUpsKw += u.loadKw; else upsMissingCount++;
    if (u.loadKva !== null) totalUpsKva += u.loadKva;
    if (u.voltage !== null && (u.voltage < 212 || u.voltage > 228)) upsAlerts.push(`${u.upsId}: Abnormal Voltage ${u.voltage}V`);
  });
  void totalUpsKw;
  void totalUpsKva;

  const energyCost = calculateEnergyCostForMonth(allLogs, log.month);
  const upsEnergyKwh = energyCost.upsEnergyKwh;
  const airEnergyKwh = energyCost.airEnergyKwh;
  const airFields = getAirFields(log);
  const airMissing = airFields.some(field => {
    const value = getAirValue(log, field);
    return value === null || value === undefined;
  });

  let totalDcPowerW = 0;
  let dcMissingCount = 0;
  const dcAlerts: string[] = [];
  log.dc.forEach(p => {
    if (p.voltage !== null && p.current !== null) {
      totalDcPowerW += p.voltage * p.current;
      if (p.voltage < 46 || p.voltage > 57) dcAlerts.push(`${p.panelId}: Voltage out of bounds ${p.voltage}V`);
    } else dcMissingCount++;
  });
  void totalDcPowerW;
  const dcEnergyKwh = energyCost.dcEnergyKwh;
  const totalEnergyKwh = energyCost.floorEnergyKwh;
  const itEquipmentEnergyKwh = upsEnergyKwh === null || dcEnergyKwh === null ? null : upsEnergyKwh + dcEnergyKwh;
  const pue = totalEnergyKwh !== null && itEquipmentEnergyKwh !== null && itEquipmentEnergyKwh > 0 ? totalEnergyKwh / itEquipmentEnergyKwh : null;
  // Carbon stays unavailable until an approved, persisted emission factor is configured.
  // Do not synthesize report values from an application constant.
  const carbonEmissionKg = null;
  const buildingEnergyKwh = energyCost.buildingEnergyKwh;
  const buildingCostThb = energyCost.buildingElectricityCostThb;
  const avgElectricityRate = energyCost.averageElectricityRateThbPerKwh;
  const estimatedCostThb = energyCost.floorElectricityCostThb;
  const actualCostThb = energyCost.floorElectricityCostThb;

  let dqScore = 100;
  if (upsMissingCount > 0) dqScore -= upsMissingCount * 3;
  if (airMissing) dqScore -= 10;
  if (dcMissingCount > 0) dqScore -= dcMissingCount * 3;
  if (log.energyCost.buildingEnergyKwh === null) dqScore -= 5;
  if (log.energyCost.buildingElectricityCostThb === null) dqScore -= 5;
  if (upsAlerts.length > 0) dqScore -= upsAlerts.length * 2;
  if (dcAlerts.length > 0) dqScore -= dcAlerts.length * 2;
  const dataQualityScore = Math.max(10, Math.min(100, dqScore));

  let healthScore = 100;
  if (pue !== null && pue > 1.5) healthScore -= Math.min(25, (pue - 1.5) * 40);
  else if (pue !== null && pue > 1.0 && pue <= 1.2) healthScore += 2;
  let balanceDeviation = 0;
  const pairs = [
    { a: "UPS 11A", b: "UPS 11B" },
    { a: "UPS 13A", b: "UPS 13B" },
    { a: "UPS 15A (PPC44A)", b: "UPS 15B (PPC44B)" }
  ];
  pairs.forEach(pair => {
    const rA = log.ups.find(u => u.upsId.includes(pair.a));
    const rB = log.ups.find(u => u.upsId.includes(pair.b));
    if (rA && rB && rA.loadKw !== null && rB.loadKw !== null) {
      const total = rA.loadKw + rB.loadKw;
      if (total > 0) {
        const percentDiff = Math.abs(rA.loadKw - rB.loadKw) / total * 100;
        if (percentDiff > 30) balanceDeviation += (percentDiff - 30) * 0.2;
      }
    }
  });
  healthScore -= Math.min(15, balanceDeviation);
  healthScore -= upsAlerts.length * 3;
  healthScore -= dcAlerts.length * 3;
  if (upsMissingCount > 0 || dcMissingCount > 0 || airMissing) healthScore -= 10;
  const facilityHealthScore = Math.max(20, Math.min(100, healthScore));

  const allAlerts = [...upsAlerts, ...dcAlerts];
  if (pue !== null && pue > 2.0) allAlerts.push(`High PUE Detected: ${formatNumber(pue)} (Standard limit is 2.0)`);
  if (totalEnergyKwh !== null && totalEnergyKwh > 300000) allAlerts.push(`High Energy Usage Spike: ${formatNumber2(totalEnergyKwh)} kWh`);
  return {
    month: log.month, upsEnergyKwh, airEnergyKwh, dcEnergyKwh, totalEnergyKwh, itEquipmentEnergyKwh,
    pue, carbonEmissionKg, actualCostThb, estimatedCostThb, avgElectricityRate,
    buildingEnergyKwh, buildingCostThb, dataQualityScore, facilityHealthScore,
    alertsCount: allAlerts.length, alerts: allAlerts
  };
}

export function computeAllMetrics(logs: MonthlyLog[]): ComputedMonthMetrics[] {
  const sorted = [...logs].sort((a, b) => a.month.localeCompare(b.month));
  return sorted.map((log, index) => computeMetricsForMonth(log, index > 0 ? sorted[index - 1] : null, sorted));
}
