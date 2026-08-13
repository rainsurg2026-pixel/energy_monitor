import fs from "node:fs";
import type { MonthlyLog } from "../src/types";
import { buildMonthlyChartData } from "../src/domain/chartData";
import { daysInLocalMonthOr30, daysInUtcMonth, normalizedMonth, previousMonthOrEmpty } from "../src/domain/dates";
import { calculateEnergyCostForMonth, calculateAverageElectricityRate } from "../src/domain/energyCost";
import { buildEngineeringDashboardSnapshot } from "../src/domain/engineeringDashboard";
import { buildFacilityComparisonMetrics } from "../src/domain/facilityComparison";
import { calculateRackCapacityMetrics } from "../src/domain/rackCapacity";
import { findPreviousRackUnitCapacityRow, usagePercent } from "../src/domain/rackUnitCapacity";
import { calculateSrinakarinAggregate } from "../src/domain/srinakarinPower";
import { computeUpsGroupSummary } from "../src/domain/upsGroupAggregation";
import { DESKTOP_FORMULA_VERSION } from "../src/domain/formulaVersion";

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/desktop-v2.3.1.json", "utf8"));
const expected = JSON.parse(fs.readFileSync("tests/golden/desktop-v2.3.1.expected.json", "utf8"));
const rangsitLogs = fixture.rangsit.logs as MonthlyLog[];
const srinakarinLogs = fixture.srinakarin.logs as MonthlyLog[];

let passed = 0;
function assertEqual(name: string, actual: unknown, wanted: unknown): void {
  const actualJson = JSON.stringify(actual);
  const wantedJson = JSON.stringify(wanted);
  if (actualJson !== wantedJson) {
    throw new Error(`${name} failed\nactual: ${actualJson}\nexpected: ${wantedJson}`);
  }
  passed++;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

assertEqual("formula version", DESKTOP_FORMULA_VERSION, expected.formulaVersion);
assertEqual("Rangsit Energy Cost", calculateEnergyCostForMonth(rangsitLogs, "2026-03"), expected.rangsit.energy);
assertEqual("Rangsit chart data", buildMonthlyChartData(rangsitLogs), expected.rangsit.chart);

const rack = calculateRackCapacityMetrics(fixture.rangsit.rackRecords);
assertEqual("Rack Capacity", {
  total: rack.total,
  countsByStatus: rack.countsByStatus,
  inUse: rack.inUse,
  available: rack.available,
  reserved: rack.reserved,
  pendingDismantle: rack.pendingDismantle,
  other: rack.other,
  zoneMetrics: rack.zoneMetrics.map(zone => ({
    zone: zone.zone,
    total: zone.total,
    inUse: zone.inUse,
    available: zone.available,
    reserved: zone.reserved,
    pendingDismantle: zone.pendingDismantle,
    other: zone.other
  }))
}, expected.rangsit.rack);
assertEqual("Rack Unit previous row", findPreviousRackUnitCapacityRow(fixture.rangsit.rackUnitRows, "2026-03"), expected.rangsit.rackUnitPrevious);
assertEqual("Rack Unit usage", usagePercent(fixture.rangsit.rackUnitRows[1]), expected.rangsit.rackUnitUsagePercent);
assertEqual("UPS group summary", computeUpsGroupSummary(rangsitLogs[1], fixture.rangsit.upsGroups), expected.rangsit.groups);

const engineering = buildEngineeringDashboardSnapshot(
  rangsitLogs,
  "2026-03",
  fixture.rangsit.engineeringMapping,
  fixture.rangsit.engineeringTopology
);
if (!engineering) throw new Error("Engineering Dashboard snapshot unexpectedly missing");
assertEqual("Engineering Dashboard", {
  daysInMonth: engineering.daysInMonth,
  previousMonth: engineering.previousMonth,
  upsGroups: engineering.upsGroups,
  upsDetails: engineering.upsDetails,
  airDifference: engineering.airDifference,
  airEnergyKwh: engineering.airEnergyKwh,
  totalDcEnergyKwh: engineering.totalDcEnergyKwh,
  floorEnergyKwh: engineering.floorEnergyKwh
}, expected.rangsit.engineering);
assertEqual("Rangsit Site Comparison", [...buildFacilityComparisonMetrics(rangsitLogs, "2026-03").entries()], expected.rangsit.comparison);

assertEqual("Srinakarin Energy Cost", calculateEnergyCostForMonth(srinakarinLogs, "2026-03"), expected.srinakarin.energy);
assertEqual("Srinakarin aggregate", calculateSrinakarinAggregate(srinakarinLogs[1]).map(row => ({
  upsId: row.upsId,
  voltage: row.voltage,
  current: row.current,
  loadKw: row.loadKw,
  loadKva: row.loadKva
})), expected.srinakarin.aggregate);
assertEqual("Srinakarin Site Comparison", [...buildFacilityComparisonMetrics(srinakarinLogs, "2026-03").entries()], expected.srinakarin.comparison);

// Date, leap-year, previous-dependency, duplicate, null, zero and blank contracts.
assertEqual("numeric month normalization", normalizedMonth("2026/3"), "2026-03");
assertEqual("short month normalization", normalizedMonth("Mar-26"), "2026-03");
assertEqual("leap-year days", daysInUtcMonth("2024-02"), 29);
assertEqual("local malformed month fallback", daysInLocalMonthOr30("not-a-month"), 30);
assertEqual("previous year boundary", previousMonthOrEmpty("2026-01"), "2025-12");
assertEqual("zero building-energy rate", calculateAverageElectricityRate(0, 100), null);
assertEqual("zero Rack Capacity denominator", calculateRackCapacityMetrics([]).inUse.ratio, null);
assertEqual("zero Rack Unit denominator", usagePercent({ totalU: 0, usedU: 0 }), null);
assertEqual("zero UPS group capacity", computeUpsGroupSummary(rangsitLogs[1], [{ name: "zero", ids: ["UPS 11A"], capacity: 0 }])[0], {
  name: "zero", totalLoadKw: 10, totalLoadKva: 12, capacity: 0, loadPercent: null, availablePercent: null, monthlyEnergyKwh: 7440
});

const missingPrevious = calculateEnergyCostForMonth([rangsitLogs[1]], "2026-03");
assertEqual("missing previous air dependency", { ups: missingPrevious.upsEnergyKwh, air: missingPrevious.airEnergyKwh, dc: missingPrevious.dcEnergyKwh, floor: missingPrevious.floorEnergyKwh }, {
  ups: 55056, air: null, dc: 3928.32, floor: null
});

const duplicateCurrent = calculateEnergyCostForMonth([...rangsitLogs, clone(rangsitLogs[1])], "2026-03");
assertEqual("duplicate month rejection", duplicateCurrent, {
  buildingEnergyKwh: null, buildingElectricityCostThb: null, upsEnergyKwh: null, airEnergyKwh: null,
  dcEnergyKwh: null, floorEnergyKwh: null, floorElectricityCostThb: null,
  averageElectricityRateThbPerKwh: null, energySharePercent: null
});

const missingMemberLogs = clone(rangsitLogs);
missingMemberLogs[1].ups = missingMemberLogs[1].ups.filter(row => row.upsId !== "UPS 14C");
const missingMember = calculateEnergyCostForMonth(missingMemberLogs, "2026-03");
assertEqual("missing required UPS member", missingMember.floorEnergyKwh, null);

console.log(`domain parity: ${passed} assertions passed; formula=${DESKTOP_FORMULA_VERSION}`);
