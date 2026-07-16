import { MonthlyLog } from "../types";
import type { ExcelIntegrityReport, WorkbookHealth } from "../desktop";

/**
 * Renderer-side export builders (RC6): CSV text and the integrity-report
 * text that go into single-file exports and the ZIP package.
 */

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const row = (cells: unknown[]): string => cells.map(csvEscape).join(",");

export function buildSectionCsvs(logs: MonthlyLog[]): Array<{ name: string; content: string }> {
  const ups = [row(["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"])];
  const air = [row(["Month", "EB41A (GWh)", "EB41B (GWh)", "EB42A (GWh)", "EB42B (GWh)"])];
  const dc = [row(["Month", "DC Panel", "Voltage (V)", "Current (A)"])];
  const energy = [row(["Month", "Building Energy (kWh)", "Electricity Cost (THB)"])];

  for (const l of [...logs].sort((a, b) => a.month.localeCompare(b.month))) {
    for (const u of l.ups) ups.push(row([l.month, u.upsId, u.voltage, u.current, u.loadKw, u.loadKva]));
    air.push(row([l.month, l.air.eb41a, l.air.eb41b, l.air.eb42a, l.air.eb42b]));
    for (const d of l.dc) dc.push(row([l.month, d.panelId, d.voltage, d.current]));
    energy.push(row([l.month, l.energyCost.buildingEnergyKwh, l.energyCost.buildingElectricityCostThb]));
  }

  return [
    { name: "UPS_Loads.csv", content: ups.join("\n") },
    { name: "Air_Conditioning.csv", content: air.join("\n") },
    { name: "DC_Panels.csv", content: dc.join("\n") },
    { name: "Energy_Cost.csv", content: energy.join("\n") }
  ];
}

/** Single-file CSV export: all four sections in one file, block per section. */
export function buildCombinedCsv(logs: MonthlyLog[]): string {
  return buildSectionCsvs(logs)
    .map(csv => `# ${csv.name.replace(".csv", "")}\n${csv.content}`)
    .join("\n\n");
}

export function buildIntegrityText(
  facility: string,
  workbookLabel: string,
  health: WorkbookHealth | undefined,
  integrity: ExcelIntegrityReport | undefined
): string {
  const lines: string[] = [
    "DATA INTEGRITY REPORT",
    "=====================",
    `Facility:  ${facility}`,
    `Workbook:  ${workbookLabel}`,
    `Generated: ${new Date().toISOString()}`,
    ""
  ];
  if (!health || !integrity) {
    lines.push("No integrity data available.");
    return lines.join("\n");
  }
  lines.push(
    `Structure:        ${health.structureOk ? "VALID" : "INVALID"}`,
    `Months:           ${health.monthCount} (${health.firstMonth ?? "-"} … ${health.lastMonth ?? "-"})`,
    `Last validation:  ${health.validatedAt}`,
    "",
    `Duplicate records:   ${integrity.duplicateKeys.length}`,
    ...integrity.duplicateKeys.map(d => `  - ${d.tab} ${d.month}${d.deviceId ? ` ${d.deviceId}` : ""} rows ${d.rowNumbers.join(",")}`),
    `Missing months:      ${integrity.missingMonths.length}`,
    ...integrity.missingMonths.slice(0, 200).map(m => `  - ${m.tab} ${m.month}`),
    `Missing devices:     ${integrity.missingDevices.length}`,
    ...integrity.missingDevices.slice(0, 200).map(m => `  - ${m.tab} ${m.month} ${m.deviceId}`),
    `Invalid device IDs:  ${integrity.invalidIds.length}`,
    ...integrity.invalidIds.map(i => `  - ${i.tab} row ${i.rowNumber}: "${i.rawId}"`),
    `Blank/invalid rows:  ${integrity.unexpectedBlankRows.length}`,
    ...integrity.unexpectedBlankRows.map(b => `  - ${b.tab} row ${b.rowNumber}`)
  );
  return lines.join("\n");
}
