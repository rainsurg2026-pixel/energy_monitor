import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const months = ["2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"];
const dcIds = ["DC PDB41A","DC PDB41B","DC PDB42A","DC PDB42B"];
const logs = months.map((month,index) => ({
  month,
  ups: [],
  air: { eb41a: 10 + index * 0.05, eb41b: 20 + index * 0.05, eb42a: 30 + index * 0.05, eb42b: 40 + index * 0.05, meters: {} },
  dc: dcIds.map((panelId,panelIndex) => ({ panelId, voltage: 53.5 + panelIndex * 0.1, current: 70 + index + panelIndex * 2 })),
  energyCost: { buildingEnergyKwh: 3_700_000 + index * 9_000, buildingElectricityCostThb: 14_000_000 + index * 30_000 },
  lastSavedUps: null,
  lastSavedAir: `${month}-28T02:05:00.000Z`,
  lastSavedDc: `${month}-28T02:10:00.000Z`,
  lastSavedEnergyCost: `${month}-28T02:15:00.000Z`,
}));
const rackCapacityHistory = months.map((month,index) => ({ snapshotMonth: month, facility: "Rangsit", rackZone: "(Total)", totalRacks: 358, inUse: 285 + index, available: 65 - index, reserved: 6, pendingDismantle: 2, other: 0, usagePct: (285 + index) / 358, availabilityPct: (65 - index) / 358, reservedPct: 6 / 358, pendingDismantlePct: 2 / 358, otherPct: 0, generatedAt: `${month}-28T02:20:00.000Z`, dataVersion: 1 }));
const rackUnitCapacity = months.map((month,index) => ({ month, totalU: 14121, usedU: 11300 + index * 95, availableU: 2821 - index * 95, availabilityPct: (2821 - index * 95) / 14121, imageAttached: false }));
const history = { months, logs, rackCapacityHistory, rackUnitCapacity, upsGroupHistory: { sourceSheet: "QA", rows: [] } };
const bootstrap = { displayPeriod: { startMonth: months[0], endMonth: months.at(-1), rowVersion: 1 }, readOnlyMode: false, sites: [{ site: { id: 1, code: "rangsit", name: "Rangsit", active: true, dashboardMapping: null }, availableMonths: months, latestAvailableMonth: months.at(-1) }] };
const session = { authenticated: true, user: { id: "qa", username: "qa", displayName: "Mobile QA", role: "admin", active: true } };
const envelope = data => JSON.stringify({ ok: true, data });

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.setRequestInterception(true);
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== "http://127.0.0.1:3000" || !url.pathname.startsWith("/api/v1")) return request.continue();
  let data = {};
  if (url.pathname === "/api/v1/auth/session") data = session;
  else if (url.pathname === "/api/v1/auth/csrf") data = { csrfToken: "qa" };
  else if (url.pathname === "/api/v1/bootstrap") data = bootstrap;
  else if (/\/sites\/1\/history$/.test(url.pathname)) data = history;
  else if (/\/sites\/1\/periods\//.test(url.pathname)) {
    const selected = decodeURIComponent(url.pathname.split("/").at(-1));
    data = { rowVersion: 1, log: logs.find(row => row.month === selected) ?? null };
  } else if (/rack-unit-capacity-image/.test(url.pathname)) data = { available: false };
  request.respond({ status: 200, contentType: "application/json", body: envelope(data) });
});
await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle0", timeout: 30_000 });
await page.waitForSelector('nav[aria-label="Mobile primary navigation"]', { timeout: 15_000 });

async function clickText(selector, text) {
  const clicked = await page.evaluate(({ selector, text }) => {
    const target = [...document.querySelectorAll(selector)].find(el => el.textContent?.trim() === text);
    if (!target) return false;
    target.click();
    return true;
  }, { selector, text });
  assert.equal(clicked, true, `click ${text}`);
}

await clickText('nav[aria-label="Mobile primary navigation"] button', 'Capacity');
await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
await clickText('[role="dialog"] button', 'Rack Unit Capacity');
await page.waitForSelector('[data-testid="rack-unit-trend-range"]', { timeout: 10_000 });

const expected = { "3M": 9, "6M": 18, "12M": 36, "All": 36 };
const rangeResults = {};
for (const [label, expectedLabels] of Object.entries(expected)) {
  await clickText('[data-testid="rack-unit-trend-range"] button', label);
  await new Promise(resolve => setTimeout(resolve, 80));
  const result = await page.evaluate(() => {
    const range = document.querySelector('[data-testid="rack-unit-trend-range"]');
    const section = range?.closest('section');
    const svg = section?.querySelector('.trend-line-chart svg');
    const pointLabels = [...(section?.querySelectorAll('[data-chart-point-label="true"]') ?? [])];
    const rects = pointLabels.map(label => { const r = label.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,text:label.textContent ?? "" }; });
    let overlaps = 0;
    for (let i=0;i<rects.length;i++) for (let j=i+1;j<rects.length;j++) {
      const a=rects[i],b=rects[j];
      if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5) overlaps++;
    }
    const circles = [...(svg?.querySelectorAll('circle') ?? [])];
    const centers = [...new Set(circles.map(circle => Number(circle.getAttribute('cx'))))].sort((a,b)=>a-b);
    const viewBox = svg?.viewBox.baseVal;
    const leftAxis = Number(svg?.querySelector('line')?.getAttribute('x1') ?? 0);
    const plotRight = viewBox ? viewBox.width - 24 : 0;
    const firstGap = centers.length ? centers[0] - leftAxis : 0;
    const lastGap = centers.length ? plotRight - centers.at(-1) : 0;
    const interval = centers.length > 1 ? centers[1] - centers[0] : firstGap;
    return { labels: pointLabels.length, overlaps, firstGap, lastGap, interval, viewBoxWidth: viewBox?.width ?? 0, renderedWidth: svg?.getBoundingClientRect().width ?? 0, compact: rects.map(x=>x.text), bodyOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(result.labels, expectedLabels, `${label}: point-label count`);
  assert.equal(result.overlaps, 0, `${label}: labels do not overlap`);
  assert.ok(result.compact.some(text => /K$/.test(text)), `${label}: long values are compact`);
  assert.ok(Math.abs(result.firstGap - result.interval) < 0.05, `${label}: one interval before first point`);
  assert.ok(Math.abs(result.lastGap - result.interval) < 0.05, `${label}: one interval after last point`);
  assert.ok(result.bodyOverflow <= 1, `${label}: no document overflow`);
  rangeResults[label] = result;
}
const twelveMonthWidth = rangeResults["12M"].viewBoxWidth;
for (const label of ["3M", "6M", "12M", "All"]) assert.equal(rangeResults[label].viewBoxWidth, twelveMonthWidth, `${label}: Rack Unit chart uses the same 12M visual canvas width`);

await clickText('nav[aria-label="Mobile primary navigation"] button', 'Entry');
await page.waitForSelector('[data-testid="dc-calculated-value"]', { timeout: 10_000 });
await page.waitForSelector('[data-testid="energy-average-rate-value"]', { timeout: 10_000 });
const entry = await page.evaluate(() => {
  function inside(selector) {
    return [...document.querySelectorAll(selector)].map(el => {
      const r=el.getBoundingClientRect(), p=el.closest('td')?.getBoundingClientRect();
      return { text: el.textContent?.replace(/\s+/g,' ').trim(), inside: Boolean(p && r.left >= p.left - .5 && r.right <= p.right + .5 && r.top >= p.top - .5 && r.bottom <= p.bottom + .5), width:r.width, parentWidth:p?.width ?? 0 };
    });
  }
  return { dc: inside('[data-testid="dc-calculated-value"]'), rate: inside('[data-testid="energy-average-rate-value"]'), overflow: document.documentElement.scrollWidth - innerWidth };
});
assert.ok(entry.dc.length >= 4 && entry.dc.every(item => item.inside), "DC calculated values stay inside their cells");
assert.ok(entry.rate.length >= 1 && entry.rate.every(item => item.inside), "Average rate stays inside its cell");
assert.ok(entry.dc.every(item => item.width <= item.parentWidth), "DC readonly blocks fit the cell");
assert.ok(entry.rate.every(item => item.width <= item.parentWidth), "Energy rate readonly block fits the cell");
assert.ok(entry.overflow <= 1, `Entry document has no overflow (${entry.overflow}px)`);

await browser.close();
console.log(JSON.stringify({ rangeResults, entry }, null, 2));
console.log("Rack Unit selectable trend and mobile Entry calculated-value QA passed");
