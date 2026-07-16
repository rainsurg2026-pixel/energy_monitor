export interface UpsRecord {
  upsId: string; // e.g., "UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A", "UPS 15B"
  voltage: number | null;
  current: number | null;
  loadKw: number | null;
  loadKva: number | null;
}

export interface AirRecord {
  eb41a: number | null; // GWh
  eb41b: number | null; // GWh
  eb42a: number | null; // GWh
  eb42b: number | null; // GWh
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
}

export interface SecurityConfig {
  pinEnabled: boolean;
  pinHash: string | null;
}
