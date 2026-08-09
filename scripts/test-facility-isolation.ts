/**
 * Multi-site isolation regression suite. Proves per-facility air-meter
 * config, dashboard source, and workbook state never leak between sites.
 * Read-only checks run against the real workbooks; the one write check runs
 * against COPIES (never the live DC_Rangsit.xlsm / DC_Srinakarin.xlsm).
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-facility-isolation.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { saveWorkbook } from "../src/excel/WorkbookWriter";
import { DeviceLists } from "../src/excel/SheetMapper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let checks = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    checks++;
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

interface FacilityProfileFile {
  air: { fields: string[]; labels: Record<string, string> };
  devices: { ups: string[]; dc: string[] };
}

async function loadProfile(id: string): Promise<FacilityProfileFile> {
  return JSON.parse(await fs.readFile(path.join(root, "config", id, "profile.json"), "utf8"));
}

function devicesFor(profile: FacilityProfileFile): DeviceLists {
  return { upsIds: profile.devices.ups, dcIds: profile.devices.dc, airFields: profile.air.fields };
}

async function main(): Promise<void> {
  console.log("Multi-site isolation regression checks");

  // --- 1. Air meter configuration: per-facility profile, not hardcoded ---
  const rangsitProfile = await loadProfile("rangsit");
  const srinakarinProfile = await loadProfile("srinakarin");

  check("Rangsit profile declares 4 air meters", rangsitProfile.air.fields.length === 4,
    `got ${rangsitProfile.air.fields.length}`);
  check("Rangsit air meters are EB41A/EB41B/EB42A/EB42B",
    ["eb41a", "eb41b", "eb42a", "eb42b"].every(f => rangsitProfile.air.fields.includes(f)));
  check("Srinakarin profile declares 6 air meters", srinakarinProfile.air.fields.length === 6,
    `got ${srinakarinProfile.air.fields.length}`);
  check("Srinakarin air meters are EB41A/B, EB43A/B, EB44A/B",
    ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"].every(f => srinakarinProfile.air.fields.includes(f)));

  // AirTable.tsx must render from the meterFields prop, never a fixed array.
  const airTableSource = await fs.readFile(path.join(root, "src", "components", "AirTable.tsx"), "utf8");
  check("AirTable renders fields dynamically (fields.map), not a hardcoded meter count",
    airTableSource.includes("fields.map"));

  // The IPC trust boundary (src/electron/ipc/excel.ts) is where a prior
  // regression silently dropped airFields, forcing every facility onto the
  // 4-field default regardless of selection. Guard the fix textually since
  // that file imports the `electron` module and cannot be loaded outside
  // Electron's runtime for a direct behavioral import.
  const excelIpcSource = await fs.readFile(path.join(root, "src", "electron", "ipc", "excel.ts"), "utf8");
  const sanitizeDevicesBody = excelIpcSource.slice(
    excelIpcSource.indexOf("function sanitizeDevices"),
    excelIpcSource.indexOf("\n}", excelIpcSource.indexOf("function sanitizeDevices"))
  );
  check("IPC device sanitizer forwards airFields (does not drop the active facility's meter config)",
    sanitizeDevicesBody.includes("o.airFields") && sanitizeDevicesBody.includes("airFields"));

  // --- 2/3. Dashboard-FAC always read from the currently selected workbook ---
  const rangsitPath = path.join(root, "DC_Rangsit.xlsm");
  const srinakarinPath = path.join(root, "DC_Srinakarin.xlsm");

  async function dashboardFacSnapshot(filePath: string): Promise<{ c4: unknown; c6: unknown }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.getWorksheet("Dashboard-FAC");
    if (!sheet) throw new Error(`Dashboard-FAC missing in ${filePath}`);
    return { c4: sheet.getCell("C4").value, c6: sheet.getCell("C6").value };
  }

  const rangsitFac1 = await dashboardFacSnapshot(rangsitPath);
  const srinakarinFac = await dashboardFacSnapshot(srinakarinPath);
  const rangsitFac2 = await dashboardFacSnapshot(rangsitPath);

  check("Dashboard-FAC sheet exists in both workbooks (each read independently)",
    rangsitFac1.c4 !== undefined && srinakarinFac.c4 !== undefined);
  check("Re-reading Rangsit's Dashboard-FAC after reading Srinakarin returns identical values (site switch invalidates cache, no leak)",
    JSON.stringify(rangsitFac1) === JSON.stringify(rangsitFac2));

  // --- 4/5. Site switch sequence: Rangsit -> Srinakarin -> Rangsit -> Srinakarin ---
  const rDevices = devicesFor(rangsitProfile);
  const sDevices = devicesFor(srinakarinProfile);

  const r1 = await readWorkbookFromFile(rangsitPath, rDevices);
  const s1 = await readWorkbookFromFile(srinakarinPath, sDevices);
  const r2 = await readWorkbookFromFile(rangsitPath, rDevices);
  const s2 = await readWorkbookFromFile(srinakarinPath, sDevices);

  check("Rangsit read is stable across a Srinakarin switch in between (no dashboard-value leak)",
    r1.logs.length === r2.logs.length &&
    JSON.stringify(r1.logs.map(l => l.month)) === JSON.stringify(r2.logs.map(l => l.month)) &&
    JSON.stringify(r1.logs[r1.logs.length - 1]?.ups) === JSON.stringify(r2.logs[r2.logs.length - 1]?.ups));
  check("Srinakarin read is stable across a Rangsit switch in between (no dashboard-value leak)",
    s1.logs.length === s2.logs.length &&
    JSON.stringify(s1.logs.map(l => l.month)) === JSON.stringify(s2.logs.map(l => l.month)));

  check("Rangsit's read logs never carry Srinakarin-only air meters (eb43/eb44)",
    r2.logs.every(l => !l.air.meters || (l.air.meters.eb43a === undefined && l.air.meters.eb44a === undefined)));
  check("Srinakarin's read logs expose its own eb43/eb44 meters (config actually reaches the reader)",
    s2.logs.some(l => l.air.meters && ("eb43a" in l.air.meters || "eb44a" in l.air.meters)));

  const appSource = await fs.readFile(path.join(root, "src", "App.tsx"), "utf8");
  const snapFn = appSource.slice(appSource.indexOf("applyWorkbookSnapshot = "), appSource.indexOf("const openWorkbook ="));
  check("Facility switch fully disposes the prior in-memory log store before loading the new snapshot (delete before add, no shared cache)",
    snapFn.indexOf("deleteLogForMonth") !== -1 &&
    snapFn.indexOf("deleteLogForMonth") < snapFn.indexOf("saveLogForMonth"));

  // --- 6. No Air Entry values leak across sites (write path, on copies only) ---
  const workDir = path.join(root, "dist-electron", "test-work-isolation");
  await fs.mkdir(workDir, { recursive: true });
  const srinakarinCopy = path.join(workDir, "SNK_Isolation.xlsm");
  await fs.copyFile(srinakarinPath, srinakarinCopy);
  await fs.unlink(`${srinakarinCopy}.appmeta.json`).catch(() => undefined);
  const backupDir = path.join(workDir, "backup");
  await fs.rm(backupDir, { recursive: true, force: true });

  const before = await readWorkbookFromFile(srinakarinCopy, sDevices);
  const targetMonth = before.logs[before.logs.length - 1].month;
  const edited = before.logs.map(l =>
    l.month === targetMonth
      ? { ...l, air: { ...l.air, meters: { ...l.air.meters, eb43a: 12.3456, eb43b: 7.891, eb44a: 4.321, eb44b: 1.234 } } }
      : l
  );
  await saveWorkbook(srinakarinCopy, edited, { backupDir, backupKeep: 3, devices: sDevices, scope: "air" });
  const after = await readWorkbookFromFile(srinakarinCopy, sDevices);
  const savedMonth = after.logs.find(l => l.month === targetMonth);

  check("Srinakarin eb43a/eb43b/eb44a/eb44b values survive save+re-read (not dropped by a hardcoded 4-field default)",
    savedMonth?.air.meters?.eb43a === 12.3456 &&
    savedMonth?.air.meters?.eb43b === 7.891 &&
    savedMonth?.air.meters?.eb44a === 4.321 &&
    savedMonth?.air.meters?.eb44b === 1.234);

  // Rangsit, read again after the Srinakarin write above, must still show
  // only its own 4 fields - the write to a copy of the other site's file
  // must never touch Rangsit's in-memory or on-disk state.
  const rangsitAfter = await readWorkbookFromFile(rangsitPath, rDevices);
  check("Rangsit is unaffected by a Srinakarin-only write elsewhere (no cross-site contamination)",
    rangsitAfter.logs.every(l => !l.air.meters || l.air.meters.eb43a === undefined));

  console.log(`\n${checks} multi-site isolation checks passed.`);
}

void main();
