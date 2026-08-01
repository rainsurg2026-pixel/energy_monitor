import type { EngineeringDashboardSnapshot, ReportComparisonFacility, ReportData, ReportMonthlyRow } from "../reportTypes";
import { formatNumber } from "../../utils/numberFormatBridge";
import { calculateRackCapacityMetrics, formatRatioPercent } from "../../utils/rackCapacity";
import { rackStatusHex } from "../../utils/rackStatusConfig";
import { RACK_CAPACITY_HISTORY_TOTAL_ZONE } from "../../excel/RackCapacityHistoryWriter";

const FONT_STACK = '"TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif';

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function format2(value: number | null | undefined): string { return typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : "—"; }
function formatMonth(month: string | null): string {
  if (!month) return "—";
  const [year, number] = month.split("-").map(Number);
  return year && number ? new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : month;
}
function kpi(label: string, value: string, unit: string, note: string): string {
  return `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-unit">${escapeHtml(unit)}</div><div class="kpi-note">${escapeHtml(note)}</div></div>`;
}
function table(headers: string[], rows: string[][], className = ""): string {
  return `<div class="table-wrap ${className}"><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? " class=\"left\"" : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function compactNumber(value: number, values: Array<number | null>): string {
  void values;
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return formatNumber(value);
}

function trendPage(title: string, unit: string, color: string, rows: ReportMonthlyRow[], values: Array<number | null>, explanation: string): string {
  const defined = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!defined.length) return `<section class="page trend-page"><h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)}</p><p>No valid values are available for this selected reporting window.</p></section>`;
  const width = 1600, height = 810, left = 140, right = 80, top = 82, bottom = 110;
  const actualMin = Math.min(...defined), actualMax = Math.max(...defined), rawRange = actualMax - actualMin || Math.max(Math.abs(actualMax) * 0.2, 1);
  const domainMin = Math.min(0, actualMin - rawRange * 0.16), domainMax = actualMax + rawRange * 0.18;
  const range = domainMax - domainMin || 1;
  const x = (index: number) => left + (rows.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (rows.length - 1));
  const y = (value: number) => top + (domainMax - value) / range * (height - top - bottom);
  const grid = [0, 1, 2, 3, 4].map(step => {
    const value = domainMax - range * step / 4;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid"/><text x="${left - 14}" y="${y(value) + 6}" text-anchor="end" class="axis-tick">${escapeHtml(compactNumber(value, values))}</text>`;
  }).join("");
  let path = "";
  values.forEach((value, index) => { if (value !== null && Number.isFinite(value)) path += `${path ? " L" : "M"}${x(index)},${y(value)}`; });
  const points = values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) return "";
    const pointY = y(value);
    const labelY = Math.max(top + 20, Math.min(height - bottom - 10, pointY + (index % 2 === 0 ? -22 : 30)));
    return `<circle cx="${x(index)}" cy="${pointY}" r="6" fill="${color}"/><text x="${x(index)}" y="${labelY}" text-anchor="middle" class="point-value">${escapeHtml(compactNumber(value, values))}</text>`;
  }).join("");
  const labels = rows.map((row, index) => `<text x="${x(index)}" y="${height - 48}" text-anchor="middle" class="month-label">${escapeHtml(formatMonth(row.month))}</text>`).join("");
  const firstIndex = values.findIndex(value => value !== null && Number.isFinite(value));
  let lastIndex = -1;
  for (let index = values.length - 1; index >= 0; index--) if (values[index] !== null && Number.isFinite(values[index])) { lastIndex = index; break; }
  const first = firstIndex >= 0 ? values[firstIndex] as number : null;
  const last = lastIndex >= 0 ? values[lastIndex] as number : null;
  let previousIndex = -1;
  for (let index = lastIndex - 1; index >= 0; index--) if (values[index] !== null && Number.isFinite(values[index])) { previousIndex = index; break; }
  const previous = previousIndex >= 0 ? values[previousIndex] as number : null;
  const minimum = Math.min(...defined), maximum = Math.max(...defined);
  const direction = first === null || last === null || last === first ? "unchanged from the first valid month" : last > first ? "increased from the first valid month" : "decreased from the first valid month";
  const comparison = previous === null || last === null ? "No prior valid month is available for comparison." : `${last >= previous ? "Increase" : "Decrease"} of ${format2(Math.abs(last - previous))} ${unit} from ${formatMonth(rows[previousIndex].month)}.`;
  const details = `Selected month ${formatMonth(rows.at(-1)?.month ?? null)}: ${last === null ? "—" : `${format2(last)} ${unit}`}. ${comparison} Minimum ${format2(minimum)} ${unit}; maximum ${format2(maximum)} ${unit}. The selected value ${direction}.`;
  return `<section class="page trend-page"><h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)} · latest ${rows.length}-month window ending at ${escapeHtml(formatMonth(rows.at(-1)?.month ?? null))}</p><svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}<path d="${path}" fill="none" stroke="${color}" stroke-width="5"/>${points}${labels}</svg><p class="chart-explanation">${escapeHtml(explanation)} ${escapeHtml(details)}</p></section>`;
}

function monthlyTable(rows: ReportMonthlyRow[]): string {
  return table(["Month", "Building Energy", "Building Cost", "4th Floor Energy", "4th Floor Cost", "Average Rate", "UPS", "Air", "DC", "Status"], rows.map(row => [formatMonth(row.month), format2(row.buildingEnergyKwh), format2(row.buildingCostThb), format2(row.floorEnergyKwh), format2(row.floorCostThb), format2(row.averageRateThbPerKwh), format2(row.upsEnergyKwh), format2(row.airEnergyKwh), format2(row.dcEnergyKwh), escapeHtml(row.status)]));
}

function upsComparison(title: string, groups: EngineeringDashboardSnapshot["upsGroups"]): string {
  if (!groups.length) return "";
  return `<article class="block"><h3>${escapeHtml(title)}</h3><p class="note">Current load capacity compared with rated maximum.</p><div class="ups-comparison">${groups.map(group => {
    const load = group.loadPercent ?? 0;
    const tone = load >= 80 ? "high" : load >= 50 ? "medium" : "normal";
    return `<div class="ups-bar-row"><span>${escapeHtml(group.name)}</span><div class="ups-track"><i class="${tone}" style="width:${Math.min(100, Math.max(0, load))}%"></i></div><strong>${escapeHtml(format2(group.loadPercent))}%</strong></div>`;
  }).join("")}</div></article>`;
}

function engineeringDashboard(data: ReportData, dashboard: EngineeringDashboardSnapshot): string {
  const upsRows = dashboard.upsGroups.map((row, index) => [String(index + 1), escapeHtml(row.name), format2(row.totalKw), format2(row.totalKva), format2(row.capacity), `${format2(row.loadPercent)}%`, `${format2(row.availablePercent)}%`, format2(row.monthlyEnergyKwh)]);
  const showAcPowerPanel = dashboard.upsDetails.some(row => row.acPowerPanel !== "—" && row.acPowerPanel !== "-");
  const upsDetails = dashboard.upsDetails.map(row => [String(row.no), escapeHtml(row.umdb), escapeHtml(row.upsId), ...(showAcPowerPanel ? [escapeHtml(row.acPowerPanel)] : []), escapeHtml(row.sts), escapeHtml(row.oudb), format2(row.voltage), format2(row.current), format2(row.loadKw), format2(row.loadKva), format2(row.capacity), `${format2(row.loadPercent)}%`]);
  const detailedHeaders = ["No.", "UMDB", "UPS ID", ...(showAcPowerPanel ? ["AC Panel"] : []), "STS", "OUDB", "V", "A", "kW", "kVA", "Capacity", "Load %"];
  const hasOverallUps = dashboard.upsOverallGroups.length > 0;
  const srinakarinOverall = hasOverallUps ? `<h3>1. UPS Load Status</h3><article class="block"><h3>1.1 UPS Load Status - Overall</h3>${table(["No.", "UPS", "Total Load (kW)", "Total Load (kVA)", "UPS Capacity (kVA)", "Load (%)", "Available (%)"], dashboard.upsOverallGroups.map((row, index) => [String(index + 1), escapeHtml(row.name), format2(row.totalKw), format2(row.totalKva), format2(row.capacity), `${format2(row.loadPercent)}%`, `${format2(row.availablePercent)}%`]))}</article>${upsComparison("UPS Loads Comparison (%) - Overall", dashboard.upsOverallGroups)}` : "";
  const detailedUpsTitle = hasOverallUps ? "1.2 UPS and PPC Load Status – DCM 4th Floor" : "1. UPS Load Status — DCM 4th Floor";
  const detailedComparisonTitle = hasOverallUps ? "UPS and PPC Loads Comparison (%) – DCM 4th Floor" : "UPS Loads Comparison (%)";
  const airRows = [[formatMonth(dashboard.previousMonth), ...dashboard.airFields.map(field => format2(dashboard.airPrevious[field])), "—"], [formatMonth(data.reportingMonth), ...dashboard.airFields.map(field => format2(dashboard.airCurrent[field])), "—"], ["Monthly Difference", ...dashboard.airFields.map(field => format2(dashboard.airDifference[field])), dashboard.airEnergyKwh === null ? "—" : `${format2(dashboard.airEnergyKwh)} kWh`]];
  const dcRows = dashboard.dcPanels.map((row, index) => [String(index + 1), escapeHtml(row.panelId), format2(row.voltage), format2(row.current), format2(row.dcPowerW), format2(row.acCurrentA), format2(row.acPowerW), format2(row.monthlyEnergyKwh)]);
  const overall = table(["Reporting Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Avg Rate (THB/kWh)", "4th Floor Share (%)"], [[formatMonth(data.reportingMonth), format2(dashboard.buildingEnergyKwh), format2(dashboard.buildingCostThb), format2(dashboard.floorEnergyKwh), format2(dashboard.floorCostThb), format2(dashboard.averageRateThbPerKwh), `${format2(dashboard.floorSharePercent)}%`]]);
  return `<section class="page dashboard-page"><div class="dashboard-head"><div><p class="eyebrow">SELECTED-MONTH ENGINEERING ANALYSIS</p><h2>Building Energy Dashboard</h2><p>${escapeHtml(data.facility)} · ${escapeHtml(formatMonth(data.reportingMonth))} · ${dashboard.daysInMonth} days in selected month</p></div><div class="dashboard-tag">Engineering analysis<br>${escapeHtml(formatMonth(data.reportingMonth))}</div></div><div class="kpis">${kpi("Total 4th Floor Energy", format2(dashboard.floorEnergyKwh), "kWh", "UPS + AC + DC power panels")}${kpi("Estimated 4th Floor Electricity Cost", format2(dashboard.floorCostThb), "THB", "Calculated from building average rate")}${kpi("4th Floor Energy Share", `${format2(dashboard.floorSharePercent)}%`, "of building energy", `Building total: ${format2(dashboard.buildingEnergyKwh)} kWh`)}${kpi("Building Average Electricity Rate", format2(dashboard.averageRateThbPerKwh), "THB/kWh", `Building cost: ${format2(dashboard.buildingCostThb)} THB`)}</div>${srinakarinOverall}<article class="block"><h3>${detailedUpsTitle}</h3>${table(["No.", "UPS Group", "Total kW", "Total kVA", "Capacity kVA", "Load %", "Available %", "Monthly Energy kWh"], upsRows)}<p class="note">UPS group capacity and mapping values are read directly from Dashboard-FAC. Monthly energy uses load × 24 hours × selected-month days.</p></article>${upsComparison(detailedComparisonTitle, dashboard.upsGroups)}</section><section class="page dashboard-page"><div class="continuation">Building Energy Dashboard · ${escapeHtml(formatMonth(data.reportingMonth))}</div><article class="block"><h3>${showAcPowerPanel ? "UPS / PPC Detailed Configuration Mapping" : "UPS Detailed Configuration Mapping"}</h3>${table(detailedHeaders, upsDetails, "dense")}<p class="note">Detail total: ${format2(dashboard.detailedVoltageAvg)} V average · ${format2(dashboard.detailedCurrentSum)} A · ${format2(dashboard.totalUpsKw)} kW · ${format2(dashboard.totalUpsKva)} kVA.</p></article><article class="block"><h3>2. Air Conditioning Energy Consumption — 4th Floor</h3>${table(["Reporting Month", ...dashboard.airFields.map(field => `${field.toUpperCase()} (GWh)`), "Total AC Energy"], airRows)}<p class="note">Air-conditioning energy is the complete GWh meter difference × 1,000,000. Missing readings remain unavailable, rather than being treated as zero.</p></article><article class="block"><h3>3. DC Power Panel Load Status</h3>${table(["No.", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current @220V (A)", "AC Power (W)", "Monthly Energy (kWh)"], dcRows)}<p class="note">DC total: ${format2(dashboard.totalDcPowerW)} W DC · ${format2(dashboard.totalDcAcCurrentA)} A AC · ${format2(dashboard.totalDcAcPowerW)} W AC · ${format2(dashboard.totalDcEnergyKwh)} kWh.</p></article><article class="block"><h3>4. Overall Energy Consumption & Electricity Cost</h3>${overall}</article></section>`;
}

function donutSvg(segments: Array<{ name: string; count: number; ratio: number | null }>, total: number): string {
  const size = 220, r = 78, cx = size / 2, cy = size / 2, circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter(s => s.count > 0)
    .map(s => {
      const fraction = total > 0 ? s.count / total : 0;
      const dash = `${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
      const rotate = offset * 360;
      offset += fraction;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${rackStatusHex(s.name)}" stroke-width="34" stroke-dasharray="${dash}" transform="rotate(${rotate - 90} ${cx} ${cy})"/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Rack Status Distribution">${arcs}<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="700" fill="#29415d">${total}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#657488">Total Racks</text></svg>`;
}

/** Latest month's Total (U)/Used (U)/Available (U)/Availability Capacity
 *  (%), plus the "Rack Unit Capacity Image" when the workbook has one -
 *  U-capacity is a genuinely separate business dimension from rack count
 *  (never inferred from it), so this block is omitted entirely (with a
 *  plain note) until real Rack Unit Capacity data exists. */
function rackUnitCapacityBlock(data: ReportData): string {
  if (data.rackUnitCapacity.length === 0) {
    return `<p class="note">Rack Unit Capacity data is not yet available in this workbook.</p>`;
  }
  const latest = [...data.rackUnitCapacity].sort((a, b) => a.month.localeCompare(b.month)).at(-1)!;
  const availabilityText = latest.availabilityPct === null ? "—" : `${(latest.availabilityPct * 100).toFixed(2)}%`;
  const image = data.rackUnitCapacityImageDataUri
    ? `<img src="${data.rackUnitCapacityImageDataUri}" alt="Rack Unit Capacity Image" class="rack-unit-capacity-image"/>`
    : "";
  return `<article class="block"><h3>Rack Unit Capacity — ${escapeHtml(formatMonth(latest.month))}</h3><div class="kpis">${kpi("Total (U)", String(latest.totalU), "U", "")}${kpi("Used (U)", String(latest.usedU), "U", "")}${kpi("Available (U)", String(latest.availableU), "U", "")}${kpi("Availability Capacity", availabilityText, "", "")}</div>${image}</article>`;
}

function rackCapacityPage(data: ReportData): string {
  if (!data.rack || data.rack.records.length === 0) {
    return `<section class="page"><h2>Rack Capacity and Utilization</h2><p class="note">Rack capacity data is unavailable in this workbook.</p>${rackUnitCapacityBlock(data)}</section>`;
  }
  const metrics = calculateRackCapacityMetrics(data.rack.records);
  const cards = [
    ["Total Racks", metrics.total, metrics.total > 0 ? 1 : null],
    ["In Use", metrics.inUse.count, metrics.inUse.ratio],
    ["Available", metrics.available.count, metrics.available.ratio],
    ["Reserved", metrics.reserved.count, metrics.reserved.ratio],
    ["Pending Dismantle", metrics.pendingDismantle.count, metrics.pendingDismantle.ratio]
  ] as const;
  const kpis = cards.map(([label, count, ratio]) => kpi(label, String(count), formatRatioPercent(ratio), "")).join("");
  const donut = donutSvg(
    [
      { name: "In Use", count: metrics.inUse.count, ratio: metrics.inUse.ratio },
      { name: "Available", count: metrics.available.count, ratio: metrics.available.ratio },
      { name: "Reserved", count: metrics.reserved.count, ratio: metrics.reserved.ratio },
      { name: "Pending Dismantle", count: metrics.pendingDismantle.count, ratio: metrics.pendingDismantle.ratio },
      { name: "Other", count: metrics.other.count, ratio: metrics.other.ratio }
    ],
    metrics.total
  );
  const zoneRows = metrics.zoneMetrics.map(zone => [
    escapeHtml(zone.zone),
    `${zone.inUse.count} (${formatRatioPercent(zone.inUse.ratio, 1)})`,
    `${zone.available.count} (${formatRatioPercent(zone.available.ratio, 1)})`,
    `${zone.reserved.count} (${formatRatioPercent(zone.reserved.ratio, 1)})`,
    `${zone.pendingDismantle.count} (${formatRatioPercent(zone.pendingDismantle.ratio, 1)})`,
    String(zone.total)
  ]);
  zoneRows.push([
    "Grand Total",
    `${metrics.inUse.count} (${formatRatioPercent(metrics.inUse.ratio, 1)})`,
    `${metrics.available.count} (${formatRatioPercent(metrics.available.ratio, 1)})`,
    `${metrics.reserved.count} (${formatRatioPercent(metrics.reserved.ratio, 1)})`,
    `${metrics.pendingDismantle.count} (${formatRatioPercent(metrics.pendingDismantle.ratio, 1)})`,
    String(metrics.total)
  ]);
  return `<section class="page"><h2>Rack Capacity and Utilization</h2><p class="note">${escapeHtml(data.facility)} · Usage ${formatRatioPercent(metrics.inUse.ratio)} · Availability ${formatRatioPercent(metrics.available.ratio)}</p><div class="kpis">${kpis}</div><div class="rack-donut-row"><div>${donut}</div><div class="table-wrap" style="flex:1"><table><thead><tr><th class="left">Rack Zone</th><th>In Use</th><th>Available</th><th>Reserved</th><th>Pending Dismantle</th><th>Total</th></tr></thead><tbody>${zoneRows.map(row => `<tr>${row.map((cell, i) => `<td${i === 0 ? " class=\"left\"" : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>${rackUnitCapacityBlock(data)}</section>`;
}

function rackCapacityTrendPage(data: ReportData): string {
  const totalRows = data.rackHistory
    .filter(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE)
    .sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth))
    .slice(-12);
  if (totalRows.length < 2) {
    return `<section class="page"><h2>Rack Capacity Monthly Trend</h2><p class="note">${totalRows.length === 0 ? "No Rack Capacity History snapshots exist yet." : "Only one month of history exists — a trend needs at least two months to be meaningful."}</p></section>`;
  }
  const syntheticRows: ReportMonthlyRow[] = totalRows.map(r => ({ month: r.snapshotMonth } as ReportMonthlyRow));
  const usageValues = totalRows.map(r => (r.usagePct === null ? null : r.usagePct * 100));
  const availabilityValues = totalRows.map(r => (r.availabilityPct === null ? null : r.availabilityPct * 100));
  return (
    trendPage("Rack Capacity Usage % Trend", "%", "#10b981", syntheticRows, usageValues, "Percentage of racks In Use, from persisted monthly snapshots (never fabricated for missing months).") +
    trendPage("Rack Capacity Availability % Trend", "%", "#0ea5e9", syntheticRows, availabilityValues, "Percentage of racks Available, from persisted monthly snapshots (never fabricated for missing months).")
  );
}

function rackUnitCapacityTrendPage(data: ReportData): string {
  const sortedRows = [...data.rackUnitCapacity].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  if (sortedRows.length < 2) {
    return `<section class="page"><h2>Rack Unit Capacity Monthly Trend</h2><p class="note">${sortedRows.length === 0 ? "No Rack Unit Capacity records exist yet." : "Only one month of data exists — a trend needs at least two months to be meaningful."}</p></section>`;
  }
  const syntheticRows: ReportMonthlyRow[] = sortedRows.map(r => ({ month: r.month } as ReportMonthlyRow));
  const availabilityValues = sortedRows.map(r => (r.availabilityPct === null ? null : r.availabilityPct * 100));
  return trendPage("Rack Unit Capacity Availability % Trend", "%", "#22c55e", syntheticRows, availabilityValues, "Percentage of rack-unit (U) space Available, from persisted monthly Rack Unit Capacity records (never fabricated for missing months).");
}

function comparisonPage(data: ReportData): string {
  if (!data.comparison) return "";
  const { self, other } = data.comparison;
  const rows: string[][] = [comparisonRow(self)];
  if (other) rows.push(comparisonRow(other));
  const note = other
    ? ""
    : `<p class="note">Only ${escapeHtml(self.label)} is shown — the sibling facility's workbook was unavailable for this export.</p>`;
  return `<section class="page"><h2>Site Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(self.month))}</p>${table(["Facility", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"], rows)}${note}</section>`;
}
function comparisonRow(facility: ReportComparisonFacility): string[] {
  return [
    escapeHtml(facility.label),
    format2(facility.buildingEnergyKwh),
    format2(facility.buildingCostThb),
    format2(facility.floorEnergyKwh),
    format2(facility.floorCostThb),
    format2(facility.averageRateThbPerKwh),
    facility.floorSharePercent === null ? "—" : `${format2(facility.floorSharePercent)}%`
  ];
}

export function buildReportHtml(data: ReportData): string {
  const range = `${formatMonth(data.historicalStart)} – ${formatMonth(data.historicalEnd)}`;
  const dashboard = data.engineeringDashboard ? engineeringDashboard(data, data.engineeringDashboard) : "";
  const trendPages = [
    ["Total 4th Floor Energy Trend", "kWh", "#6366f1", data.monthlyRows.map(row => row.floorEnergyKwh), "Monthly total 4th Floor energy for the selected reporting window."],
    ["UPS System Energy Trend", "kWh", "#3b82f6", data.monthlyRows.map(row => row.upsEnergyKwh), "Monthly UPS system energy utilization."],
    ["Air Conditioning Energy Trend", "kWh", "#14b8a6", data.monthlyRows.map(row => row.airEnergyKwh), "Meter-difference energy; gaps indicate an unavailable prior reading."],
    ["DC Power Panel Energy Trend", "kWh", "#f59e0b", data.monthlyRows.map(row => row.dcEnergyKwh), "Monthly DC panel energy estimate."],
    ["Estimated 4th Floor Cost Trend", "THB", "#10b981", data.monthlyRows.map(row => row.floorCostThb), "Estimated cost at the building average electricity rate."],
    ["Building Average Electricity Rate Trend", "THB/kWh", "#f97316", data.monthlyRows.map(row => row.averageRateThbPerKwh), "Building electricity cost divided by building energy."],
  ] as const;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>
@page{size:A4 landscape;margin:8mm 9mm 12mm}*{box-sizing:border-box}html,body{margin:0;color:#243247;background:#fff;font:12px/1.3 ${FONT_STACK}}.cover{height:180mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}.cover h1{font-size:34px;margin:0;color:#29415d}.cover h2{font-size:20px;font-weight:400;color:#7c6a68}.meta{margin-top:16px;border-top:1px solid #e6d9d2;padding-top:12px;color:#5f6f82}.page{page-break-before:always;padding-top:1mm}.page h2{font-size:23px;margin:0 0 7px;color:#29415d;border-bottom:2px solid #e8d7d0;padding-bottom:5px}.page h3{font-size:16px;color:#3e5874;margin:0 0 6px}.dashboard-head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e8d7d0;padding-bottom:8px}.dashboard-head h2{border:0;padding:0;margin:0}.dashboard-head p{margin:3px 0;color:#5f6f82}.eyebrow{font-size:9px!important;font-weight:bold;letter-spacing:1px;color:#a25e4c!important}.dashboard-tag{font-size:10px;text-align:right;color:#52687f;border-left:1px solid #e7d9d2;padding-left:12px}.continuation{font-size:10px;font-weight:bold;color:#68798a;border-bottom:1px solid #e7d9d2;padding-bottom:4px;margin-bottom:7px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:9px 0}.kpi{min-height:74px;padding:9px;background:#f5eee9;border:1px solid #e7d9d2;border-radius:6px;break-inside:avoid}.kpi-label{font-size:10px;color:#67788b;text-transform:uppercase;font-weight:bold}.kpi-value{font-size:21px;font-weight:700;margin-top:5px;color:#29415d}.kpi-unit,.kpi-note,.note{font-size:10px;color:#64758a}.kpi-note{margin-top:3px}.block{margin:9px 0;padding:9px;border:1px solid #e7dcd6;border-radius:6px;break-inside:avoid}.note{margin:6px 0 0}.table-wrap{margin:4px 0;overflow:hidden}table{border-collapse:collapse;width:100%;font-size:10px}th,td{padding:4px;border:1px solid #eadfda;text-align:right;vertical-align:top}td.left,th:first-child{text-align:left}th{background:#eee3dd;color:#40566e;font-weight:bold}.dense table{font-size:8.5px}.dense th,.dense td{padding:3px}.ups-comparison{display:grid;gap:7px;margin-top:8px}.ups-bar-row{display:grid;grid-template-columns:90px 1fr 52px;gap:8px;align-items:center;font-size:11px}.ups-bar-row strong{text-align:right}.ups-track{height:10px;background:#edf1f5;border-radius:99px;overflow:hidden}.ups-track i{display:block;height:100%;border-radius:99px;background:#10b981}.ups-track i.medium{background:#f59e0b}.ups-track i.high{background:#e05b4c}.trend-page{height:183mm;display:flex;flex-direction:column}.trend-page h2{font-size:26px;margin-bottom:2px}.chart-unit{margin:0 0 5px;color:#657488;font-size:12px}.trend-svg{width:100%;height:142mm;flex:1;overflow:visible}.grid{stroke:#dce4ea;stroke-width:1}.axis-tick,.month-label,.point-value{fill:#44566b;font-family:${FONT_STACK}}.axis-tick{font-size:20px}.month-label{font-size:19px}.point-value{font-size:19px;font-weight:bold}.chart-explanation{margin:2px 5mm 0;font-size:12px;color:#52687f;text-align:center}.report-info{font-size:13px;line-height:1.55}.rack-donut-row{display:flex;gap:16px;align-items:flex-start;margin-top:8px}.rack-unit-capacity-image{display:block;max-width:220px;max-height:120px;object-fit:contain;margin-top:8px;border:1px solid #e7dcd6;border-radius:6px}
</style></head><body><main class="cover"><h1>${escapeHtml(data.title)}</h1><h2>${escapeHtml(data.thaiSubtitle)}</h2><div class="meta">Facility: ${escapeHtml(data.facility)}<br>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}<br>Historical range: ${escapeHtml(range)}<br>Source workbook: ${escapeHtml(data.sourceWorkbook)}<br>Application version: ${escapeHtml(data.appVersion)}</div></main>${dashboard}${trendPages.map(([title, unit, color, values, explanation]) => trendPage(title, unit, color, data.monthlyRows, values, explanation)).join("")}<section class="page"><h2>Monthly Energy &amp; Cost Table</h2>${monthlyTable(data.monthlyRows)}</section>${comparisonPage(data)}${rackCapacityPage(data)}${rackCapacityTrendPage(data)}${rackUnitCapacityTrendPage(data)}<section class="page report-info"><h2>Report Information and Data Source</h2><p>Source workbook: ${escapeHtml(data.sourceWorkbook)}<br>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}<br>Historical range: ${escapeHtml(range)}<br>Data status: ${escapeHtml(data.status)}</p></section><script>document.body.dataset.reportReady="true";</script></body></html>`;
}
