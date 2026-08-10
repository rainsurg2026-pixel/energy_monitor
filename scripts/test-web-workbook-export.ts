import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWebWorkbook } from "../src/web/workbookExport";
import type { MonthlyLog } from "../src/types";

const logs: MonthlyLog[] = [{
  month: "2026-03",
  ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 10, loadKva: 12 }],
  air: { eb41a: 100, eb41b: 200, eb42a: 300, eb42b: 400 },
  dc: [{ panelId: "DC PDB41A", voltage: 48, current: 10 }],
  energyCost: { buildingEnergyKwh: 100000, buildingElectricityCostThb: 500000 },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
}];
const blob = await buildWebWorkbook(logs, "Rangsit Data Center", [{ month: "2026-03", records: [{ rowNumber: 2, rackZone: "Zone A", rackId: "RACK-001", status: "In Use", cabinetSize: "600x1200", detail: "Test rack", deviceType: "Server", remarks: null }] }], [{ month: "2026-03", totalU: 400, usedU: 100 }]);
assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
assert.ok(blob.size > 0);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()) as unknown as ArrayBuffer);
assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Summary", "UPS Loads", "Air Conditioning", "DC Power Panels", "Energy & Cost", "Rack Capacity", "Rack Unit Capacity"]);
assert.equal(workbook.getWorksheet("UPS Loads")?.getCell("B2").value, "UPS 11A");
assert.equal(workbook.getWorksheet("Energy & Cost")?.getCell("B2").value, 100000);
assert.equal(workbook.getWorksheet("Rack Capacity")?.getCell("D2").value, "RACK-001");
assert.equal(workbook.getWorksheet("Rack Unit Capacity")?.getCell("D2").value, 300);
console.log("web workbook export: 7 assertions passed; readable XLSX with monthly and rack sections");
