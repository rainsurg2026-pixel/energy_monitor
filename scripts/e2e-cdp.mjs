// UI-level E2E smoke driven over the Chrome DevTools Protocol.
// Launches the built app (expects config/config.json to point at a test
// workbook), then walks the four views and exercises settings + integrity.
//
// Run: node scripts/e2e-cdp.mjs
import { spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9312;

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = async file => createHash("sha256").update(await fs.readFile(file)).digest("hex");

function parseMonthYearDisplay(display) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [monthName, shortYear] = String(display ?? "").trim().split("-");
  const monthIndex = months.findIndex(month => month.toLowerCase() === monthName?.toLowerCase());
  const year = Number(shortYear);
  if (monthIndex < 0 || !Number.isInteger(year)) return null;
  return `${year >= 70 ? 1900 + year : 2000 + year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function stopProcessTree(child) {
  if (child?.pid) spawnSync("taskkill", ["/F", "/PID", String(child.pid), "/T"], { stdio: "ignore" });
  child?.kill();
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("Could not connect to DevTools endpoint");
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  return {
    send(method, params = {}) {
      return new Promise(resolve => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    }
  };
}

async function main() {
  const testRoot = path.join(process.env.TEMP ?? root, `energy-monitor-e2e-root-${Date.now()}`);
  const rangsit = path.join(testRoot, "DC_Rangsit.xlsm");
  const sourceWorkbooks = [path.join(root, "DC_Rangsit.xlsm"), path.join(root, "DC_Srinakarin.xlsm")];
  const sourceHashesBefore = await Promise.all(sourceWorkbooks.map(sha256));
  await fs.mkdir(path.join(testRoot, "config"), { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(root, "DC_Rangsit.xlsm"), rangsit),
    fs.copyFile(path.join(root, "DC_Srinakarin.xlsm"), path.join(testRoot, "DC_Srinakarin.xlsm"))
  ]);
  await fs.writeFile(path.join(testRoot, "config", "config.json"), JSON.stringify({
    activeFacilityId: "rangsit",
    defaultWorkbookPath: rangsit,
    lastWorkbookPath: rangsit,
    startupBehavior: "last",
    theme: "dark",
    language: "th",
    backupFolder: null,
    backupKeep: 3,
    autoSaveIntervalMinutes: 0,
    googleSheets: { enabled: false, spreadsheetId: null },
    recentFiles: [rangsit],
    window: { width: 1440, height: 816, maximized: false },
    security: { pinEnabled: false, pinHash: null }
  }, null, 2));

  const env = { ...process.env, ENERGY_MONITOR_APP_ROOT: testRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const userData = path.join(process.env.TEMP ?? root, `energy-monitor-e2e-data-${Date.now()}`);
  const app = spawn(electron, [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { cwd: root, env, stdio: "ignore" });

  try {
    const ws = await connect();
    await new Promise(resolve => (ws.readyState === 1 ? resolve() : ws.addEventListener("open", resolve)));
    const cdp = makeClient(ws);
    await cdp.send("Runtime.enable");

    const evalJs = async expression => {
      const res = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
      return res.result?.result?.value;
    };

    // Renderer bundle can load before React commits its navigation.
    let navTexts = [];
    for (let i = 0; i < 30; i++) {
      navTexts = await evalJs(`[...document.querySelectorAll("nav button")].map(b => b.innerText.trim())`);
      if (navTexts.length === 5) break;
      await sleep(500);
    }

    console.log("\nVIEW WALKTHROUGH");
    check("app title", (await evalJs("document.title")).includes("Energy"), await evalJs("document.title"));
    check("nav has 5 tabs (desktop)", Array.isArray(navTexts) && navTexts.length === 5, JSON.stringify(navTexts));

    // Entry view: wait for either real configured facility workbook, not the
    // removed one-off RST_E2E.xlsm fixture.
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("1.")).click()`);
    let entryText = "";
    for (let i = 0; i < 30; i++) {
      entryText = await evalJs("document.body.innerText");
      if (entryText.includes("DC_Rangsit.xlsm") || entryText.includes("DC_Srinakarin.xlsm")) break;
      await sleep(500);
    }
    check("entry: configured workbook bar present", entryText.includes("DC_Rangsit.xlsm") || entryText.includes("DC_Srinakarin.xlsm"));
    let entrySectionPresent = false;
    for (let i = 0; i < 30; i++) {
      entrySectionPresent = await evalJs("Boolean(document.querySelector('#entry-section-ups'))");
      if (entrySectionPresent) break;
      entryText = await evalJs("document.body.innerText");
      await sleep(500);
    }
    check("entry: facility UPS form present", entrySectionPresent, entrySectionPresent ? "" : entryText.slice(0, 1000));
    check("entry: no Google Sheets board (disabled on desktop)", !entryText.includes("Google Sheets Sync"));

    // Dashboard reports loaded workbook data after entry readiness.
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("2.")).click()`);
    await sleep(800);
    const dashboardText = await evalJs("document.body.innerText");
    check("dashboard view renders with data", dashboardText.length > 500 && !dashboardText.includes("Unable to load latest data"));

    // History view
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("3.")).click()`);
    await sleep(1200);
    const historyText = await evalJs("document.body.innerText");
    check("history view renders", historyText.length > 300);

    // Site comparison loads both isolated workbooks through openMultiple.
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("เปรียบเทียบ") || b.innerText.includes("Site Comparison")).click()`);
    await sleep(1500);
    const comparisonText = await evalJs("document.body.innerText");
    check("comparison view renders", comparisonText.includes("เปรียบเทียบไซต์") || comparisonText.includes("Site Comparison"));
    check("comparison shows Rangsit and Srinakarin", comparisonText.includes("Rangsit") && comparisonText.includes("Srinakarin"));
    const comparisonState = await evalJs(`(() => {
      const section = document.querySelector('[data-testid="facility-comparison"]');
      const select = document.querySelector('[data-testid="comparison-reference-month"]');
      const headers = [...(section?.querySelectorAll("thead th") ?? [])].map(header => header.innerText);
      return {
        hasSection: Boolean(section),
        text: section?.innerText ?? "",
        options: select ? [...select.options].map(option => option.value) : [],
        selected: select?.value ?? null,
        headers,
        tableRows: section?.querySelectorAll("tbody tr").length ?? 0,
      };
    })()`);
    check("comparison reference month selector has real options", comparisonState.options.length > 0 && comparisonState.options.every(value => /^\d{4}-\d{2}$/.test(value)));
    check("comparison has detailed table headers", ["เดือนที่รายงาน", "การใช้พลังงานทั้งอาคาร", "ค่าไฟฟ้าทั้งอาคาร", "การใช้พลังงานชั้น 4", "ค่าไฟฟ้าชั้น 4", "อัตราค่าไฟเฉลี่ย", "สัดส่วนพลังงานชั้น 4"].every(header => comparisonState.headers.some(value => value.includes(header))), JSON.stringify(comparisonState.headers));
    check("comparison has two facility rows", comparisonState.tableRows === 2, String(comparisonState.tableRows));
    check("comparison removes PUE presentation", !/\\bPUE\\b/i.test(comparisonState.text), comparisonState.text);
    check("comparison has both trend titles", comparisonState.text.includes("แนวโน้มการใช้พลังงานรายเดือน") && comparisonState.text.includes("ค่าไฟชั้น 4"));
    const priorReference = comparisonState.options.at(-2);
    const selectedReference = await evalJs(`(() => {
      const select = document.querySelector('[data-testid="comparison-reference-month"]');
      const value = ${JSON.stringify(priorReference)};
      if (!select || !value) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    const changedReference = await evalJs(`(() => ({
      month: document.querySelector('[data-testid="comparison-reference-month"]')?.value,
      chart: document.querySelector('[data-testid="comparison-energy-chart"]')?.getAttribute("data-reference-month"),
      table: document.querySelector('[data-testid="facility-comparison"] tbody tr td:nth-child(2)')?.innerText
    }))()`);
    const changedTableMonth = parseMonthYearDisplay(changedReference.table?.split(' ')[0] ?? '');
    check("comparison reference month updates table and charts", selectedReference && changedReference.month === priorReference && changedReference.chart === priorReference && changedTableMonth === priorReference, JSON.stringify(changedReference));

    for (const range of [3, 6, 12]) {
      const changed = await evalJs(`(() => {
        const button = document.querySelector('[data-testid="comparison-range-${range}"]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      await sleep(400);
      const state = await evalJs(`(() => {
        const energy = document.querySelector('[data-testid="comparison-energy-chart"]');
        const cost = document.querySelector('[data-testid="comparison-cost-chart"]');
        return {
          energyMonths: Number(energy?.getAttribute("data-month-count")),
          costMonths: Number(cost?.getAttribute("data-month-count")),
          pressed: document.querySelector('[data-testid="comparison-range-${range}"]')?.getAttribute("aria-pressed"),
        };
      })()`);
      check(`comparison ${range}-month control responds`, changed && state.energyMonths === range && state.energyMonths === state.costMonths && state.pressed === "true", JSON.stringify(state));
    }

    const chartState = await evalJs(`(() => {
      const energy = document.querySelector('[data-testid="comparison-energy-chart"]');
      const cost = document.querySelector('[data-testid="comparison-cost-chart"]');
      const countLabels = chart => chart?.querySelectorAll(".recharts-label-list text").length ?? 0;
      const compact = chart => /\\d(?:\\.\\d+)?[KMB]/.test(chart?.innerText ?? "");
      return {
        energySvg: energy?.querySelectorAll("svg").length ?? 0,
        costSvg: cost?.querySelectorAll("svg").length ?? 0,
        energyLabels: countLabels(energy),
        costLabels: countLabels(cost),
        energyCompact: compact(energy),
        costCompact: compact(cost),
      };
    })()`);
    check("energy trend renders visible compact data labels", chartState.energySvg > 0 && chartState.energyLabels > 0 && chartState.energyCompact, JSON.stringify(chartState));
    check("Floor 4 cost trend renders visible compact data labels", chartState.costSvg > 0 && chartState.costLabels > 0 && chartState.costCompact, JSON.stringify(chartState));

    const tooltipShown = await evalJs(`(() => {
      const chartContainer = document.querySelector('[data-testid="comparison-energy-chart"]');
      const tooltipTrigger = chartContainer?.querySelector('.recharts-wrapper') ?? chartContainer?.querySelector('.recharts-surface');
      if (!tooltipTrigger) return false;
      const rect = tooltipTrigger.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      tooltipTrigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX, clientY }));
      tooltipTrigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
      return true;
    })()`);
    await sleep(500);
    const tooltipText = await evalJs("document.querySelector('.recharts-tooltip-wrapper')?.innerText ?? ''");
    check("energy tooltip exposes full-value unit", tooltipShown && /kWh/.test(tooltipText) && /\d{1,3}(?:,\d{3})*(?:\.\d+)?/.test(tooltipText), tooltipText);

    // Settings & Integrity view
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("4.")).click()`);
    await sleep(800);
    const settingsText = await evalJs("document.body.innerText");
    check("integrity center present", settingsText.includes("ศูนย์ตรวจสอบ") || settingsText.includes("Integrity"));
    check("settings: auto-save control", settingsText.includes("บันทึกอัตโนมัติ") || settingsText.includes("Auto"));
    check("settings: backups section", settingsText.includes("สำรอง") || settingsText.includes("Backup"));
    check("settings: app info portable folders note", settingsText.includes("config/"));

    // Toggle language via settings (config round-trip)
    await evalJs(`[...document.querySelectorAll("button")].find(b => b.innerText.trim() === "English").click()`);
    await sleep(900);
    const afterLang = await evalJs("document.body.innerText");
    check("language switch applies", afterLang.includes("Settings & Integrity"), "nav label did not switch to EN");
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("Site Comparison"))?.click()`);
    await sleep(600);
    const englishComparison = await evalJs("document.querySelector('[data-testid=\"facility-comparison\"]')?.innerText ?? ''");
    check("comparison language switch applies", englishComparison.includes("Reference Month") && englishComparison.includes("Last 3 Months") && /whole building energy/i.test(englishComparison), englishComparison);
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("4."))?.click()`);
    await sleep(300);
    const cfg = JSON.parse(readFileSync(path.join(testRoot, "config", "config.json"), "utf8"));
    check("config.json persisted language", cfg.language === "en", `language=${cfg.language}`);

    // Switch back to Thai for cleanliness
    await evalJs(`[...document.querySelectorAll("button")].find(b => b.innerText.trim() === "ภาษาไทย").click()`);
    await sleep(600);

    console.log(failures === 0 ? "\nE2E UI SMOKE PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
  } finally {
    stopProcessTree(app);
    await sleep(500);
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
    const sourceHashesAfter = await Promise.all(sourceWorkbooks.map(sha256));
    check("E2E leaves source workbooks unchanged", sourceHashesBefore.every((hash, index) => hash === sourceHashesAfter[index]), `${JSON.stringify(sourceHashesBefore)} != ${JSON.stringify(sourceHashesAfter)}`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
