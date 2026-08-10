import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { WorkbookIntegrityService } from "../server/services/workbookIntegrityService";

const buffer = await fs.readFile("DC_Rangsit.xlsm");
const report = await new WorkbookIntegrityService().inspect("DC_Rangsit.xlsm", buffer);
assert.equal(report.scope, "desktop-workbook-package");
assert.equal(report.structureOk, true);
assert.equal(report.validation.ok, true);
assert.equal(report.package.hasVbaProject, true);
assert(report.package.pivotCacheCount > 0);
assert(report.package.chartCount > 0);
assert(report.package.drawingCount > 0);
assert.equal(report.sourceFileHash.length, 64);
console.log(`web workbook integrity: PASS (VBA, ${report.package.pivotCacheCount} pivot cache(s), ${report.package.chartCount} chart(s), ${report.package.drawingCount} drawing(s); Desktop reader validation passed)`);
