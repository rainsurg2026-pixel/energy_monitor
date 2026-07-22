export interface PhaseReading {
  voltage: number | null;
  current: number | null;
  loadKw: number | null;
  loadKva: number | null;
}

export interface UpsRecord {
  upsId: string; // e.g., "UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A", "UPS 15B"
  voltage: number | null;
  current: number | null;
  loadKw: number | null;
  loadKva: number | null;
  phases?: Record<string, PhaseReading>;
}

export interface AirRecord {
  eb41a: number | null; // GWh
  eb41b: number | null; // GWh
  eb42a: number | null; // GWh
  eb42b: number | null; // GWh
  eb43a?: number | null; // GWh (Srinakarin)
  eb43b?: number | null; // GWh (Srinakarin)
  eb44a?: number | null; // GWh (Srinakarin)
  eb44b?: number | null; // GWh (Srinakarin)
  /** Additional facility-specific meter fields (for example EB43/EB44). */
  meters?: Record<string, number | null>;
}

export interface EnergyCalculationProfile {
  /** UPS/PPC groups used by the workbook's floor-energy chain. */
  upsGroups: string[][];
  /** DC panels used by the workbook's floor-energy chain. */
  dcIds: string[];
  /** Air meter keys used in the month-over-month delta chain. */
  airFields: string[];
}

export interface SrinakarinInputSnapshot {
  upsPhase: Record<string, { voltage: number | null; current: number | null; loadKw: number | null; loadKva: number | null }>;
  acPhase: Record<string, { voltage: number | null; current: number | null }>;
  ppc43Current: Record<string, number | null>;
  ppc43Panel: Record<string, { loadKw: number | null; loadKva: number | null }>;
}

export interface DcRecord {
  panelId: string; // e.g., "DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"
  voltage: number | null;
  current: number | null;
}

export interface EnergyCostRecord {
  buildingEnergyKwh: number | null;
  buildingElectricityCostThb: number | null;
}

export interface MonthlyLog {
  month: string; // "YYYY-MM"
  ups: UpsRecord[];
  air: AirRecord;
  dc: DcRecord[];
  energyCost: EnergyCostRecord;
  lastSavedUps: string | null;
  lastSavedAir: string | null;
  lastSavedDc: string | null;
  lastSavedEnergyCost: string | null;
  /** Optional workbook-specific calculation mapping; absent means Rangsit compatibility mode. */
  energyCalculation?: EnergyCalculationProfile;
  /** Raw Srinakarin input rows retained for safe phase-level round trips. */
  srinakarinInputs?: SrinakarinInputSnapshot;
}

export interface SecurityConfig {
  pinEnabled: boolean;
  pinHash: string | null;
}
