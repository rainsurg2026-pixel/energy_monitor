import type { MonthlyLog, UpsRecord, DcRecord } from "../types";
import { daysInUtcMonth, normalizedMonth, previousUtcMonth } from "./dates";

export interface EnergyCostCalculation {
  buildingEnergyKwh: number | null;
  buildingElectricityCostThb: number | null;
  upsEnergyKwh: number | null;
  airEnergyKwh: number | null;
  dcEnergyKwh: number | null;
  floorEnergyKwh: number | null;
  floorElectricityCostThb: number | null;
  averageElectricityRateThbPerKwh: number | null;
  energySharePercent: number | null;
}
const UPS_GROUPS = [
  ["UPS 11A", "UPS 11B"],
  ["UPS 13A", "UPS 13B"],
  ["UPS 14C"],
  ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"]
] as const;

const DC_IDS = ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"] as const;

export const LEGACY_AIR_FIELDS = ["eb41a", "eb41b", "eb42a", "eb42b"] as const;

export { normalizedMonth };

function matchUpsId(expected: string, actual: string): boolean {
  const cleanExpected = expected.replace(/\s+/g, "").toLowerCase();
  const cleanActual = actual.replace(/\s+/g, "").toLowerCase();
  if (!cleanExpected || !cleanActual) return false;
  return cleanExpected === cleanActual || cleanExpected.includes(cleanActual) || cleanActual.includes(cleanExpected);
}

function matchDcId(expected: string, actual: string): boolean {
  const cleanExpected = expected.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const cleanActual = actual.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (!cleanExpected || !cleanActual) return false;
  return cleanExpected === cleanActual || cleanExpected.includes(cleanActual) || cleanActual.includes(cleanExpected);
}

function findUps(log: MonthlyLog, id: string): UpsRecord | null {
  return log.ups.find(record => matchUpsId(id, record.upsId)) ?? null;
}

function findDc(log: MonthlyLog, id: string): DcRecord | null {
  return log.dc.find(record => matchDcId(id, record.panelId)) ?? null;
}

export function getAirFields(log: MonthlyLog, configuredFields?: readonly string[]): string[] {
  if (configuredFields && configuredFields.length > 0) return [...configuredFields];
  const configured = log.energyCalculation?.airFields;
  if (configured && configured.length > 0) return [...configured];
  const meters = Object.keys(log.air.meters ?? {});
  return meters.length > 0 ? meters : [...LEGACY_AIR_FIELDS];
}

export function getAirValue(log: MonthlyLog, field: string): number | null {
  const fixed = log.air as unknown as Record<string, number | null | undefined>;
  const meter = log.air.meters?.[field] ?? null;
  // EB41/EB42 are top-level records; configured EB43/EB44 fields are meters.
  // Keep a fallback for records saved by older releases on the other path.
  return (LEGACY_AIR_FIELDS as readonly string[]).includes(field)
    ? fixed[field] ?? meter
    : meter ?? fixed[field] ?? null;
}

/** Excel direct arithmetic cannot safely be replaced by a zero for a blank lookup. */
function sumRequired(values: Array<number | null>): number | null {
  if (values.some(value => value === null || !Number.isFinite(value))) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0);
}

function calculateUpsEnergy(log: MonthlyLog, days: number): number | null {
  const groups = log.energyCalculation?.upsGroups ?? UPS_GROUPS;
  const groupLoads = groups.map(group => sumRequired(group.map(id => findUps(log, id)?.loadKw ?? null)));
  const totalKw = sumRequired(groupLoads);
  return totalKw === null ? null : totalKw * 24 * days;
}

function calculateAirEnergy(current: MonthlyLog, previous: MonthlyLog | null): number | null {
  if (!previous) return null;
  const fields = getAirFields(current);
  const deltas = fields.map(field => {
    const value = getAirValue(current, field);
    const previousValue = getAirValue(previous, field);
    return value === null || previousValue === null ? null : value - previousValue;
  });
  const totalDelta = sumRequired(deltas);
  return totalDelta === null ? null : totalDelta * 1000000;
}

function calculateDcEnergy(log: MonthlyLog, days: number): number | null {
  const ids = log.energyCalculation?.dcIds ?? DC_IDS;
  const panelEnergy = ids.map(id => {
    const panel = findDc(log, id);
    if (!panel || panel.voltage === null || panel.current === null) return null;
    return (panel.voltage * panel.current / 200) * 220 / 1000 * 24 * days;
  });
  return sumRequired(panelEnergy);
}

export function calculateAverageElectricityRate(
  buildingEnergyKwh: number | null,
  buildingElectricityCostThb: number | null
): number | null {
  return buildingEnergyKwh === null || buildingElectricityCostThb === null
    || !Number.isFinite(buildingEnergyKwh) || !Number.isFinite(buildingElectricityCostThb)
    || buildingEnergyKwh === 0
    ? null
    : Number.isFinite(buildingElectricityCostThb / buildingEnergyKwh)
      ? buildingElectricityCostThb / buildingEnergyKwh
      : null;
}

export function calculateFloorElectricityCost(
  buildingEnergyKwh: number | null,
  buildingElectricityCostThb: number | null,
  floorEnergyKwh: number | null
): number | null {
  const averageRate = calculateAverageElectricityRate(buildingEnergyKwh, buildingElectricityCostThb);
  return averageRate === null || floorEnergyKwh === null || !Number.isFinite(floorEnergyKwh)
    ? null
    : averageRate * floorEnergyKwh;
}

/**
 * Desktop v2.3.1 Dashboard-FAC calculation mapping:
 * UPS groups * 24 * calendar days; air meter deltas * 1,000,000; and DC
 * voltage/current conversion through the 200/220 factor. Raw building energy
 * and cost remain authoritative inputs; workbook cached derived values are not
 * read here.
 */
export function calculateEnergyCostForMonth(
  logs: readonly MonthlyLog[],
  reportingMonth: string
): EnergyCostCalculation {
  const month = normalizedMonth(reportingMonth);
  const empty: EnergyCostCalculation = {
    buildingEnergyKwh: null,
    buildingElectricityCostThb: null,
    upsEnergyKwh: null,
    airEnergyKwh: null,
    dcEnergyKwh: null,
    floorEnergyKwh: null,
    floorElectricityCostThb: null,
    averageElectricityRateThbPerKwh: null,
    energySharePercent: null
  };
  if (!month) return empty;

  const matchingLogs = logs.filter(log => normalizedMonth(log.month) === month);
  if (matchingLogs.length !== 1) return empty;
  const log = matchingLogs[0];
  const buildingEnergyKwh = log.energyCost.buildingEnergyKwh;
  const buildingElectricityCostThb = log.energyCost.buildingElectricityCostThb;
  const days = daysInUtcMonth(month);
  if (days === null) return { ...empty, buildingEnergyKwh, buildingElectricityCostThb };

  const previous = previousUtcMonth(month);
  const previousMatches = previous
    ? logs.filter(candidate => normalizedMonth(candidate.month) === previous)
    : [];
  const previousLog = previousMatches.length === 1 ? previousMatches[0] : null;
  const upsEnergyKwh = calculateUpsEnergy(log, days);
  const airEnergyKwh = calculateAirEnergy(log, previousLog);
  const dcEnergyKwh = calculateDcEnergy(log, days);
  const floorEnergyKwh = upsEnergyKwh === null || airEnergyKwh === null || dcEnergyKwh === null
    ? null
    : upsEnergyKwh + airEnergyKwh + dcEnergyKwh;

  const averageElectricityRateThbPerKwh = calculateAverageElectricityRate(
    buildingEnergyKwh,
    buildingElectricityCostThb
  );
  const floorElectricityCostThb = calculateFloorElectricityCost(
    buildingEnergyKwh,
    buildingElectricityCostThb,
    floorEnergyKwh
  );
  const energySharePercent =
    floorEnergyKwh === null || buildingEnergyKwh === null || buildingEnergyKwh === 0
      ? null
      : (floorEnergyKwh / buildingEnergyKwh) * 100;

  return {
    buildingEnergyKwh,
    buildingElectricityCostThb,
    upsEnergyKwh,
    airEnergyKwh,
    dcEnergyKwh,
    floorEnergyKwh,
    floorElectricityCostThb,
    averageElectricityRateThbPerKwh,
    energySharePercent
  };
}
