import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.PACKAGED_TEST_ROOT ?? path.join(process.cwd(), "release", "Energy Monitor-v2.3.1"));
const exe = path.join(root, "Energy Monitor-v2.3.1.exe");
const workbook = path.join(root, "DC_Rangsit.xlsm");
const port = 9344;
const userData = path.join(root, "user-data-restart");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = file => fs.access(file).then(() => true).catch(() => false);

if (!(await exists(exe)) || !(await exists(workbook))) {
  throw new Error(`Packaged restart test inputs are missing under ${root}`);
}

await fs.rm(userData, { recursive: true, force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [workbook, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--no-sandbox"], {
  cwd: root,
  env,
  stdio: "ignore",
  windowsHide: true
});
let socket = null;
let shutdownRequested = false;

async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json();
      const page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // Electron can expose the debugging endpoint before the page target is stable.
    }
    await sleep(500);
  }
  throw new Error("Packaged restart test did not expose a page target.");
}

function createClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  ws.addEventListener("close", () => {
    for (const resolve of pending.values()) resolve({ error: "CDP socket closed" });
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== 1) return reject(new Error(`CDP socket is not open (state ${ws.readyState})`));
        const requestId = ++id;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
  };
}

async function waitForOpen(ws) {
  if (ws.readyState === 1) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for CDP socket open.")), 5000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP socket failed to open.")); }, { once: true });
  });
}

async function waitFor(name, fn) {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${name}: ${JSON.stringify(last)}`);
}

try {
  socket = await connect();
  await waitForOpen(socket);
  const cdp = createClient(socket);
  await cdp.send("Runtime.enable");
  const evaluate = async expression => {
    const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
    return response.result?.result?.value;
  };

  await waitFor("renderer content", () => evaluate("document.body && document.body.innerText.length > 500"));
  const config = await evaluate("window.desktop.config.get()");
  if (config.globalDataDisplayPeriod !== "2026") {
    throw new Error(`Restarted packaged config did not retain 2026: ${JSON.stringify(config)}`);
  }
  await evaluate(`[...document.querySelectorAll("nav button")].find(button => button.innerText.includes("Settings & Data Validation"))?.click()`);
  const settings = await waitFor("Global Data Display Period after restart", () => evaluate(`(() => {
    const select = document.querySelector('[data-testid="global-data-display-period"]');
    const integrity = document.querySelector('[data-testid="integrity-display-period"]');
    return select?.value === "2026" && integrity?.innerText.includes("2026")
      ? { selected: select.value, integrity: integrity.innerText }
      : null;
  })()`));
  console.log(`Packaged restart display period: ${JSON.stringify(settings)}`);
  await cdp.send("Browser.close");
  shutdownRequested = true;
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 10_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  if (child.exitCode !== 0 && child.exitCode !== null) throw new Error(`Packaged restart process exited with ${child.exitCode}`);
  console.log("PACKAGED DISPLAY PERIOD RESTART PASSED");
} finally {
  if (socket?.readyState === 1) socket.close();
  if (!shutdownRequested && child.exitCode === null) {
    if (child.pid) spawnSync("taskkill", ["/F", "/PID", String(child.pid), "/T"], { stdio: "ignore" });
    child.kill();
  }
}
