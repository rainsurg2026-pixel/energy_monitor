// UI-level E2E smoke driven over the Chrome DevTools Protocol.
// Launches the built app (expects config/config.json to point at a test
// workbook), then walks the four views and exercises settings + integrity.
//
// Run: node scripts/e2e-cdp.mjs
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const app = spawn(electron, [".", `--remote-debugging-port=${PORT}`], { cwd: root, env, stdio: "ignore" });

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

    // Wait for the workbook to auto-open (WorkbookBar / dashboard data present)
    let months = 0;
    for (let i = 0; i < 30; i++) {
      months = await evalJs(`document.body.innerText.includes("เดือน") || document.body.innerText.includes("months") ? 1 : 0`);
      const busy = await evalJs(`document.body.innerText.includes("กำลังอ่านข้อมูล") ? 1 : 0`);
      if (months && !busy) break;
      await sleep(700);
    }

    console.log("\nVIEW WALKTHROUGH");
    check("app title", (await evalJs("document.title")).includes("Energy"), await evalJs("document.title"));

    const navTexts = await evalJs(`[...document.querySelectorAll("nav button")].map(b => b.innerText.trim())`);
    check("nav has 4 tabs (desktop)", Array.isArray(navTexts) && navTexts.length === 4, JSON.stringify(navTexts));

    // Dashboard (default view) shows report content or filter bar
    const dashboardOk = await evalJs(
      `document.body.innerText.length > 500 && !document.body.innerText.includes("Unable to load latest data") ? 1 : 0`
    );
    check("dashboard view renders with data", dashboardOk === 1);

    // Entry view
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("1.")).click()`);
    await sleep(800);
    const entryText = await evalJs("document.body.innerText");
    check("entry: workbook bar present", entryText.includes("RST_E2E.xlsm"));
    check("entry: UPS table present", entryText.includes("UPS 11A"));
    check("entry: no Google Sheets board (disabled on desktop)", !entryText.includes("Google Sheets Sync"));

    // History view
    await evalJs(`[...document.querySelectorAll("nav button")].find(b => b.innerText.includes("3.")).click()`);
    await sleep(1200);
    const historyText = await evalJs("document.body.innerText");
    check("history view renders", historyText.length > 300);

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
    const cfg = JSON.parse(readFileSync(path.join(root, "config", "config.json"), "utf8"));
    check("config.json persisted language", cfg.language === "en", `language=${cfg.language}`);

    // Switch back to Thai for cleanliness
    await evalJs(`[...document.querySelectorAll("button")].find(b => b.innerText.trim() === "ภาษาไทย").click()`);
    await sleep(600);

    console.log(failures === 0 ? "\nE2E UI SMOKE PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
  } finally {
    app.kill();
    await sleep(500);
    spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" });
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("E2E crashed:", err);
  spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" });
  process.exit(1);
});
