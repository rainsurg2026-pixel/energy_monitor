import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const months = ["2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"];
const upsIds = ["UPS 11A","UPS 11B","UPS 13A","UPS 13B","UPS 14C","UPS 15A (PPC44A)","UPS 15B (PPC44B)"];
const dcIds = ["DC PDB41A","DC PDB41B","DC PDB42A","DC PDB42B"];
const logs = months.map((month,index) => ({
  month,
  ups: upsIds.map((upsId,upsIndex) => ({ upsId, voltage: 220 + (upsIndex % 2) * 0.2, current: 20 + index * 0.2 + upsIndex, loadKw: 8 + index * 0.15 + upsIndex * 0.3, loadKva: 9 + index * 0.15 + upsIndex * 0.3 })),
  air: { eb41a: 10 + index * 0.05, eb41b: 20 + index * 0.05, eb42a: 30 + index * 0.05, eb42b: 40 + index * 0.05, meters: {} },
  dc: dcIds.map((panelId,panelIndex) => ({ panelId, voltage: 52 + panelIndex * 0.1, current: 70 + index + panelIndex * 2 })),
  energyCost: { buildingEnergyKwh: 1_500_000 + index * 25_000, buildingElectricityCostThb: 5_600_000 + index * 90_000 },
  lastSavedUps: `${month}-28T02:00:00.000Z`,
  lastSavedAir: `${month}-28T02:05:00.000Z`,
  lastSavedDc: `${month}-28T02:10:00.000Z`,
  lastSavedEnergyCost: `${month}-28T02:15:00.000Z`,
}));
const rackCapacityHistory = months.map((month,index) => {
  const totalRacks = 120;
  const inUse = 82 + index;
  const available = totalRacks - inUse - 4;
  return { snapshotMonth: month, facility: "Rangsit Data Center", rackZone: "(Total)", totalRacks, inUse, available, reserved: 3, pendingDismantle: 1, other: 0, usagePct: inUse / totalRacks, availabilityPct: available / totalRacks, reservedPct: 3 / totalRacks, pendingDismantlePct: 1 / totalRacks, otherPct: 0, generatedAt: `${month}-28T02:20:00.000Z`, dataVersion: 1 };
});
const rackUnitCapacity = months.map((month,index) => ({ month, totalU: 4800, usedU: 3350 + index * 35, availableU: 1450 - index * 35, availabilityPct: (1450 - index * 35) / 4800, imageAttached: false }));
const history = { months, logs, rackCapacityHistory, rackUnitCapacity, upsGroupHistory: { sourceSheet: "QA", rows: [] } };
const bootstrap = { displayPeriod: { startMonth: months[0], endMonth: months.at(-1), rowVersion: 1 }, readOnlyMode: false, sites: [{ site: { id: 1, code: "rangsit", name: "Rangsit Data Center", active: true, dashboardMapping: null }, availableMonths: months, latestAvailableMonth: months.at(-1) }] };
const session = { authenticated: true, user: { id: "qa-user", username: "qa", displayName: "Responsive QA", role: "admin", active: true } };

function apiEnvelope(data) { return JSON.stringify({ ok: true, data }); }

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== "http://127.0.0.1:3000" || !url.pathname.startsWith("/api/v1")) return request.continue();
  let data;
  if (url.pathname === "/api/v1/auth/session") data = session;
  else if (url.pathname === "/api/v1/auth/csrf") data = { csrfToken: "qa" };
  else if (url.pathname === "/api/v1/bootstrap") data = bootstrap;
  else if (/\/api\/v1\/sites\/1\/history$/.test(url.pathname)) data = history;
  else if (/\/api\/v1\/sites\/1\/periods\//.test(url.pathname)) {
    const month = decodeURIComponent(url.pathname.split("/").at(-1));
    data = { rowVersion: 1, log: logs.find(row => row.month === month) ?? null };
  } else data = {};
  request.respond({ status: 200, contentType: "application/json", body: apiEnvelope(data) });
});

const viewports = [
  { name: "iPhone", width: 375, height: 812, mobile: true },
  { name: "Tablet", width: 768, height: 1024, mobile: false },
  { name: "Desktop-1366", width: 1366, height: 768, mobile: false },
  { name: "Desktop-1920", width: 1920, height: 1080, mobile: false },
];
const results = [];
for (const viewport of viewports) {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: viewport.mobile, hasTouch: viewport.mobile });
  await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle0", timeout: 30_000 });
  const executiveSelector = viewport.mobile ? '[data-testid="executive-mobile-v2"]' : '[data-testid="executive-desktop-v2"]';
  await page.waitForSelector(executiveSelector, { timeout: 15_000 });
  const executive = await page.evaluate(({ width, mobile }) => {
    const body = document.documentElement;
    const kpi = document.querySelector('section[aria-label="Executive KPI summary"]');
    const mobileNav = document.querySelector('nav[aria-label="Mobile primary navigation"]');
    const desktopNav = document.querySelector('nav[aria-label="Desktop primary navigation"]');
    const visible = element => element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0;
    const columns = kpi ? getComputedStyle(kpi).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    const mobileRect = mobileNav?.getBoundingClientRect();
    const main = document.querySelector("main");
    return {
      overflow: body.scrollWidth - width,
      columns,
      mobileNavVisible: visible(mobileNav),
      desktopNavVisible: visible(desktopNav),
      mobileNavBottomGap: mobileRect ? Math.abs(window.innerHeight - mobileRect.bottom) : null,
      mainPaddingBottom: main ? parseFloat(getComputedStyle(main).paddingBottom) : 0,
      trendCards: document.querySelectorAll('[data-testid^="executive-trend-"]').length,
      capacityPresent: Boolean(document.querySelector('[data-testid^="executive-capacity-"]')),
      rackUnitLabels: (() => {
        const article = [...document.querySelectorAll("article")].find(item => item.querySelector("h3")?.textContent?.trim() === "Rack Unit Capacity Trend");
        const labels = article ? [...article.querySelectorAll('[data-chart-point-label="true"]')] : [];
        const rects = labels.map(label => {
          const rect = label.getBoundingClientRect();
          return { text: label.textContent ?? "", left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        let overlaps = 0;
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const intersects = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
          if (intersects) overlaps++;
        }
        return { count: rects.length, overlaps, texts: rects.map(item => item.text) };
      })(),
    };
  }, { width: viewport.width, mobile: viewport.mobile });
  assert.ok(executive.overflow <= 1, `${viewport.name}: no horizontal overflow (${executive.overflow}px)`);
  const expectedExecutiveColumns = viewport.mobile ? 2 : viewport.width >= 1280 ? 6 : 3;
  assert.equal(executive.columns, expectedExecutiveColumns, `${viewport.name}: KPI columns`);
  assert.equal(executive.mobileNavVisible, viewport.mobile, `${viewport.name}: mobile nav visibility`);
  assert.equal(executive.desktopNavVisible, !viewport.mobile, `${viewport.name}: desktop nav visibility`);
  assert.equal(executive.trendCards, 6, `${viewport.name}: six energy trend cards`);
  assert.equal(executive.capacityPresent, true, `${viewport.name}: capacity overview present`);
  assert.ok(executive.rackUnitLabels.count >= 9, `${viewport.name}: Rack Unit chart keeps per-point labels`);
  assert.equal(executive.rackUnitLabels.overlaps, 0, `${viewport.name}: Rack Unit point labels do not overlap`);
  assert.ok(executive.rackUnitLabels.texts.some(text => /K$/.test(text)), `${viewport.name}: long Rack Unit values use compact K labels`);
  if (viewport.mobile) {
    assert.ok((executive.mobileNavBottomGap ?? 99) <= 1, `${viewport.name}: bottom nav fixed to viewport`);
    assert.ok(executive.mainPaddingBottom >= 80, `${viewport.name}: main content reserves bottom-nav space`);
  }

  // Switch to Engineering through the real Report View control and verify the Web-only sticky navigator.
  await page.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find(item => item.value === "executive" && [...item.options].some(option => option.value === "dashboard"));
    if (!select) throw new Error("Report View select not found");
    select.value = "dashboard";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[data-testid="engineering-sticky-nav"]', { timeout: 10_000 });
  const engineering = await page.evaluate(width => {
    const nav = document.querySelector('[data-testid="engineering-sticky-nav"]');
    const rect = nav?.getBoundingClientRect();
    const style = nav ? getComputedStyle(nav) : null;
    const operational = document.querySelector('[data-testid="engineering-operational-totals"]');
    return { overflow: document.documentElement.scrollWidth - width, navWidth: rect?.width ?? 0, position: style?.position ?? "", sectionCount: nav?.querySelectorAll("button").length ?? 0, operationalCards: operational?.querySelectorAll("article").length ?? 0, operationalText: operational?.textContent ?? "" };
  }, viewport.width);
  assert.ok(engineering.overflow <= 1, `${viewport.name}: Engineering has no horizontal overflow (${engineering.overflow}px)`);
  assert.ok(engineering.navWidth <= viewport.width, `${viewport.name}: sticky Engineering nav fits viewport`);
  assert.equal(engineering.position, "sticky", `${viewport.name}: Engineering nav is sticky`);
  assert.equal(engineering.sectionCount, 4, `${viewport.name}: Engineering nav has four sections`);
  assert.equal(engineering.operationalCards, 3, `${viewport.name}: Engineering shows three operational total cards`);
  for (const label of ["2.1 Total UPS and PPC Load Status", "2.2 Total Air", "2.3 Total DC Power Panels"]) assert.ok(engineering.operationalText.includes(label), `${viewport.name}: Engineering operational card ${label}`);
  // Navigate to History and verify Facility Trend Analytics now exposes Building + 4th Floor summaries.
  await page.evaluate(mobile => {
    const nav = document.querySelector(mobile ? 'nav[aria-label="Mobile primary navigation"]' : 'nav[aria-label="Desktop primary navigation"]');
    const reports = [...(nav?.querySelectorAll('button') ?? [])].find(button => button.textContent?.trim() === 'Reports');
    if (!reports) throw new Error('Reports navigation not found');
    reports.click();
  }, viewport.mobile);
  if (viewport.mobile) await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.evaluate(mobile => {
    const root = mobile ? document.querySelector('[role="dialog"]') : document.querySelector('nav[aria-label="Desktop primary navigation"]');
    const historyButton = [...(root?.querySelectorAll('button') ?? [])].find(button => button.textContent?.trim() === 'History');
    if (!historyButton) throw new Error('History navigation not found');
    historyButton.click();
  }, viewport.mobile);
  await page.waitForSelector('[data-testid="facility-trend-summary-cards"]', { timeout: 10_000 });
  const historySummary = await page.evaluate(width => {
    const cards = document.querySelector('[data-testid="facility-trend-summary-cards"]');
    return { cardCount: cards?.children.length ?? 0, text: cards?.textContent ?? '', overflow: document.documentElement.scrollWidth - width };
  }, viewport.width);
  assert.equal(historySummary.cardCount, 5, `${viewport.name}: Energy Facility Trend summary has selected metric + four Building/4th Floor cards`);
  for (const label of ['Building Total Accumulation', '4th Floor Total Accumulation', 'Building Monthly Average', '4th Floor Monthly Average']) assert.ok(historySummary.text.includes(label), `${viewport.name}: History includes ${label}`);
  assert.ok(historySummary.overflow <= 1, `${viewport.name}: History summary has no horizontal overflow (${historySummary.overflow}px)`);

  results.push({ viewport: viewport.name, ...executive, engineeringOverflow: engineering.overflow, engineeringSections: engineering.sectionCount, historyCards: historySummary.cardCount, historyOverflow: historySummary.overflow });
  await page.evaluate(() => localStorage.setItem("report_pref_report_view", "executive"));
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
console.log("Dashboard UX V2 viewport QA passed: iPhone, tablet, 1366px desktop, 1920px desktop");
