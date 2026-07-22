import { MonthlyLog } from "../types";
import type { ExcelIntegrityReport, WorkbookHealth } from "../desktop";
import { calculateEnergyCostForMonth } from "./energyCost";
import { formatNumber2 } from "./numberFormatBridge";

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
const csvNumber2 = (value: number | null): string => value === null ? "" : formatNumber2(value);

export function buildSectionCsvs(logs: MonthlyLog[]): Array<{ name: string; content: string }> {
  const ups = [row(["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)"])];
  const airFields = logs.some(log => log.air.meters && Object.keys(log.air.meters).length > 0)
    ? Array.from(new Set(logs.flatMap(log => Object.keys(log.air.meters ?? {})))).sort()
    : ["eb41a", "eb41b", "eb42a", "eb42b"];
  const air = [row(["Month", ...airFields.map(field => `${field.toUpperCase()} (GWh)`)] )];
  const dc = [row(["Month", "DC Panel", "Voltage (V)", "Current (A)"])];
  const energy = [row([
    "Month",
    "Building Energy Consumption (kWh)",
    "Building Electricity Cost (THB)",
    "4th Floor Energy Consumption (kWh)",
    "4th Floor Electricity Cost (THB)",
    "Average Electricity Rate (THB/kWh)",
    "4th Floor Energy Share (%)"
  ])];

  for (const l of [...logs].sort((a, b) => a.month.localeCompare(b.month))) {
    for (const u of l.ups) ups.push(row([l.month, u.upsId, u.voltage, u.current, u.loadKw, u.loadKva]));
    air.push(row([l.month, ...airFields.map(field => l.air.meters?.[field] ?? (l.air as unknown as Record<string, number | null | undefined>)[field] ?? null)]));
    for (const d of l.dc) dc.push(row([l.month, d.panelId, d.voltage, d.current]));
    const energyCost = calculateEnergyCostForMonth(logs, l.month);
    energy.push(row([
      l.month,
      csvNumber2(energyCost.buildingEnergyKwh),
      csvNumber2(energyCost.buildingElectricityCostThb),
      csvNumber2(energyCost.floorEnergyKwh),
      csvNumber2(energyCost.floorElectricityCostThb),
      csvNumber2(energyCost.averageElectricityRateThbPerKwh),
      energyCost.energySharePercent === null ? "" : `${formatNumber2(energyCost.energySharePercent)}%`
    ]));
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
