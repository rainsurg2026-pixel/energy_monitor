import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAllFacilitiesCsv, buildAllFacilitiesReportHtml, buildFacilityCsv, buildSiteComparisonReportModel, facilityReportData, workbookForFacilities, writeInteractiveExcelWorkbook, type ExportFacility } from "../src/web-clean-v1/exports";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import type { MonthlyLog } from "../src/types";

const out = path.resolve("dist-electron/test-work/export-ui-parity");
await mkdir(out, { recursive: true });
const log = (month: string, energy: number, cost: number): MonthlyLog => ({
  month, ups: [], air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} }, dc: [],
  energyCost: { buildingEnergyKwh: energy, buildingElectricityCostThb: cost },
  lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
});
const rack = { sourceSheet: "Rack Capacity", sourceTable: "Table7", sourceSnapshot: "2026-06", records: [
  { rowNumber: 1, rackZone: "A", rackId: "A-01", status: "In Use", cabinetSize: "60*100", detail: null, deviceType: null, remarks: null },
  { rowNumber: 2, rackZone: "A", rackId: "A-02", status: "Available", cabinetSize: "60*100", detail: "spare", deviceType: null, remarks: null },
  { rowNumber: 3, rackZone: "B", rackId: "B-01", status: "Reserved", cabinetSize: "60*120", detail: "held", deviceType: null, remarks: null },
  { rowNumber: 4, rackZone: "B", rackId: "B-02", status: "Pending Dismantle", cabinetSize: "60*120", detail: "EOL", deviceType: null, remarks: null },
], byZone: [], byStatus: [], byCabinetSize: [], byDeviceType: [], validation: { duplicateIds: [], missingRequiredFields: [], invalidStatuses: [], invalidDataTypes: [], unsupportedUMetrics: [] } } as any;const facilities: ExportFacility[] = [
  { siteName: "Rangsit", siteCode: "RST", logs: [log("2026-05", 95, 475), log("2026-06", 100, 500)], rack, rackUnitCapacity: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, availabilityPct: 0.25 }] },
  { siteName: "Srinakarin", siteCode: "SRN", logs: [log("2026-05", 85, 382.5), log("2026-06", 90, 405)], rack, rackUnitCapacity: [{ month: "2026-06", totalU: 180, usedU: 120, availableU: 60, availabilityPct: 1 / 3 }] },
];
const model = buildSiteComparisonReportModel({
  displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" }, months: ["2026-05", "2026-06"],
  sites: [
    { site: { id: 1, code: "RST", name: "Rangsit" }, months: [{ month: "2026-05", metrics: { buildingEnergy: 95, buildingCost: 475, floorEnergy: 0, floorCost: 0, avgRate: 5, floorShare: 0 } }, { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 0, floorCost: 0, avgRate: 5, floorShare: 0 } }], rack, rackUnitCapacity: facilities[0].rackUnitCapacity },
    { site: { id: 2, code: "SRN", name: "Srinakarin" }, months: [{ month: "2026-05", metrics: { buildingEnergy: 85, buildingCost: 382.5, floorEnergy: 0, floorCost: 0, avgRate: 4.5, floorShare: 0 } }, { month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 0, floorCost: 0, avgRate: 4.5, floorShare: 0 } }], rack, rackUnitCapacity: facilities[1].rackUnitCapacity },
  ]
} as any, "2026-06");
const currentHtml = buildReportHtml(facilityReportData(facilities[0].logs, "Rangsit", "2026-06", rack, [], facilities[0].rackUnitCapacity ?? []));
const allHtml = buildAllFacilitiesReportHtml(facilities, model, "2026-06");
const currentCsv = buildFacilityCsv(facilities[0]);
const allCsv = buildAllFacilitiesCsv(facilities, model);
await writeFile(path.join(out, "current-facility.html"), currentHtml);
await writeFile(path.join(out, "all-facilities.html"), allHtml);
await writeFile(path.join(out, "current-facility.csv"), currentCsv);
await writeFile(path.join(out, "all-facilities.csv"), allCsv);const currentWorkbook = await workbookForFacilities([facilities[0]]);
const allWorkbook = await workbookForFacilities(facilities, model);
await writeFile(path.join(out, "current-facility.xlsx"), await writeInteractiveExcelWorkbook(currentWorkbook));
await writeFile(path.join(out, "all-facilities.xlsx"), await writeInteractiveExcelWorkbook(allWorkbook));

const checks = [
  ["Building Energy", "100", currentHtml.includes("100.00") || currentHtml.includes("100"), currentCsv.includes("100"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(100))],
  ["Building Cost", "500", currentHtml.includes("500.00") || currentHtml.includes("500"), currentCsv.includes("500"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(500))],
  ["Rack Total", "4", currentHtml.includes("Total Racks") && currentHtml.includes(">4<"), currentCsv.includes("RACK_CAPACITY_SUMMARY") && currentCsv.includes(",4,"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(4))],
  ["Rack Available", "1", currentHtml.includes("Available") && currentHtml.includes(">1<"), currentCsv.includes(",1,"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(1))],
  ["Rack Unit Total U", "200", currentHtml.includes("200"), currentCsv.includes("200,150,50"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(200))],
  ["Rack Unit Used U", "150", currentHtml.includes("150"), currentCsv.includes("200,150,50"), currentWorkbook.worksheets.some(s => s.getSheetValues().flat().includes(150))],
] as const;
console.log("Metric | Expected | HTML | CSV | XLSX | Result");
let failed = false;
for (const [metric, expected, html, csv, xlsx] of checks) {
  const ok = html && csv && xlsx;
  console.log(`${metric} | ${expected} | ${html ? "OK" : "MISS"} | ${csv ? "OK" : "MISS"} | ${xlsx ? "OK" : "MISS"} | ${ok ? "OK" : "MISMATCH"}`);
  if (!ok) failed = true;
}
if (failed) throw new Error("Export reconciliation mismatch detected.");
console.log(`Samples written to ${out}`);