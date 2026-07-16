// Development runner: starts the Vite dev server, builds the Electron main
// bundle, then launches Electron pointed at the dev server (with HMR).
import { spawn } from "child_process";
import { createServer } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1. Vite dev server (renderer)
const vite = await createServer({ root });
await vite.listen();
const address = vite.httpServer.address();
const devUrl = `http://localhost:${address.port}`;
vite.printUrls();

// 2. Main-process bundle
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(root, "scripts/build-electron.mjs")], {
    stdio: "inherit"
  });
  p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`esbuild exited ${code}`))));
});

// 3. Electron
const electronBin = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
// ELECTRON_RUN_AS_NODE leaks in from IDE extension hosts and would make
// Electron start as plain Node - strip it.
const env = { ...process.env, VITE_DEV_SERVER_URL: devUrl };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, ["."], { stdio: "inherit", env });

child.on("exit", async code => {
  await vite.close();
  process.exit(code ?? 0);
});
