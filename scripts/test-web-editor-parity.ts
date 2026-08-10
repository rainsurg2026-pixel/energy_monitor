import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const web = await readFile("src/web/WebV3App.tsx", "utf8");
const webRack = await readFile("src/web/WebHistoricalAndRackEditors.tsx", "utf8");
const apiService = await readFile("server/services/apiService.ts", "utf8");
const migration = await readFile("db/migrations/007_ups_group_history.sql", "utf8");
const componentSources = await Promise.all([
  "src/components/UpsTable.tsx",
  "src/components/AirTable.tsx",
  "src/components/DcTable.tsx",
  "src/components/EnergyCostTable.tsx",
  "src/components/SrinakarinPowerPhaseTable.tsx"
].map(path => readFile(path, "utf8")));

const checks: Array<[string, boolean]> = [
  ["Web carries Desktop per-section save timestamps", ["lastSavedUps", "lastSavedAir", "lastSavedDc", "lastSavedEnergyCost"].every(field => web.includes(field))],
  ["Web submits explicit changed sections", web.includes("changed_sections: changedSections")],
  ["Web derives historical confirmation from latest available month", web.includes("latestAvailableMonth") && web.includes("window.confirm")],
  ["Web renders a validation dialog", web.includes("role=\"dialog\"") && web.includes("validationIssues")],
  ["Web highlights and focuses missing fields", web.includes("highlight-missing") && web.includes("input:placeholder-shown")],
  ["section controls preserve canceled-save state", componentSources.every(source => /onSave\([^;\n]+\) === false/.test(source))],
  ["Web Rack route uses the Desktop executive surface", web.includes("WebRackCapacitySurface") && ["RackCapacityProvider", "CapacityAlerts", "ExecutiveKpiCards", "CapacityGauge", "Forecast", "RackCapacitySummaryCard", "RackCapacityHistoryPanel"].every(name => webRack.includes(name))],
  ["Web historical route receives persisted UPS Group History", webRack.includes("upsGroupHistory={data.upsGroupHistory}") && apiService.includes("getUpsGroupHistory")],
  ["UPS Group History has a protected relational migration", migration.includes("CREATE TABLE IF NOT EXISTS public.ups_group_history") && migration.includes("ENABLE ROW LEVEL SECURITY")]
];
for (const [name, result] of checks) assert.equal(result, true, name);
console.log(`web editor parity: PASS (${checks.length} structural UI parity checks)`);
