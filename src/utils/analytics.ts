import { MonthlyLog, UpsRecord, AirRecord, DcRecord } from "../types";

// Helper to calculate days in month
export function getDaysInMonth(monthStr: string): number {
  if (!monthStr) return 30;
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStrPart, 10);
  return new Date(year, month, 0).getDate();
}

// Get the previous month string "YYYY-MM"
export function getPreviousMonthStr(monthStr: string): string {
  if (!monthStr) return "";
  const [yearStr, monthStrPart] = monthStr.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStrPart, 10) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${month.toString().padStart(2, "0")}`;
}

export interface ComputedMonthMetrics {
  month: string; // YYYY-MM
  upsEnergyKwh: number;
  airEnergyKwh: number;
  dcEnergyKwh: number;
  totalEnergyKwh: number;
  itEquipmentEnergyKwh: number;
  pue: number;
  carbonEmissionKg: number;
  actualCostThb: number;
  estimatedCostThb: number;
  avgElectricityRate: number;
  buildingEnergyKwh: number;
  buildingCostThb: number;
  
  // Scoring
  dataQualityScore: number; // 0-100
  facilityHealthScore: number; // 0-100
  
  // Status & Warnings
  alertsCount: number;
  alerts: string[];
}

/**
 * Computes comprehensive reporting metrics for a specific month
 */
export function computeMetricsForMonth(log: MonthlyLog, previousLog: MonthlyLog | null): ComputedMonthMetrics {
  const days = getDaysInMonth(log.month);
  
  // 1. UPS Calculations
  let totalUpsKw = 0;
  let totalUpsKva = 0;
  let upsMissingCount = 0;
  const upsAlerts: string[] = [];

  log.ups.forEach(u => {
    if (u.loadKw !== null) totalUpsKw += u.loadKw;
    else upsMissingCount++;
    if (u.loadKva !== null) totalUpsKva += u.loadKva;

    // Abnormal Voltage threshold check (ideal: 215V - 225V)
    if (u.voltage !== null && (u.voltage < 212 || u.voltage > 228)) {
      upsAlerts.push(`${u.upsId}: Abnormal Voltage ${u.voltage}V`);
    }
  });
  
  const upsEnergyKwh = totalUpsKw * 24 * days;

  // 2. Air Conditioning Calculations
  const curAir = log.air;
  const prevAir = previousLog ? previousLog.air : { eb41a: null, eb41b: null, eb42a: null, eb42b: null };

  const airDiff = {
    eb41a: curAir.eb41a !== null && prevAir.eb41a !== null ? Math.max(0, curAir.eb41a - prevAir.eb41a) : 0,
    eb41b: curAir.eb41b !== null && prevAir.eb41b !== null ? Math.max(0, curAir.eb41b - prevAir.eb41b) : 0,
    eb42a: curAir.eb42a !== null && prevAir.eb42a !== null ? Math.max(0, curAir.eb42a - prevAir.eb42a) : 0,
    eb42b: curAir.eb42b !== null && prevAir.eb42b !== null ? Math.max(0, curAir.eb42b - prevAir.eb42b) : 0,
  };

  const airDiffSumGwh = airDiff.eb41a + airDiff.eb41b + airDiff.eb42a + airDiff.eb42b;
  const airEnergyKwh = airDiffSumGwh * 1000000;
  
  const airMissing = curAir.eb41a === null || curAir.eb41b === null || curAir.eb42a === null || curAir.eb42b === null;

  // 3. DC Power Calculations
  let totalDcPowerW = 0;
  let dcMissingCount = 0;
  const dcAlerts: string[] = [];

  log.dc.forEach(p => {
    if (p.voltage !== null && p.current !== null) {
      const pW = p.voltage * p.current;
      totalDcPowerW += pW;

      // Telecom standard range: 48V - 56V
      if (p.voltage < 46 || p.voltage > 57) {
        dcAlerts.push(`${p.panelId}: Voltage out of bounds ${p.voltage}V`);
      }
    } else {
      dcMissingCount++;
    }
  });

  const totalDcAcPowerW = totalDcPowerW * 1.10; // 10% overhead conversion loss
  const dcEnergyKwh = (totalDcAcPowerW * 24 * days) / 1000;

  // 4. Overall Energy totals
  const totalEnergyKwh = upsEnergyKwh + airEnergyKwh + dcEnergyKwh;
  const itEquipmentEnergyKwh = upsEnergyKwh + dcEnergyKwh;

  // PUE Calculation (ideal minimum is 1.0, typical target: 1.5)
  const pue = itEquipmentEnergyKwh > 0 ? totalEnergyKwh / itEquipmentEnergyKwh : 1.5;

  // Carbon Emission calculation (Thailand Grid Emission Factor: 0.4991 kgCO2e/kWh)
  const carbonEmissionKg = totalEnergyKwh * 0.4991;

  // 5. Costing
  const buildingEnergyKwh = log.energyCost.buildingEnergyKwh || 0;
  const buildingCostThb = log.energyCost.buildingElectricityCostThb || 0;
  const avgElectricityRate = buildingEnergyKwh > 0 ? buildingCostThb / buildingEnergyKwh : 0;
  
  const estimatedCostThb = totalEnergyKwh * avgElectricityRate;
  const actualCostThb = estimatedCostThb; // Use estimated for floor level as master cost

  // 6. Data Quality Score calculation (starts at 100)
  let dqScore = 100;
  if (upsMissingCount > 0) dqScore -= (upsMissingCount * 3);
  if (airMissing) dqScore -= 10;
  if (dcMissingCount > 0) dqScore -= (dcMissingCount * 3);
  if (!log.energyCost.buildingEnergyKwh) dqScore -= 5;
  if (!log.energyCost.buildingElectricityCostThb) dqScore -= 5;
  if (upsAlerts.length > 0) dqScore -= (upsAlerts.length * 2);
  if (dcAlerts.length > 0) dqScore -= (dcAlerts.length * 2);
  const dataQualityScore = Math.max(10, Math.min(100, dqScore));

  // 7. Facility Health Score calculation (starts at 100)
  let healthScore = 100;
  
  // PUE penalty (Ideal is 1.0 - 1.5, standard is 1.5-2.0, bad is > 2.0)
  if (pue > 1.5) {
    healthScore -= Math.min(25, (pue - 1.5) * 40);
  } else if (pue > 1.0 && pue <= 1.2) {
    // exceptionally good
    healthScore += 2;
  }

  // UPS capacity balance penalty (checking if load is balanced across A/B pairs)
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
        const diff = Math.abs(rA.loadKw - rB.loadKw);
        const percentDiff = (diff / total) * 100;
        if (percentDiff > 30) {
          balanceDeviation += (percentDiff - 30) * 0.2; // penalty for big imbalance
        }
      }
    }
  });
  healthScore -= Math.min(15, balanceDeviation);

  // Electrical Warnings deduction
  healthScore -= (upsAlerts.length * 3);
  healthScore -= (dcAlerts.length * 3);

  // Missing data penalty on health
  if (upsMissingCount > 0 || dcMissingCount > 0 || airMissing) {
    healthScore -= 10;
  }

  const facilityHealthScore = Math.max(20, Math.min(100, healthScore));

  // Merge alerts
  const allAlerts = [...upsAlerts, ...dcAlerts];
  if (pue > 2.0) {
    allAlerts.push(`High PUE Detected: ${pue.toFixed(2)} (Standard limit is 2.0)`);
  }
  if (totalEnergyKwh > 300000) {
    allAlerts.push(`High Energy Usage Spike: ${totalEnergyKwh.toLocaleString()} kWh`);
  }

  return {
    month: log.month,
    upsEnergyKwh,
    airEnergyKwh,
    dcEnergyKwh,
    totalEnergyKwh,
    itEquipmentEnergyKwh,
    pue,
    carbonEmissionKg,
    actualCostThb,
    estimatedCostThb,
    avgElectricityRate,
    buildingEnergyKwh,
    buildingCostThb,
    dataQualityScore,
    facilityHealthScore,
    alertsCount: allAlerts.length,
    alerts: allAlerts
  };
}

/**
 * Computes metrics for all available logs in chronological order
 */
export function computeAllMetrics(logs: MonthlyLog[]): ComputedMonthMetrics[] {
  const sorted = [...logs].sort((a, b) => a.month.localeCompare(b.month));
  return sorted.map((log, index) => {
    const prevLog = index > 0 ? sorted[index - 1] : null;
    return computeMetricsForMonth(log, prevLog);
  });
}

/**
 * Linear Regression calculation
 */
export function linearRegression(data: { x: number; y: number }[]) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (const p of data) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  }
  
  const numSlope = n * sumXY - sumX * sumY;
  const denSlope = n * sumXX - sumX * sumX;
  const slope = denSlope === 0 ? 0 : numSlope / denSlope;
  const intercept = (sumY - slope * sumX) / n;

  // Coefficient of determination (R2)
  const meanY = sumY / n;
  let totalSS = 0; // total sum of squares
  let residualSS = 0; // residual sum of squares
  
  for (const p of data) {
    const predY = slope * p.x + intercept;
    totalSS += Math.pow(p.y - meanY, 2);
    residualSS += Math.pow(p.y - predY, 2);
  }
  
  const r2 = totalSS === 0 ? 1 : 1 - (residualSS / totalSS);

  return { slope, intercept, r2 };
}

/**
 * Generates statistical forecast for next N months
 */
export interface ForecastPoint {
  monthIndex: number;
  monthStr: string;
  actual: number | null;
  forecast: number;
  confidenceUpper: number;
  confidenceLower: number;
}

export function generateForecast(
  history: { monthStr: string; value: number }[],
  steps: number = 3
): { forecast: ForecastPoint[]; accuracyPct: number } {
  if (history.length === 0) {
    return { forecast: [], accuracyPct: 0 };
  }

  // index data
  const data = history.map((h, idx) => ({ x: idx, y: h.value }));
  const reg = linearRegression(data);

  const forecastPoints: ForecastPoint[] = [];
  
  // Historical data points
  history.forEach((h, idx) => {
    const fitted = reg.slope * idx + reg.intercept;
    forecastPoints.push({
      monthIndex: idx,
      monthStr: h.monthStr,
      actual: h.value,
      forecast: fitted,
      confidenceUpper: fitted,
      confidenceLower: fitted
    });
  });

  // Calculate prediction standard error
  let sumSquaredErrors = 0;
  history.forEach((h, idx) => {
    const pred = reg.slope * idx + reg.intercept;
    sumSquaredErrors += Math.pow(h.value - pred, 2);
  });
  const standardError = history.length > 2 
    ? Math.sqrt(sumSquaredErrors / (history.length - 2)) 
    : 0;

  // Add forecasted points
  const lastMonthStr = history[history.length - 1].monthStr;
  let [lastYr, lastMth] = lastMonthStr.split("-").map(Number);

  for (let i = 1; i <= steps; i++) {
    lastMth += 1;
    if (lastMth > 12) {
      lastMth = 1;
      lastYr += 1;
    }
    const futMonthStr = `${lastYr}-${lastMth.toString().padStart(2, "0")}`;
    const futIdx = history.length - 1 + i;
    const forecastVal = Math.max(0, reg.slope * futIdx + reg.intercept);
    
    // Calculate custom confidence interval (widening as index increases)
    const confidenceMargin = 1.96 * standardError * Math.sqrt(1 + 1 / history.length + Math.pow(futIdx - (history.length / 2), 2) / (history.length * history.length));
    
    forecastPoints.push({
      monthIndex: futIdx,
      monthStr: futMonthStr,
      actual: null,
      forecast: forecastVal,
      confidenceUpper: forecastVal + confidenceMargin,
      confidenceLower: Math.max(0, forecastVal - confidenceMargin)
    });
  }

  // Convert R-squared to accuracy percentage for display
  const accuracyPct = Math.round(reg.r2 * 100);

  return {
    forecast: forecastPoints,
    accuracyPct: Math.min(100, Math.max(0, accuracyPct))
  };
}
