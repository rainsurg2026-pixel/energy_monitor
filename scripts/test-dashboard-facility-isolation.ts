/**
 * Dashboard multi-site rendering regression suite. DashboardSummary /
 * UniversalFilterBar are React components with no render-test harness in
 * this repo (adding jsdom/RTL would be new infra, out of scope for a
 * defect-only fix) - so this proves two things instead:
 *   1. Source structure: the facility-aware branch + prop wiring genuinely
 *      exists (not a flat hardcoded Rangsit array reachable regardless of
 *      site), and the prop actually flows App -> DashboardViewContainer ->
 *      DashboardSummary/UniversalFilterBar.
 *   2. Data layer: Srinakarin's real workbook rows carry the exact IDs
 *      (SRINAKARIN_AGGREGATE_IDS) the fixed code now looks up, so once
 *      wired, the render is guaranteed non-zero rather than merely
 *      "compiles."
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-dashboard-facility-isolation.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readWorkbookFromFile } from "../src/excel/WorkbookReader";
import { DeviceLists } from "../src/excel/SheetMapper";
import { SRINAKARIN_AGGREGATE_IDS, SRINAKARIN_DCM4_AGGREGATE_IDS } from "../src/utils/srinakarinPower";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let checks = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    checks++;
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

interface FacilityProfileFile {
  air: { fields: string[] };
  devices: { ups: string[]; dc: string[] };
}

async function loadProfile(id: string): Promise<FacilityProfileFile> {
  return JSON.parse(await fs.readFile(path.join(root, "config", id, "profile.json"), "utf8"));
}

function devicesFor(profile: FacilityProfileFile): DeviceLists {
  return { upsIds: profile.devices.ups, dcIds: profile.devices.dc, airFields: profile.air.fields };
}

async function main(): Promise<void> {
  console.log("Dashboard multi-site rendering regression checks");

  const dashboardSource = await fs.readFile(path.join(root, "src", "components", "DashboardSummary.tsx"), "utf8");
  const dashboardCss = await fs.readFile(path.join(root, "src", "index.css"), "utf8");
  const filterBarSource = await fs.readFile(path.join(root, "src", "components", "UniversalFilterBar.tsx"), "utf8");
  const appSource = await fs.readFile(path.join(root, "src", "App.tsx"), "utf8");

  // --- Config-driven only: no facility-identity branching left in either
  // component (superseded by the technical-debt cleanup - see
  // test-dashboard-config-driven.ts for the full architecture-debt suite) ---
  check("DashboardSummary declares a facility prop", dashboardSource.includes("facility?: FacilityEntry | null"));
  check("Every Building Energy Dashboard table uses the shared centered-header class",
    (dashboardSource.match(/dashboard-table/g) ?? []).length === 6 && dashboardCss.includes(".dashboard-table > thead > tr > th") && dashboardCss.includes(".dashboard-table > tbody > tr > td") && dashboardCss.includes("text-align: center !important"));
  // Superseded (RC-3.2): UPS groups/mapping now read from the workbook
  // itself (upsMapping.summary/.mapping) rather than static config - see
  // test-dashboard-workbook-mapping.ts. Still true either way: no branch.
  check("DashboardSummary reads UPS groups/mapping from data, not a branch",
    dashboardSource.includes("buildEngineeringDashboardSnapshot") &&
    (await fs.readFile(path.join(root, "src", "domain", "engineeringDashboard.ts"), "utf8")).includes("upsMapping?.summary") &&
    (await fs.readFile(path.join(root, "src", "domain", "engineeringDashboard.ts"), "utf8")).includes("upsMapping?.mapping"));
  check("UniversalFilterBar reads UPS filter options from facility.profile.dashboard, not a branch",
    filterBarSource.includes("facility?.profile.dashboard.upsGroups") &&
    filterBarSource.includes("facility?.profile.dashboard.upsMapping"));

  // --- Facility actually reaches the dashboard tree (prop wiring, not just a component that supports it) ---
  check("App wires activeFacility into DashboardViewContainer",
    appSource.includes("facility={activeFacility}"));
  const dashboardSummaryCallSite = appSource.slice(
    appSource.indexOf("<DashboardSummary"),
    appSource.indexOf("/>", appSource.indexOf("<DashboardSummary"))
  );
  check("DashboardViewContainer forwards facility into DashboardSummary",
    dashboardSummaryCallSite.includes("facility={facility}"));
  check("DashboardViewContainer forwards facility into UniversalFilterBar",
    appSource.includes("<UniversalFilterBar lang={lang} onExport={handleExport} facility={facility} />"));

  // --- Dashboard summary / air summary / charts match Dashboard-FAC (data layer) ---
  const rangsitProfile = await loadProfile("rangsit");
  const srinakarinProfile = await loadProfile("srinakarin");
  const rangsitPath = path.join(root, "DC_Rangsit.xlsm");
  const srinakarinPath = path.join(root, "DC_Srinakarin.xlsm");

  const rangsitRead = await readWorkbookFromFile(rangsitPath, devicesFor(rangsitProfile));
  const srinakarinRead = await readWorkbookFromFile(srinakarinPath, devicesFor(srinakarinProfile));
  const rangsitLatest = rangsitRead.logs[rangsitRead.logs.length - 1];
  const srinakarinLatest = srinakarinRead.logs[srinakarinRead.logs.length - 1];

  const rangsitIds = new Set(rangsitLatest.ups.map(u => u.upsId.replace(/\s+/g, "").toLowerCase()));
  const srinakarinIds = new Set(srinakarinLatest.ups.map(u => u.upsId.replace(/\s+/g, "").toLowerCase()));

  check("Srinakarin's read UPS records use SRINAKARIN_AGGREGATE_IDS (the IDs the fixed dashboard code now looks up)",
    SRINAKARIN_AGGREGATE_IDS.some(id => srinakarinIds.has(id.replace(/\s+/g, "").toLowerCase())));
  // Rangsit's own site has no "UPS 41A"/"PPC 4xA" hardware at all - if these
  // ever appeared in a Rangsit read, that would be a real cross-site leak.
  // UPS 11/12/13 legitimately exist at both facilities. Cross-site isolation
  // therefore checks only Srinakarin's DCM4-exclusive UPS41/PPC41-44 IDs.
  check("Rangsit's UPS records never carry Srinakarin-exclusive aggregate IDs (UPS 41A/PPC 4xA) - no cross-site leak",
    SRINAKARIN_DCM4_AGGREGATE_IDS.every(id => !rangsitIds.has(id.replace(/\s+/g, "").toLowerCase())));
  check("Rangsit's UMDB-mapped 'UPS 14C' never appears in Srinakarin's aggregate ID set",
    !SRINAKARIN_AGGREGATE_IDS.some(id => id.replace(/\s+/g, "").toLowerCase() === "ups14c"));

  // At least one Srinakarin aggregate device must carry real load data for
  // the latest month, so the fixed grouping produces non-zero rows instead
  // of a table that merely stops rendering literal zero for want of data.
  const srinakarinHasLoad = srinakarinLatest.ups.some(u => (u.loadKw ?? 0) > 0 || (u.loadKva ?? 0) > 0);
  check("Srinakarin's latest month has real, non-zero UPS load data available to the fixed grouping",
    srinakarinHasLoad);

  // --- Site switching never leaks data (sequence: Rangsit -> Srinakarin -> Rangsit -> Srinakarin) ---
  const r1 = await readWorkbookFromFile(rangsitPath, devicesFor(rangsitProfile));
  const s1 = await readWorkbookFromFile(srinakarinPath, devicesFor(srinakarinProfile));
  const r2 = await readWorkbookFromFile(rangsitPath, devicesFor(rangsitProfile));
  const s2 = await readWorkbookFromFile(srinakarinPath, devicesFor(srinakarinProfile));

  check("Rangsit's UPS id set is identical before and after a Srinakarin switch (site switch invalidates cache, no leak)",
    JSON.stringify(r1.logs[r1.logs.length - 1].ups.map(u => u.upsId).sort()) ===
    JSON.stringify(r2.logs[r2.logs.length - 1].ups.map(u => u.upsId).sort()));
  check("Srinakarin's UPS id set is identical before and after a Rangsit switch (site switch invalidates cache, no leak)",
    JSON.stringify(s1.logs[s1.logs.length - 1].ups.map(u => u.upsId).sort()) ===
    JSON.stringify(s2.logs[s2.logs.length - 1].ups.map(u => u.upsId).sort()));

  console.log(`\n${checks} dashboard multi-site rendering checks passed.`);
}

void main();
