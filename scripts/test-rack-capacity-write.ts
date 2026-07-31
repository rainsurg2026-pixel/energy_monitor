import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";
import { applyRackCapacityStatusChanges } from "../src/excel/RackCapacityWriter";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function unrelatedPartHashes(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(name =>
    !zip.files[name].dir && /vbaProject|pivotCache|pivotTables|charts\/chart|xl\/tables|drawings/.test(name)
  );
  const result: Record<string, string> = {};
  for (const name of names) {
    let data: Buffer | string = await zip.file(name)!.async("nodebuffer");
    if (/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)) {
      // The writer intentionally flags pivot caches to refresh on load
      // (confirmed real staleness bug: Srinakarin's cache was already
      // stale relative to live Table7 data before this feature existed).
      // Compare everything else about the part byte-for-byte.
      data = data.toString("utf8").replace(/\s*refreshOnLoad="[^"]*"/g, "");
    }
    result[name] = crypto.createHash("sha256").update(data).digest("hex");
  }
  return result;
}

async function testFacility(label: string, sourcePath: string): Promise<void> {
  console.log(`\n===== ${label} =====`);
  const original = await fs.readFile(sourcePath);
  const before = await readRackCapacityFromBuffer(original);
  if (!before) throw new Error("Rack Capacity report is missing.");
  check(`${label}: Table7 has real records`, before.records.length > 0);

  const target = before.records.find(r => r.rackId && r.status)!;
  const otherStatus = target.status === "Available" ? "Reserved" : "Available";

  // ---- Happy path: correct expectedStatus, real record ----
  const beforeHashes = await unrelatedPartHashes(original);
  const result = await applyRackCapacityStatusChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, expectedStatus: target.status, newStatus: otherStatus }
  ]);
  check(`${label}: change applied`, result.outcomes[0].applied === true);
  check(`${label}: changedCount is 1`, result.changedCount === 1);

  const after = await readRackCapacityFromBuffer(result.buffer);
  const afterRecord = after!.records.find(r => r.rowNumber === target.rowNumber)!;
  check(`${label}: status actually changed on re-read`, afterRecord.status === otherStatus);
  check(`${label}: Rack ID unchanged`, afterRecord.rackId === target.rackId);
  check(`${label}: Rack Zone unchanged`, afterRecord.rackZone === target.rackZone);
  check(`${label}: Cabinet Size unchanged`, afterRecord.cabinetSize === target.cabinetSize);

  // Every other record must be untouched.
  const untouchedMismatch = before.records.find(b => {
    if (b.rowNumber === target.rowNumber) return false;
    const a = after!.records.find(r => r.rowNumber === b.rowNumber);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  check(`${label}: every other rack record is byte-for-byte unchanged`, untouchedMismatch === undefined, JSON.stringify(untouchedMismatch));

  const afterHashes = await unrelatedPartHashes(result.buffer);
  const changedParts = Object.keys(beforeHashes).filter(name => beforeHashes[name] !== afterHashes[name]);
  check(`${label}: VBA/pivot/table/chart/drawing parts otherwise byte-identical`, changedParts.length === 0, changedParts.join(", "));

  const afterZip = await JSZip.loadAsync(result.buffer);
  let sawPivotCache = false;
  for (const name of Object.keys(afterZip.files)) {
    if (/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)) {
      sawPivotCache = true;
      const xml = await afterZip.file(name)!.async("string");
      check(`${label}: pivot cache ${name} flagged refreshOnLoad after a real status change`, xml.includes('refreshOnLoad="1"'));
    }
  }
  check(`${label}: workbook actually has a pivot cache to check`, sawPivotCache);

  // ---- Conflict: stale expectedStatus (someone else changed it since read) ----
  const wrongExpected = target.status === "Pending Dismantle" ? "Available" : "Pending Dismantle";
  const conflictResult = await applyRackCapacityStatusChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, expectedStatus: wrongExpected, newStatus: otherStatus }
  ]);
  check(`${label}: stale expectedStatus is rejected as a conflict, not applied`, conflictResult.outcomes[0].applied === false);
  check(`${label}: conflict reports the real actual status`, conflictResult.outcomes[0].conflictActualStatus === target.status);
  check(`${label}: conflicted save changes nothing (changedCount 0)`, conflictResult.changedCount === 0);

  // ---- Conflict: Rack ID mismatch (row identity drifted, e.g. rows inserted) ----
  const idMismatchResult = await applyRackCapacityStatusChanges(original, [
    { rowNumber: target.rowNumber, rackId: "THIS-RACK-ID-DOES-NOT-EXIST", expectedStatus: target.status, newStatus: otherStatus }
  ]);
  check(`${label}: Rack ID mismatch is rejected, not applied`, idMismatchResult.outcomes[0].applied === false);
  check(`${label}: Rack ID mismatch reason is rack_id_mismatch`, idMismatchResult.outcomes[0].conflictReason === "rack_id_mismatch");

  // ---- Out-of-range row is rejected, not silently written elsewhere ----
  const outOfRangeResult = await applyRackCapacityStatusChanges(original, [
    { rowNumber: 999999, rackId: target.rackId!, expectedStatus: target.status, newStatus: otherStatus }
  ]);
  check(`${label}: out-of-range row is rejected`, outOfRangeResult.outcomes[0].applied === false);
  check(`${label}: out-of-range reason is row_not_found`, outOfRangeResult.outcomes[0].conflictReason === "row_not_found");

  // ---- No-op: newStatus already equals current status ----
  const noopResult = await applyRackCapacityStatusChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, expectedStatus: target.status, newStatus: target.status! }
  ]);
  check(`${label}: setting status to its current value applies but does not rewrite anything`, noopResult.outcomes[0].applied === true && noopResult.changedCount === 0);

  // ---- Multiple changes in one save, one conflicting ----
  const second = before.records.find(r => r.rackId && r.status && r.rowNumber !== target.rowNumber)!;
  const batch = await applyRackCapacityStatusChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, expectedStatus: target.status, newStatus: otherStatus },
    { rowNumber: second.rowNumber, rackId: second.rackId!, expectedStatus: "wrong-expected-value", newStatus: otherStatus }
  ]);
  check(`${label}: batch applies the valid change`, batch.outcomes[0].applied === true);
  check(`${label}: batch rejects the conflicting change independently`, batch.outcomes[1].applied === false);
  check(`${label}: batch changedCount reflects only the valid change`, batch.changedCount === 1);
}

const workDir = path.resolve("dist-electron/test-work/rack-capacity-write");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });

const rangsitCopy = path.join(workDir, "DC_Rangsit.xlsm");
const srinakarinCopy = path.join(workDir, "DC_Srinakarin.xlsm");
await fs.copyFile(path.resolve("DC_Rangsit.xlsm"), rangsitCopy);
await fs.copyFile(path.resolve("DC_Srinakarin.xlsm"), srinakarinCopy);

const prodHashBefore = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};

await testFacility("RANGSIT", rangsitCopy);
await testFacility("SRINAKARIN", srinakarinCopy);

const prodHashAfter = {
  rangsit: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Rangsit.xlsm"))).digest("hex"),
  srinakarin: crypto.createHash("sha256").update(await fs.readFile(path.resolve("DC_Srinakarin.xlsm"))).digest("hex")
};
check("Production DC_Rangsit.xlsm untouched by this test", prodHashBefore.rangsit === prodHashAfter.rangsit);
check("Production DC_Srinakarin.xlsm untouched by this test", prodHashBefore.srinakarin === prodHashAfter.srinakarin);

console.log(failures === 0 ? "\nALL RACK CAPACITY WRITE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
