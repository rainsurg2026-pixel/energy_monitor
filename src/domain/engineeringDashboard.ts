import type { MonthlyLog } from "../types";
import type { DomainDashboardUpsMappingReport, DomainEngineeringDashboardSnapshot } from "./types";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "./energyCost";
import { computeUpsGroupSummary, type UpsGroupConfig } from "./upsGroupAggregation";
import { daysInLocalMonthOr30, previousMonthOrEmpty } from "./dates";

export interface DashboardUpsTopology {
  upsGroups: UpsGroupConfig[];
  upsMapping: Array<{ no: number; umdb: string; upsId: string; keyId?: string; sts: string; oudb: string; capacity: number | null }>;
}
export type EngineeringDashboardSnapshot = DomainEngineeringDashboardSnapshot;

const SRINAKARIN_OVERALL_GROUPS: UpsGroupConfig[] = [
  { name: "UPS 11", ids: ["UPS 11A", "UPS 11B"], capacity: 400 },
  { name: "UPS 12", ids: ["UPS 12A", "UPS 12B"], capacity: 400 },
  { name: "UPS 13", ids: ["UPS 13A", "UPS 13B"], capacity: 400 }
];

function normalizedUpsId(value: string): string { return value.replace(/\s+/g, "").toLowerCase(); }

export function getDaysInMonth(month: string): number { return daysInLocalMonthOr30(month); }
export function getPreviousMonth(month: string): string { return previousMonthOrEmpty(month); }

function mapGroup(row: { name: string; totalLoadKw: number; totalLoadKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }) {
  return { name: row.name, totalKw: row.totalLoadKw, totalKva: row.totalLoadKva, capacity: row.capacity, loadPercent: row.loadPercent, availablePercent: row.availablePercent, monthlyEnergyKwh: row.monthlyEnergyKwh };
}

/** The selected-month Engineering Dashboard calculation used by Desktop. */
export function buildEngineeringDashboardSnapshot(
  logs: MonthlyLog[],
  selectedMonth: string,
  upsMapping: DomainDashboardUpsMappingReport | null,
  topology?: DashboardUpsTopology | null
): EngineeringDashboardSnapshot | null {
  const activeLog = logs.find(log => log.month === selectedMonth);
  if (!activeLog) return null;
  const previousMonth = getPreviousMonth(selectedMonth);
  const previousLog = logs.find(log => log.month === previousMonth) ?? null;
  const daysInMonth = getDaysInMonth(selectedMonth);
  const upsGroups = topology?.upsGroups?.length
    ? computeUpsGroupSummary(activeLog, topology.upsGroups).map(mapGroup)
    : (upsMapping?.summary ?? []).map(row => {
      const totalKw = row.totalLoadKw ?? 0;
      const totalKva = row.totalLoadKva ?? 0;
      const loadPercent = row.loadPercent;
      return { name: row.name, totalKw, totalKva, capacity: row.capacity, loadPercent, availablePercent: loadPercent === null ? null : Math.max(0, 100 - loadPercent), monthlyEnergyKwh: totalKw * 24 * daysInMonth };
    });
  const configuredRows = topology?.upsMapping ?? [];
  const workbookRows = upsMapping?.mapping ?? [];
  const detailRows = workbookRows.length > 0 ? workbookRows : configuredRows.map(row => ({ ...row, acPowerPanel: "—", voltage: null, current: null, loadKw: null, loadKva: null, loadPercent: null }));
  const hasAcPowerPanel = detailRows.some(row => row.acPowerPanel !== "—" && row.acPowerPanel !== "-");
  const upsOverallGroups = hasAcPowerPanel
    ? computeUpsGroupSummary(activeLog, SRINAKARIN_OVERALL_GROUPS).map(mapGroup)
    : [];
  const upsDetails = detailRows.map((row, index) => {
    const configured = configuredRows.find(item => item.no === row.no) ?? configuredRows[index];
    const reading = activeLog.ups.find(item => normalizedUpsId(item.upsId) === normalizedUpsId(row.upsId))
      ?? activeLog.ups.find(item => normalizedUpsId(item.upsId) === normalizedUpsId(configured?.keyId ?? configured?.upsId ?? row.upsId));
    const capacity = row.capacity ?? configured?.capacity ?? null;
    const loadKva = reading?.loadKva ?? row.loadKva ?? 0;
    return {
      no: row.no, umdb: row.umdb, upsId: row.upsId, acPowerPanel: row.acPowerPanel,
      sts: row.sts, oudb: row.oudb, voltage: reading?.voltage ?? row.voltage ?? 0, current: reading?.current ?? row.current ?? 0,
      loadKw: reading?.loadKw ?? row.loadKw ?? 0, loadKva, capacity,
      loadPercent: capacity !== null && capacity > 0 ? loadKva / capacity * 100 : row.loadPercent
    };
  });
  const airFields = getAirFields(activeLog);
  const airCurrent = Object.fromEntries(airFields.map(field => [field, getAirValue(activeLog, field)]));
  const airPrevious = Object.fromEntries(airFields.map(field => [field, previousLog ? getAirValue(previousLog, field) : null]));
  const airDifference = Object.fromEntries(airFields.map(field => {
    const current = airCurrent[field]; const previous = airPrevious[field];
    return [field, current !== null && previous !== null ? current - previous : null];
  }));
  const differenceValues = airFields.map(field => airDifference[field]);
  const airEnergyKwh = differenceValues.every(value => value !== null)
    ? differenceValues.reduce((sum, value) => sum + (value as number), 0) * 1000000 : null;
  const dcPanels = activeLog.dc.map(panel => {
    const voltage = panel.voltage ?? 0, current = panel.current ?? 0, dcPowerW = voltage * current, acPowerW = dcPowerW / 200 * 220;
    return { panelId: panel.panelId, voltage, current, dcPowerW, acCurrentA: acPowerW / 220, acPowerW, monthlyEnergyKwh: acPowerW * 24 * daysInMonth / 1000 };
  });
  const energy = calculateEnergyCostForMonth(logs, activeLog.month);
  return {
    daysInMonth, previousMonth: previousLog?.month ?? null, upsGroups, upsOverallGroups, upsDetails,
    totalUpsKw: upsGroups.reduce((sum, row) => sum + row.totalKw, 0), totalUpsKva: upsGroups.reduce((sum, row) => sum + row.totalKva, 0),
    totalUpsEnergyKwh: upsGroups.reduce((sum, row) => sum + row.monthlyEnergyKwh, 0),
    detailedVoltageAvg: upsDetails.length ? upsDetails.reduce((sum, row) => sum + row.voltage, 0) / upsDetails.length : null,
    detailedCurrentSum: upsDetails.reduce((sum, row) => sum + row.current, 0),
    airFields, airPrevious, airCurrent, airDifference, airEnergyKwh, dcPanels,
    totalDcPowerW: dcPanels.reduce((sum, row) => sum + row.dcPowerW, 0), totalDcAcCurrentA: dcPanels.reduce((sum, row) => sum + row.acCurrentA, 0),
    totalDcAcPowerW: dcPanels.reduce((sum, row) => sum + row.acPowerW, 0), totalDcEnergyKwh: dcPanels.reduce((sum, row) => sum + row.monthlyEnergyKwh, 0),
    buildingEnergyKwh: energy.buildingEnergyKwh, buildingCostThb: energy.buildingElectricityCostThb, floorEnergyKwh: energy.floorEnergyKwh,
    floorCostThb: energy.floorElectricityCostThb, averageRateThbPerKwh: energy.averageElectricityRateThbPerKwh, floorSharePercent: energy.energySharePercent
  };
}
