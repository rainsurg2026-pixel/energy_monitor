// Launches electron-builder via its Node API entry point. We avoid the
// node_modules/.bin cmd shims because the project path contains "&", which
// breaks cmd.exe shim resolution on Windows.
import { createRequire } from "module";
import { spawn } from "child_process";
import path from "path";

const require = createRequire(import.meta.url);
const pkg = require("electron-builder/package.json");
const bin = require.resolve(`electron-builder/${pkg.bin["electron-builder"] ?? pkg.bin}`);

// Some portable/CI environments invoke Node by absolute path without adding
// its directory to PATH. electron-builder resolves npm through PATH while
// collecting production dependencies, so make the current Node installation
// discoverable without changing the user's global environment.
const nodeDir = path.dirname(process.execPath);
const separator = process.platform === "win32" ? ";" : ":";
const env = {
  ...process.env,
  PATH: [nodeDir, process.env.PATH].filter(Boolean).join(separator)
};
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", code => process.exit(code ?? 0));
