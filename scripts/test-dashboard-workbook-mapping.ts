/**
 * Proves the Dashboard's UPS Summary / UPS Mapping sections match Excel
 * exactly - the specific regression this suite exists for: UMDB, STS,
 * OUDB, AC Power Panel, and Capacity were previously "—" placeholders for
 * Srinakarin. Every value asserted here was independently hand-verified
 * against a raw ExcelJS cell dump of Dashboard-FAC before this suite was
 * written (see docs/desktop/KNOWN_TECHNICAL_DEBT.md).
 *
 * Run: node node_modules/tsx/dist/cli.mjs scripts/test-dashboard-workbook-mapping.ts
 */
import { readFile } from "fs/promises";
import { readUpsMappingFromBuffer } from "../src/reports/upsMappingReader";

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

function approxEqual(a: number | null, b: number, epsilon = 0.001): boolean {
  return a !== null && Math.abs(a - b) < epsilon;
}

async function main(): Promise<void> {
  console.log("Dashboard workbook-mapping exactness checks");

  // --- Rangsit ---
  const rangsitReport = await readUpsMappingFromBuffer(await readFile("DC_Rangsit.xlsm"));
  if (!rangsitReport) throw new Error("Rangsit Dashboard-FAC mapping did not read.");

  check("Rangsit summary has 4 groups (UPS 11/13/14/15)", rangsitReport.summary.length === 4);
  check("Rangsit summary capacities are never null (no placeholder)",
    rangsitReport.summary.every(g => g.capacity !== null));
  check("Rangsit UPS 11 group: 315kW/317kVA/400cap/79.25%", (() => {
    const g = rangsitReport.summary.find(r => r.name === "UPS 11");
    return !!g && g.totalLoadKw === 315 && g.totalLoadKva === 317 && g.capacity === 400 && approxEqual(g.loadPercent, 79.25);
  })());

  check("Rangsit mapping has 7 detail rows", rangsitReport.mapping.length === 7);
  check("Rangsit row 1 (UPS 11A): UMDB/STS/OUDB/Capacity/Load% all populated, matching Excel exactly", (() => {
    const r = rangsitReport.mapping[0];
    return r.umdb === "UMDB11A (EMDB_12A2)" && r.upsId === "UPS 11A" && r.sts === "STS11A" && r.oudb === "OUDB41A" &&
      r.voltage === 390 && r.current === 254 && r.loadKw === 157 && r.loadKva === 158 &&
      r.capacity === 400 && approxEqual(r.loadPercent, 39.5);
  })());
  check("No Rangsit mapping row has a placeholder '—' for UMDB, STS, OUDB, or Capacity",
    rangsitReport.mapping.every(r => r.umdb !== "—" && r.sts !== "—" && r.oudb !== "—" && r.capacity !== null));

  // --- Srinakarin: the actual regression this suite guards ---
  const srinakarinReport = await readUpsMappingFromBuffer(await readFile("DC_Srinakarin.xlsm"));
  if (!srinakarinReport) throw new Error("Srinakarin Dashboard-FAC mapping did not read.");

  check("Srinakarin summary picks the complete 'UPS and PPC Load Status' table (5 groups), not the partial 'Overall' table (3 rows)",
    srinakarinReport.summary.length === 5 &&
    JSON.stringify(srinakarinReport.summary.map(g => g.name)) === JSON.stringify(["UPS 41", "PPC 41", "PPC 42", "PPC 43", "PPC 44"]));
  check("Srinakarin summary capacities are never null (was previously always null)",
    srinakarinReport.summary.every(g => g.capacity !== null));
  check("Srinakarin PPC 41 group: 153kW/157kVA/400cap/39.25% - real Excel values, not a guess",
    (() => {
      const g = srinakarinReport.summary.find(r => r.name === "PPC 41");
      return !!g && g.totalLoadKw === 153 && g.totalLoadKva === 157 && g.capacity === 400 && approxEqual(g.loadPercent, 39.25);
    })());

  check("Srinakarin mapping has 10 detail rows (was previously 10 rows of all-placeholder data)",
    srinakarinReport.mapping.length === 10);
  check("Srinakarin mapping includes a real 'AC Power Panel' column (Rangsit has none)",
    srinakarinReport.mapping.every(r => r.acPowerPanel !== "—"));

  // The exact worked examples from the regression report this fix addresses.
  const expectedRows: Array<{ upsId: string; acPowerPanel: string; loadKva: number; capacity: number; loadPercent: number }> = [
    { upsId: "UPS 41A", acPowerPanel: "LPU 1-7, LPU 1-8", loadKva: 29.6, capacity: 400, loadPercent: 7.4 },
    { upsId: "UPS 11A", acPowerPanel: "PPC 41A", loadKva: 78, capacity: 200, loadPercent: 39.0 },
    { upsId: "UPS 11B", acPowerPanel: "PPC 41B", loadKva: 79, capacity: 200, loadPercent: 39.5 },
    { upsId: "UPS 13A", acPowerPanel: "PPC 42A", loadKva: 42, capacity: 200, loadPercent: 21.0 },
    { upsId: "UPS 13B", acPowerPanel: "PPC 42B", loadKva: 41, capacity: 200, loadPercent: 20.5 },
    { upsId: "UPS 12A", acPowerPanel: "PPC 43A", loadKva: 71, capacity: 400, loadPercent: 17.75 },
    { upsId: "UPS 12B", acPowerPanel: "PPC 43B", loadKva: 72, capacity: 400, loadPercent: 18.0 },
    { upsId: "UPS 12A", acPowerPanel: "PPC 44A", loadKva: 14, capacity: 400, loadPercent: 3.5 }
  ];
  for (const expected of expectedRows) {
    const row = srinakarinReport.mapping.find(r => r.upsId === expected.upsId && r.acPowerPanel === expected.acPowerPanel);
    check(
      `Srinakarin ${expected.upsId} -> ${expected.acPowerPanel}: ${expected.loadKva}/${expected.capacity}=${expected.loadPercent}% (Load(%) = Load(kVA)/Capacity(kVA)*100, matching Excel)`,
      !!row && row.loadKva === expected.loadKva && row.capacity === expected.capacity && approxEqual(row.loadPercent, expected.loadPercent),
      row ? `got loadKva=${row.loadKva} capacity=${row.capacity} loadPercent=${row.loadPercent}` : "row not found"
    );
  }
  check("No Srinakarin mapping row has a placeholder '—' for UMDB, STS, OUDB, or a null Capacity (the reported regression)",
    srinakarinReport.mapping.every(r => r.umdb !== "—" && r.sts !== "—" && r.oudb !== "—" && r.capacity !== null));

  console.log(`\n${checks} dashboard workbook-mapping exactness checks passed.`);
}

void main();
