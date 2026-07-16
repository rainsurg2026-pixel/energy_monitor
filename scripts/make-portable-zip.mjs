// Stages the distributable portable folder layout and zips it:
//
//   release/Energy Monitor/
//     Energy Monitor.exe      (from electron-builder portable target)
//     RST_Dashboard.xlsm      (the live workbook database)
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
const release = path.join(root, "release");
const exe = path.join(release, "Energy Monitor.exe");
const stage = path.join(release, "Energy Monitor");
const zipPath = path.join(release, "EnergyMonitor_Portable.zip");

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

  // Executable + workbook database
  await fs.copyFile(exe, path.join(stage, "Energy Monitor.exe"));
  const workbook = path.join(root, "RST_Dashboard.xlsm");
  if (await exists(workbook)) {
    await fs.copyFile(workbook, path.join(stage, "RST_Dashboard.xlsm"));
  } else {
    console.warn("WARNING: RST_Dashboard.xlsm not found in project root - ZIP will ship without a workbook.");
  }

  // Portable folder layout
  for (const dir of ["config", "backup", "logs", "exports", "docs"]) {
    await fs.mkdir(path.join(stage, dir), { recursive: true });
  }

  // Documentation (if generated)
  const docsSrc = path.join(root, "docs", "desktop");
  if (await exists(docsSrc)) {
    for (const entry of await fs.readdir(docsSrc)) {
      await fs.copyFile(path.join(docsSrc, entry), path.join(stage, "docs", entry));
    }
  }
  for (const readme of ["README.pdf", "README.md"]) {
    const src = path.join(root, "docs", "desktop", readme);
    if (await exists(src)) {
      await fs.copyFile(src, path.join(stage, readme));
      break;
    }
  }

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
