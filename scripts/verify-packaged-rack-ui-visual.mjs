// One-off visual verification pass for the v2.2.4 corrective release: spawns
// the just-built packaged portable EXE with Google Sheets enabled, captures
// real screenshots of the redesigned Rack Capacity view for BOTH facilities,
// and verifies Google sign-in initiates from the packaged runtime (reaching
// a graceful Connection Error, since no OAuth client config exists here).
// Not part of the permanent `npm test:*` suite - a targeted diagnostic run
// so the screenshots can be visually inspected, not just text-asserted.
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const sourceExe = path.join(root, "release", `Energy Monitor-v${pkg.version}.exe`);
const port = 9345;
const testRoot = path.join(process.env.TEMP ?? root, `energy-monitor-visual-${Date.now()}`);
const exe = path.join(testRoot, path.basename(sourceExe));
const rangsit = path.join(testRoot, "DC_Rangsit.xlsm");
const srinakarin = path.join(testRoot, "DC_Srinakarin.xlsm");
const userData = path.join(testRoot, "user-data");
const shotDir = path.join(process.env.TEMP ?? root, "energy-monitor-visual-verification-screens");
const sleep = ms => new Promise(r => setTimeout(r, ms));

await fs.mkdir(path.join(testRoot, "config"), { recursive: true });
await fs.mkdir(shotDir, { recursive: true });
await Promise.all([
  fs.copyFile(sourceExe, exe),
  fs.copyFile(path.join(root, "DC_Rangsit.xlsm"), rangsit),
  fs.copyFile(path.join(root, "DC_Srinakarin.xlsm"), srinakarin)
]);
await fs.writeFile(path.join(testRoot, "config", "config.json"), JSON.stringify({
  activeFacilityId: "rangsit",
  defaultWorkbookPath: rangsit,
  lastWorkbookPath: rangsit,
  startupBehavior: "last",
  theme: "dark",
  language: "en",
  backupFolder: null,
  backupKeep: 3,
  autoSaveIntervalMinutes: 0,
  googleSheets: { enabled: true, spreadsheetId: null },
  recentFiles: [rangsit],
  window: { width: 1440, height: 900, maximized: false },
  security: { pinEnabled: false, pinHash: null }
}, null, 2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [rangsit, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: testRoot, env, stdio: "ignore" });

function stop() {
  if (child.pid) spawnSync("taskkill", ["/F", "/PID", String(child.pid), "/T"], { stdio: "ignore" });
  child.kill();
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("no CDP target");
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  return { send(method, params = {}) { return new Promise(resolve => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params })); }); } };
}

try {
  const ws = await connect();
  await new Promise(resolve => (ws.readyState === 1 ? resolve() : ws.addEventListener("open", resolve)));
  const cdp = makeClient(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  const evalJs = async expression => {
    const res = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  const shoot = async name => {
    const res = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(shotDir, name), Buffer.from(res.result.data, "base64"));
    console.log(`saved ${name}`);
  };

  for (let i = 0; i < 30; i++) {
    const ready = await evalJs("document.body.innerText.includes('DC_Rangsit.xlsm')");
    if (ready) break;
    await sleep(500);
  }
  await evalJs(`document.querySelectorAll("nav button")[2]?.click()`);
  await sleep(1500);
  await shoot("01-rangsit-rack-capacity.png");

  // Switch facility to Srinakarin and re-capture.
  await evalJs(`(() => {
    const select = document.querySelector("header select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "srinakarin");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  for (let i = 0; i < 30; i++) {
    const ready = await evalJs("document.body.innerText.includes('DC_Srinakarin.xlsm')");
    if (ready) break;
    await sleep(500);
  }
  await evalJs(`document.querySelectorAll("nav button")[2]?.click()`);
  await sleep(1500);
  await shoot("02-srinakarin-rack-capacity.png");

  // Google sign-in initiation from the packaged runtime.
  await evalJs(`document.querySelectorAll("nav button")[1]?.click()`);
  await sleep(1000);
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll("button")].find(b => b.innerText.includes("Sign in with Google"));
    btn?.click();
  })()`);
  let googleText = "";
  for (let i = 0; i < 20; i++) {
    googleText = await evalJs("document.body.innerText");
    if (googleText.includes("Connection Error")) break;
    await sleep(300);
  }
  console.log("Google sign-in reached Connection Error (packaged):", googleText.includes("Connection Error"));
  await shoot("03-packaged-google-oauth-attempt.png");

  await cdp.send("Browser.close");
} finally {
  stop();
  await sleep(500);
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
}
console.log("done");
