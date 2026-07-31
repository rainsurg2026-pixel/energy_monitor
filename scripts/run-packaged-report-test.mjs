import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const sourceExe = process.env.PACKAGED_EXE ?? path.join(root, "release", `Energy Monitor-v${pkg.version}.exe`);
const port = 9333;
const runId = Date.now();
const testRoot = path.join(process.env.TEMP ?? root, `energy-monitor-packaged-test-${runId}`);
const exeName = path.basename(sourceExe);
const exe = path.join(testRoot, exeName);
const rangsit = path.join(testRoot, "DC_Rangsit.xlsm");
const srinakarin = path.join(testRoot, "DC_Srinakarin.xlsm");
const outputDir = path.join(testRoot, "exports-test");
const userData = path.join(testRoot, "user-data");
const sourceWorkbooks = [
  path.join(root, "DC_Rangsit.xlsm"),
  path.join(root, "DC_Srinakarin.xlsm")
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex").toUpperCase();
const exists = async file => fs.access(file).then(() => true).catch(() => false);

if (!(await exists(sourceExe))) {
  throw new Error(`Portable executable not found: ${sourceExe}`);
}
if (!path.basename(sourceExe).includes(`v${pkg.version}`)) {
  throw new Error(`Packaged executable does not match package.json version ${pkg.version}: ${sourceExe}`);
}

const sourceHashesBefore = await Promise.all(sourceWorkbooks.map(sha256));
await fs.mkdir(path.join(testRoot, "config"), { recursive: true });
await Promise.all([
  fs.copyFile(sourceExe, exe),
  fs.copyFile(sourceWorkbooks[0], rangsit),
  fs.copyFile(sourceWorkbooks[1], srinakarin)
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
  googleSheets: { enabled: false, spreadsheetId: null },
  recentFiles: [rangsit],
  window: { width: 1440, height: 816, maximized: false },
  security: { pinEnabled: false, pinHash: null }
}, null, 2));
await fs.mkdir(outputDir, { recursive: true });

const env = { ...process.env, ENERGY_MONITOR_TEST_EXPORT_DIR: outputDir };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(exe, [rangsit, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: testRoot,
  env,
  stdio: "ignore"
});
const processLifecycle = { pid: child.pid, spawnedAt: Date.now(), exit: null };
child.on("exit", (code, signal) => {
  processLifecycle.exit = { code, signal, at: Date.now() };
});
const targetPollLog = [];
let ws = null;
let cdp = null;
let shutdownRequested = false;
let runtimeLog = { available: false };
let completed = false;

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

function client(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  socket.addEventListener("error", event => {
    for (const resolve of pending.values()) resolve({ error: String(event.error ?? "CDP WebSocket error") });
    pending.clear();
  });
  socket.addEventListener("close", () => {
    for (const resolve of pending.values()) resolve({ error: "CDP WebSocket closed" });
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== 1) return reject(new Error(`CDP socket is not open (state ${socket.readyState})`));
        const requestId = ++id;
        pending.set(requestId, resolve);
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
  };
}

async function waitForSocketOpen(socket) {
  if (socket.readyState === 1) return;
  if (socket.readyState !== 0) throw new Error(`CDP socket closed before open (state ${socket.readyState})`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for CDP WebSocket open.")), 5000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket failed before open.")); }, { once: true });
  });
}

async function connectRuntime() {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const socket = await connect();
      await waitForSocketOpen(socket);
      const protocol = client(socket);
      await protocol.send("Runtime.enable");
      return { socket, protocol };
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`Unable to establish stable CDP Runtime session: ${lastError?.message ?? lastError}`);
}

async function waitFor(name, fn, attempts = 60, delay = 500) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await fn();
    if (last) return last;
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for ${name}: ${JSON.stringify(last)}`);
}

async function readRendererLifecycle() {
  const logFiles = await fs.readdir(userData).catch(() => []);
  const diagnostics = logFiles.filter(file => /^startup-diagnostics-\d+\.log$/.test(file));
  if (diagnostics.length === 0) return { available: false, userData };
  const entries = await Promise.all(diagnostics.map(async file => ({
    file,
    stat: await fs.stat(path.join(userData, file))
  })));
  const selected = entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  const logPath = path.join(userData, selected.file);
  const contents = await fs.readFile(logPath, "utf8");
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
    tail: contents.trim().split("\n").slice(-10)
  };
}

async function readRuntimeLog() {
  const logPath = path.join(testRoot, "logs", "app.log");
  try {
    const contents = await fs.readFile(logPath, "utf8");
    return { available: true, logPath, tail: contents.trim().split("\n").slice(-12) };
  } catch {
    return { available: false, logPath };
  }
}

async function reportFailure(error) {
  const renderer = await readRendererLifecycle();
  console.error("\n--- packaged-report-test failure diagnostics ---");
  console.error("Process lifecycle:", JSON.stringify(processLifecycle));
  console.error(`Target lifecycle: ${targetPollLog.length} poll attempt(s) recorded`);
  console.error(JSON.stringify(targetPollLog.slice(-5)));
  console.error("Renderer lifecycle:", JSON.stringify({ ...renderer, tail: undefined }));
  if (renderer.tail) console.error("Renderer diagnostic log tail:\n" + renderer.tail.join("\n"));
  console.error(`\n${error.message}`);
  console.error("--- end diagnostics ---\n");
}

async function waitForChildExit(timeoutMs = 10_000) {
  if (child.exitCode !== null) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopProcessTree() {
  if (child.exitCode !== null) return;
  if (child.pid) spawnSync("taskkill", ["/F", "/PID", String(child.pid), "/T"], { stdio: "ignore" });
  child.kill();
  await sleep(500);
}

async function selectFacility(evaluate, id, expectedWorkbook) {
  const changed = await evaluate(`(() => {
    const select = document.querySelector("header select");
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, ${JSON.stringify(id)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Facility selector was not available.");
  await waitFor(`${id} facility workbook`, async () => evaluate(`(() => {
    const select = document.querySelector("header select");
    return select?.value === ${JSON.stringify(id)} && document.body.innerText.includes(${JSON.stringify(expectedWorkbook)});
  })()`));
}

let primaryError = null;
try {
  const connection = await connectRuntime();
  ws = connection.socket;
  cdp = connection.protocol;
  const evaluate = async expression => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };

  await waitFor("renderer content", () => evaluate("document.body && document.body.innerText.length > 500"));
  await waitFor("Rangsit startup workbook", () => evaluate("document.body.innerText.includes('DC_Rangsit.xlsm')"));
  const appInfo = await evaluate("window.desktop.app.getInfo()");
  if (appInfo.version !== pkg.version || !appInfo.portable || appInfo.appRoot !== testRoot) {
    throw new Error(`Unexpected packaged app identity: ${JSON.stringify(appInfo)}`);
  }

  const facilityRegistry = await evaluate("window.desktop.facilities.list()");
  const mapped = Object.fromEntries(facilityRegistry.facilities.map(facility => [facility.id, facility.workbook]));
  if (mapped.rangsit !== rangsit || mapped.srinakarin !== srinakarin || mapped.rangsit === mapped.srinakarin) {
    throw new Error(`Facility workbook mapping is not isolated: ${JSON.stringify(mapped)}`);
  }

  // Rack Capacity tab, packaged build: Rangsit's real total (358 racks) must
  // render, proving the packaged asar bundle (recharts/lucide included)
  // renders this new tab correctly, not just the dev build.
  await evaluate(`document.querySelectorAll("nav button")[2]?.click()`);
  await waitFor("Rangsit Rack Capacity data", () => evaluate("document.body.innerText.includes('358')"));
  const rangsitRackText = await evaluate("document.body.innerText");
  if (!/\b294\b/.test(rangsitRackText)) throw new Error("Rangsit Rack Capacity In Use count (294) did not render in the packaged build.");

  await selectFacility(evaluate, "srinakarin", "DC_Srinakarin.xlsm");
  await evaluate(`document.querySelectorAll("nav button")[2]?.click()`);
  await waitFor("Srinakarin Rack Capacity data (facility isolation)", () => evaluate("document.body.innerText.includes('237')"));
  const srinakarinRackText = await evaluate("document.body.innerText");
  if (/\b358\b/.test(srinakarinRackText)) throw new Error("Srinakarin Rack Capacity tab still shows Rangsit's total (358) - facility isolation leak.");
  if (!/\b218\b/.test(srinakarinRackText)) throw new Error("Srinakarin Rack Capacity In Use count (218) did not render in the packaged build.");

  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.innerText.includes('Site Comparison'))?.click()");
  const comparisonRows = await waitFor("comparison data", () => evaluate(`(() => {
    const section = document.querySelector('[data-testid="facility-comparison"]');
    const referenceMonth = document.querySelector('[data-testid="comparison-reference-month"]')?.value;
    const rows = [...(section?.querySelectorAll("tbody tr") ?? [])];
    const wholeBuildingEnergy = rows.map(row => row.querySelector("td:nth-child(3)")?.innerText);
    return referenceMonth && rows.length === 2 && wholeBuildingEnergy.every(value => value && value !== "—")
      ? rows.map(row => row.innerText)
      : null;
  })()`));
  const rangsitRow = comparisonRows.find(row => row.includes("Rangsit"));
  const srinakarinRow = comparisonRows.find(row => row.includes("Srinakarin"));
  if (!rangsitRow || !srinakarinRow || rangsitRow === srinakarinRow || !rangsitRow.includes("4") || !srinakarinRow.includes("6")) {
    throw new Error(`Comparison did not preserve separate facility data/configuration: ${JSON.stringify(comparisonRows)}`);
  }

  const comparisonState = await evaluate(`(() => {
    const section = document.querySelector('[data-testid="facility-comparison"]');
    const month = document.querySelector('[data-testid="comparison-reference-month"]');
    return {
      options: month ? [...month.options].map(option => option.value) : [],
      referenceMonth: month?.value ?? null,
      table: section?.querySelector("tbody")?.innerText ?? "",
      energyMonthCount: Number(document.querySelector('[data-testid="comparison-energy-chart"]')?.getAttribute("data-month-count")),
      costMonthCount: Number(document.querySelector('[data-testid="comparison-cost-chart"]')?.getAttribute("data-month-count")),
      energyReferenceMonth: document.querySelector('[data-testid="comparison-energy-chart"]')?.getAttribute("data-reference-month"),
      costReferenceMonth: document.querySelector('[data-testid="comparison-cost-chart"]')?.getAttribute("data-reference-month"),
    };
  })()`);
  if (!comparisonState.referenceMonth || comparisonState.options.length === 0 || !comparisonState.options.every(month => /^\d{4}-\d{2}$/.test(month)) || comparisonState.energyMonthCount !== 12 || comparisonState.costMonthCount !== 12 || comparisonState.energyReferenceMonth !== comparisonState.referenceMonth || comparisonState.costReferenceMonth !== comparisonState.referenceMonth) {
    throw new Error(`Comparison controls are not initialized from real monthly data: ${JSON.stringify(comparisonState)}`);
  }

  const alternateReferenceMonth = comparisonState.options.find(month => month !== comparisonState.referenceMonth);
  if (!alternateReferenceMonth) throw new Error("Comparison needs at least two real reporting months to verify Reference Month.");
  const initialComparisonTable = comparisonState.table;
  await evaluate(`(() => {
    const month = document.querySelector('[data-testid="comparison-reference-month"]');
    if (!month) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(month, ${JSON.stringify(alternateReferenceMonth)});
    month.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor("Reference Month update", () => evaluate(`(() => {
    const month = document.querySelector('[data-testid="comparison-reference-month"]');
    const energy = document.querySelector('[data-testid="comparison-energy-chart"]');
    const cost = document.querySelector('[data-testid="comparison-cost-chart"]');
    const table = document.querySelector('[data-testid="facility-comparison"] tbody')?.innerText ?? "";
    return month?.value === ${JSON.stringify(alternateReferenceMonth)}
      && energy?.getAttribute("data-reference-month") === ${JSON.stringify(alternateReferenceMonth)}
      && cost?.getAttribute("data-reference-month") === ${JSON.stringify(alternateReferenceMonth)}
      && table !== ${JSON.stringify(initialComparisonTable)};
  })()`));
  await evaluate(`(() => {
    const month = document.querySelector('[data-testid="comparison-reference-month"]');
    if (!month) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(month, ${JSON.stringify(comparisonState.referenceMonth)});
    month.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor("Reference Month restoration", () => evaluate(`(() => document.querySelector('[data-testid="comparison-reference-month"]')?.value === ${JSON.stringify(comparisonState.referenceMonth)} && document.querySelector('[data-testid="comparison-energy-chart"]')?.getAttribute("data-reference-month") === ${JSON.stringify(comparisonState.referenceMonth)} && document.querySelector('[data-testid="comparison-cost-chart"]')?.getAttribute("data-reference-month") === ${JSON.stringify(comparisonState.referenceMonth)})()`));

  for (const range of [3, 6, 12]) {
    await evaluate(`document.querySelector('[data-testid="comparison-range-${range}"]')?.click()`);
    await waitFor(`${range}-month comparison range`, () => evaluate(`(() => {
      const energy = document.querySelector('[data-testid="comparison-energy-chart"]');
      const cost = document.querySelector('[data-testid="comparison-cost-chart"]');
      return Number(energy?.getAttribute("data-month-count")) === ${range}
        && Number(cost?.getAttribute("data-month-count")) === ${range}
        && document.querySelector('[data-testid="comparison-range-${range}"]')?.getAttribute("aria-pressed") === "true";
    })()`));
  }

  const chartState = await evaluate(`(() => {
    const inspect = testId => {
      const chart = document.querySelector('[data-testid="' + testId + '"]');
      return {
        svg: chart?.querySelectorAll("svg").length ?? 0,
        labels: chart?.querySelectorAll(".recharts-label-list text").length ?? 0,
        compactLabel: /\\d(?:\\.\\d+)?[KMB]/.test(chart?.innerText ?? ""),
      };
    };
    return { energy: inspect("comparison-energy-chart"), cost: inspect("comparison-cost-chart") };
  })()`);
  if (chartState.energy.svg === 0 || chartState.cost.svg === 0 || chartState.energy.labels === 0 || chartState.cost.labels === 0 || !chartState.energy.compactLabel || !chartState.cost.compactLabel) {
    throw new Error(`Comparison chart labels are missing or not compact: ${JSON.stringify(chartState)}`);
  }

  const directRead = await evaluate(`window.desktop.excel.openMultiple([
    { path: ${JSON.stringify(rangsit)}, devices: { upsIds: ["UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A (PPC44A)", "UPS 15B (PPC44B)"], dcIds: ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"], airFields: ["eb41a", "eb41b", "eb42a", "eb42b"] } },
    { path: ${JSON.stringify(srinakarin)}, devices: { upsIds: ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"], dcIds: ["DC PDB41A", "DC PDB41B"], airFields: ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"] } }
  ]).then(result => ({
    ok: result.ok,
    paths: Object.keys(result.workbooks ?? {}),
    rangsitAir: result.workbooks?.[${JSON.stringify(rangsit)}]?.logs?.find(log => log.month === "2026-05")?.air,
    srinakarinMeters: Object.keys(result.workbooks?.[${JSON.stringify(srinakarin)}]?.logs?.find(log => log.month === "2026-05")?.air?.meters ?? {}).sort(),
    rangsitReferenceEnergyCost: result.workbooks?.[${JSON.stringify(rangsit)}]?.logs?.find(log => log.month === ${JSON.stringify(comparisonState.referenceMonth)})?.energyCost,
    srinakarinReferenceEnergyCost: result.workbooks?.[${JSON.stringify(srinakarin)}]?.logs?.find(log => log.month === ${JSON.stringify(comparisonState.referenceMonth)})?.energyCost
  }))`);
  if (!directRead.ok || directRead.paths.length !== 2 || typeof directRead.rangsitAir?.eb42a !== "number" || directRead.rangsitAir?.meters?.eb43a !== undefined || !directRead.srinakarinMeters.includes("eb43a") || !directRead.srinakarinMeters.includes("eb44b")) {
    throw new Error(`openMultiple did not return isolated meter mappings: ${JSON.stringify(directRead)}`);
  }
  const format = value => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const rangsitReference = directRead.rangsitReferenceEnergyCost;
  const srinakarinReference = directRead.srinakarinReferenceEnergyCost;
  if (!rangsitReference || !srinakarinReference || !comparisonState.table.includes(format(rangsitReference.buildingEnergyKwh)) || !comparisonState.table.includes(format(rangsitReference.buildingElectricityCostThb)) || !comparisonState.table.includes(format(srinakarinReference.buildingEnergyKwh)) || !comparisonState.table.includes(format(srinakarinReference.buildingElectricityCostThb))) {
    throw new Error(`Comparison table did not render authoritative reference-month workbook values: ${JSON.stringify({ comparisonState, directRead })}`);
  }

  const tooltipText = await evaluate(`(() => {
    const chart = document.querySelector('[data-testid="comparison-energy-chart"]');
    const trigger = chart?.querySelector(".recharts-wrapper") ?? chart?.querySelector(".recharts-surface");
    if (!trigger) return "";
    const rect = trigger.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX, clientY }));
    trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
    return true;
  })()`);
  await sleep(400);
  const energyTooltip = await evaluate("document.querySelector('[data-testid=\"comparison-energy-chart\"] .recharts-tooltip-wrapper')?.innerText ?? ''");
  if (!tooltipText || !/kWh/.test(energyTooltip) || !/\d{1,3}(?:,\d{3})*(?:\.\d+)?/.test(energyTooltip)) {
    throw new Error(`Comparison energy tooltip is not full-value data: ${JSON.stringify(energyTooltip)}`);
  }


  // Nav order: Dashboard, Data Entry, Rack Capacity, Historical Logs, Site Comparison, Settings.
  await evaluate(`document.querySelectorAll("nav button")[5]?.click()`);
  await waitFor("English language control", () => evaluate("Boolean([...document.querySelectorAll('button')].find(button => button.innerText.trim() === 'ภาษาไทย'))"));
  await evaluate(`[...document.querySelectorAll("button")].find(button => button.innerText.trim() === "ภาษาไทย")?.click()`);
  await waitFor("Thai Site Comparison", () => evaluate("[...document.querySelectorAll('nav button')].some(button => button.innerText.includes('เปรียบเทียบ'))"));
  await evaluate(`[...document.querySelectorAll("nav button")].find(button => button.innerText.includes("เปรียบเทียบ"))?.click()`);
  const thaiComparison = await waitFor("Thai comparison data", () => evaluate(`(() => {
    const section = document.querySelector('[data-testid="facility-comparison"]');
    const text = section?.innerText ?? "";
    const wholeBuildingEnergy = section?.querySelector("tbody tr td:nth-child(3)")?.innerText;
    return text.includes("เลือกเดือนอ้างอิง")
      && text.includes("ย้อนหลัง 3 เดือน")
      && text.includes("แนวโน้มการใช้พลังงานรายเดือน")
      && text.includes("ค่าไฟชั้น 4")
      && wholeBuildingEnergy
      && wholeBuildingEnergy !== "—"
      ? text
      : null;
  })()`));
  if (!thaiComparison.includes("แนวโน้มการใช้พลังงานรายเดือน") || !thaiComparison.includes("ค่าไฟชั้น 4")) {
    throw new Error(`Thai Site Comparison labels are incomplete: ${thaiComparison}`);
  }

  await evaluate(`[...document.querySelectorAll("button")].find(button => button.innerText.trim() === "English (EN)")?.click()`);
  await waitFor("English language control restored", () => evaluate("Boolean([...document.querySelectorAll('button')].find(button => button.innerText.trim() === 'ภาษาไทย (TH)'))"));
  await selectFacility(evaluate, "rangsit", "DC_Rangsit.xlsm");
  await evaluate("document.querySelectorAll('nav button')[1]?.click()");
  await waitFor("entry export button", () => evaluate("Boolean(document.querySelector('button[title=\"Ctrl+E / Ctrl+Shift+S\"]'))"), 30, 300);
  await evaluate("document.querySelector('button[title=\"Ctrl+E / Ctrl+Shift+S\"]')?.click()");
  await waitFor("export center", () => evaluate("document.body.innerText.includes('Export All Report') && document.body.innerText.includes('Current view as an A4 landscape PDF')"), 30, 300);
  await evaluate("[...document.querySelectorAll('button')].find(button => button.innerText.trim().startsWith('PDF'))?.click()");
  const currentPagePdf = await waitFor("current-page PDF", async () => {
    const files = (await fs.readdir(outputDir)).filter(file => file.toLowerCase().endsWith(".pdf"));
    return files.length > 0 ? path.join(outputDir, files[0]) : null;
  }, 120, 500);
  if ((await fs.stat(currentPagePdf)).size < 1000) throw new Error(`Current-page PDF is unexpectedly small: ${currentPagePdf}`);
  console.log(`Packaged current-page PDF generated: ${currentPagePdf}`);

  await evaluate("document.querySelector('button[title=\"Ctrl+E / Ctrl+Shift+S\"]')?.click()");
  await waitFor("export all action", () => evaluate("document.body.innerText.includes('Export All Report')"), 30, 300);
  await evaluate("[...document.querySelectorAll('button')].find(button => button.innerText.trim().startsWith('Export All Report'))?.click()");
  const allReportPdf = await waitFor("all-report PDF", async () => {
    const files = (await fs.readdir(outputDir)).filter(file => file.toLowerCase().endsWith(".pdf"));
    const file = files.find(name => path.join(outputDir, name) !== currentPagePdf);
    return file ? path.join(outputDir, file) : null;
  }, 120, 500);
  if ((await fs.stat(allReportPdf)).size < 1000) throw new Error(`All-report PDF is unexpectedly small: ${allReportPdf}`);
  console.log(`Packaged Export All Report generated: ${allReportPdf}`);

  await cdp.send("Browser.close");
  shutdownRequested = true;
  if (!(await waitForChildExit())) throw new Error("Packaged app did not exit after Browser.close.");
  completed = true;
} catch (error) {
  primaryError = error instanceof Error ? error : new Error(String(error));
  await reportFailure(primaryError);
} finally {
  if (ws && ws.readyState === 1) ws.close();
  if (!shutdownRequested || child.exitCode === null) await stopProcessTree();
  runtimeLog = await readRuntimeLog();
  const sourceHashesAfter = await Promise.all(sourceWorkbooks.map(sha256));
  const sourcesUnchanged = sourceHashesBefore.every((hash, index) => hash === sourceHashesAfter[index]);
  if (!sourcesUnchanged && !primaryError) {
    primaryError = new Error(`Source workbook integrity failed: before=${JSON.stringify(sourceHashesBefore)} after=${JSON.stringify(sourceHashesAfter)}`);
  }
  if (runtimeLog.available) console.log("Packaged runtime log tail:\n" + runtimeLog.tail.join("\n"));
  if (!sourcesUnchanged) console.error("Source workbook integrity failed during packaged runtime test.");
  await fs.rm(testRoot, { recursive: true, force: true });
}

if (primaryError) throw primaryError;
if (!runtimeLog.available) throw new Error(`Packaged runtime log was not created: ${runtimeLog.logPath}`);
if (!completed) throw new Error("Packaged runtime test did not complete.");
console.log("PACKAGED PORTABLE RUNTIME PASSED");
