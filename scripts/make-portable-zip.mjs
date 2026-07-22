// Stages the distributable portable folder layout and zips it:
//
//   release/Energy Monitor/
//     Energy Monitor.exe      (from electron-builder portable target)
//     DC_Rangsit.xlsm         (the default facility workbook)
//     DC_Srinakarin.xlsm      (the second facility workbook)
//     config/  backup/  logs/  exports/   (empty, created for clarity)
//     docs/                   (user/deployment guides, if built)
//     README.md
//
//   release/EnergyMonitor_Portable.zip
//
// The user extracts the ZIP anywhere and double-clicks Energy Monitor.exe -
// no installer, no admin rights, fully offline.
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const release = path.join(root, "release");
const exe = path.join(release, "Energy Monitor.exe");
const stage = path.join(release, "Energy Monitor");
const zipPath = path.join(release, `Energy Monitor v${pkg.version} Portable.zip`);

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false);
}

async function main() {
  if (!(await exists(exe))) {
    console.error(`Portable exe not found: ${exe}\nRun "npm run portable" first.`);
    process.exit(1);
  }

  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  // Executable + facility workbook databases. Keep both configured facilities
  // beside the executable so the first launch works without a file picker.
  await fs.copyFile(exe, path.join(stage, "Energy Monitor.exe"));
  for (const workbookName of ["DC_Rangsit.xlsm", "DC_Srinakarin.xlsm", "SNK_Dashboard_Renew_Voltage-1_EnergyMonitorReady.xlsm"]) {
    const workbook = await exists(path.join(root, workbookName))
      ? path.join(root, workbookName)
      : path.join(root, "release", workbookName);
    if (await exists(workbook)) {
      await fs.copyFile(workbook, path.join(stage, workbookName));
    } else {
      console.warn(`WARNING: ${workbookName} not found in project root - ZIP will ship without this workbook.`);
    }
  }

  // Portable folder layout
  for (const dir of ["config", "backup", "logs", "exports", "docs"]) {
    await fs.mkdir(path.join(stage, dir), { recursive: true });
  }

  // Documentation (if generated). Recursive copy: docs/desktop/ contains
  // both files and subdirectories (e.g. adr/), and fs.copyFile only handles
  // files.
  const docsSrc = path.join(root, "docs", "desktop");
  if (await exists(docsSrc)) {
    for (const entry of await fs.readdir(docsSrc)) {
      await fs.cp(path.join(docsSrc, entry), path.join(stage, "docs", entry), { recursive: true });
    }
  }
  await fs.writeFile(path.join(stage, "README.md"), `# Energy Monitor — Portable Package

1. Extract this folder anywhere on a writable Windows drive.
2. Double-click **Energy Monitor.exe**.
3. The default facility is **DC_Rangsit.xlsm**. **DC_Srinakarin.xlsm** is also included for facility selection.

The application is fully portable and works without Microsoft Office or an internet connection.
The Excel workbooks remain the authoritative data source. Keep the workbook closed in Excel while saving from the application so its backup and validation protections can run.

Folders created beside the executable:
- config/ application and facility settings
- backup/ workbook backups
- logs/ startup and application diagnostics
- exports/ generated reports and exports
- docs/ user and deployment documentation
`, "utf8");

  // Zip via PowerShell (built into Windows)
  await fs.rm(zipPath, { force: true });
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${stage}" -DestinationPath "${zipPath}" -CompressionLevel Optimal`
    ],
    { stdio: "inherit" }
  );
  if (ps.status !== 0) {
    console.error("Compress-Archive failed");
    process.exit(1);
  }

  const zipStat = await fs.stat(zipPath);
  console.log(`\nPortable folder: ${stage}`);
  console.log(`ZIP: ${zipPath} (${(zipStat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
