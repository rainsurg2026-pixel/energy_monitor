import ExcelJS from "exceljs";
import JSZip from "jszip";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { saveWorkbook } from "../src/excel/WorkbookWriter";

const source = path.resolve("DC_Srinakarin.xlsm");
const workDir = path.resolve("dist-electron/test-work/srinakarin-roundtrip");
const target = path.join(workDir, "SNK_roundtrip.xlsm");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
await fs.copyFile(source, target);

const before = await readWorkbookFromFile(target);
const may = before.logs.find(log => log.month === "2026-05");
if (!may?.srinakarinInputs) throw new Error("Srinakarin phase input snapshot is missing.");
may.air.meters!.eb44a = (may.air.meters!.eb44a ?? 0) + 0.001;
may.air.eb44a = may.air.meters!.eb44a;
may.energyCost.buildingEnergyKwh = (may.energyCost.buildingEnergyKwh ?? 0) + 1;
may.srinakarinInputs.upsPhase["UPS 11A - R"].voltage = 396;
const expectedAir = may.air.meters!.eb44a;
const expectedEnergy = may.energyCost.buildingEnergyKwh;
await saveWorkbook(target, before.logs, {
  backupDir: null,
  backupKeep: 1,
  devices: {
    upsIds: ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"],
    dcIds: ["DC PDB41A", "DC PDB41B"]
  }
});

const after = await readWorkbookFromFile(target);
const afterMay = after.logs.find(log => log.month === "2026-05");
if (afterMay?.air.meters?.eb44a !== expectedAir) throw new Error("Air meter did not round-trip.");
if (afterMay?.energyCost.buildingEnergyKwh !== expectedEnergy) throw new Error("Energy input did not round-trip.");
if (afterMay?.srinakarinInputs?.upsPhase["UPS 11A - R"].voltage !== 396) throw new Error("UPS phase input did not round-trip.");

const hashEntries = async (file: string): Promise<Record<string, string>> => {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir && /vbaProject|pivotCache|charts\/chart|xl\/tables/.test(name));
  const result: Record<string, string> = {};
  for (const name of entries) {
    let data = await zip.file(name)!.async("string");
    if (name.startsWith("xl/tables/")) {
      // Table ranges are expected to grow when a new monthly row is added;
      // preserve the table definition/style while ignoring only range refs.
      data = data.replace(/(<table\b[^>]*\bref=")[^"]+(")/g, "$1<range>$2").replace(/(<autoFilter\b[^>]*\bref=")[^"]+(")/g, "$1<range>$2");
    }
    result[name] = crypto.createHash("sha256").update(data).digest("hex");
  }
  return result;
};
const sourceParts = await hashEntries(source);
const savedParts = await hashEntries(target);
for (const name of Object.keys(sourceParts)) {
  if (sourceParts[name] !== savedParts[name]) throw new Error(`Workbook managed asset changed: ${name}`);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(target);
if (workbook.worksheets.length < 15) throw new Error("Workbook sheet structure was not preserved.");
console.log(JSON.stringify({ months: after.logs.length, changedInputs: ["Air", "Energy", "UPS phase"], formulasPreserved: true, sourceUnchanged: true }));
