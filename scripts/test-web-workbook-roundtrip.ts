import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { InMemoryObjectStorage } from "../server/storage/objectStorage";
import { WorkbookRoundTripService } from "../server/services/workbookRoundTripService";

const sourcePath = "DC_Rangsit.xlsm";
const original = await fs.readFile(sourcePath);
const parsed = await readWorkbookFromFile(sourcePath);
assert.equal(parsed.validation.ok, true, parsed.validation.errors.join("; "));
assert(parsed.logs.length > 0);
const siteId = 1;
const repository = new InMemoryRepository({
  sites: [{ id: siteId, code: "RST", name: "Rangsit Data Center", active: true }],
  logs: { [siteId]: parsed.logs },
  settings: { startMonth: "2025-01", endMonth: "2026-12", rowVersion: 1 }
});
const storage = new InMemoryObjectStorage();
const hash = createHash("sha256").update(original).digest("hex");
const objectKey = `sites/${siteId}/workbooks/${hash}/DC_Rangsit.xlsm`;
await storage.put(objectKey, original, "application/vnd.ms-excel.sheet.macroEnabled.12");
await repository.saveWorkbookSource({ siteId, sourceFileName: sourcePath, sourceFileHash: hash, objectKey, contentType: "application/vnd.ms-excel.sheet.macroEnabled.12", byteSize: original.length, actorUserId: 7, correlationId: "roundtrip-test" });

const result = await new WorkbookRoundTripService(repository, storage).exportWorkbook(siteId);
assert.equal(result.sourceFileHash, hash);
assert.equal(result.contentType, "application/vnd.ms-excel.sheet.macroEnabled.12");
const originalZip = await JSZip.loadAsync(original);
const roundTripZip = await JSZip.loadAsync(result.buffer);
const originalVba = await originalZip.file("xl/vbaProject.bin")!.async("nodebuffer");
const roundTripVba = await roundTripZip.file("xl/vbaProject.bin")!.async("nodebuffer");
assert.deepEqual(roundTripVba, originalVba, "VBA project is preserved byte-for-byte");
assert(await roundTripZip.file("xl/pivotCache/pivotCacheDefinition1.xml")?.async("nodebuffer"), "pivot cache remains present");
const reread = await readWorkbookFromFile(sourcePath);
assert.equal(reread.validation.ok, true);
console.log(`web workbook round-trip: PASS (source ${original.length} bytes -> ${result.buffer.length} bytes; VBA/pivot package members preserved)`);
