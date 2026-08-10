import type { EngineeringDashboardSnapshot, ReportComparisonFacility, ReportData, ReportMonthlyRow } from "../reportTypes";
import { formatNumber } from "../../utils/numberFormatBridge";
import { formatTimestamp } from "../../utils";
import { calculateRackCapacityMetrics, formatRatioPercent, RackCapacityMetrics } from "../../utils/rackCapacity";
import type { RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import { calculateCapacityHealthScore, utilizationColorHex } from "../../utils/capacityHealth";
import { getCapacityHealth } from "../../utils/capacityForecast";
import { getAccessibleTextColor } from "../../utils/colorContrast";
import { findPreviousRackUnitCapacityRow, usagePercent } from "../../utils/rackUnitCapacity";
import { calculatePercentageDelta, getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";

const FONT_STACK = '"TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif';

/** Export-only palette. These colors are deliberately darker than the live
 * dashboard accents so thin PDF strokes, legends, and point labels remain
 * legible in print. Series colors never depend on row order. The PUE token is
 * reserved for benchmark export surfaces; All Report keeps PUE dashboard-only
 * under the existing report-safety contract. */
const REPORT_PALETTE = {
  energy: "#1d4ed8",
  ups: "#0f766e",
  air: "#c2410c",
  dc: "#7c3aed",
  cost: "#047857",
  rate: "#b45309",
  pue: "#b91c1c",
  rackInUse: "#1d4ed8",
  rackAvailable: "#059669",
  rackReserved: "#b45309",
  rackPending: "#b91c1c",
  rackOther: "#475569",
  rackTotal: "#64748b",
  siteRangsit: "#1d4ed8",
  siteSrinakarin: "#c2410c",
  siteOther: "#475569"
} as const;

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

interface TrendSeries {
  name: string;
  color: string;
  values: Array<number | null>;
}

/** Single-series narrative (first/last/min/max/direction) - unchanged
 *  behavior from before this function supported multiple series, so every
 *  existing single-series page's text stays byte-identical. */
function trendSeriesDetails(unit: string, values: Array<number | null>, rows: ReportMonthlyRow[]): string {
  const defined = values.filter((value): value is number => value !== null && Number.isFinite(value));
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
  return `Selected month ${formatMonth(rows.at(-1)?.month ?? null)}: ${last === null ? "—" : `${format2(last)} ${unit}`}. ${comparison} Minimum ${format2(minimum)} ${unit}; maximum ${format2(maximum)} ${unit}. The selected value ${direction}.`;
}

/** `sectionLabel`, when given, prints a small eyebrow line above the page
 *  title (reusing the dashboard-page's existing `.eyebrow` style) - used to
 *  group the facility energy/cost trend pages under "Facility Trend
 *  Analytics" (matching HistoricalCharts.tsx's exact dashboard naming).
 *  Supports 1..N series on one chart (single facility trend, or a
 *  self-vs-sibling comparison) - single-series rendering (path/point/label
 *  markup and count) is byte-identical to before multi-series support was
 *  added, so existing single-series pages/tests are unaffected. */
function trendPage(title: string, unit: string, series: TrendSeries[], rows: ReportMonthlyRow[], explanation: string, sectionLabel?: string): string {
  const eyebrow = sectionLabel ? `<p class="eyebrow">${escapeHtml(sectionLabel)}</p>` : "";
  const allValues = series.flatMap(s => s.values);
  const defined = allValues.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!defined.length) return `<section class="page trend-page">${eyebrow}<h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)}</p><p>No valid values are available for this selected reporting window.</p></section>`;
  const width = 1600, height = 810, left = 140, right = 80, top = 82, bottom = 110;
  const actualMin = Math.min(...defined), actualMax = Math.max(...defined), rawRange = actualMax - actualMin || Math.max(Math.abs(actualMax) * 0.2, 1);
  const domainMin = Math.min(0, actualMin - rawRange * 0.16), domainMax = actualMax + rawRange * 0.18;
  const range = domainMax - domainMin || 1;
  const x = (index: number) => left + (rows.length < 2 ? (width - left - right) / 2 : index * (width - left - right) / (rows.length - 1));
  const y = (value: number) => top + (domainMax - value) / range * (height - top - bottom);
  const grid = [0, 1, 2, 3, 4].map(step => {
    const value = domainMax - range * step / 4;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid"/><text x="${left - 14}" y="${y(value) + 6}" text-anchor="end" class="axis-tick">${escapeHtml(compactNumber(value, allValues))}</text>`;
  }).join("");
  const multi = series.length > 1;
  const seriesSvg = series.map((s, seriesIndex) => {
    let path = "";
    s.values.forEach((value, index) => { if (value !== null && Number.isFinite(value)) path += `${path ? " L" : "M"}${x(index)},${y(value)}`; });
    const points = s.values.map((value, index) => {
      if (value === null || !Number.isFinite(value)) return "";
      const pointY = y(value);
      const labelOffset = multi ? (seriesIndex % 2 === 0 ? -22 : 30) : (index % 2 === 0 ? -22 : 30);
      const labelY = Math.max(top + 20, Math.min(height - bottom - 10, pointY + labelOffset));
      const fillAttr = multi ? ` fill="${s.color}"` : "";
      return `<circle cx="${x(index)}" cy="${pointY}" r="6" fill="${s.color}"/><text x="${x(index)}" y="${labelY}" text-anchor="middle" class="point-value"${fillAttr}>${escapeHtml(compactNumber(value, allValues))}</text>`;
    }).join("");
    return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="5"/>${points}`;
  }).join("");
  const labels = rows.map((row, index) => `<text x="${x(index)}" y="${height - 48}" text-anchor="middle" class="month-label">${escapeHtml(formatMonth(row.month))}</text>`).join("");
  const legend = multi
    ? `<div class="trend-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join("")}</div>`
    : "";
  const details = multi
    ? series.map(s => `${escapeHtml(s.name)} — ${escapeHtml(trendSeriesDetails(unit, s.values, rows))}`).join(" ")
    : escapeHtml(trendSeriesDetails(unit, series[0]?.values ?? [], rows));
  return `<section class="page trend-page">${eyebrow}<h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)} · latest ${rows.length}-month window ending at ${escapeHtml(formatMonth(rows.at(-1)?.month ?? null))}</p>${legend}<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}${seriesSvg}${labels}</svg><p class="chart-explanation">${escapeHtml(explanation)} ${details}</p></section>`;
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

function reportRackStatusColor(status: string): string {
  switch (status) {
    case "In Use": return REPORT_PALETTE.rackInUse;
    case "Available": return REPORT_PALETTE.rackAvailable;
    case "Reserved": return REPORT_PALETTE.rackReserved;
    case "Pending Dismantle": return REPORT_PALETTE.rackPending;
    default: return REPORT_PALETTE.rackOther;
  }
}

/** Shared donut renderer for every proportional-ring chart in this report
 *  (Rack Capacity status, Rack Capacity Site Comparison, Rack Unit Capacity
 *  Used/Available). `color` on a segment overrides the stable report rack
 *  palette; `centerLabel`/`centerSubLabel` override the default
 *  "<total> / Total Racks" center text the same way. One renderer, no
 *  per-page duplicate SVG code. */
function donutSvg(segments: Array<{ name: string; count: number; ratio: number | null; color?: string }>, total: number, centerLabel?: string, centerSubLabel?: string): string {
  const size = 220, r = 78, cx = size / 2, cy = size / 2, circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter(s => s.count > 0)
    .map(s => {
      const fraction = total > 0 ? s.count / total : 0;
      const dash = `${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
      const rotate = offset * 360;
      offset += fraction;
      const color = s.color ?? reportRackStatusColor(s.name);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="34" stroke-dasharray="${dash}" transform="rotate(${rotate - 90} ${cx} ${cy})"/>`;
    })
    .join("");
  const primary = centerLabel ?? String(total);
  const secondary = centerSubLabel ?? "Total Racks";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Rack Status Distribution">${arcs}<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="700" fill="#29415d">${escapeHtml(primary)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#657488">${escapeHtml(secondary)}</text></svg>`;
}

/** The Rack Unit Capacity row for this report's single Reporting Month
 *  (`data.reportingMonth`, the same value that drives every other section
 *  of this PDF) - never "latest", so the PDF can't silently show a
 *  different month's numbers than the one the report claims to be about. */
function unitCapacityRowForReportingMonth(data: ReportData): RackUnitCapacityRow | null {
  if (!data.reportingMonth) return null;
  return data.rackUnitCapacity.find(row => row.month === data.reportingMonth) ?? null;
}

/** The Monthly Rack Unit Capacity Image figure (or placeholder) for one
 *  Rack Unit Capacity row - image bytes/metadata come exclusively from
 *  ImageStorageProvider via reportDataBuilder.ts
 *  (data.rackUnitCapacityImageDataUri/Meta); never a second image source,
 *  never the legacy Excel-embedded mechanisms. Same placeholder copy as
 *  the Dashboard (RackUnitCapacitySummary.tsx) for a missing image. */
function rackUnitCapacityImageFigure(data: ReportData, row: RackUnitCapacityRow): string {
  return data.rackUnitCapacityImageDataUri && data.rackUnitCapacityImageMeta
    ? `<figure class="rack-unit-capacity-image-figure">` +
      `<img src="${data.rackUnitCapacityImageDataUri}" alt="Rack Unit Capacity Image" class="rack-unit-capacity-image"/>` +
      `<figcaption class="rack-unit-capacity-image-caption">` +
      `<span>Reporting Month: ${escapeHtml(formatMonth(row.month))}</span>` +
      `<span>Captured By: ${escapeHtml(data.rackUnitCapacityImageMeta.savedBy)}</span>` +
      `<span>Captured Date: ${escapeHtml(formatTimestamp(new Date(data.rackUnitCapacityImageMeta.savedAt)))}</span>` +
      `<span>Resolution: ${data.rackUnitCapacityImageMeta.width}×${data.rackUnitCapacityImageMeta.height}px</span>` +
      `</figcaption></figure>`
    : `<div class="rack-unit-capacity-image-placeholder"><span>Rack Unit Capacity image not yet captured for this reporting month.</span></div>`;
}

/** Rack Unit Capacity and Utilization - the executive page restoring full
 *  Dashboard/PDF parity with RackUnitCapacitySummary.tsx: 2x3 KPI cards, a
 *  large Used/Available donut (left, ~60%), and the Monthly Rack Unit
 *  Capacity Image (right, ~40%). Every number/color/image comes from the
 *  same sources the Dashboard reads - unitCapacityRowForReportingMonth()
 *  above, findPreviousRackUnitCapacityRow()/trendCalculator.ts (shared with
 *  the Dashboard's own trend arrow), utilizationColorHex() (shared with the
 *  Capacity Health Gauge), the shared donutSvg() renderer above, and
 *  rackUnitCapacityImageFigure() above - no calculation, color, or image
 *  logic is reimplemented here. */
function renderRackUnitCapacityExecutivePage(data: ReportData): string {
  const subtitle = `${escapeHtml(data.facility)} · ${escapeHtml(formatMonth(data.reportingMonth))}`;
  if (data.rackUnitCapacity.length === 0) {
    return `<section class="page"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><p class="note">Rack Unit Capacity data is not yet available in this workbook.</p></section>`;
  }
  const row = unitCapacityRowForReportingMonth(data);
  if (!row) {
    return `<section class="page"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><p class="note">No Rack Unit Capacity data is available for the selected reporting month (${escapeHtml(formatMonth(data.reportingMonth))}).</p></section>`;
  }
  const previousRow = findPreviousRackUnitCapacityRow(data.rackUnitCapacity, row.month);
  const usagePctNow = usagePercent(row);
  const usagePctPrev = previousRow ? usagePercent(previousRow) : null;
  const trendDirection = usagePctNow !== null && usagePctPrev !== null ? getTrendDirection(calculatePercentageDelta(usagePctNow, usagePctPrev), 0.05) : null;
  const trendValue = trendDirection === null || usagePctNow === null || usagePctPrev === null
    ? "—"
    : `${trendDirection === "Up" ? "▲" : trendDirection === "Down" ? "▼" : "◆"} ${Math.abs(calculatePercentageDelta(usagePctNow, usagePctPrev)).toFixed(1)}%`;
  const trendNote = trendDirection === null ? "no prior month" : getTrendLabel(trendDirection, "en");
  const availabilityText = formatRatioPercent(row.availabilityPct);
  const kpis = [
    kpi("Total (U)", String(row.totalU), "U", ""),
    kpi("Used (U)", String(row.usedU), "U", ""),
    kpi("Available (U)", String(row.availableU), "U", ""),
    kpi("Availability %", availabilityText, "", ""),
    kpi("Usage %", usagePctNow === null ? "—" : `${usagePctNow.toFixed(1)}%`, "", ""),
    kpi("Trend vs Previous Month", trendValue, "", trendNote)
  ].join("");
  const donut = donutSvg(
    [
      { name: "Used", count: row.usedU, ratio: null, color: REPORT_PALETTE.rackInUse },
      { name: "Available", count: Math.max(0, row.availableU), ratio: null, color: REPORT_PALETTE.rackAvailable }
    ],
    row.totalU,
    `${row.usedU} / ${row.totalU}`,
    "Used / Total (U)"
  );
  const legend = `<div class="legend-row"><i style="background:${REPORT_PALETTE.rackInUse}"></i><span>Used (U)</span><strong>${row.usedU}</strong></div>` +
    `<div class="legend-row"><i style="background:${REPORT_PALETTE.rackAvailable}"></i><span>Available (U)</span><strong>${row.availableU}</strong></div>` +
    `<div class="legend-row"><i style="background:${REPORT_PALETTE.rackTotal}"></i><span>Total (U)</span><strong>${row.totalU}</strong></div>`;
  return `<section class="page"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><div class="kpis-3col">${kpis}</div><div class="rack-unit-capacity-layout"><div class="ruc-left"><div class="block gauge-row">${donut}<div class="gauge-caption">${legend}</div></div></div><div class="ruc-right">${rackUnitCapacityImageFigure(data, row)}</div></div></section>`;
}

/** Half-donut gauge arc: a track path drawn once in a neutral color, then
 *  the same path redrawn in the health color with a dasharray clipped to
 *  `utilizationPct` of the semicircle's length - the same left-to-right
 *  180°->0° sweep as the dashboard's recharts gauge (CapacityGauge.tsx). */
function gaugeSvg(utilizationPct: number, color: string): string {
  const size = 280, r = 104, strokeWidth = 28, cx = size / 2, cy = 132;
  const circumference = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, utilizationPct));
  const filled = (clamped / 100) * circumference;
  const arc = `M ${(cx - r).toFixed(2)} ${cy} A ${r} ${r} 0 0 1 ${(cx + r).toFixed(2)} ${cy}`;
  return `<svg width="${size}" height="${cy + 18}" viewBox="0 0 ${size} ${cy + 18}" role="img" aria-label="Capacity Health Gauge"><path d="${arc}" fill="none" stroke="#e7dcd6" stroke-width="${strokeWidth}" stroke-linecap="round"/><path d="${arc}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${circumference.toFixed(2)}"/><text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="36" font-weight="700" fill="${color}">${clamped.toFixed(1)}%</text></svg>`;
}

/** Capacity Health Gauge - color/label/score come exclusively from
 *  capacityHealth.ts + capacityForecast.ts (the exact functions the live
 *  dashboard's CapacityGauge.tsx uses), never re-derived here. Utilization
 *  prefers the Reporting Month's saved Rack Unit Capacity row, falling back
 *  to rack-count In Use % - same fallback order as the dashboard. */
function capacityGaugeBlock(data: ReportData): string {
  if (!data.rack || data.rack.records.length === 0) return "";
  const metrics = calculateRackCapacityMetrics(data.rack.records);
  const unitRow = unitCapacityRowForReportingMonth(data);
  const utilization = unitRow && unitRow.totalU > 0 ? (unitRow.usedU / unitRow.totalU) * 100 : metrics.inUse.ratio !== null ? metrics.inUse.ratio * 100 : 0;
  const healthScore = calculateCapacityHealthScore({
    usageRatio: metrics.inUse.ratio,
    availabilityRatio: metrics.available.ratio,
    reservedRatio: metrics.reserved.ratio,
    pendingDismantleRatio: metrics.pendingDismantle.ratio
  });
  const health = getCapacityHealth(healthScore, 75, 90);
  const color = utilizationColorHex(healthScore);
  const sourceNote = unitRow
    ? `From saved Rack Unit Capacity: ${unitRow.usedU} / ${unitRow.totalU} U used.`
    : `From rack counts in use: ${metrics.inUse.count} of ${metrics.total} (${formatRatioPercent(metrics.inUse.ratio)}).`;
  return `<article class="block"><h3>Capacity Health Gauge</h3><div class="gauge-row">${gaugeSvg(utilization, color)}<div class="gauge-caption"><p class="gauge-health-label" style="color:${color}">${health}</p><p class="note">Weighted Health Score: ${healthScore.toFixed(0)}/100</p><p class="note">${escapeHtml(sourceNote)}</p></div></div></article>`;
}

/** One utilization-colored tile per Rack Zone - same shared gradient
 *  (utilizationColorHex) and WCAG AA text-contrast helper
 *  (getAccessibleTextColor) as the dashboard's ZoneHeatmap.tsx. */
function zoneHeatmapBlock(data: ReportData): string {
  if (!data.rack || data.rack.records.length === 0) return "";
  const metrics = calculateRackCapacityMetrics(data.rack.records);
  if (metrics.zoneMetrics.length === 0) return "";
  const tiles = metrics.zoneMetrics
    .map(zone => {
      const utilizationPct = zone.inUse.ratio !== null ? zone.inUse.ratio * 100 : null;
      const bg = utilizationColorHex(utilizationPct);
      const textColor = getAccessibleTextColor(bg);
      return `<div class="heatmap-tile" style="background:${bg};color:${textColor}"><p class="heatmap-zone">${escapeHtml(zone.zone)}</p><p class="heatmap-pct">${formatRatioPercent(zone.inUse.ratio, 0)}</p><p class="heatmap-detail">${zone.total} racks &middot; avail ${formatRatioPercent(zone.available.ratio, 0)}</p></div>`;
    })
    .join("");
  return `<article class="block"><h3>Zone Heatmap</h3><div class="heatmap-grid">${tiles}</div></article>`;
}

function capacityHealthPage(data: ReportData): string {
  const gauge = capacityGaugeBlock(data);
  const heatmap = zoneHeatmapBlock(data);
  if (!gauge && !heatmap) return "";
  return `<section class="page"><h2>Capacity Health and Zone Heatmap</h2>${gauge}${heatmap}</section>`;
}

function rackComparisonRow(label: string, m: RackCapacityMetrics): string[] {
  return [
    escapeHtml(comparisonFacilityLabel(label)),
    String(m.total),
    `${m.inUse.count} (${formatRatioPercent(m.inUse.ratio, 1)})`,
    `${m.available.count} (${formatRatioPercent(m.available.ratio, 1)})`,
    `${m.reserved.count} (${formatRatioPercent(m.reserved.ratio, 1)})`,
    `${m.pendingDismantle.count} (${formatRatioPercent(m.pendingDismantle.ratio, 1)})`
  ];
}

/** One facility's pie + legend for the Rack Capacity Site Comparison page.
 *  Reuses donutSvg() and the stable export rack-status palette for every
 *  swatch, so the same status always has the same printed color. */
function rackComparisonDonutBlock(label: string, metrics: RackCapacityMetrics): string {
  const segments = [
    { name: "In Use", count: metrics.inUse.count, ratio: metrics.inUse.ratio },
    { name: "Available", count: metrics.available.count, ratio: metrics.available.ratio },
    { name: "Reserved", count: metrics.reserved.count, ratio: metrics.reserved.ratio },
    { name: "Pending Dismantle", count: metrics.pendingDismantle.count, ratio: metrics.pendingDismantle.ratio },
    { name: "Other", count: metrics.other.count, ratio: metrics.other.ratio }
  ];
  const legend = segments
    .filter(s => s.count > 0)
    .map(s => `<div class="legend-row"><i style="background:${reportRackStatusColor(s.name)}"></i><span>${escapeHtml(s.name)}</span><strong>${s.count} (${formatRatioPercent(s.ratio, 1)})</strong></div>`)
    .join("");
  return `<div class="rack-comparison-donut"><h3>${escapeHtml(comparisonFacilityLabel(label))}</h3>${donutSvg(segments, metrics.total)}<div class="rack-comparison-legend">${legend}</div></div>`;
}

/** Comparison-only label rule. Normal report cover/facility titles retain the
 * configured long display name; only the two-site comparison context removes
 * the redundant "Data Center" suffix. */
function comparisonFacilityLabel(label: string): string {
  return label.replace(/\s+Data Center\b/gi, "").trim();
}

/** Rack Capacity Site Comparison - self vs sibling facility, current (live)
 *  Rack Capacity state. Deliberately named distinctly from the existing
 *  energy "Site Comparison" page (comparisonPage below) - the two compare
 *  different business dimensions and must not be conflated into one page.
 *  Top: one pie per facility; bottom: the comparison table. */
function rackComparisonPage(data: ReportData): string {
  if (!data.rackComparison) return "";
  const { self, other } = data.rackComparison;
  const selfMetrics = calculateRackCapacityMetrics(self.records);
  const rows: string[][] = [rackComparisonRow(self.label, selfMetrics)];
  const donuts = [rackComparisonDonutBlock(self.label, selfMetrics)];
  if (other) {
    const otherMetrics = calculateRackCapacityMetrics(other.records);
    rows.push(rackComparisonRow(other.label, otherMetrics));
    donuts.push(rackComparisonDonutBlock(other.label, otherMetrics));
  }
  const note = other ? "" : `<p class="note">Only ${escapeHtml(comparisonFacilityLabel(self.label))} is shown — the sibling facility's Rack Capacity data was unavailable for this export.</p>`;
  return `<section class="page"><h2>Rack Capacity Site Comparison</h2><div class="rack-comparison-donuts">${donuts.join("")}</div>${table(["Facility", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle"], rows)}${note}</section>`;
}

function rackCapacityPage(data: ReportData): string {
  if (!data.rack || data.rack.records.length === 0) {
    return `<section class="page"><h2>Rack Capacity and Utilization</h2><p class="note">Rack capacity data is unavailable in this workbook.</p></section>`;
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
  return `<section class="page"><h2>Rack Capacity and Utilization</h2><p class="note">${escapeHtml(data.facility)} · Usage ${formatRatioPercent(metrics.inUse.ratio)} · Availability ${formatRatioPercent(metrics.available.ratio)}</p><div class="kpis">${kpis}</div><div class="rack-donut-row"><div>${donut}</div><div class="table-wrap" style="flex:1"><table><thead><tr><th class="left">Rack Zone</th><th>In Use</th><th>Available</th><th>Reserved</th><th>Pending Dismantle</th><th>Total</th></tr></thead><tbody>${zoneRows.map(row => `<tr>${row.map((cell, i) => `<td${i === 0 ? " class=\"left\"" : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div></section>`;
}

/** Stable export-only facility colors. Match by name so long display labels
 *  such as "Rangsit Data Center" still receive distinct site colors. */
function siteColour(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("rangsit")) return REPORT_PALETTE.siteRangsit;
  if (normalized.includes("srinakarin")) return REPORT_PALETTE.siteSrinakarin;
  return REPORT_PALETTE.siteOther;
}

/** Monthly Energy Consumption Trend + Floor 4 Electricity Cost Trend -
 *  reuses the exact data (buildingEnergyKwh/floorCostThb, the same fields
 *  FacilityComparison.tsx's chartData plots) and the shared trendPage()
 *  multi-series renderer, never a second chart implementation. Self and
 *  sibling share one x-axis (`selfTrend`'s own month window); sibling
 *  values are looked up per month and left null where the sibling has no
 *  record, never fabricated. Omitted entirely when the sibling is
 *  unavailable AND self has fewer than 2 months (nothing meaningful to
 *  plot) - a single-facility trend still renders otherwise. */
function comparisonTrendPages(data: ReportData): string {
  if (!data.comparison) return "";
  const { self, other, selfTrend, otherTrend } = data.comparison;
  if (selfTrend.length < 2) return "";
  const otherByMonth = new Map(otherTrend.map(row => [row.month, row] as const));
  const buildSeries = (metric: "buildingEnergyKwh" | "floorCostThb"): TrendSeries[] => {
    const series: TrendSeries[] = [{ name: comparisonFacilityLabel(self.label), color: siteColour(self.label), values: selfTrend.map(row => row[metric]) }];
    if (other) {
      series.push({ name: comparisonFacilityLabel(other.label), color: siteColour(other.label), values: selfTrend.map(row => otherByMonth.get(row.month)?.[metric] ?? null) });
    }
    return series;
  };
  return (
    trendPage(
      "Monthly Energy Consumption Trend",
      "kWh",
      buildSeries("buildingEnergyKwh"),
      selfTrend,
      "Whole-building monthly energy for the selected reporting window, self vs. sibling facility.",
      "SITE COMPARISON"
    ) +
    trendPage(
      "Floor 4 Electricity Cost Trend",
      "THB",
      buildSeries("floorCostThb"),
      selfTrend,
      "Estimated 4th Floor electricity cost for the selected reporting window, self vs. sibling facility.",
      "SITE COMPARISON"
    )
  );
}

function comparisonPage(data: ReportData): string {
  if (!data.comparison) return "";
  const { self, other } = data.comparison;
  const rows: string[][] = [comparisonRow(self)];
  if (other) rows.push(comparisonRow(other));
  const note = other
    ? ""
    : `<p class="note">Only ${escapeHtml(comparisonFacilityLabel(self.label))} is shown — the sibling facility's workbook was unavailable for this export.</p>`;
  return `${comparisonTrendPages(data)}<section class="page"><h2>Site Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(self.month))}</p>${table(["Facility", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"], rows)}${note}</section>`;
}
function comparisonRow(facility: ReportComparisonFacility): string[] {
  return [
    escapeHtml(comparisonFacilityLabel(facility.label)),
    format2(facility.buildingEnergyKwh),
    format2(facility.buildingCostThb),
    format2(facility.floorEnergyKwh),
    format2(facility.floorCostThb),
    format2(facility.averageRateThbPerKwh),
    facility.floorSharePercent === null ? "—" : `${format2(facility.floorSharePercent)}%`
  ];
}

export type ReportRenderSection =
  | "executive"
  | "dashboard"
  | "rack-capacity"
  | "rack-unit-capacity"
  | "ups"
  | "air-conditioning"
  | "dc"
  | "historical"
  | "site-comparison"
  | "appendix";

export interface ReportRenderOptions {
  /** Omit to preserve the Desktop All Report output. */
  sections?: readonly ReportRenderSection[];
}

export function buildReportHtml(data: ReportData, options: ReportRenderOptions = {}): string {
  const range = `${formatMonth(data.historicalStart)} – ${formatMonth(data.historicalEnd)}`;
  const selected = options.sections ? new Set(options.sections) : null;
  const has = (...sections: ReportRenderSection[]) => selected === null || sections.some(section => selected.has(section));
  const dashboard = data.engineeringDashboard && has("executive", "dashboard") ? engineeringDashboard(data, data.engineeringDashboard) : "";
  const trendPages: Array<[ReportRenderSection[], string, string, string, Array<number | null>, string]> = [
    [["historical", "executive"], "Total 4th Floor Energy Trend", "kWh", REPORT_PALETTE.energy, data.monthlyRows.map(row => row.floorEnergyKwh), "Monthly total 4th Floor energy for the selected reporting window."],
    [["ups", "historical", "executive"], "UPS System Energy Trend", "kWh", REPORT_PALETTE.ups, data.monthlyRows.map(row => row.upsEnergyKwh), "Monthly UPS system energy utilization."],
    [["air-conditioning", "historical", "executive"], "Air Conditioning Energy Trend", "kWh", REPORT_PALETTE.air, data.monthlyRows.map(row => row.airEnergyKwh), "Meter-difference energy; gaps indicate an unavailable prior reading."],
    [["dc", "historical", "executive"], "DC Power Panel Energy Trend", "kWh", REPORT_PALETTE.dc, data.monthlyRows.map(row => row.dcEnergyKwh), "Monthly DC panel energy estimate."],
    [["historical", "executive"], "Estimated 4th Floor Cost Trend", "THB", REPORT_PALETTE.cost, data.monthlyRows.map(row => row.floorCostThb), "Estimated cost at the building average electricity rate."],
    [["historical", "executive"], "Building Average Electricity Rate Trend", "THB/kWh", REPORT_PALETTE.rate, data.monthlyRows.map(row => row.averageRateThbPerKwh), "Building electricity cost divided by building energy."],
  ];
  const renderedTrendPages = trendPages
    .filter(([sections]) => has(...sections))
    .map(([, title, unit, color, values, explanation]) => trendPage(title, unit, [{ name: title, color, values }], data.monthlyRows, explanation, "FACILITY TREND ANALYTICS"))
    .join("");
  const monthly = has("executive", "historical") ? `<section class="page"><h2>Monthly Energy &amp; Cost Table</h2>${monthlyTable(data.monthlyRows)}</section>` : "";
  const comparison = has("site-comparison") ? comparisonPage(data) : "";
  const rackUnit = has("rack-unit-capacity") ? renderRackUnitCapacityExecutivePage(data) : "";
  const rack = has("rack-capacity") ? `${rackCapacityPage(data)}${rackUnit}${capacityHealthPage(data)}${rackComparisonPage(data)}` : "";
  const standaloneRackUnit = has("rack-capacity") ? "" : rackUnit;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>
@page{size:A4 landscape;margin:8mm 9mm 12mm}*{box-sizing:border-box}html,body{margin:0;color:#243247;background:#fff;font:12px/1.3 ${FONT_STACK}}.cover{height:180mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}.cover h1{font-size:34px;margin:0;color:#29415d}.cover h2{font-size:20px;font-weight:400;color:#7c6a68}.meta{margin-top:16px;border-top:1px solid #e6d9d2;padding-top:12px;color:#5f6f82}.page{page-break-before:always;padding-top:1mm}.page h2{font-size:23px;margin:0 0 7px;color:#29415d;border-bottom:2px solid #e8d7d0;padding-bottom:5px}.page h3{font-size:16px;color:#3e5874;margin:0 0 6px}.dashboard-head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e8d7d0;padding-bottom:8px}.dashboard-head h2{border:0;padding:0;margin:0}.dashboard-head p{margin:3px 0;color:#5f6f82}.eyebrow{font-size:9px!important;font-weight:bold;letter-spacing:1px;color:#a25e4c!important}.dashboard-tag{font-size:10px;text-align:right;color:#52687f;border-left:1px solid #e7d9d2;padding-left:12px}.continuation{font-size:10px;font-weight:bold;color:#68798a;border-bottom:1px solid #e7d9d2;padding-bottom:4px;margin-bottom:7px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:9px 0}.kpi{min-height:74px;padding:9px;background:#f5eee9;border:1px solid #e7d9d2;border-radius:6px;break-inside:avoid}.kpi-label{font-size:10px;color:#67788b;text-transform:uppercase;font-weight:bold}.kpi-value{font-size:21px;font-weight:700;margin-top:5px;color:#29415d}.kpi-unit,.kpi-note,.note{font-size:10px;color:#64758a}.kpi-note{margin-top:3px}.block{margin:9px 0;padding:9px;border:1px solid #e7dcd6;border-radius:6px;break-inside:avoid}.note{margin:6px 0 0}.table-wrap{margin:4px 0;overflow:hidden}table{border-collapse:collapse;width:100%;font-size:10px}th,td{padding:4px;border:1px solid #eadfda;text-align:right;vertical-align:top}td.left,th:first-child{text-align:left}th{background:#eee3dd;color:#40566e;font-weight:bold}.dense table{font-size:8.5px}.dense th,.dense td{padding:3px}.ups-comparison{display:grid;gap:7px;margin-top:8px}.ups-bar-row{display:grid;grid-template-columns:90px 1fr 52px;gap:8px;align-items:center;font-size:11px}.ups-bar-row strong{text-align:right}.ups-track{height:10px;background:#edf1f5;border-radius:99px;overflow:hidden}.ups-track i{display:block;height:100%;border-radius:99px;background:${REPORT_PALETTE.ups}}.ups-track i.medium{background:${REPORT_PALETTE.rate}}.ups-track i.high{background:${REPORT_PALETTE.pue}}.trend-page{height:183mm;display:flex;flex-direction:column}.trend-page h2{font-size:26px;margin-bottom:2px}.chart-unit{margin:0 0 5px;color:#657488;font-size:12px}.trend-svg{width:100%;height:142mm;flex:1;overflow:visible}.grid{stroke:#dce4ea;stroke-width:1}.axis-tick,.month-label,.point-value{fill:#44566b;font-family:${FONT_STACK}}.axis-tick{font-size:20px}.month-label{font-size:19px}.point-value{font-size:19px;font-weight:bold}.chart-explanation{margin:2px 5mm 0;font-size:12px;color:#52687f;text-align:center}.trend-legend{display:flex;gap:18px;margin:0 0 4px}.trend-legend span{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#3e5874;font-weight:600}.trend-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}.rack-donut-row{display:flex;gap:16px;align-items:flex-start;margin-top:8px}.rack-comparison-donuts{display:flex;gap:32px;justify-content:center;margin:10px 0 16px}.rack-comparison-donut{text-align:center}.rack-comparison-donut h3{margin-bottom:4px}.rack-comparison-legend{display:flex;flex-direction:column;gap:3px;margin-top:8px;text-align:left}.legend-row{display:flex;align-items:center;gap:6px;font-size:10px;color:#3e5874}.legend-row i{width:10px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0}.legend-row strong{margin-left:auto;font-weight:700}.rack-unit-capacity-image-figure{margin:8px 0 0;display:inline-block}.rack-unit-capacity-image{display:block;max-width:260px;max-height:150px;object-fit:contain;border:1px solid #e7dcd6;border-radius:8px;box-shadow:0 1px 3px rgba(41,65,93,.12)}.rack-unit-capacity-image-caption{display:flex;flex-direction:column;gap:1px;margin-top:5px;font-size:9px;color:#657488}.rack-unit-capacity-image-placeholder{margin-top:8px;width:260px;height:150px;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;border:1px dashed #cfc0b8;border-radius:8px;background:#f8f3f0;color:#8a7d78;font-size:10px}.gauge-row{display:flex;align-items:center;gap:20px;margin-top:6px}.gauge-caption{flex:1}.gauge-health-label{font-size:20px;font-weight:700;margin:0 0 4px}.heatmap-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px}.heatmap-tile{border-radius:8px;padding:8px}.heatmap-zone{font-size:12px;font-weight:700;margin:0}.heatmap-pct{font-size:18px;font-weight:700;margin:2px 0}.heatmap-detail{font-size:9px;margin:0;opacity:.9}.kpis-3col{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:9px 0}.rack-unit-capacity-layout{display:flex;gap:16px;align-items:stretch;margin-top:4px}.rack-unit-capacity-layout .ruc-left{flex:3}.rack-unit-capacity-layout .ruc-right{flex:2}.rack-unit-capacity-layout .rack-unit-capacity-image-figure,.rack-unit-capacity-layout .rack-unit-capacity-image-placeholder{width:100%;max-width:none;height:100%;min-height:90mm}.rack-unit-capacity-layout .rack-unit-capacity-image{max-width:100%;max-height:82mm;width:100%}
</style></head><body><main class="cover"><h1>${escapeHtml(data.title)}</h1><h2>${escapeHtml(data.thaiSubtitle)}</h2><div class="meta">Facility: ${escapeHtml(data.facility)}<br>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}<br>Historical range: ${escapeHtml(range)}<br>Source workbook: ${escapeHtml(data.sourceWorkbook)}<br>Application version: ${escapeHtml(data.appVersion)}</div></main>${dashboard}${renderedTrendPages}${monthly}${comparison}${rack}${standaloneRackUnit}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}
