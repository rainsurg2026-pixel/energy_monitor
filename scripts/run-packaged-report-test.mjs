import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.env.PACKAGED_EXE ?? path.join(root, "release", "win-unpacked", "Energy Monitor.exe");
const workbook = path.join(root, "DC_Rangsit.xlsm");
const outputDir = path.join(root, "release", `packaged-test-export-${Date.now()}`);
const userData = path.join(process.env.TEMP ?? root, `energy-monitor-packaged-test-${Date.now()}`);
const port = 9333;

await fs.mkdir(outputDir, { recursive: true });
const env = { ...process.env, ENERGY_MONITOR_TEST_EXPORT_DIR: outputDir };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [workbook, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { cwd: root, env, stdio: "ignore" });

// --- Process lifecycle tracking (diagnostics only; no retry/timing behavior change) ---
const processLifecycle = { pid: child.pid, spawnedAt: Date.now(), exit: null };
child.on("exit", (code, signal) => {
  processLifecycle.exit = { code, signal, at: Date.now() };
});

// --- CDP target lifecycle tracking (diagnostics only) ---
const targetPollLog = [];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json();
      const pageTargets = targets.filter(target => target.type === "page");
      targetPollLog.push({ attempt, at: Date.now(), targetCount: targets.length, pageTargetCount: pageTargets.length });
      const page = pageTargets.find(target => target.webSocketDebuggerUrl);
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch (error) {
      targetPollLog.push({ attempt, at: Date.now(), fetchError: String(error?.message ?? error) });
    }
    await sleep(500);
  }
  throw new Error("Packaged Electron window did not expose a stable page target.");
}

// Reads the app's own startup-diagnostics-<pid>.log (written unconditionally by
// src/electron/main.ts) to distinguish "renderer never initialized" from every
// other failure mode, instead of reporting every failure as a generic timeout.
async function readRendererLifecycle() {
  if (!processLifecycle.pid) return { available: false };
  const logPath = path.join(userData, `startup-diagnostics-${processLifecycle.pid}.log`);
  let contents;
  try {
    contents = await fs.readFile(logPath, "utf8");
  } catch {
    return { available: false, logPath };
  }
  const count = stage => (contents.match(new RegExp(`stage=${stage}\\b`, "g")) ?? []).length;
  return {
    available: true,
    logPath,
    initialized: contents.includes("stage=renderer-initialized"),
    browserWindowCreatedCount: count("browser-window-created"),
    rendererLoadStartedCount: count("create-main-window:created"),
    renderProcessGoneCount: count("render-process-gone"),
    gpuProcessGoneCount: count("child-process-gone"),
    didFailLoadCount: count("did-fail-load"),
    tail: contents.trim().split("\n").slice(-8)
  };
}

async function reportFailure(error) {
  const renderer = await readRendererLifecycle();
  const rendererNeverInitialized = renderer.available && !renderer.initialized &&
    (renderer.renderProcessGoneCount > 0 || renderer.gpuProcessGoneCount > 0);

  console.error("\n--- packaged-report-test failure diagnostics ---");
  console.error("Process lifecycle:", JSON.stringify(processLifecycle));
  console.error(`Target lifecycle: ${targetPollLog.length} poll attempt(s) recorded`);
  console.error(JSON.stringify(targetPollLog.slice(-5)));
  console.error("Renderer lifecycle:", JSON.stringify({ ...renderer, tail: undefined }));
  if (renderer.tail) console.error("Renderer diagnostic log tail:\n" + renderer.tail.join("\n"));

  if (rendererNeverInitialized) {
    console.error("\nRenderer failed before initialization. Possible external runtime interference.");
  } else {
    console.error(`\n${error.message}`);
  }
  console.error("--- end diagnostics ---\n");
}

function client(ws) {
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
  ws.addEventListener("error", event => {
    for (const resolve of pending.values()) resolve({ error: String(event.error ?? "CDP WebSocket error") });
    pending.clear();
  });
  ws.addEventListener("close", () => {
    for (const resolve of pending.values()) resolve({ error: "CDP WebSocket closed" });
    pending.clear();
  });
  return { send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== 1) return reject(new Error(`CDP socket is not open (state ${ws.readyState})`));
      const requestId = ++id;
      pending.set(requestId, resolve);
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }};
}

async function waitForSocketOpen(ws) {
  if (ws.readyState === 1) return;
  if (ws.readyState !== 0) throw new Error(`CDP socket closed before open (state ${ws.readyState})`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for CDP WebSocket open.")), 5000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket failed before open.")); }, { once: true });
  });
}

async function connectRuntime() {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const ws = await connect();
      await waitForSocketOpen(ws);
      const cdp = client(ws);
      await cdp.send("Runtime.enable");
      return { ws, cdp };
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`Unable to establish stable CDP Runtime session: ${lastError?.message ?? lastError}`);
}

try {
  const { ws, cdp } = await connectRuntime();
  const evaluate = async expression => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await evaluate("document.body && document.body.innerText.length > 500");
    if (ready) break;
    await sleep(500);
  }
  await evaluate("[...document.querySelectorAll('button')].find(button => button.innerText.trim().startsWith('1.'))?.click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("Boolean(document.querySelector('button[title=\\\"Ctrl+E / Ctrl+Shift+S\\\"]'))")) break;
    await sleep(300);
  }
  await evaluate("document.querySelector('button[title=\\\"Ctrl+E / Ctrl+Shift+S\\\"]')?.click()");
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("document.body.innerText.includes('Export All Report')")) break;
    await sleep(300);
  }
  await evaluate("[...document.querySelectorAll('button')].find(button => button.innerText.trim().startsWith('Export All Report'))?.click()");
  for (let attempt = 0; attempt < 120; attempt++) {
    const files = (await fs.readdir(outputDir)).filter(file => file.toLowerCase().endsWith(".pdf"));
    if (files.length > 0) {
      console.log(`Packaged Export All Report generated: ${path.join(outputDir, files[0])}`);
      break;
    }
    await sleep(500);
    if (attempt === 119) throw new Error("Packaged Export All Report did not produce a PDF.");
  }
  ws.close();
} catch (error) {
  await reportFailure(error);
  process.exitCode = 1;
  throw error;
} finally {
  child.kill();
  spawnSync("taskkill", ["/F", "/IM", "Energy Monitor.exe", "/T"], { stdio: "ignore" });
}
