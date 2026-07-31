import { MonthlyLog } from "../types";
import { parseSafeNumber } from "../excel/SheetMapper";
import { getAirFields, getAirValue } from "./energyCost";

/**
 * Completion metrics for one monthly record - drives the workflow header,
 * the sticky entry toolbar and the save validation (RC2/RC3/RC4).
 */

export interface SectionCompletion {
  filled: number;
  total: number;
  percent: number; // 0-100, rounded
}

export interface CompletionSummary {
  ups: SectionCompletion;
  air: SectionCompletion;
  dc: SectionCompletion;
  energy: SectionCompletion;
  overall: SectionCompletion;
}

export interface MissingField {
  section: "ups" | "air" | "dc" | "energy";
  /** Human-readable location, e.g. "UPS 11A · Voltage (V)" */
  label: string;
}

/**
 * Imperative surface each entry table registers with the App so the sticky
 * toolbar (RC3) can Save/Reset all sections at once.
 */
export interface EntrySectionApi {
  commit: () => void;
  reset: () => void;
  hasChanges: () => boolean;
}

const isFilled = (v: unknown): boolean => parseSafeNumber(v) !== null;

function section(filled: number, total: number): SectionCompletion {
  return { filled, total, percent: total === 0 ? 100 : Math.round((filled / total) * 100) };
}

export function computeCompletion(log: MonthlyLog | null): CompletionSummary {
  if (!log) {
    const empty = section(0, 0);
    return { ups: empty, air: empty, dc: empty, energy: empty, overall: section(0, 1) };
  }

  let upsFilled = 0;
  for (const u of log.ups) {
    if (isFilled(u.voltage)) upsFilled++;
    if (isFilled(u.current)) upsFilled++;
    if (isFilled(u.loadKw)) upsFilled++;
    if (isFilled(u.loadKva)) upsFilled++;
  }
  const ups = section(upsFilled, log.ups.length * 4);

  const airFields = getAirFields(log);
  const airValues = airFields.map(field => getAirValue(log, field));
  const air = section(airValues.filter(isFilled).length, airValues.length);

  let dcFilled = 0;
  for (const d of log.dc) {
    if (isFilled(d.voltage)) dcFilled++;
    if (isFilled(d.current)) dcFilled++;
  }
  const dc = section(dcFilled, log.dc.length * 2);

  const energyValues = [log.energyCost.buildingEnergyKwh, log.energyCost.buildingElectricityCostThb];
  const energy = section(energyValues.filter(isFilled).length, energyValues.length);

  const overall = section(
    ups.filled + air.filled + dc.filled + energy.filled,
    ups.total + air.total + dc.total + energy.total
  );
  return { ups, air, dc, energy, overall };
}

/** Field-level list of everything still empty (RC4 validation popup). */
export function listMissingFields(log: MonthlyLog): MissingField[] {
  const missing: MissingField[] = [];
  for (const u of log.ups) {
    if (!isFilled(u.voltage)) missing.push({ section: "ups", label: `${u.upsId} · Voltage (V)` });
    if (!isFilled(u.current)) missing.push({ section: "ups", label: `${u.upsId} · Current (A)` });
    if (!isFilled(u.loadKw)) missing.push({ section: "ups", label: `${u.upsId} · Load (kW)` });
    if (!isFilled(u.loadKva)) missing.push({ section: "ups", label: `${u.upsId} · Load (kVA)` });
  }
  for (const field of getAirFields(log)) {
    if (!isFilled(getAirValue(log, field))) missing.push({ section: "air", label: `${field.toUpperCase()} (GWh)` });
  }
  for (const d of log.dc) {
    if (!isFilled(d.voltage)) missing.push({ section: "dc", label: `${d.panelId} · Voltage (V)` });
    if (!isFilled(d.current)) missing.push({ section: "dc", label: `${d.panelId} · Current (A)` });
  }
  if (!isFilled(log.energyCost.buildingEnergyKwh))
    missing.push({ section: "energy", label: "Building Energy Consumption (kWh)" });
  if (!isFilled(log.energyCost.buildingElectricityCostThb))
    missing.push({ section: "energy", label: "Building Electricity Cost (THB)" });
  return missing;
}
