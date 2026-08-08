import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";
import { applyRackCapacityFieldChanges } from "../src/excel/RackCapacityWriter";

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

  // ---- Happy path: Status only, correct expected, real record ----
  const beforeHashes = await unrelatedPartHashes(original);
  const result = await applyRackCapacityFieldChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, status: { expected: target.status, next: otherStatus } }
  ]);
  check(`${label}: change applied`, result.outcomes[0].applied === true);
  check(`${label}: changedCount is 1`, result.changedCount === 1);

  const after = await readRackCapacityFromBuffer(result.buffer);
  const afterRecord = after!.records.find(r => r.rowNumber === target.rowNumber)!;
  check(`${label}: status actually changed on re-read`, afterRecord.status === otherStatus);
  check(`${label}: Rack ID unchanged`, afterRecord.rackId === target.rackId);
  check(`${label}: Rack Zone unchanged`, afterRecord.rackZone === target.rackZone);
  check(`${label}: Cabinet Size unchanged (not part of this change)`, afterRecord.cabinetSize === target.cabinetSize);

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

  // ---- Conflict: stale expected Status (someone else changed it since read) ----
  const wrongExpected = target.status === "Pending Dismantle" ? "Available" : "Pending Dismantle";
  const conflictResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, status: { expected: wrongExpected, next: otherStatus } }
  ]);
  check(`${label}: stale expected Status is rejected as a conflict, not applied`, conflictResult.outcomes[0].applied === false);
  check(`${label}: conflict reports the real actual value`, conflictResult.outcomes[0].conflictActualValue === target.status);
  check(`${label}: conflict identifies the Status field specifically`, conflictResult.outcomes[0].conflictField === "status");
  check(`${label}: conflicted save changes nothing (changedCount 0)`, conflictResult.changedCount === 0);

  // ---- Conflict: Rack ID mismatch (row identity drifted, e.g. rows inserted) ----
  const idMismatchResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: target.rowNumber, rackId: "THIS-RACK-ID-DOES-NOT-EXIST", status: { expected: target.status, next: otherStatus } }
  ]);
  check(`${label}: Rack ID mismatch is rejected, not applied`, idMismatchResult.outcomes[0].applied === false);
  check(`${label}: Rack ID mismatch reason is rack_id_mismatch`, idMismatchResult.outcomes[0].conflictReason === "rack_id_mismatch");

  // ---- Out-of-range row is rejected, not silently written elsewhere ----
  const outOfRangeResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: 999999, rackId: target.rackId!, status: { expected: target.status, next: otherStatus } }
  ]);
  check(`${label}: out-of-range row is rejected`, outOfRangeResult.outcomes[0].applied === false);
  check(`${label}: out-of-range reason is row_not_found`, outOfRangeResult.outcomes[0].conflictReason === "row_not_found");

  // ---- No-op: next Status already equals current status ----
  const noopResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, status: { expected: target.status, next: target.status! } }
  ]);
  check(`${label}: setting status to its current value applies but does not rewrite anything`, noopResult.outcomes[0].applied === true && noopResult.changedCount === 0);

  // ---- Multiple changes in one save, one conflicting ----
  const second = before.records.find(r => r.rackId && r.status && r.rowNumber !== target.rowNumber)!;
  const batch = await applyRackCapacityFieldChanges(original, [
    { rowNumber: target.rowNumber, rackId: target.rackId!, status: { expected: target.status, next: otherStatus } },
    { rowNumber: second.rowNumber, rackId: second.rackId!, status: { expected: "wrong-expected-value", next: otherStatus } }
  ]);
  check(`${label}: batch applies the valid change`, batch.outcomes[0].applied === true);
  check(`${label}: batch rejects the conflicting change independently`, batch.outcomes[1].applied === false);
  check(`${label}: batch changedCount reflects only the valid change`, batch.changedCount === 1);

  // ---- v2.2.3: Cabinet Size / Detail / Device Type are independently editable ----
  const cabinetTarget = before.records.find(r => r.rackId && r.rowNumber !== target.rowNumber && r.rowNumber !== second.rowNumber)!;
  const newCabinetSize = `${cabinetTarget.cabinetSize ?? "60*100"}-edited`;
  const cabinetResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: cabinetTarget.rowNumber, rackId: cabinetTarget.rackId!, cabinetSize: { expected: cabinetTarget.cabinetSize, next: newCabinetSize } }
  ]);
  check(`${label}: Cabinet Size change applied`, cabinetResult.outcomes[0].applied === true);
  const afterCabinet = await readRackCapacityFromBuffer(cabinetResult.buffer);
  const afterCabinetRecord = afterCabinet!.records.find(r => r.rowNumber === cabinetTarget.rowNumber)!;
  check(`${label}: Cabinet Size actually changed on re-read`, afterCabinetRecord.cabinetSize === newCabinetSize);
  check(`${label}: Cabinet Size edit left Status untouched`, afterCabinetRecord.status === cabinetTarget.status);
  check(`${label}: Cabinet Size edit left Detail untouched`, afterCabinetRecord.detail === cabinetTarget.detail);
  check(`${label}: Cabinet Size edit left Device Type untouched`, afterCabinetRecord.deviceType === cabinetTarget.deviceType);

  const detailResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: cabinetTarget.rowNumber, rackId: cabinetTarget.rackId!, detail: { expected: cabinetTarget.detail, next: "Edited detail text" } }
  ]);
  check(`${label}: Detail change applied`, detailResult.outcomes[0].applied === true);
  const afterDetail = (await readRackCapacityFromBuffer(detailResult.buffer))!.records.find(r => r.rowNumber === cabinetTarget.rowNumber)!;
  check(`${label}: Detail actually changed on re-read`, afterDetail.detail === "Edited detail text");

  const deviceTypeResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: cabinetTarget.rowNumber, rackId: cabinetTarget.rackId!, deviceType: { expected: cabinetTarget.deviceType, next: "Storage" } }
  ]);
  check(`${label}: Device Type change applied`, deviceTypeResult.outcomes[0].applied === true);
  const afterDeviceType = (await readRackCapacityFromBuffer(deviceTypeResult.buffer))!.records.find(r => r.rowNumber === cabinetTarget.rowNumber)!;
  check(`${label}: Device Type actually changed on re-read`, afterDeviceType.deviceType === "Storage");

  const remarksResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: cabinetTarget.rowNumber, rackId: cabinetTarget.rackId!, remarks: { expected: cabinetTarget.remarks, next: "Edited rack remark" } }
  ]);
  check(`${label}: Remarks change applied`, remarksResult.outcomes[0].applied === true);
  const afterRemarks = (await readRackCapacityFromBuffer(remarksResult.buffer))!.records.find(r => r.rowNumber === cabinetTarget.rowNumber)!;
  check(`${label}: Remarks actually changed on re-read`, afterRemarks.remarks === "Edited rack remark");

  // ---- v2.2.3: clearing a free-text field to blank is legitimate (not coerced to a fake value) ----
  const clearResult = await applyRackCapacityFieldChanges(original, [
    { rowNumber: cabinetTarget.rowNumber, rackId: cabinetTarget.rackId!, detail: { expected: cabinetTarget.detail, next: null } }
  ]);
  check(`${label}: Detail can be cleared to blank`, clearResult.outcomes[0].applied === true);
  const afterClear = (await readRackCapacityFromBuffer(clearResult.buffer))!.records.find(r => r.rowNumber === cabinetTarget.rowNumber)!;
  check(`${label}: cleared Detail reads back as null, not "null"/empty-string-with-junk`, afterClear.detail === null);

  // ---- v2.3.1: ONE staged rack modification covering ALL FIVE fields at once ----
  const multiTarget = before.records.find(r => r.rackId && r.rowNumber !== target.rowNumber && r.rowNumber !== second.rowNumber && r.rowNumber !== cabinetTarget.rowNumber)!;
  const multiResult = await applyRackCapacityFieldChanges(original, [
    {
      rowNumber: multiTarget.rowNumber,
      rackId: multiTarget.rackId!,
      status: { expected: multiTarget.status, next: multiTarget.status === "In Use" ? "Reserved" : "In Use" },
      cabinetSize: { expected: multiTarget.cabinetSize, next: "45U-combo" },
      detail: { expected: multiTarget.detail, next: "Combo detail" },
      deviceType: { expected: multiTarget.deviceType, next: "Network" },
      remarks: { expected: multiTarget.remarks, next: "Combo remark" }
    }
  ]);
  check(`${label}: one rack, all five fields changed at once, applies as ONE outcome`, multiResult.outcomes.length === 1 && multiResult.outcomes[0].applied === true);
  check(`${label}: multi-field change updates changedCount for all 5 touched cells`, multiResult.changedCount === 5);
  const afterMulti = (await readRackCapacityFromBuffer(multiResult.buffer))!.records.find(r => r.rowNumber === multiTarget.rowNumber)!;
  check(`${label}: multi-field Status applied`, afterMulti.status === (multiTarget.status === "In Use" ? "Reserved" : "In Use"));
  check(`${label}: multi-field Cabinet Size applied`, afterMulti.cabinetSize === "45U-combo");
  check(`${label}: multi-field Detail applied`, afterMulti.detail === "Combo detail");
  check(`${label}: multi-field Device Type applied`, afterMulti.deviceType === "Network");
  check(`${label}: multi-field Remarks applied`, afterMulti.remarks === "Combo remark");

  // ---- v2.2.3: a conflict on ONE field of a multi-field change blocks the WHOLE row (no partial write) ----
  const partialConflict = await applyRackCapacityFieldChanges(original, [
    {
      rowNumber: multiTarget.rowNumber,
      rackId: multiTarget.rackId!,
      status: { expected: multiTarget.status, next: "Available" },
      cabinetSize: { expected: "this-is-not-the-real-current-value", next: "should-not-be-written" }
    }
  ]);
  check(`${label}: multi-field change with one conflicting field is rejected entirely`, partialConflict.outcomes[0].applied === false);
  check(`${label}: multi-field conflict identifies cabinetSize specifically`, partialConflict.outcomes[0].conflictField === "cabinetSize");
  const afterPartialConflict = (await readRackCapacityFromBuffer(partialConflict.buffer))!.records.find(r => r.rowNumber === multiTarget.rowNumber)!;
  check(`${label}: Status was NOT written even though it didn't conflict (all-or-nothing per row)`, afterPartialConflict.status === multiTarget.status);
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
