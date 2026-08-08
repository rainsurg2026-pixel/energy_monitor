import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/http/app";
import { InMemoryRepository } from "../server/repositories/inMemoryRepository";
import { apiTestRepository, fixtureLog } from "../server/testFixtures";
import type { ServerConfig } from "../server/config/env";

const config = (readOnlyMode = false): ServerConfig => ({ databaseUrl: null, nodeEnv: "test", port: 0, appOrigin: "http://test", readOnlyMode });
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

async function withApi(readOnlyMode: boolean, work: (base: string) => Promise<void>, repository = apiTestRepository()): Promise<void> {
  const server = createServer(createApp({ repository, config: config(readOnlyMode) }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  try { await work(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function json(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: response.status, body: await response.json() };
}

await withApi(false, async base => {
  const health = await json(base, "/api/v1/health"); check("health", health.status === 200 && health.body.ok === true);
  const readiness = await json(base, "/api/v1/health/ready"); check("readiness", readiness.status === 200 && readiness.body.data.status === "ready");
  const periods = await json(base, "/api/v1/periods?siteId=1"); check("periods expose allowed/latest", periods.status === 200 && periods.body.data.latestAvailableMonth === "2026-01" && !periods.body.data.availableMonths.includes("2025-12") && !periods.body.data.availableMonths.includes("2026-12"));
  const energy = await json(base, "/api/v1/energy?siteId=1&month=2026-01"); const energyText = JSON.stringify(energy.body); check("hidden previous is used internally", energy.status === 200 && energy.body.data.calculation.airEnergyKwh === 16000000); check("hidden previous is not in DTO", !energyText.includes("2025-12"));
  const rackUnit = await json(base, "/api/v1/rack-unit-capacity?siteId=1&month=2026-01"); check("rack unit raw snapshot is exposed with derived metrics", rackUnit.status === 200 && rackUnit.body.data.snapshot.availableU === 50 && rackUnit.body.data.snapshot.usagePercent === 87.5);
  const comparison = await json(base, "/api/v1/site-comparison"); check("comparison excludes hidden period", comparison.status === 200 && comparison.body.data.months.join(",") === "2026-01,2026-02" && !JSON.stringify(comparison.body).includes("2025-12"));
  const invalid = await json(base, "/api/v1/energy?siteId=1&month=2026/01"); check("strict month validation", invalid.status === 404 || invalid.status === 400);
  const outside = await json(base, "/api/v1/energy?siteId=1&month=2025-12"); check("outside period rejected", outside.status === 404 && outside.body.error?.code === "MONTH_OUTSIDE_DISPLAY_PERIOD");
  const future = await json(base, "/api/v1/energy?siteId=1&month=2026-12"); check("future month rejected", future.status === 404 && future.body.error?.code === "MONTH_NOT_AVAILABLE");
  const save = await json(base, "/api/v1/sites/1/periods/2026-03", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-03", 25, 130000, 650000), expected_row_version: 0 }) }); check("raw monthly dataset save", save.status === 200 && save.body.data.rowVersion === 1);
  const staleSave = await json(base, "/api/v1/sites/1/periods/2026-03", { method: "PUT", body: JSON.stringify({ log: fixtureLog("2026-03", 25, 130000, 650000), expected_row_version: 0 }) }); check("raw monthly dataset stale conflict", staleSave.status === 409 && staleSave.body.error?.code === "STALE_VERSION");
  const update = await json(base, "/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-02", end_month: "2026-03", expected_row_version: 1 }) }); check("settings update", update.status === 200 && update.body.data.rowVersion === 2);
  const stale = await json(base, "/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-03", expected_row_version: 1 }) }); check("stale settings conflict", stale.status === 409 && stale.body.error?.code === "STALE_VERSION");
});

await withApi(true, async base => {
  const get = await json(base, "/api/v1/settings"); check("read-only GET allowed", get.status === 200);
  const put = await json(base, "/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-03", expected_row_version: 1 }) }); check("read-only mutation rejected server-side", put.status === 423 && put.body.error?.code === "READ_ONLY_MODE");
});

const transactionRepository = new InMemoryRepository({ settings: { startMonth: "2026-01", endMonth: "2026-03", rowVersion: 1 } });
await assert.rejects(() => transactionRepository.withTransaction(async repository => { await repository.updateGlobalSettings({ startMonth: "2026-02", endMonth: "2026-03", expectedRowVersion: 1 }, "rollback-test"); throw new Error("force rollback"); }));
check("in-memory transaction rollback", (await transactionRepository.getGlobalSettings())?.startMonth === "2026-01");

const initialSettingsRepository = new InMemoryRepository({ settings: null });
check("fresh repository has no display period until initialized", (await initialSettingsRepository.getGlobalSettings()) === null);

await withApi(false, async base => {
  const missing = await json(base, "/api/v1/settings"); check("fresh API reports unconfigured display period", missing.status === 503 && missing.body.error?.code === "DISPLAY_PERIOD_NOT_CONFIGURED");
  const configured = await json(base, "/api/v1/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: "2026-01", end_month: "2026-12", expected_row_version: 0 }) }); check("fresh API initializes display period", configured.status === 200 && configured.body.data.rowVersion === 1);
}, initialSettingsRepository);
check("first-run repository state is initialized", (await initialSettingsRepository.getGlobalSettings())?.rowVersion === 1);

await withApi(false, async base => {
  const ready = await json(base, "/api/v1/health/ready");
  check("database readiness failure is reported as 503", ready.status === 503 && ready.body.error?.code === "DATABASE_NOT_READY");
}, new InMemoryRepository({ databaseReady: false }));

console.log(`api foundation: ${checks} assertions passed`);
