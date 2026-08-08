/**
 * Storage- and UI-neutral shapes used by the reusable calculation layer.
 * These are intentionally structural so callers can adapt workbook/report
 * records without making the domain depend on Excel, Electron, or React.
 */

export interface DomainRackRecord {
  rowNumber?: number;
  rackZone: string | null;
  rackId?: string | null;
  status: string | null;
  cabinetSize?: string | null;
  detail?: string | null;
  deviceType?: string | null;
  remarks?: string | null;
}
export interface DomainRackUnitCapacityRow {
  month: string;
  totalU: number;
  usedU: number;
  availableU: number;
  availabilityPct?: number | null;
}

export interface DomainDashboardUpsSummaryRow {
  no: number;
  name: string;
  totalLoadKw: number | null;
  totalLoadKva: number | null;
  capacity: number | null;
  loadPercent: number | null;
}

export interface DomainDashboardUpsMappingRow {
  no: number;
  umdb: string;
  upsId: string;
  acPowerPanel: string;
  sts: string;
  oudb: string;
  voltage: number | null;
  current: number | null;
  loadKw: number | null;
  loadKva: number | null;
  capacity: number | null;
  loadPercent: number | null;
}

export interface DomainDashboardUpsMappingReport {
  sourceSheet: string;
  summary: DomainDashboardUpsSummaryRow[];
  mapping: DomainDashboardUpsMappingRow[];
}

export interface DomainEngineeringDashboardSnapshot {
  daysInMonth: number;
  previousMonth: string | null;
  upsGroups: Array<{ name: string; totalKw: number; totalKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }>;
  upsOverallGroups: Array<{ name: string; totalKw: number; totalKva: number; capacity: number | null; loadPercent: number | null; availablePercent: number | null; monthlyEnergyKwh: number }>;
  upsDetails: Array<{ no: number; umdb: string; upsId: string; acPowerPanel: string; sts: string; oudb: string; voltage: number; current: number; loadKw: number; loadKva: number; capacity: number | null; loadPercent: number | null }>;
  totalUpsKw: number;
  totalUpsKva: number;
  totalUpsEnergyKwh: number;
  detailedVoltageAvg: number | null;
  detailedCurrentSum: number;
  airFields: string[];
  airPrevious: Record<string, number | null>;
  airCurrent: Record<string, number | null>;
  airDifference: Record<string, number | null>;
  airEnergyKwh: number | null;
  dcPanels: Array<{ panelId: string; voltage: number; current: number; dcPowerW: number; acCurrentA: number; acPowerW: number; monthlyEnergyKwh: number }>;
  totalDcPowerW: number;
  totalDcAcCurrentA: number;
  totalDcAcPowerW: number;
  totalDcEnergyKwh: number;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
}
