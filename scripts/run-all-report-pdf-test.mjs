import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = path.join(root, "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
const bundle = path.join(root, "dist-electron", "test-all-report-pdf.cjs");
const build = spawnSync(esbuild, ["scripts/test-all-report-pdf.ts", "--bundle", "--platform=node", "--external:electron", "--outfile=" + bundle, "--format=cjs", "--log-level=error"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const electronCli = path.join(root, "node_modules", "electron", "cli.js");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const userData = path.join(process.env.TEMP ?? root, "energy-report-pdf-test");
const result = spawnSync(process.execPath, [electronCli, bundle, "--no-sandbox", `--user-data-dir=${userData}`], { cwd: root, stdio: "inherit", env });
process.exit(result.status ?? 1);
