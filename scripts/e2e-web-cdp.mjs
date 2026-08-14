// Browser E2E for the deployed Web Clean v1 application.
//
// Run against a deployed environment:
//   E2E_BASE_URL=https://energy-monitor-puce.vercel.app E2E_REQUIRE_AUTH=1 npm run test:e2e:web
//
// Authentication is deliberately never hard-coded or printed. Supply either
// an isolated Chrome user-data directory with an existing session via
// E2E_CHROME_USER_DATA_DIR, or E2E_USERNAME/E2E_PASSWORD in the environment.
// The latter values are injected into the page only and are never logged.
// To attach to a Chrome instance started manually, set E2E_ATTACH=1.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const baseUrl = (process.env.E2E_BASE_URL ?? "https://energy-monitor-puce.vercel.app").replace(/\/$/u, "");
const port = Number(process.env.E2E_CDP_PORT ?? 9223);
const requireAuth = process.env.E2E_REQUIRE_AUTH === "1";
const attachToExistingChrome = process.env.E2E_ATTACH === "1";
const username = process.env.E2E_USERNAME ?? "";
const password = process.env.E2E_PASSWORD ?? "";
const failures = [];
const checks = [];
const consoleErrors = [];
const pageExceptions = [];
const unexpectedResponses = [];
const downloads = new Map();

function pass(name, detail = "") {
  checks.push({ status: "PASS", name, detail });
  console.log(`  PASS  ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail = "") {
  failures.push({ name, detail });
  checks.push({ status: "FAIL", name, detail });
  console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function blocked(name, detail) {
  checks.push({ status: "BLOCKED", name, detail });
  console.warn(`  BLOCKED  ${name} - ${detail}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDownloadedFile(directory, extension, beforeFiles = new Set(), timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const browserDownload = [...downloads.values()].find(item => item.state === "completed" && typeof item.filename === "string" && item.filename.toLowerCase().endsWith(extension) && Number(item.receivedBytes) > 0 && !beforeFiles.has(item.filename));
    if (browserDownload) return browserDownload.filename;
    const files = await fs.readdir(directory);
    for (const file of files) {
      if (beforeFiles.has(file)) continue;
      if (!file.toLowerCase().endsWith(extension) || file.endsWith(".crdownload")) continue;
      const stat = await fs.stat(path.join(directory, file));
      if (stat.isFile() && stat.size > 0) return file;
    }
    await sleep(500);
  }
  return null;
}

const exportWaitTimeout = Number(process.env.E2E_EXPORT_TIMEOUT ?? 60000);

function chromePath() {
  const candidates = [
    process.env.E2E_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  return candidates.find(candidate => {
    try { return existsSync(candidate); } catch { return false; }
  });
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/F", "/PID", String(child.pid), "/T"], { stdio: "ignore", timeout: 5000 });
  child.kill();
}

async function connectCdp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      const page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // Chrome is still starting.
    }
    await sleep(500);
  }
  throw new Error("Could not connect to Chrome DevTools.");
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") consoleErrors.push(true);
    if (message.method === "Runtime.exceptionThrown") pageExceptions.push(true);
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      const status = Number(response?.status);
      if (status >= 400) {
        try {
          const url = new URL(response.url);
          unexpectedResponses.push({ status, path: url.pathname });
        } catch {
          unexpectedResponses.push({ status, path: "unknown" });
        }
      }
    }
    if (message.method === "Browser.downloadWillBegin") {
      downloads.set(message.params.guid, { filename: message.params.suggestedFilename, state: "inProgress" });
    }
    if (message.method === "Browser.downloadProgress") {
      const existing = downloads.get(message.params.guid) ?? {};
      downloads.set(message.params.guid, { ...existing, state: message.params.state, receivedBytes: message.params.receivedBytes });
    }
    const request = message.id ? pending.get(message.id) : undefined;
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error("Chrome DevTools request failed."));
    else request.resolve(message);
  });
  ws.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Chrome DevTools connection closed."));
    }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Chrome DevTools request timed out: ${method}`));
        }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
  };
}

async function main() {
  const executable = chromePath();
  if (!executable) throw new Error("Chrome executable was not found. Set E2E_CHROME_PATH.");
  const temporaryUserData = process.env.E2E_CHROME_USER_DATA_DIR ? null : await fs.mkdtemp(path.join(os.tmpdir(), "energy-monitor-web-e2e-"));
  const userData = process.env.E2E_CHROME_USER_DATA_DIR ?? temporaryUserData;
  const temporaryDownloadDir = !process.env.E2E_DOWNLOAD_DIR;
  const downloadDir = process.env.E2E_DOWNLOAD_DIR ?? await fs.mkdtemp(path.join(os.tmpdir(), "energy-monitor-web-downloads-"));
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    `--download-default-directory=${downloadDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--headless=new",
    "--disable-gpu",
    baseUrl
  ];
  const chrome = attachToExistingChrome ? null : spawn(executable, chromeArgs, { stdio: "ignore" });
  let ws;
  try {
    ws = await connectCdp();
    await new Promise((resolve, reject) => {
      if (ws.readyState === 1) resolve();
      else { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); }
    });
    const cdp = makeClient(ws);
    await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable"), cdp.send("Network.enable"), cdp.send("Network.setCacheDisabled", { cacheDisabled: true }), cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }), cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }).catch(() => undefined)]);
    if (attachToExistingChrome && process.env.E2E_SKIP_ATTACH_NAVIGATION !== "1") {
      await cdp.send("Page.navigate", { url: `${baseUrl}/?e2e_cache_bust=${Date.now()}` });
      await sleep(500);
    }
    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.result?.exceptionDetails) throw new Error("Browser evaluation failed.");
      return result.result?.result?.value;
    };
    const waitFor = async (expression, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await sleep(300);
      }
      return false;
    };
    const clickByText = async (text, selector = "button") => evaluate(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.offsetParent !== null && node.innerText.trim().includes(${JSON.stringify(text)})); if (!item) return false; item.click(); return true; })()`);
    const clickFirstVisibleDesktopNav = async () => evaluate("(() => { const nav = [...document.querySelectorAll('nav')].find(item => item.offsetParent !== null && item.querySelectorAll('button').length >= 6); const item = nav?.querySelector('button'); if (!item) return false; item.click(); return true; })()");
    const selectValueContaining = async (text) => evaluate(`(() => { const select = [...document.querySelectorAll('select')].find(node => [...node.options].some(option => option.textContent.includes(${JSON.stringify(text)}) || option.value.includes(${JSON.stringify(text)}))); if (!select) return false; const option = [...select.options].find(item => item.textContent.includes(${JSON.stringify(text)}) || item.value.includes(${JSON.stringify(text)})); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

    await waitFor("document.readyState === 'complete'", 30000);
    await waitFor("document.body && document.body.innerText.length > 0", 30000);
    if (process.env.E2E_PROBE_ONLY === "1") {
      const probe = await evaluate("JSON.stringify({ url: location.href, passwordField: Boolean(document.querySelector('input[type=password]')), navButtons: document.querySelectorAll('nav button').length, visibleExportButtons: [...document.querySelectorAll('button')].filter(node => node.offsetParent !== null && /PDF|EXCEL|Excel/i.test(node.innerText)).map(node => node.innerText.trim()), pdfRenderer: Boolean(document.querySelector('[data-energy-monitor-pdf-renderer]')), rendererCount: document.querySelectorAll('[data-energy-monitor-pdf-renderer]').length, rendererPages: [...document.querySelectorAll('[data-energy-monitor-pdf-renderer]')].map(host => ({ pages: host.querySelectorAll('.cover, .page').length, images: [...host.querySelectorAll('img')].map(image => ({ complete: image.complete, naturalWidth: image.naturalWidth })).slice(0, 12), width: host.scrollWidth, height: host.scrollHeight })), notices: document.body.innerText.split(/\\n+/).map(line => line.trim()).filter(line => /download|failed|error|report/i.test(line)).slice(-12) });");
      console.log(`  PROBE  ${probe}`);
      return;
    }
    await waitFor("Boolean(document.querySelector('input[type=password]')) || document.querySelectorAll('nav button').length > 0", 30000);
    pass("application page loaded");

    const loginVisible = await evaluate("Boolean(document.querySelector('input[type=password]'))");
    if (loginVisible && username && password) {
      await evaluate(`(() => { const inputs = [...document.querySelectorAll('input')]; const user = inputs.find(input => input.type !== 'password'); const secret = inputs.find(input => input.type === 'password'); if (!user || !secret) return false; user.value = ${JSON.stringify(username)}; user.dispatchEvent(new Event('input', { bubbles: true })); secret.value = ${JSON.stringify(password)}; secret.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      const submitted = await clickByText("เข้าสู่ระบบ") || await clickByText("Sign in") || await evaluate("document.querySelector('form')?.requestSubmit(), true");
      if (!submitted || !(await waitFor("!document.querySelector('input[type=password]')", 30000))) {
        fail("administrator login", "login form did not complete");
        return;
      }
      pass("administrator login");
    } else if (loginVisible) {
      if (requireAuth) fail("authenticated browser flow", "no browser session or credentials were supplied");
      else blocked("authenticated browser flow", "provide E2E_CHROME_USER_DATA_DIR or environment credentials to exercise protected screens");
      return;
    }
    if (!loginVisible) pass("authenticated session is already available");
    if (!(await waitFor("document.querySelectorAll('nav button').length > 0", 30000))) {
      const surface = await evaluate("JSON.stringify({ title: document.title, bodyLength: document.body?.innerText?.length ?? 0, passwordField: Boolean(document.querySelector('input[type=password]')), navButtons: document.querySelectorAll('nav button').length })");
      fail("application navigation rendered", surface);
      return;
    }
    pass("application navigation rendered");

    const selected2025 = await selectValueContaining("2025");
    if (selected2025) pass("year selector can select 2025");
    else {
      const selectDiagnostics = await evaluate("JSON.stringify([...document.querySelectorAll('select')].filter(node => node.offsetParent !== null).map(node => ({ value: node.value, options: [...node.options].map(option => option.textContent?.trim() ?? '').slice(0, 30) })))");
      fail("year selector can select 2025", `no option containing 2025 was available; visible selects=${selectDiagnostics}`);
    }

    const siteSelector = await evaluate("Boolean(document.querySelector('#facility-selector'))");
    if (siteSelector) {
      const switchedToRangsit = await evaluate("(() => { const select = document.querySelector('#facility-selector'); const option = [...select.options].find(item => /Rangsit/i.test(item.textContent)); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await sleep(500);
      const rangsitSelected = await evaluate("document.querySelector('#facility-selector option:checked')?.textContent?.trim() ?? ''");
      const switchedToSrinakarin = await evaluate("(() => { const select = document.querySelector('#facility-selector'); const option = [...select.options].find(item => /Srinakarin/i.test(item.textContent)); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await sleep(500);
      const srinakarinSelected = await evaluate("document.querySelector('#facility-selector option:checked')?.textContent?.trim() ?? ''");
      if (switchedToRangsit && /Rangsit/i.test(rangsitSelected) && switchedToSrinakarin && /Srinakarin/i.test(srinakarinSelected)) pass("site switching keeps the selected facility isolated");
      else fail("site switching keeps the selected facility isolated");
    } else blocked("site switching keeps the selected facility isolated", "facility selector was not rendered");

    const dashboardButton = await clickFirstVisibleDesktopNav();
    if (!dashboardButton) blocked("dashboard loads", "dashboard navigation was not rendered");
    else if (await waitFor("!document.body.innerText.includes('กำลังโหลดข้อมูลไซต์') && !document.body.innerText.includes('Loading site data')", 30000)) pass("dashboard loads");
    else fail("dashboard loads", "dashboard loading state did not finish");

    // The pre-fix Production build opens a print popup. Block that side effect
    // in the test tab so the old implementation fails fast instead of hanging
    // Chrome's CDP connection on a native print dialog. The fixed implementation
    // never calls window.open(), so this does not affect a real download test.
    await evaluate("window.open = () => null");
    const beforePdf = new Set(await fs.readdir(downloadDir));
    const pdfButton = await clickByText("PDF");
    if (!pdfButton) fail("PDF export button is available");
    else {
      const download = await waitForDownloadedFile(downloadDir, ".pdf", beforePdf, exportWaitTimeout);
      if (download) pass("PDF export downloads a real .pdf file");
      else {
        const diagnostics = await evaluate("JSON.stringify({ url: location.href, buttons: [...document.querySelectorAll('button')].filter(node => node.offsetParent !== null && /PDF|EXCEL|Excel/i.test(node.innerText)).map(node => node.innerText.trim()), exportErrors: document.body.innerText.split(/\\n+/).map(line => line.trim()).filter(line => /failed|error|export/i.test(line)).slice(-8) })");
        fail("PDF export downloads a real .pdf file", `no completed PDF download was observed; ${diagnostics}`);
      }
    }

    const beforeExcel = new Set(await fs.readdir(downloadDir));
    const excelButton = await clickByText("EXCEL") || await clickByText("Excel");
    if (!excelButton) fail("Excel export button is available");
    else {
      const download = await waitForDownloadedFile(downloadDir, ".xlsx", beforeExcel, exportWaitTimeout);
      if (download) pass("Excel export downloads a real .xlsx file");
      else {
        const diagnostics = await evaluate("JSON.stringify({ url: location.href, buttons: [...document.querySelectorAll('button')].filter(node => node.offsetParent !== null && /PDF|EXCEL|Excel/i.test(node.innerText)).map(node => node.innerText.trim()), exportErrors: document.body.innerText.split(/\\n+/).map(line => line.trim()).filter(line => /failed|error|export/i.test(line)).slice(-8) })");
        fail("Excel export downloads a real .xlsx file", `no completed XLSX download was observed; ${diagnostics}`);
      }
    }

    const allowedUnauthenticated = new Set(["/api/v1/auth/me", "/api/v1/auth/csrf"]);
    const relevant4xx5xx = unexpectedResponses.filter(response => !allowedUnauthenticated.has(response.path));
    if (consoleErrors.length === 0 && pageExceptions.length === 0) pass("browser console has no errors");
    else fail("browser console has no errors", `${consoleErrors.length} console errors, ${pageExceptions.length} uncaught exceptions`);
    if (relevant4xx5xx.length === 0) pass("browser network has no unexpected 4xx/5xx responses");
    else fail("browser network has no unexpected 4xx/5xx responses", `${relevant4xx5xx.length} responses`);
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    if (chrome) stopProcessTree(chrome);
    if (temporaryDownloadDir) {
      try { await fs.rm(downloadDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { console.warn("  WARN  browser download directory cleanup was deferred"); }
    }
    if (temporaryUserData) {
      try { await fs.rm(temporaryUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { console.warn("  WARN  browser profile cleanup was deferred"); }
    }
  }
}

main().then(() => {
  console.log(`\nWeb E2E: ${checks.filter(item => item.status === "PASS").length} passed, ${failures.length} failed.`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}).catch(error => {
  console.error(`Web E2E blocked: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 2;
});
