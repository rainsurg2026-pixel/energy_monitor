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
      if (navTexts.length === 6) break;
      await sleep(500);
    }

    console.log("\nVIEW WALKTHROUGH");
    check("app title", (await evalJs("document.title")).includes("Energy"), await evalJs("document.title"));
    // Nav order: Dashboard, Data Entry, Rack Capacity, Historical Logs, Site Comparison, Settings.
    check("nav has 6 tabs (desktop, incl. Rack Capacity)", Array.isArray(navTexts) && navTexts.length === 6, JSON.stringify(navTexts));
    check("no nav label carries a numeric prefix", Array.isArray(navTexts) && navTexts.every(text => !/^\d+\./.test(text)), JSON.stringify(navTexts));

    // Entry view: wait for either real configured facility workbook, not the
    // removed one-off RST_E2E.xlsm fixture.
    await evalJs(`document.querySelectorAll("nav button")[1].click()`);
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
    await evalJs(`document.querySelectorAll("nav button")[0].click()`);
    await sleep(800);
    const dashboardText = await evalJs("document.body.innerText");
    check("dashboard view renders with data", dashboardText.length > 500 && !dashboardText.includes("Unable to load latest data"));

    // Rack Capacity view (index 2: Dashboard, Data Entry, Rack Capacity, ...)
    await evalJs(`document.querySelectorAll("nav button")[2].click()`);
    await sleep(1200);
    const rackCapacityText = await evalJs("document.body.innerText");
    check("rack capacity view renders", rackCapacityText.includes("Rack Capacity") || rackCapacityText.includes("ความจุแร็ค"));
    check("rack capacity shows a real zone/status filter and editor table", rackCapacityText.includes("Rack ID") || rackCapacityText.includes("รหัสแร็ค"));

    // Overview cards must show real counts from the active workbook (Rangsit
    // by default: 358 total, 294 In Use, 32 Reserved, 24 Pending Dismantle, 8
    // Available - confirmed by direct OOXML inspection, not guessed).
    check("rack capacity Total Racks card shows the real workbook total (358)", /\b358\b/.test(rackCapacityText));
    check("rack capacity In Use card shows a real, non-fabricated count (294)", /\b294\b/.test(rackCapacityText));
    check("rack capacity cards show a percentage (not raw 0-1 fraction)", /9\d\.\d\d%|8\d\.\d\d%/.test(rackCapacityText));

    // Save Changes must start disabled - no staged edits yet.
    const saveDisabledInitially = await evalJs(`(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.innerText.includes("Save Changes") || b.innerText.includes("บันทึกการเปลี่ยนแปลง"));
      return btn ? btn.disabled : null;
    })()`);
    check("rack capacity Save Changes is disabled with no pending edits", saveDisabledInitially === true);

    // Rack ID search must actually filter the visible table rows.
    const countBeforeFilter = await evalJs(`document.querySelectorAll("table tbody tr").length`);
    await evalJs(`(() => {
      const input = [...document.querySelectorAll("input")].find(i => i.placeholder && (i.placeholder.includes("AA01")));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "AA01");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(500);
    const filteredText = await evalJs(`[...document.querySelectorAll("table tbody tr")].map(r => r.innerText).join("|")`);
    const countAfterFilter = await evalJs(`document.querySelectorAll("table tbody tr").length`);
    check("rack capacity Rack ID search narrows the visible rows", countAfterFilter > 0 && countAfterFilter < countBeforeFilter, `${countAfterFilter} vs ${countBeforeFilter}`);
    check("rack capacity Rack ID search result actually matches the query", filteredText.includes("AA01"));
    // Clear the search back out for a clean state for any later checks.
    await evalJs(`(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.innerText.includes("Clear Filters") || b.innerText.includes("ล้างตัวกรอง"));
      btn?.click();
    })()`);
    await sleep(300);

    // v2.2.3: Rack Capacity page restructuring - overview at top, then Rack
    // Unit Capacity, then the field Editor, in that DOM order.
    const sectionOrder = await evalJs(`[...document.querySelectorAll("section h3")].map(h => h.innerText.trim())`);
    const overviewIdx = sectionOrder.findIndex(t => t.includes("Rack Capacity and Utilization") || t.includes("ความจุแร็คและการใช้งาน"));
    const unitCapacityIdx = sectionOrder.findIndex(t => t.includes("Rack Unit Capacity") || t.includes("ความจุหน่วยแร็ค"));
    const editorIdx = sectionOrder.findIndex(t => t.includes("Rack Capacity Editor") || t.includes("แก้ไขความจุแร็ค"));
    check(
      "rack capacity: overview -> Rack Unit Capacity -> Editor DOM order",
      overviewIdx >= 0 && unitCapacityIdx > overviewIdx && editorIdx > unitCapacityIdx,
      JSON.stringify(sectionOrder)
    );
    check("rack capacity: no leftover 'Rack Capacity Overview' heading", !rackCapacityText.includes("Rack Capacity Overview"));
    check("rack capacity: no leftover internal 'Table7' name in the UI", !rackCapacityText.includes("Table7"));

    // Rack Unit Capacity panel: fill Total (U)/Used (U), verify the live
    // Available (U)/Availability % preview, then actually save (real IPC
    // round-trip against the copied test workbook - safe, not production).
    const unitCapacityFillResult = await evalJs(`(() => {
      const section = [...document.querySelectorAll("section")].find(s => s.innerText.includes("Rack Unit Capacity") || s.innerText.includes("ความจุหน่วยแร็ค"));
      if (!section) return { ok: false, reason: "section not found" };
      const inputs = [...section.querySelectorAll('input[type="number"]')];
      if (inputs.length !== 2) return { ok: false, reason: "expected 2 number inputs, found " + inputs.length };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], "400");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], "350");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, text: section.innerText };
    })()`);
    check("rack unit capacity: Total (U)/Used (U) inputs found and fillable", unitCapacityFillResult.ok === true, JSON.stringify(unitCapacityFillResult));
    await sleep(300);
    const unitCapacityPreviewText = await evalJs(`[...document.querySelectorAll("section")].find(s => s.innerText.includes("Rack Unit Capacity") || s.innerText.includes("ความจุหน่วยแร็ค"))?.innerText ?? ""`);
    check("rack unit capacity: live preview shows Available (U) = 50 (400-350)", /\b50\b/.test(unitCapacityPreviewText));
    check("rack unit capacity: live preview shows Availability % = 12.50%", unitCapacityPreviewText.includes("12.50%"));

    const unitCapacitySaveEnabled = await evalJs(`(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.innerText.includes("Save Rack Unit Capacity") || b.innerText.includes("บันทึกความจุหน่วยแร็ค"));
      return btn ? !btn.disabled : null;
    })()`);
    check("rack unit capacity: Save button enables once dirty", unitCapacitySaveEnabled === true);

    await evalJs(`(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.innerText.includes("Save Rack Unit Capacity") || b.innerText.includes("บันทึกความจุหน่วยแร็ค"));
      btn?.click();
    })()`);
    let unitCapacitySavedText = "";
    for (let i = 0; i < 20; i++) {
      unitCapacitySavedText = await evalJs("document.body.innerText");
      if (unitCapacitySavedText.includes("Rack Unit Capacity saved") || unitCapacitySavedText.includes("บันทึกความจุหน่วยแร็คแล้ว")) break;
      await sleep(400);
    }
    check(
      "rack unit capacity: save succeeds end-to-end (real IPC write to the test workbook copy)",
      unitCapacitySavedText.includes("Rack Unit Capacity saved") || unitCapacitySavedText.includes("บันทึกความจุหน่วยแร็คแล้ว")
    );

    // Editor: the shared History-snapshot Month/Year selector is present.
    const editorMonthSelectorPresent = await evalJs(`(() => {
      const section = [...document.querySelectorAll("section")].find(s => s.innerText.includes("Rack Capacity Editor") || s.innerText.includes("แก้ไขความจุแร็ค"));
      return section ? section.querySelectorAll("select").length >= 2 : false;
    })()`);
    check("rack capacity editor: shared Month/Year selector is present", editorMonthSelectorPresent === true);

    // History view
    await evalJs(`document.querySelectorAll("nav button")[3].click()`);
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

    // Settings & Data Validation view (index 5: Dashboard, Data Entry, Rack Capacity, History, Comparison, Settings)
    await evalJs(`document.querySelectorAll("nav button")[5].click()`);
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
    check("language switch applies", afterLang.includes("Settings & Data Validation"), "nav label did not switch to EN");
    await evalJs(`document.querySelectorAll("nav button")[4].click()`);
    await sleep(600);
    const englishComparison = await evalJs("document.querySelector('[data-testid=\"facility-comparison\"]')?.innerText ?? ''");
    check("comparison language switch applies", englishComparison.includes("Reference Month") && englishComparison.includes("Last 3 Months") && /whole building energy/i.test(englishComparison), englishComparison);
    await evalJs(`document.querySelectorAll("nav button")[5].click()`);
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
