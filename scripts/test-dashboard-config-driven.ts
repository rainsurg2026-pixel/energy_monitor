/**
 * Technical-debt cleanup regression suite: dashboard UPS topology
 * (groups/UMDB-STS-OUDB mapping) must live entirely in facility config
 * (facility.profile.dashboard), with zero facility-identity branching left
 * in the presentation layer. Companion to test-dashboard-facility-isolation.ts
 * (which covers the earlier bug fix's data-layer isolation guarantees -
 * still valid and unaffected by this refactor).
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-dashboard-config-driven.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

interface DashboardConfig {
  upsGroups: { name: string; ids: string[]; capacity: number | null }[];
  upsMapping: { no: number; umdb: string; upsId: string; keyId?: string; sts: string; oudb: string; capacity: number | null }[];
}

async function loadDashboardConfig(id: string): Promise<DashboardConfig> {
  const raw = JSON.parse(await fs.readFile(path.join(root, "config", id, "profile.json"), "utf8"));
  return raw.dashboard;
}

async function main(): Promise<void> {
  console.log("Dashboard config-driven architecture checks");

  const dashboardSource = await fs.readFile(path.join(root, "src", "components", "DashboardSummary.tsx"), "utf8");
  const filterBarSource = await fs.readFile(path.join(root, "src", "components", "UniversalFilterBar.tsx"), "utf8");

  // --- Presentation layer contains no facility-specific branching ---
  check("DashboardSummary contains no facility.id comparison",
    !/facility\??\.id\s*===/.test(dashboardSource));
  check("DashboardSummary contains no \"srinakarin\"/\"rangsit\" string literal",
    !/["']srinakarin["']|["']rangsit["']/i.test(dashboardSource));
  check("UniversalFilterBar contains no facility.id comparison",
    !/facility\??\.id\s*===|facility\.id\s*!==/.test(filterBarSource));
  check("UniversalFilterBar contains no \"srinakarin\"/\"rangsit\" string literal",
    !/["']srinakarin["']|["']rangsit["']/i.test(filterBarSource));

  // --- Dashboard is configuration-driven ---
  // Superseded by direct workbook reads (RC-3.2): UMDB/STS/OUDB/AC Power
  // Panel/Capacity turned out to be real Dashboard-FAC data, not something
  // safe to hand-author in JSON - see docs/desktop/KNOWN_TECHNICAL_DEBT.md
  // and src/reports/upsMappingReader.ts. facility.profile.dashboard remains
  // as valid, unused fallback infrastructure; it is no longer the active
  // source DashboardSummary renders from.
  // engineeringDashboard.ts under utils is now a compatibility re-export;
  // inspect the domain implementation where the calculation source lives.
  const dashboardCalculationSource = await fs.readFile(path.join(root, "src", "domain", "engineeringDashboard.ts"), "utf8");
  check("DashboardSummary reads UPS groups from the shared workbook calculation, not static config",
    dashboardSource.includes("buildEngineeringDashboardSnapshot") && dashboardCalculationSource.includes("upsMapping?.summary"));
  check("DashboardSummary reads UPS mapping from the shared workbook calculation, not static config",
    dashboardSource.includes("buildEngineeringDashboardSnapshot") && dashboardCalculationSource.includes("upsMapping?.mapping"));
  check("UniversalFilterBar reads its UPS options from facility.profile.dashboard",
    filterBarSource.includes("facility?.profile.dashboard.upsGroups") &&
    filterBarSource.includes("facility?.profile.dashboard.upsMapping"));

  // --- Single Source of Truth / no duplicated topology definitions ---
  check("Rangsit's UMDB mapping literal ('UMDB11A') does not live in component source",
    !dashboardSource.includes("UMDB11A"));
  check("FacilityProfile declares `dashboard` exactly once (single type definition, not duplicated per component)",
    (await fs.readFile(path.join(root, "src", "electron", "facilities.ts"), "utf8"))
      .match(/dashboard: FacilityDashboardConfig/g)?.length === 1);

  // --- Adding a new facility requires configuration only (no component
  // change needed): DashboardSummary must tolerate a workbook with no
  // Dashboard-FAC mapping table without crashing, i.e. it uses `?? []`,
  // never assumes the array is non-empty. ---
  check("DashboardSummary defaults to an empty array when upsMapping is unavailable",
    dashboardCalculationSource.includes("upsMapping?.summary ?? []") &&
    dashboardCalculationSource.includes("upsMapping?.mapping ?? []"));

  // --- Data integrity: config moved, not altered - the values now in
  // profile.json are byte-for-byte the values that used to be hardcoded in
  // DashboardSummary.tsx before this refactor. ---
  const rangsitDashboard = await loadDashboardConfig("rangsit");
  const srinakarinDashboard = await loadDashboardConfig("srinakarin");

  const expectedRangsitGroups = [
    { name: "UPS 11", ids: ["UPS 11A", "UPS 11B"], capacity: 400 },
    { name: "UPS 13", ids: ["UPS 13A", "UPS 13B"], capacity: 400 },
    { name: "UPS 14", ids: ["UPS 14C"], capacity: 120 },
    { name: "UPS 15 (PPC44A, PPC44B)", ids: ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"], capacity: 400 }
  ];
  check("Rangsit's moved upsGroups match the original hardcoded values exactly (no data change)",
    JSON.stringify(rangsitDashboard.upsGroups) === JSON.stringify(expectedRangsitGroups));

  const expectedRangsitMappingIds = ["UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A (PPC44A)", "UPS 15B (PPC44B)"];
  check("Rangsit's moved upsMapping has the same 7 rows in the same order as before",
    JSON.stringify(rangsitDashboard.upsMapping.map(m => m.upsId)) === JSON.stringify(expectedRangsitMappingIds));
  check("Rangsit's moved upsMapping preserves the original UMDB/STS/OUDB values for row 1 (UPS 11A)",
    rangsitDashboard.upsMapping[0].umdb === "UMDB11A (EMDB_12A2)" &&
    rangsitDashboard.upsMapping[0].sts === "STS11A" &&
    rangsitDashboard.upsMapping[0].oudb === "OUDB41A" &&
    rangsitDashboard.upsMapping[0].capacity === 400);
  check("Rangsit's UPS 15A row keeps its keyId lookup alias (PPC44A) -> UPS 15A",
    rangsitDashboard.upsMapping.find(m => m.upsId === "UPS 15A (PPC44A)")?.keyId === "UPS 15A");

  const expectedSrinakarinIds = ["UPS 41A", "UPS 41B", "PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B", "PPC 43A", "PPC 43B", "PPC 44A", "PPC 44B"];
  check("Srinakarin's moved upsMapping has the same 10 rows in the same order as before",
    JSON.stringify(srinakarinDashboard.upsMapping.map(m => m.upsId)) === JSON.stringify(expectedSrinakarinIds));
  check("Srinakarin's moved upsGroups pair the same 5 A/B groups as before",
    JSON.stringify(srinakarinDashboard.upsGroups.map(g => g.name)) ===
    JSON.stringify(["UPS 41", "PPC 41", "PPC 42", "PPC 43", "PPC 44"]));

  console.log(`\n${checks} dashboard config-driven architecture checks passed.`);
}

void main();
