// Launches electron-builder via its Node API entry point. We avoid the
// node_modules/.bin cmd shims because the project path contains "&", which
// breaks cmd.exe shim resolution on Windows.
import { createRequire } from "module";
import { spawn } from "child_process";

const require = createRequire(import.meta.url);
const pkg = require("electron-builder/package.json");
const bin = require.resolve(`electron-builder/${pkg.bin["electron-builder"] ?? pkg.bin}`);

const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
