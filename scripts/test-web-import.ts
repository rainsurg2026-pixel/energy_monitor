import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { ImportService } from "../server/services/importService";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { InMemoryObjectStorage } from "../server/storage/objectStorage";
import { WorkbookBackupService } from "../server/services/workbookBackupService";

async function workbookBuffer(energyBase = 90000): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ups = workbook.addWorksheet("1. UPS Data Log"); ups.addRow(["Month", "UPS", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"]); ups.addRows([["2026-02", "UPS 11A", 220, 10, 10, 12], ["2026-03", "UPS 11A", 220, 10, 10, 12]]);
  const air = workbook.addWorksheet("2. Air Energy Consumption Log"); air.addRow(["Month", "EB41A", "EB41B", "EB42A", "EB42B"]); air.addRows([["2026-02", 100, 200, 300, 400], ["2026-03", 101, 202, 303, 404]]);
  const dc = workbook.addWorksheet("3. DC Data Log"); dc.addRow(["Month", "DC Panel", "Voltage (V)", "Current (A)"]); dc.addRows([["2026-02", "DC PDB41A", 48, 10], ["2026-03", "DC PDB41A", 48, 10]]);
  const energy = workbook.addWorksheet("4. Electricity Cost Log"); energy.addRow(["Month", "Building Energy (kWh)", "Building Electricity Cost (THB)"]); energy.addRows([["2026-02", energyBase, 450000], ["2026-03", energyBase + 10000, 500000]]);
  const racks = workbook.addWorksheet("Rack Capacity"); racks.addRow(["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"]); racks.addRow(["Zone A", "RACK-001", "In Use", "600x1200", "Test rack", "Server", ""]);
  const rackUnits = workbook.addWorksheet("Rack Unit Capacity"); rackUnits.addRow(["Month", "Total (U)", "Used (U)", "Available (U)", "Availability Capacity (%)"]); rackUnits.addRow([new Date("2026-03-01T00:00:00Z"), 400, 100, 300, 0.75]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const sites = [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }];
const settings = { startMonth: "2026-02", endMonth: "2026-03", rowVersion: 1 };
const buffer = await workbookBuffer();
const repository = new InMemoryRepository({ sites, settings });
const objectStorage = new InMemoryObjectStorage();
const service = new ImportService(repository, () => new Date("2026-03-20T00:00:00Z"), objectStorage);
const result = await service.importWorkbook(1, "DC_Rangsit.xlsx", buffer, "import-test", 7);
assert.equal(result.importedMonths.length, 2);
assert.equal(result.sourceFileHash.length, 64);
assert.equal(result.validation.ok, true);
assert.equal(result.rackCapacitySnapshotMonth, "2026-03");
assert.deepEqual(result.rackUnitCapacityMonths, ["2026-03"]);
assert.equal((await repository.getMonthlyLogs(1, ["2026-02", "2026-03"])).length, 2);

const secondBuffer = await workbookBuffer(91000);
const secondResult = await service.importWorkbook(1, "DC_Rangsit_v2.xlsx", secondBuffer, "import-test-v2", 7);
const backupService = new WorkbookBackupService(repository, objectStorage, service);
const backups = await backupService.list(1);
assert.equal(backups.length, 2);
assert.equal(backups.find(item => item.sourceFileHash === secondResult.sourceFileHash)?.isCurrent, true);
const firstBackup = backups.find(item => item.sourceFileHash === result.sourceFileHash);
assert.ok(firstBackup);
await backupService.restore(1, firstBackup.id, 7, "restore-test");
assert.equal((await repository.getWorkbookSource(1))?.sourceFileHash, result.sourceFileHash);
assert.equal((await repository.getMonthlyLogs(1, ["2026-02"]))[0]?.energyCost.buildingEnergyKwh, 90000);
assert.equal((await repository.getRackSnapshot(1, "2026-03"))?.records.length, 1);
assert.equal((await repository.getRackUnitSnapshot(1, "2026-03"))?.usedU, 100);
assert.equal(result.idempotent, false);
assert.equal((await repository.getWorkbookSource(1))?.sourceFileHash, result.sourceFileHash);
const auditCountAfterFirstImport = repository.auditEvents.length;
const duplicateResult = await service.importWorkbook(1, "DC_Rangsit.xlsx", buffer, "duplicate-test", 7);
assert.equal(duplicateResult.idempotent, true);
assert.equal(repository.auditEvents.length, auditCountAfterFirstImport);
assert.equal((await repository.getMonthlyLogs(1, ["2026-02", "2026-03"])).length, 2);

const rollbackRepository = new InMemoryRepository({ sites, settings, auditFailure: true });
const rollbackService = new ImportService(rollbackRepository, () => new Date("2026-03-20T00:00:00Z"), new InMemoryObjectStorage());
await assert.rejects(() => rollbackService.importWorkbook(1, "DC_Rangsit.xlsx", buffer, "rollback-test", 7));
assert.equal((await rollbackRepository.getMonthlyLogs(1, ["2026-02", "2026-03"])).length, 0);

const invalidWorkbook = new ExcelJS.Workbook(); invalidWorkbook.addWorksheet("invalid");
const invalidBuffer = Buffer.from(await invalidWorkbook.xlsx.writeBuffer());
await assert.rejects(() => service.importWorkbook(1, "invalid.xlsx", invalidBuffer, "invalid-test", 7), /WORKBOOK_VALIDATION_FAILED|missing|required|could not find/i);
console.log("web workbook import: 20 assertions passed; monthly, rack, source retention, backup restore, transaction rollback, idempotency and provenance hash verified");
