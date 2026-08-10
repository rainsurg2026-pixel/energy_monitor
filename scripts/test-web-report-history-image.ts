import assert from "node:assert/strict";
import zlib from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { ImportService } from "../server/services/importService";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { InMemoryObjectStorage } from "../server/storage/objectStorage";
import { ReportService } from "../server/services/reportService";
import { ApiService } from "../server/services/apiService";
import { calculateRackCapacityMetrics } from "../src/utils/rackCapacity";
import { ensureRackCapacityHistorySheet, rackCapacityHistoryRowsFromMetrics, upsertRackCapacityHistoryRows } from "../src/excel/RackCapacityHistoryWriter";
import { ensureRackUnitCapacityImageHistorySheet, upsertRackUnitCapacityImageHistoryRow } from "../src/excel/RackUnitCapacityImageHistoryWriter";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function testPng(): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.from([0, 30, 120, 210, 30, 120, 210]);
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function sourceWorkbook(): Promise<{ buffer: Buffer; image: Buffer }> {
  const workbook = new ExcelJS.Workbook();
  const ups = workbook.addWorksheet("1. UPS Data Log"); ups.addRow(["Month", "UPS", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"]); ups.addRow(["2026-03", "UPS 11A", 220, 10, 10, 12]);
  const air = workbook.addWorksheet("2. Air Energy Consumption Log"); air.addRow(["Month", "EB41A", "EB41B", "EB42A", "EB42B"]); air.addRow(["2026-03", 100, 200, 300, 400]);
  const dc = workbook.addWorksheet("3. DC Data Log"); dc.addRow(["Month", "DC Panel", "Voltage (V)", "Current (A)"]); dc.addRow(["2026-03", "DC PDB41A", 48, 10]);
  const energy = workbook.addWorksheet("4. Electricity Cost Log"); energy.addRow(["Month", "Building Energy (kWh)", "Building Electricity Cost (THB)"]); energy.addRow(["2026-03", 90000, 450000]);
  const racks = workbook.addWorksheet("Rack Capacity"); racks.addRow(["Rack Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"]); racks.addRow(["Zone A", "RACK-001", "In Use", "600x1200", "Test rack", "Server", ""]);
  const rackUnits = workbook.addWorksheet("Rack Unit Capacity"); rackUnits.addRow(["Month", "Total (U)", "Used (U)", "Available (U)", "Availability Capacity (%)"]); rackUnits.addRow([new Date("2026-03-01T00:00:00Z"), 400, 100, 300, 0.75]);
  const image = testPng();
  let buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const metrics = calculateRackCapacityMetrics([{ rackZone: "Zone A", rackId: "RACK-001", status: "In Use" }]);
  const historySheet = await ensureRackCapacityHistorySheet(zip);
  await upsertRackCapacityHistoryRows(zip, historySheet.xmlPath, rackCapacityHistoryRowsFromMetrics("Rangsit Data Center", "2026-03", metrics, "2026-03-20T00:00:00.000Z"));
  const imageSheet = await ensureRackUnitCapacityImageHistorySheet(zip);
  await upsertRackUnitCapacityImageHistoryRow(zip, imageSheet.xmlPath, { reportingMonth: "2026-03", facility: "Rangsit Data Center", timestamp: "2026-03-20T00:00:00.000Z", user: "desktop.operator", mimeType: "image/png", dataVersion: 1 }, { bytes: image, type: "png", width: 2, height: 1 });
  buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { buffer, image };
}

const { buffer, image } = await sourceWorkbook();
const repository = new InMemoryRepository({ sites: [{ id: 1, code: "RST", name: "Rangsit Data Center", active: true }], settings: { startMonth: "2026-03", endMonth: "2026-03", rowVersion: 1 } });
const workbookStorage = new InMemoryObjectStorage();
const imageStorage = new InMemoryObjectStorage();
const importer = new ImportService(repository, () => new Date("2026-03-20T00:00:00.000Z"), workbookStorage, imageStorage);
const imported = await importer.importWorkbook(1, "Rangsit.xlsm", buffer, "history-image-test", 7);
assert.deepEqual(imported.rackCapacityHistoryMonths, ["2026-03"]);
assert.deepEqual(imported.rackUnitCapacityImageMonths, ["2026-03"]);
assert.equal((await repository.getRackCapacityHistory(1)).length, 2, "total and zone history rows should be retained");
const imageRecord = await repository.getRackUnitImage(1, "2026-03");
assert.ok(imageRecord);
assert.equal(imageRecord?.width, 2);
assert.equal(imageRecord?.height, 1);
assert.deepEqual(await imageStorage.get(imageRecord!.objectKey), image);
const api = new ApiService(repository, () => new Date("2026-03-20T00:00:00.000Z"), imageStorage);
const rackUnitDto = await api.getRackUnit(1, "2026-03") as { image: { width: number; height: number } | null };
assert.deepEqual(rackUnitDto.image, { contentType: "image/png", byteSize: image.length, width: 2, height: 1, savedAt: "2026-03-20T00:00:00.000Z", savedBy: "desktop.operator" });
const servedImage = await api.getRackUnitImage(1, "2026-03");
assert.equal(servedImage.contentType, "image/png");
assert.deepEqual(servedImage.bytes, image);

const report = await new ReportService(repository, () => new Date("2026-03-20T00:00:00.000Z"), imageStorage).buildAllReport(1, "2026-03");
assert.match(report.html, /data:image\/png;base64,/);
assert.match(report.html, /desktop\.operator/);
assert.match(report.html, /Rack Unit Capacity and Utilization/);

console.log("web report history/image: PASS (Desktop Rack Capacity History retained, image storage hash path and report embedding verified)");
