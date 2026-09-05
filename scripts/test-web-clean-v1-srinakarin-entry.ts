import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateSrinakarinAggregate } from "../src/domain/srinakarinPower";
import { buildEngineeringDashboardSnapshot } from "../src/domain/engineeringDashboard";
import { facilityReportData } from "../src/web-clean-v1/exports";
import { buildReportHtml } from "../src/reports/pdf/reportHtml";
import type { MonthlyLog, PhaseReading } from "../src/types";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkspace.tsx", import.meta.url), "utf8");

assert.match(app, /const WebEntryWorkspace = lazy\(\(\) => import\("\.\/WebEntryWorkspace"\)\)/);
assert.match(app, /<WebEntryWorkspace lang=\{lang\} siteName=\{site\.name\} siteCode=\{site\.code\}/);
assert.match(app, /allowedStartMonth=\{bootstrap\?\.displayPeriod\.startMonth \?\? month\}/);
assert.match(app, /allowedEndMonth=\{bootstrap \? \(bootstrap\.displayPeriod\.endMonth < todayMonth\(\) \? bootstrap\.displayPeriod\.endMonth : todayMonth\(\)\) : month\}/);
assert.match(workspace, /import SrinakarinPowerPhaseTable from "\.\.\/components\/SrinakarinPowerPhaseTable"/);
assert.match(workspace, /siteCode === "srinakarin" \? <SrinakarinPowerPhaseTable/);
assert.match(workspace, /initialLog=\{draft\} lastSaved=\{formatWebSavedTimestamp\(draft\.lastSavedUps\)\} onSave=\{\(ups, srinakarinInputs\) => requestSectionSave\("ups", \{ ups, srinakarinInputs \}\)\}/);
assert.match(workspace, /: <UpsTable (?:lang=\{lang\} )?monthStr=\{month\} initialRecords=\{draft\.ups\}/);
assert.match(workspace, /allowedStartMonth=\{allowedStartMonth\} allowedEndMonth=\{allowedEndMonth\}/);

const phase = (loadKw: number, loadKva: number): PhaseReading => ({ voltage: 220, current: 10, loadKw, loadKva });
const rawLatestMonth: MonthlyLog = {
  month: "2026-08",
  // Reproduce the pre-fix Web save: DCM4 aggregate rows survived, while
  // UPS 11/12/13 were omitted even though their raw R/S/T values were saved.
  ups: [{ upsId: "PPC 41A", voltage: 220, current: 10, loadKw: 80, loadKva: 82 }],
  srinakarinInputs: {
    upsPhase: {
      "UPS 11A - R": phase(40, 41), "UPS 11A - S": phase(45, 46), "UPS 11A - T": phase(50, 51),
      "UPS 11B - R": phase(42, 43), "UPS 11B - S": phase(44, 45), "UPS 11B - T": phase(46, 47),
      "UPS 12A - R": phase(51, 52), "UPS 12A - S": phase(52, 53), "UPS 12A - T": phase(53, 54),
      "UPS 12B - R": phase(48, 49), "UPS 12B - S": phase(50, 51), "UPS 12B - T": phase(52, 53),
      "UPS 13A - R": phase(38, 39), "UPS 13A - S": phase(40, 41), "UPS 13A - T": phase(42, 43),
      "UPS 13B - R": phase(39, 40), "UPS 13B - S": phase(41, 42), "UPS 13B - T": phase(43, 44),
    },
    acPhase: {}, ppc43Current: {}, ppc43Panel: {}
  },
  air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
  dc: [],
  energyCost: { buildingEnergyKwh: 3103000, buildingElectricityCostThb: 11657059.68 },
  lastSavedUps: "2026-09-05T14:00:00.000Z", lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null
};
const rebuilt = calculateSrinakarinAggregate(rawLatestMonth);
for (const id of ["UPS 11A", "UPS 11B", "UPS 12A", "UPS 12B", "UPS 13A", "UPS 13B"]) {
  assert.ok(rebuilt.some(row => row.upsId === id), `monthly aggregate preserves ${id}`);
}
assert.equal(rebuilt.find(row => row.upsId === "UPS 11A")?.loadKw, 135);

const snapshot = buildEngineeringDashboardSnapshot([rawLatestMonth], "2026-08", {
  sourceSheet: "Dashboard-FAC", summary: [],
  mapping: [{ no: 1, umdb: "?", upsId: "PPC 41A", acPowerPanel: "PPC41", sts: "?", oudb: "?", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null }]
});
assert.ok(snapshot, "latest-month engineering snapshot is available");
assert.deepEqual(snapshot!.upsOverallGroups.map(row => row.name), ["UPS 11", "UPS 12", "UPS 13"]);
assert.deepEqual(snapshot!.upsOverallGroups.map(row => row.totalKw), [267, 306, 243]);
assert.ok(snapshot!.upsOverallGroups.every(row => row.totalKw > 0), "raw saved phase readings restore non-zero Overall UPS values");

const reportHtml = buildReportHtml(facilityReportData(
  [rawLatestMonth], "Srinakarin", "2026-08", null, [], [], [rawLatestMonth],
  { dashboardMapping: { sourceSheet: "Dashboard-FAC", summary: [], mapping: [{ no: 1, umdb: "?", upsId: "PPC 41A", acPowerPanel: "PPC41", sts: "?", oudb: "?", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null }] } }
));
assert.ok(reportHtml.includes("UPS 11") && reportHtml.includes(">267.00<"), "server-side PDF HTML receives the recovered latest-month Overall UPS value");

console.log("web-clean-v1 Srinakarin entry: preserves Desktop phase-input workflow and restores latest-month UPS aggregates");
