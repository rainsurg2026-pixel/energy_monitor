import assert from "node:assert/strict";
import { buildAllFacilitiesCsv, buildSiteComparisonCsv, type SiteComparisonExport } from "../src/web-clean-v1/exports";
import type { MonthlyLog } from "../src/types";

const log = (month: string): MonthlyLog => ({
  month,
  ups: [],
  air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
  dc: [],
  energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 500 },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
});

const comparison: SiteComparisonExport = {
  displayPeriod: { startMonth: "2025-12", endMonth: "2026-01" },
  months: ["2025-12", "2026-01"],
  sites: [
    { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 50, floorCost: 250, avgRate: 5, floorShare: 50 } }] },
    { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 200, buildingCost: 900, floorEnergy: 80, floorCost: 360, avgRate: 4.5, floorShare: 40 } }] }
  ]
};

const allFacilities = buildAllFacilitiesCsv([{ siteName: "Rangsit", logs: [log("2026-01")] }, { siteName: "Srinakarin", logs: [log("2026-01")] }]);
assert.match(allFacilities, /# Facility: Rangsit/);
assert.match(allFacilities, /# Facility: Srinakarin/);
assert.match(allFacilities, /# Energy_Cost/);

const csv = buildSiteComparisonCsv(comparison, "2026-01");
assert.match(csv, /Rangsit,rangsit,2026-01,100.00,500.00/);
assert.match(csv, /Srinakarin,srinakarin,2026-01,200.00,900.00/);
assert.doesNotMatch(csv, /undefined|NaN/);

console.log("web-clean-v1 exports: 7 assertions passed");
