import type { EngineeringDashboardSnapshot, ReportComparisonFacility, ReportData, ReportMonthlyRow } from "../reportTypes";
import { RACK_UNIT_CAPACITY_TREND_NOTE, type ComparisonMetric, type SiteComparisonReportModel } from "../reportTypes";
import { formatGWh, formatNumber } from "../../utils/numberFormatBridge";
import { formatTimestamp } from "../../utils";
import { calculateRackCapacityMetrics, formatRatioPercent, RackCapacityMetrics, rackPositionExportRows } from "../../utils/rackCapacity";
import type { RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import { calculateCapacityHealthScore, utilizationColorHex } from "../../utils/capacityHealth";
import { getCapacityHealth } from "../../utils/capacityForecast";
import { getAccessibleTextColor } from "../../utils/colorContrast";
import { findPreviousRackUnitCapacityRow, usagePercent } from "../../utils/rackUnitCapacity";
import { calculatePercentageDelta, getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";
import type { ReportSectionId } from "../../reporting/reportingTypes";
import { isValidRackUnitCapacity, rackAvailabilityStatus } from "../../domain/rackComparison";

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

/** The complete report stylesheet, extracted verbatim from the Desktop
 *  `buildReportHtml` document so the DOM-free All Facilities builder can
 *  embed a character-identical `<style>` body. Keeps its
 *  `${REPORT_PALETTE.*}` / `${FONT_STACK}` interpolations. */
export const REPORT_CSS = `
@page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;color:#243247;background:#fff;font:12px/1.3 ${FONT_STACK}}.cover,.page{width:1123px;min-height:794px;margin:0;background:#fff}.cover{padding:64px 72px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}.cover h1{font-size:34px;margin:0;color:#29415d}.cover h2{font-size:20px;font-weight:400;color:#7c6a68}.meta{margin-top:16px;border-top:1px solid #e6d9d2;padding-top:12px;color:#5f6f82}.page{page-break-before:always;padding:34px 40px 38px}.page h2{font-size:23px;margin:0 0 7px;color:#29415d;border-bottom:2px solid #e8d7d0;padding-bottom:5px}.page h3{font-size:16px;color:#3e5874;margin:0 0 6px}.dashboard-head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e8d7d0;padding-bottom:8px}.dashboard-head h2{border:0;padding:0;margin:0}.dashboard-head p{margin:3px 0;color:#5f6f82}.eyebrow{font-size:9px!important;font-weight:bold;letter-spacing:1px;color:#a25e4c!important}.dashboard-tag{font-size:10px;text-align:right;color:#52687f;border-left:1px solid #e7d9d2;padding-left:12px}.continuation{font-size:10px;font-weight:bold;color:#68798a;border-bottom:1px solid #e7d9d2;padding-bottom:4px;margin-bottom:7px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:9px 0}.kpi{min-height:74px;padding:9px;background:#f5eee9;border:1px solid #e7d9d2;border-radius:6px;break-inside:avoid}.kpi-label{font-size:10px;color:#67788b;text-transform:uppercase;font-weight:bold}.kpi-value{font-size:21px;font-weight:700;margin-top:5px;color:#29415d}.kpi-unit,.kpi-note,.note{font-size:10px;color:#64758a}.kpi-note{margin-top:3px}.block{margin:9px 0;padding:9px;border:1px solid #e7dcd6;border-radius:6px;break-inside:avoid}.capacity-health-page .block{margin:10px 0;padding:12px}.capacity-health-page .gauge-row{min-height:165px;gap:28px;align-items:center}.capacity-health-page .gauge-row svg{flex:0 0 auto}.capacity-health-page .heatmap-grid{grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.note{margin:6px 0 0}.table-wrap{margin:4px 0;overflow:hidden}table{border-collapse:collapse;width:100%;font-size:10px}th,td{padding:4px;border:1px solid #eadfda;text-align:right;vertical-align:top}td.left,th:first-child{text-align:left}th{background:#eee3dd;color:#40566e;font-weight:bold}.dense table{font-size:8.5px}.dense th,.dense td{padding:3px}.ups-comparison{display:grid;gap:7px;margin-top:8px}.ups-bar-row{display:grid;grid-template-columns:90px 1fr 52px;gap:8px;align-items:center;font-size:11px}.ups-bar-row strong{text-align:right}.ups-track{height:10px;background:#edf1f5;border-radius:99px;overflow:hidden}.ups-track i{display:block;height:100%;border-radius:99px;background:${REPORT_PALETTE.ups}}.ups-track i.medium{background:${REPORT_PALETTE.rate}}.ups-track i.high{background:${REPORT_PALETTE.pue}}.trend-page{height:183mm;display:flex;flex-direction:column}.trend-page h2{font-size:26px;margin-bottom:2px}.chart-unit{margin:0 0 5px;color:#657488;font-size:12px}.trend-svg{width:100%;height:142mm;flex:1;overflow:visible}.grid{stroke:#dce4ea;stroke-width:1}.axis-tick,.month-label,.point-value{fill:#44566b;font-family:${FONT_STACK}}.axis-tick{font-size:20px}.month-label{font-size:19px}.point-value{font-size:19px;font-weight:bold}.chart-explanation{margin:2px 5mm 0;font-size:12px;color:#52687f;text-align:center}.trend-legend{display:flex;gap:18px;margin:0 0 4px}.trend-legend span{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#3e5874;font-weight:600}.trend-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}.rack-donut-row{display:flex;gap:16px;align-items:flex-start;margin-top:8px}.rack-comparison-donuts{display:flex;gap:32px;justify-content:center;margin:10px 0 16px}.rack-comparison-donut{text-align:center}.rack-comparison-donut h3{margin-bottom:4px}.rack-comparison-legend{display:flex;flex-direction:column;gap:3px;margin-top:8px;text-align:left}.legend-row{display:flex;align-items:center;gap:6px;font-size:10px;color:#3e5874}.legend-row i{width:10px;height:10px;border-radius:3px;display:inline-block;flex-shrink:0}.legend-row strong{margin-left:auto;font-weight:700}.rack-unit-capacity-image-figure{margin:8px 0 0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;max-width:100%}.rack-unit-capacity-image{display:block;width:auto;height:auto;max-width:100%;max-height:150px;object-fit:contain;border:1px solid #e7dcd6;border-radius:8px;box-shadow:0 1px 3px rgba(41,65,93,.12)}.rack-unit-capacity-image-caption{display:flex;flex-direction:column;gap:1px;margin-top:5px;font-size:9px;color:#657488}.rack-unit-capacity-image-placeholder{margin-top:8px;width:260px;height:150px;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;border:1px dashed #cfc0b8;border-radius:8px;background:#f8f3f0;color:#8a7d78;font-size:10px}.gauge-row{display:flex;align-items:center;gap:20px;margin-top:6px}.gauge-caption{flex:1}.gauge-health-label{font-size:20px;font-weight:700;margin:0 0 4px}.heatmap-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px}.heatmap-tile{border-radius:8px;padding:8px}.heatmap-zone{font-size:12px;font-weight:700;margin:0}.heatmap-pct{font-size:18px;font-weight:700;margin:2px 0}.heatmap-detail{font-size:9px;margin:0;opacity:.9}.kpis-3col{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:9px 0}.rack-unit-capacity-layout{display:flex;gap:16px;align-items:stretch;margin-top:4px}.rack-unit-capacity-layout .ruc-left{flex:3;min-width:0}.rack-unit-capacity-layout .ruc-right{flex:2;min-width:0;display:flex;align-items:center;justify-content:center}.rack-unit-capacity-layout .rack-unit-capacity-image-figure,.rack-unit-capacity-layout .rack-unit-capacity-image-placeholder{width:100%;max-width:100%;height:auto;min-height:90mm}.rack-unit-capacity-layout .rack-unit-capacity-image{max-width:100%;max-height:82mm;width:auto;height:auto}.facility-band{display:flex;align-items:center;justify-content:center;text-align:center}.facility-band h2{font-size:34px;border:0;margin:0;color:#29415d}
.facility-trends-page{padding-top:28px}.facility-trends-grid{display:grid;grid-template-columns:1fr;gap:8px}.mini-trend{border:1px solid #e7dcd6;border-radius:7px;padding:8px 10px;break-inside:avoid}.mini-trend h2{font-size:20px;border:0;padding:0;margin:0 0 2px}.mini-trend .chart-unit{font-size:11.5px;margin-bottom:2px}.mini-trend .trend-svg{height:70mm;display:block}.mini-trend .axis-tick{font-size:26px}.mini-trend .month-label,.mini-trend .point-value{font-size:24px}.mini-trend .chart-explanation{font-size:11.5px;line-height:1.35;margin-top:2px}.mini-trend .trend-legend span{font-size:11.5px}
.appendix-page table{font-size:11px}.appendix-page th,.appendix-page td{padding:6px 5px}.appendix-intro{display:flex;justify-content:space-between;gap:16px;margin:10px 0 14px;padding:12px 14px;background:#f7f2ee;border:1px solid #e7d9d2;border-radius:7px}.appendix-intro strong{font-size:14px;color:#29415d}.appendix-intro span{color:#657488}
.positions table{font-size:10.5px}.positions th,.positions td{padding:5px}.rack-position-page .continuation{margin-top:-2px}.rack-unit-capacity-layout .rack-unit-capacity-image-placeholder{min-height:48mm;height:48mm}.rack-unit-capacity-layout .ruc-right:has(.rack-unit-capacity-image-placeholder){align-items:flex-start;padding-top:12px}.rack-unit-capacity-image-page-content{height:150mm;display:flex;align-items:center;justify-content:center;padding:8mm 12mm}.rack-unit-capacity-image-page-content .rack-unit-capacity-image-figure{width:100%;height:100%;margin:0}.rack-unit-capacity-image-page-content .rack-unit-capacity-image{max-width:100%;max-height:138mm;width:auto;height:auto}.rack-unit-capacity-image-page-content .rack-unit-capacity-image-placeholder{width:75%;height:90mm;font-size:13px}.rack-unit-capacity-image-page-content .rack-unit-capacity-image-caption{font-size:11px;margin-top:7px}
.capacity-health-page .zone-summary table{font-size:10.5px}.capacity-health-page .zone-summary th,.capacity-health-page .zone-summary td{padding:5px}
`;

export function facilityBandPage(facilityName: string): string {
  return `<section class="page facility-band" data-report-section="facility-header"><h2>Facility: ${escapeHtml(facilityName)}</h2></section>`;
}

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


function formatInteger(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
}

function formatRatioPercent1(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : (value * 100).toFixed(1) + "%";
}

function formatUsagePercent1(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(1) + "%";
}

function rackPositionsTable(records: NonNullable<ReportData["rack"]>["records"]): string {
  const headers = ["Status", "Rack ID", "Cabinet Size (cm)", "Detail"];
  const rows = rackPositionExportRows(records).map(row => [
    escapeHtml(row.status),
    escapeHtml(row.rackId ?? "—"),
    escapeHtml(row.cabinetSize ?? "—"),
    escapeHtml(row.detail ?? "—")
  ]);
  if (rows.length === 0) {
    return table(headers, [["—", "—", "—", "No Available, Reserved, or Pending Decommission rack positions in the confirmed snapshot."]], "dense");
  }
  return table(headers, rows, "dense");
}

function rackUnitTrendRows(data: ReportData): RackUnitCapacityRow[] {
  const endMonth = data.reportingMonth;
  return [...data.rackUnitCapacity]
    .filter(row => !endMonth || row.month <= endMonth)
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-6);
}


function rackUnitTrendPage(data: ReportData): string {
  const rows = rackUnitTrendRows(data);
  if (rows.length === 0) return "";
  const renderedRows = rows.map(row => [
    escapeHtml(formatMonth(row.month)),
    formatInteger(row.totalU),
    formatInteger(row.usedU),
    formatInteger(row.availableU),
    formatUsagePercent1(usagePercent(row)),
    formatRatioPercent1(row.availabilityPct)
  ]);
  return '<section class="page" data-report-section="rack-unit-capacity"><h2>Rack Unit Capacity Six-Month Trend</h2><p class="note">' +
    escapeHtml(data.facility) + ' · ' + escapeHtml(formatMonth(data.reportingMonth)) +
    '</p>' + table(["Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"], renderedRows) +
    '<p class="note">Six-month trend uses the selected reporting month and up to five preceding persisted monthly Rack Unit snapshots.</p>' +
    '<p class="note">' + escapeHtml(RACK_UNIT_CAPACITY_TREND_NOTE) + '</p></section>';
}

function rackUnitComparisonPage(data: ReportData): string {
  const sites = data.rackUnitComparison?.sites ?? [];
  const populated = sites.filter(site => site.rows.length > 0);
  if (populated.length === 0) return "";
  const selectedRows = populated.flatMap(site => site.rows.filter(row => row.month === data.reportingMonth).map(row => [
    escapeHtml(site.label),
    escapeHtml(formatMonth(row.month)),
    formatInteger(row.totalU),
    formatInteger(row.usedU),
    formatInteger(row.availableU),
    formatUsagePercent1(usagePercent(row)),
    formatRatioPercent1(row.availabilityPct)
  ]));
  const trendRows = populated.flatMap(site => [...site.rows]
    .filter(row => !data.reportingMonth || row.month <= data.reportingMonth)
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-6)
    .map(row => [
      escapeHtml(site.label),
      escapeHtml(formatMonth(row.month)),
      formatInteger(row.totalU),
      formatInteger(row.usedU),
      formatInteger(row.availableU),
      formatUsagePercent1(usagePercent(row)),
      formatRatioPercent1(row.availabilityPct)
    ]));
  return '<section class="page" data-report-section="site-rack-comparison"><h2>Rack Unit Capacity Comparison</h2><p class="note">Reference month: ' +
    escapeHtml(formatMonth(data.reportingMonth)) + '</p>' +
    table(["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"], selectedRows) +
    '<h3>Six-Month Trend</h3>' +
    table(["Site", "Month", "Total (U)", "Used (U)", "Available (U)", "Usage (%)", "Availability (%)"], trendRows) +
    '<p class="note">Six-month trend uses the selected reporting month and up to five preceding persisted monthly Rack Unit snapshots.</p>' +
    '<p class="note">' + escapeHtml(RACK_UNIT_CAPACITY_TREND_NOTE) + '</p></section>';
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
export function trendChartXPosition(index: number, rowCount: number, width = 1600, left = 140, right = 80): number {
  const plotWidth = width - left - right;
  if (rowCount < 2) return left + plotWidth / 2;
  // Reserve one complete category slot before the first point and one after
  // the final point. This keeps labels detached from both chart edges.
  const categorySlot = plotWidth / (rowCount + 1);
  return left + (index + 1) * categorySlot;
}

function trendPage(title: string, unit: string, series: TrendSeries[], rows: ReportMonthlyRow[], explanation: string, sectionLabel?: string, reportSection: ReportSectionId = "historical"): string {
  const eyebrow = sectionLabel ? `<p class="eyebrow">${escapeHtml(sectionLabel)}</p>` : "";
  const allValues = series.flatMap(s => s.values);
  const defined = allValues.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!defined.length) return `<section class="page trend-page" data-report-section="${reportSection}">${eyebrow}<h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)}</p><p>No valid values are available for this selected reporting window.</p></section>`;
  const width = 1600, height = 810, left = 140, right = 80, top = 82, bottom = 110;
  const actualMin = Math.min(...defined), actualMax = Math.max(...defined), rawRange = actualMax - actualMin || Math.max(Math.abs(actualMax) * 0.2, 1);
  const domainMin = Math.min(0, actualMin - rawRange * 0.16), domainMax = actualMax + Math.max(rawRange * 0.28, Math.abs(actualMax) * 0.04);
  const range = domainMax - domainMin || 1;
  const x = (index: number) => trendChartXPosition(index, rows.length, width, left, right);
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
  return `<section class="page trend-page" data-report-section="${reportSection}">${eyebrow}<h2>${escapeHtml(title)}</h2><p class="chart-unit">${escapeHtml(unit)} · latest ${rows.length}-month window ending at ${escapeHtml(formatMonth(rows.at(-1)?.month ?? null))}</p>${legend}<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}${seriesSvg}${labels}</svg><p class="chart-explanation">${escapeHtml(explanation)} ${details}</p></section>`;
}

function facilityTrendPages(data: ReportData): string {
  const charts: Array<[string, string, string, Array<number | null>, string]> = [
    ["Total 4th Floor Energy Trend", "kWh", REPORT_PALETTE.energy, data.monthlyRows.map(row => row.floorEnergyKwh), "Monthly total 4th Floor energy for the selected reporting window."],
    ["UPS System Energy Trend", "kWh", REPORT_PALETTE.ups, data.monthlyRows.map(row => row.upsEnergyKwh), "Monthly UPS system energy utilization."],
    ["Air Conditioning Energy Trend", "kWh", REPORT_PALETTE.air, data.monthlyRows.map(row => row.airEnergyKwh), "Meter-difference energy; gaps indicate an unavailable prior reading."],
    ["DC Power Panel Energy Trend", "kWh", REPORT_PALETTE.dc, data.monthlyRows.map(row => row.dcEnergyKwh), "Monthly DC panel energy estimate."],
    ["Estimated 4th Floor Cost Trend", "THB", REPORT_PALETTE.cost, data.monthlyRows.map(row => row.floorCostThb), "Estimated cost at the building average electricity rate."],
    ["Building Average Electricity Rate Trend", "THB/kWh", REPORT_PALETTE.rate, data.monthlyRows.map(row => row.averageRateThbPerKwh), "Building electricity cost divided by building energy."],
  ];
  return charts.map(([title, unit, color, values, explanation]) =>
    trendPage(title, unit, [{ name: title, color, values }], data.monthlyRows, explanation, "FACILITY TREND ANALYTICS", "historical")
  ).join("");
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

function executiveDashboardPage(data: ReportData): string {
  const rows = data.monthlyRows;
  if (rows.length === 0) return `<section class="page executive-dashboard-page" data-report-section="executive"><p class="eyebrow">EXECUTIVE DASHBOARD</p><h2>Executive Dashboard</h2><p class="note">No monthly records are available for the selected reporting window.</p></section>`;
  const sum = (selector: (row: ReportMonthlyRow) => number | null): number => rows.reduce((total, row) => {
    const value = selector(row);
    return typeof value === "number" && Number.isFinite(value) ? total + value : total;
  }, 0);
  const buildingEnergy = sum(row => row.buildingEnergyKwh);
  const floorEnergy = sum(row => row.floorEnergyKwh);
  const buildingCost = sum(row => row.buildingCostThb);
  const floorCost = sum(row => row.floorCostThb);
  const latest = data.currentRow ?? rows.at(-1) ?? null;
  const previous = rows.length > 1 ? rows.at(-2) ?? null : null;
  const latestDelta = latest && previous && latest.floorEnergyKwh !== null && previous.floorEnergyKwh !== null
    ? latest.floorEnergyKwh - previous.floorEnergyKwh
    : null;
  const floorShare = buildingEnergy > 0 ? floorEnergy / buildingEnergy * 100 : null;
  const upsGroups = data.engineeringDashboard?.upsGroups ?? [];
  const maxUpsLoad = upsGroups.reduce<number | null>((maximum, group) => group.loadPercent === null ? maximum : maximum === null ? group.loadPercent : Math.max(maximum, group.loadPercent), null);
  const upsStatus = upsGroups.length === 0 ? "No UPS status" : `${upsGroups.length} group(s) · max ${format2(maxUpsLoad)}% load`;
  const insights = [
    latestDelta === null ? "Month-over-month floor energy comparison is unavailable." : `Latest 4th Floor energy ${latestDelta >= 0 ? "increased" : "decreased"} by ${format2(Math.abs(latestDelta))} kWh versus the previous month.`,
    latest?.status === "Complete" ? "Selected month passed the report completeness check." : "Selected month is partial; review missing source readings before making operational decisions.",
    upsGroups.length === 0 ? "UPS group status is unavailable for the selected month." : `UPS status loaded from Dashboard-FAC group history for ${formatMonth(data.reportingMonth)}.`
  ];
  return `<section class="page executive-dashboard-page" data-report-section="executive"><div class="dashboard-head"><div><p class="eyebrow">EXECUTIVE DASHBOARD</p><h2>Executive Dashboard</h2><p>${escapeHtml(data.facility)} · ${escapeHtml(formatMonth(data.reportingMonth))} · ${rows.length} reporting month(s)</p></div><div class="dashboard-tag">Management summary<br>${escapeHtml(formatMonth(data.reportingMonth))}</div></div><div class="kpis-3col">${kpi("Total Building Energy", format2(buildingEnergy), "kWh", `${rows.length} reporting month(s)`)}${kpi("Total 4th Floor Energy", format2(floorEnergy), "kWh", "UPS + AC + DC power panels")}${kpi("Total Building Cost", format2(buildingCost), "THB", "Stored/calculated building cost")}${kpi("Total 4th Floor Cost", format2(floorCost), "THB", "Calculated at building average rate")}${kpi("4th Floor Energy Share", `${format2(floorShare)}%`, "of building energy", "Selected reporting window")}${kpi("UPS Status", upsStatus, "Dashboard-FAC", "Persisted group status for selected month")}</div><article class="block"><h3>Management insights</h3><ul class="insight-list">${insights.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article></section>`;
}

function engineeringDashboard(data: ReportData, dashboard: EngineeringDashboardSnapshot, includeViewTitle = false): string {
  const upsRows = dashboard.upsGroups.map((row, index) => [String(index + 1), escapeHtml(row.name), format2(row.totalKw), format2(row.totalKva), format2(row.capacity), `${format2(row.loadPercent)}%`, `${format2(row.availablePercent)}%`, format2(row.monthlyEnergyKwh)]);
  const showAcPowerPanel = dashboard.upsDetails.some(row => row.acPowerPanel !== "—" && row.acPowerPanel !== "-");
  const upsDetails = dashboard.upsDetails.map(row => [String(row.no), escapeHtml(row.umdb), escapeHtml(row.upsId), ...(showAcPowerPanel ? [escapeHtml(row.acPowerPanel)] : []), escapeHtml(row.sts), escapeHtml(row.oudb), format2(row.voltage), format2(row.current), format2(row.loadKw), format2(row.loadKva), format2(row.capacity), `${format2(row.loadPercent)}%`]);
  const detailedHeaders = ["No.", "UMDB", "UPS ID", ...(showAcPowerPanel ? ["AC Panel"] : []), "STS", "OUDB", "V", "A", "kW", "kVA", "Capacity", "Load %"];
  const hasOverallUps = dashboard.upsOverallGroups.length > 0;
  const srinakarinOverall = hasOverallUps ? `<h3>1. UPS Load Status</h3><article class="block"><h3>1.1 UPS Load Status - Overall</h3>${table(["No.", "UPS", "Total Load (kW)", "Total Load (kVA)", "UPS Capacity (kVA)", "Load (%)", "Available (%)"], dashboard.upsOverallGroups.map((row, index) => [String(index + 1), escapeHtml(row.name), format2(row.totalKw), format2(row.totalKva), format2(row.capacity), `${format2(row.loadPercent)}%`, `${format2(row.availablePercent)}%`]))}</article>${upsComparison("UPS Loads Comparison (%) - Overall", dashboard.upsOverallGroups)}` : "";
  const detailedUpsTitle = hasOverallUps ? "1.2 UPS and PPC Load Status – DCM 4th Floor" : "1. UPS Load Status — DCM 4th Floor";
  const detailedComparisonTitle = hasOverallUps ? "UPS and PPC Loads Comparison (%) – DCM 4th Floor" : "UPS Loads Comparison (%)";
  const airRows = [[formatMonth(dashboard.previousMonth), ...dashboard.airFields.map(field => formatGWh(dashboard.airPrevious[field])), "—"], [formatMonth(data.reportingMonth), ...dashboard.airFields.map(field => formatGWh(dashboard.airCurrent[field])), "—"], ["Monthly Difference", ...dashboard.airFields.map(field => formatGWh(dashboard.airDifference[field])), dashboard.airEnergyKwh === null ? "—" : `${format2(dashboard.airEnergyKwh)} kWh`]];
  const dcRows = dashboard.dcPanels.map((row, index) => [String(index + 1), escapeHtml(row.panelId), format2(row.voltage), format2(row.current), format2(row.dcPowerW), format2(row.acCurrentA), format2(row.acPowerW), format2(row.monthlyEnergyKwh)]);
  const overall = table(["Reporting Month", "Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Avg Rate (THB/kWh)", "4th Floor Share (%)"], [[formatMonth(data.reportingMonth), format2(dashboard.buildingEnergyKwh), format2(dashboard.buildingCostThb), format2(dashboard.floorEnergyKwh), format2(dashboard.floorCostThb), format2(dashboard.averageRateThbPerKwh), `${format2(dashboard.floorSharePercent)}%`]]);
  return `<section class="page dashboard-page" data-report-section="dashboard">${includeViewTitle ? "<h2>Engineering View</h2>" : ""}<div class="dashboard-head"><div><p class="eyebrow">SELECTED-MONTH ENGINEERING ANALYSIS</p><h2>Building Energy Dashboard</h2><p>${escapeHtml(data.facility)} · ${escapeHtml(formatMonth(data.reportingMonth))} · ${dashboard.daysInMonth} days in selected month</p></div><div class="dashboard-tag">Engineering analysis<br>${escapeHtml(formatMonth(data.reportingMonth))}</div></div><div class="kpis">${kpi("Total 4th Floor Energy", format2(dashboard.floorEnergyKwh), "kWh", "UPS + AC + DC power panels")}${kpi("Estimated 4th Floor Electricity Cost", format2(dashboard.floorCostThb), "THB", "Calculated from building average rate")}${kpi("4th Floor Energy Share", `${format2(dashboard.floorSharePercent)}%`, "of building energy", `Building total: ${format2(dashboard.buildingEnergyKwh)} kWh`)}${kpi("Building Average Electricity Rate", format2(dashboard.averageRateThbPerKwh), "THB/kWh", `Building cost: ${format2(dashboard.buildingCostThb)} THB`)}</div>${srinakarinOverall}<article class="block"><h3>${detailedUpsTitle}</h3>${table(["No.", "UPS Group", "Total kW", "Total kVA", "Capacity kVA", "Load %", "Available %", "Monthly Energy kWh"], upsRows)}<p class="note">UPS group capacity and mapping values are read directly from Dashboard-FAC. Monthly energy uses load × 24 hours × selected-month days.</p></article>${upsComparison(detailedComparisonTitle, dashboard.upsGroups)}</section><section class="page dashboard-page" data-report-section="dashboard"><div class="continuation">Building Energy Dashboard · ${escapeHtml(formatMonth(data.reportingMonth))}</div><article class="block"><h3>${showAcPowerPanel ? "UPS / PPC Detailed Configuration Mapping" : "UPS Detailed Configuration Mapping"}</h3>${table(detailedHeaders, upsDetails, "dense")}<p class="note">Detail total: ${format2(dashboard.detailedVoltageAvg)} V average · ${format2(dashboard.detailedCurrentSum)} A · ${format2(dashboard.totalUpsKw)} kW · ${format2(dashboard.totalUpsKva)} kVA.</p></article><article class="block"><h3>2. Air Conditioning Energy Consumption — 4th Floor</h3>${table(["Reporting Month", ...dashboard.airFields.map(field => `${field.toUpperCase()} (GWh)`), "Total AC Energy"], airRows)}<p class="note">Air-conditioning energy is the complete GWh meter difference × 1,000,000. Missing readings remain unavailable, rather than being treated as zero.</p></article><article class="block"><h3>3. DC Power Panel Load Status</h3>${table(["No.", "DC Panel", "Voltage (V)", "Current (A)", "DC Power (W)", "AC Current @220V (A)", "AC Power (W)", "Monthly Energy (kWh)"], dcRows)}<p class="note">DC total: ${format2(dashboard.totalDcPowerW)} W DC · ${format2(dashboard.totalDcAcCurrentA)} A AC · ${format2(dashboard.totalDcAcPowerW)} W AC · ${format2(dashboard.totalDcEnergyKwh)} kWh.</p></article><article class="block"><h3>4. Overall Energy Consumption & Electricity Cost</h3>${overall}</article></section>`;
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
    return `<section class="page" data-report-section="rack-unit-capacity"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><p class="note">Rack Unit Capacity data is not yet available in this workbook.</p></section>`;
  }
  const row = unitCapacityRowForReportingMonth(data);
  if (!row) {
    return `<section class="page" data-report-section="rack-unit-capacity"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><p class="note">No Rack Unit Capacity data is available for the selected reporting month (${escapeHtml(formatMonth(data.reportingMonth))}).</p></section>`;
  }
  const previousRow = findPreviousRackUnitCapacityRow(data.rackUnitCapacity, row.month);
  const usagePctNow = usagePercent(row);
  const usagePctPrev = previousRow ? usagePercent(previousRow) : null;
  const trendDirection = usagePctNow !== null && usagePctPrev !== null ? getTrendDirection(calculatePercentageDelta(usagePctNow, usagePctPrev), 0.05) : null;
  const trendValue = trendDirection === null || usagePctNow === null || usagePctPrev === null
    ? "—"
    : `${trendDirection === "Up" ? "▲" : trendDirection === "Down" ? "▼" : "◆"} ${Math.abs(calculatePercentageDelta(usagePctNow, usagePctPrev)).toFixed(1)}%`;
  const trendNote = trendDirection === null ? "no prior month" : getTrendLabel(trendDirection, "en");
  const availabilityText = formatRatioPercent1(row.availabilityPct);
  const kpis = [
    kpi("Total (U)", formatInteger(row.totalU), "U", ""),
    kpi("Used (U)", formatInteger(row.usedU), "U", ""),
    kpi("Available (U)", formatInteger(row.availableU), "U", ""),
    kpi("Availability %", availabilityText, "", ""),
    kpi("Usage %", formatUsagePercent1(usagePctNow), "", ""),
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
  const imagePage = `<section class="page rack-unit-capacity-image-page" data-report-section="rack-unit-capacity"><h2>Monthly Rack Unit Capacity Image</h2><p class="note">${subtitle}</p><div class="rack-unit-capacity-image-page-content">${rackUnitCapacityImageFigure(data, row)}</div></section>`;
  return `<section class="page" data-report-section="rack-unit-capacity"><h2>Rack Unit Capacity and Utilization</h2><p class="note">${subtitle}</p><div class="kpis-3col">${kpis}</div><div class="rack-unit-capacity-layout"><div class="ruc-left"><div class="block gauge-row">${donut}<div class="gauge-caption">${legend}</div></div></div></div></section>${imagePage}${rackUnitTrendPage(data)}`;
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
  const metrics = data.rack ? calculateRackCapacityMetrics(data.rack.records) : null;
  const zoneRows = metrics?.zoneMetrics.map(zone => [escapeHtml(zone.zone), formatInteger(zone.total), formatInteger(zone.inUse.count), formatInteger(zone.available.count), formatInteger(zone.reserved.count), formatInteger(zone.pendingDismantle.count), formatRatioPercent1(zone.inUse.ratio)]) ?? [];
  const zoneSummary = zoneRows.length ? `<article class="block zone-summary"><h3>Zone Capacity Breakdown</h3>${table(["Zone", "Total", "In Use", "Available", "Reserved", "Pending Decommission", "Usage %"], zoneRows)}</article>` : "";
  return `<section class="page capacity-health-page" data-report-section="rack-capacity"><h2>Capacity Health and Zone Heatmap</h2>${gauge}${heatmap}${zoneSummary}</section>`;
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

function rackComparisonDetailBlock(label: string, records: NonNullable<ReportData["rack"]>["records"]): string {
  const metrics = calculateRackCapacityMetrics(records);
  const rows = metrics.zoneMetrics.map(zone => [
    escapeHtml(zone.zone),
    formatInteger(zone.total),
    formatInteger(zone.inUse.count),
    formatInteger(zone.available.count),
    formatInteger(zone.reserved.count),
    formatInteger(zone.pendingDismantle.count),
    formatRatioPercent1(zone.available.ratio)
  ]);
  return '<div class="block"><h3>Rack Capacity Details — ' + escapeHtml(comparisonFacilityLabel(label)) + '</h3>' +
    table(["Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle", "Availability (%)"], rows) +
    '<h3>Rack Positions — ' + escapeHtml(comparisonFacilityLabel(label)) + '</h3>' +
    rackPositionsTable(records) + '</div>';
}

function rackComparisonPage(data: ReportData): string {
  if (!data.rackComparison) return "";
  const { self, other } = data.rackComparison;
  const selfMetrics = calculateRackCapacityMetrics(self.records);
  const rows: string[][] = [rackComparisonRow(self.label, selfMetrics)];
  const donuts = [rackComparisonDonutBlock(self.label, selfMetrics)];
  const details = [rackComparisonDetailBlock(self.label, self.records)];
  if (other) {
    const otherMetrics = calculateRackCapacityMetrics(other.records);
    rows.push(rackComparisonRow(other.label, otherMetrics));
    donuts.push(rackComparisonDonutBlock(other.label, otherMetrics));
    details.push(rackComparisonDetailBlock(other.label, other.records));
  }
  const note = other ? "" : '<p class="note">Only ' + escapeHtml(comparisonFacilityLabel(self.label)) + ' is shown — the sibling facility\'s Rack Capacity data was unavailable for this export.</p>';
  return '<section class="page" data-report-section="site-rack-comparison"><h2>Rack Capacity Site Comparison</h2><div class="rack-comparison-donuts">' + donuts.join("") + '</div>' +
    table(["Facility", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle"], rows) + details.join("") + note + '</section>';
}

function rackCapacityPage(data: ReportData): string {
  if (!data.rack || data.rack.records.length === 0) {
    return `<section class="page" data-report-section="rack-capacity"><h2>Rack Capacity and Utilization</h2><p class="note">Rack capacity data is unavailable in this workbook.</p></section>`;
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
  return `<section class="page" data-report-section="rack-capacity"><h2>Rack Capacity and Utilization</h2><p class="note">${escapeHtml(data.facility)} · Usage ${formatRatioPercent(metrics.inUse.ratio)} · Availability ${formatRatioPercent(metrics.available.ratio)}</p><div class="kpis">${kpis}</div><div class="rack-donut-row"><div>${donut}</div><div class="table-wrap" style="flex:1"><h3>Rack Capacity Details</h3><table><thead><tr><th class="left">Rack Zone</th><th>In Use</th><th>Available</th><th>Reserved</th><th>Pending Dismantle</th><th>Total</th></tr></thead><tbody>${zoneRows.map(row => `<tr>${row.map((cell, i) => `<td${i === 0 ? " class=\"left\"" : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div><p class="note">Detailed Available, Reserved, and Pending Decommission rack positions continue on the following page(s) at a larger readable size.</p></section>${rackPositionPages(data)}`;
}

function rackPositionPages(data: ReportData): string {
  if (!data.rack) return "";
  const headers = ["Status", "Rack ID", "Cabinet Size (cm)", "Detail"];
  const rows = rackPositionExportRows(data.rack.records).map(row => [escapeHtml(row.status), escapeHtml(row.rackId ?? "-"), escapeHtml(row.cabinetSize ?? "-"), escapeHtml(row.detail ?? "-")]);
  const pageSize = 24;
  if (rows.length === 0) return `<section class="page rack-position-page" data-report-section="rack-capacity"><h2>Rack Positions</h2><p class="note">${escapeHtml(data.facility)} - ${escapeHtml(formatMonth(data.reportingMonth))}</p>${table(headers, [["-", "-", "-", "No Available, Reserved, or Pending Decommission rack positions in the confirmed snapshot."]], "positions")}</section>`;
  const pages: string[] = [];
  for (let start = 0; start < rows.length; start += pageSize) {
    const chunk = rows.slice(start, start + pageSize);
    const pageNo = Math.floor(start / pageSize) + 1;
    const pageCount = Math.ceil(rows.length / pageSize);
    pages.push(`<section class="page rack-position-page" data-report-section="rack-capacity"><h2>Rack Positions</h2><p class="continuation">${escapeHtml(data.facility)} - ${escapeHtml(formatMonth(data.reportingMonth))} - Page ${pageNo} of ${pageCount} - ${rows.length} deployable / exception positions</p>${table(headers, chunk, "positions")}</section>`);
  }
  return pages.join("");
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
      "SITE COMPARISON",
      "site-energy-comparison"
    ) +
    trendPage(
      "Floor 4 Electricity Cost Trend",
      "THB",
      buildSeries("floorCostThb"),
      selfTrend,
      "Estimated 4th Floor electricity cost for the selected reporting window, self vs. sibling facility.",
      "SITE COMPARISON",
      "site-energy-comparison"
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
  return `${comparisonTrendPages(data)}<section class="page" data-report-section="site-energy-comparison"><h2>Site Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(self.month))}</p>${table(["Facility", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"], rows)}${note}</section>`;
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


function crossSiteEnergyPages(model: SiteComparisonReportModel): string {
  const rows = model.months.map(month => ({ month } as ReportMonthlyRow));
  const seriesFor = (pick: (metric: ComparisonMetric) => number | null): TrendSeries[] => model.sites.map(site => ({
    name: comparisonFacilityLabel(site.label),
    color: siteColour(site.label),
    values: model.months.map(month => {
      const metric = site.metricsByMonth[month];
      return metric ? pick(metric) : null;
    })
  }));
  const charts =
    trendPage("Total Building Energy Consumption Trend", "kWh", seriesFor(metric => metric.buildingEnergy), rows, "Whole-building monthly energy per site for the selected window.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("4th Floor Energy Consumption Trend", "kWh", seriesFor(metric => metric.floorEnergy), rows, "4th Floor monthly energy per site.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("Total Building Electricity Cost Trend", "THB", seriesFor(metric => metric.buildingCost), rows, "Whole-building monthly electricity cost per site.", "SITE COMPARISON", "site-energy-comparison") +
    trendPage("Estimated 4th Floor Electricity Cost Trend", "THB", seriesFor(metric => metric.floorCost), rows, "Estimated 4th Floor electricity cost per site.", "SITE COMPARISON", "site-energy-comparison");
  const tableRows = model.sites.map(site => {
    const metric = site.metrics;
    return [escapeHtml(comparisonFacilityLabel(site.label)), format2(metric?.buildingEnergy), format2(metric?.buildingCost), format2(metric?.floorEnergy), format2(metric?.floorCost), format2(metric?.avgRate), metric?.floorShare == null ? "—" : `${format2(metric.floorShare)}%`];
  });
  return charts + `<section class="page" data-report-section="site-energy-comparison"><h2>Site Energy &amp; Cost Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(model.referenceMonth))}</p>${table(["Facility", "Whole Building Energy (kWh)", "Whole Building Cost (THB)", "4th Floor Energy (kWh)", "Estimated 4th Floor Cost (THB)", "Average Rate (THB/kWh)", "4th Floor Share (%)"], tableRows)}</section>`;
}

function crossSiteRackSummaryPage(model: SiteComparisonReportModel): string {
  const rows = model.sites.map(site => {
    if (!site.rack) return [escapeHtml(comparisonFacilityLabel(site.label)), "Unavailable", "—", "—", "—", "—", "—", "Unavailable"];
    const metrics = calculateRackCapacityMetrics(site.rack.records);
    return [escapeHtml(comparisonFacilityLabel(site.label)), formatInteger(metrics.available.count), formatInteger(metrics.total), formatInteger(metrics.inUse.count), formatInteger(metrics.reserved.count), formatInteger(metrics.pendingDismantle.count), formatRatioPercent1(metrics.available.ratio), rackAvailabilityStatus(metrics.available.count, metrics.total)];
  });
  return `<section class="page" data-report-section="site-rack-comparison"><h2>Site Rack Capacity &amp; Availability Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(model.referenceMonth))}. Missing confirmed snapshots are shown as Unavailable and are never treated as zero capacity.</p>${table(["Facility", "Available Now", "Total Racks", "In Use", "Reserved", "Pending Decommission", "Availability %", "Status"], rows)}</section>`;
}

function crossSiteRackZonePage(model: SiteComparisonReportModel): string {
  const availableSites = model.sites.filter(site => site.rack !== null);
  if (availableSites.length === 0) return "";
  const metricsBySite = availableSites.map(site => ({ site, metrics: calculateRackCapacityMetrics(site.rack!.records) }));
  const maxZoneTotal = Math.max(1, ...metricsBySite.flatMap(item => item.metrics.zoneMetrics.map(zone => zone.total)));
  const blocks = metricsBySite.map(({ site, metrics }) => {
    const zones = metrics.zoneMetrics.map(zone => {
      const outerWidth = Math.max(5, zone.total / maxZoneTotal * 100);
      const segment = (count: number, color: string) => `<i style="display:block;height:100%;width:${zone.total > 0 ? count / zone.total * 100 : 0}%;background:${color}"></i>`;
      const bar = `<div style="height:14px;width:${outerWidth}%;min-width:80px;display:flex;overflow:hidden;border-radius:7px;background:#edf1f5">${segment(zone.inUse.count, REPORT_PALETTE.rackInUse)}${segment(zone.available.count, REPORT_PALETTE.rackAvailable)}${segment(zone.reserved.count, REPORT_PALETTE.rackReserved)}${segment(zone.pendingDismantle.count, REPORT_PALETTE.rackPending)}</div>`;
      return `<div style="display:grid;grid-template-columns:120px 1fr 70px;gap:10px;align-items:center;margin:7px 0"><strong>${escapeHtml(zone.zone)}</strong>${bar}<span>${formatInteger(zone.total)} racks</span></div>`;
    }).join("");
    return `<article class="block"><h3>${escapeHtml(comparisonFacilityLabel(site.label))}</h3>${zones || '<p class="note">No rack zones are available.</p>'}</article>`;
  }).join("");
  return `<section class="page" data-report-section="site-rack-comparison"><h2>Rack Capacity by Zone</h2><p class="note">Bar width uses one shared scale across sites; segments show In Use, Available, Reserved, and Pending Decommission.</p>${blocks}</section>`;
}

function crossSiteRackDetailPages(model: SiteComparisonReportModel): string {
  return model.sites.filter(site => site.rack !== null).map(site => {
    const metrics = calculateRackCapacityMetrics(site.rack!.records);
    const rows = metrics.zoneMetrics.map(zone => [escapeHtml(zone.zone), formatInteger(zone.total), formatInteger(zone.inUse.count), formatInteger(zone.available.count), formatInteger(zone.reserved.count), formatInteger(zone.pendingDismantle.count)]);
    return `<section class="page" data-report-section="site-rack-comparison"><h2>Rack Capacity Details — ${escapeHtml(comparisonFacilityLabel(site.label))}</h2>${table(["Zone", "Total", "In Use", "Available", "Reserved", "Pending Decommission"], rows)}</section>`;
  }).join("");
}

function crossSiteRackPositionPages(model: SiteComparisonReportModel): string {
  const statuses = ["Available", "Reserved", "Pending Decommission"] as const;
  return model.sites.filter(site => site.rack !== null).map(site => {
    const rows = rackPositionExportRows(site.rack!.records);
    const groups = statuses.map(status => {
      const tableRows = rows.filter(row => row.status === status).map(row => [escapeHtml(row.rackId ?? "—"), escapeHtml(row.cabinetSize ?? "—"), escapeHtml(row.detail ?? "—")]);
      return `<article class="block"><h3>${status}</h3>${tableRows.length ? table(["Rack ID", "Cabinet Size (cm)", "Detail"], tableRows) : '<p class="note">No positions.</p>'}</article>`;
    }).join("");
    return `<section class="page" data-report-section="site-rack-comparison"><h2>Rack Positions — ${escapeHtml(comparisonFacilityLabel(site.label))}</h2>${groups}</section>`;
  }).join("");
}

function crossSiteRackUnitPage(model: SiteComparisonReportModel): string {
  const currentRows: string[][] = [];
  const trendRows: string[][] = [];
  const excluded: string[] = [];
  for (const site of model.sites) {
    const validRows = [...site.rackUnit]
      .filter(row => row.month <= model.referenceMonth)
      .sort((left, right) => left.month.localeCompare(right.month))
      .filter(row => {
        const valid = isValidRackUnitCapacity(row.totalU, row.usedU) && Number.isFinite(row.availableU) && row.availableU >= 0;
        if (!valid) excluded.push(`${comparisonFacilityLabel(site.label)} ${row.month}`);
        return valid;
      });
    const current = validRows.find(row => row.month === model.referenceMonth);
    if (current) {
      const usage = current.totalU > 0 ? current.usedU / current.totalU * 100 : null;
      const availability = current.totalU > 0 ? current.availableU / current.totalU : null;
      currentRows.push([escapeHtml(comparisonFacilityLabel(site.label)), formatInteger(current.totalU), formatInteger(current.usedU), formatInteger(current.availableU), formatUsagePercent1(usage), formatRatioPercent1(availability)]);
    }
    for (const row of validRows.slice(-6)) {
      const usage = row.totalU > 0 ? row.usedU / row.totalU * 100 : null;
      const availability = row.totalU > 0 ? row.availableU / row.totalU : null;
      trendRows.push([escapeHtml(comparisonFacilityLabel(site.label)), escapeHtml(formatMonth(row.month)), formatInteger(row.totalU), formatInteger(row.usedU), formatInteger(row.availableU), formatUsagePercent1(usage), formatRatioPercent1(availability)]);
    }
  }
  if (currentRows.length === 0 && trendRows.length === 0 && excluded.length === 0) return "";
  const excludedNote = excluded.length ? `<p class="note">Excluded invalid Rack Unit rows: ${escapeHtml(excluded.join(", "))}.</p>` : "";
  return `<section class="page" data-report-section="site-rack-comparison"><h2>Rack Unit Capacity Comparison</h2><p class="note">Reference month: ${escapeHtml(formatMonth(model.referenceMonth))}</p>${currentRows.length ? table(["Facility", "Total U", "Used U", "Available U", "Usage %", "Availability %"], currentRows) : '<p class="note">No valid Rack Unit Capacity row is available for the reference month.</p>'}<h3>Six-Month Trend</h3>${trendRows.length ? table(["Site", "Month", "Total U", "Used U", "Available U", "Usage %", "Availability %"], trendRows) : '<p class="note">No valid Rack Unit Capacity trend rows are available.</p>'}${excludedNote}<p class="note">${escapeHtml(RACK_UNIT_CAPACITY_TREND_NOTE)}</p></section>`;
}

function crossSiteRackPages(model: SiteComparisonReportModel): string {
  return crossSiteRackSummaryPage(model) + crossSiteRackZonePage(model) + crossSiteRackDetailPages(model) + crossSiteRackPositionPages(model) + crossSiteRackUnitPage(model);
}

export function buildCrossSiteComparisonPages(model: SiteComparisonReportModel, sections?: readonly ReportSectionId[]): string {
  const body = crossSiteEnergyPages(model) + crossSiteRackPages(model);
  return sections !== undefined ? filterReportBodySections(body, sections) : body;
}

function filterReportBodySections(body: string, selectedSections: readonly ReportSectionId[]): string {
  const selected = new Set<string>(selectedSections);
  return body
    .split(/(?=<section class="page)/)
    .filter(page => page.startsWith('<section class="page'))
    .filter(page => {
      const match = page.match(/data-report-section="([a-z-]+)"/);
      return !match || selected.has(match[1]);
    })
    .join("");
}

function currentExecutiveDashboardPage(data: ReportData): string {
  const current = data.currentRow;
  if (!current) {
    return `<section class="page executive-dashboard-page" data-report-section="executive"><p class="eyebrow">EXECUTIVE VIEW</p><h2>Executive View</h2><p class="note">No monthly record is available for the selected reporting month.</p></section>`;
  }
  const trendRows = data.executiveTrendRows ?? data.monthlyRows;
  const previous = trendRows.filter(row => row.month < current.month).at(-1) ?? null;
  const latestDelta = current.floorEnergyKwh !== null && previous?.floorEnergyKwh !== null && previous
    ? current.floorEnergyKwh - previous.floorEnergyKwh
    : null;
  const upsGroups = data.engineeringDashboard?.upsGroups ?? [];
  const maxUpsLoad = upsGroups.reduce<number | null>((maximum, group) => group.loadPercent === null ? maximum : maximum === null ? group.loadPercent : Math.max(maximum, group.loadPercent), null);
  const upsStatus = upsGroups.length === 0 ? "No UPS status" : `${upsGroups.length} group(s) · max ${format2(maxUpsLoad)}% load`;
  const insights = [
    latestDelta === null ? "Month-over-month floor energy comparison is unavailable." : `Selected month 4th Floor energy ${latestDelta >= 0 ? "increased" : "decreased"} by ${format2(Math.abs(latestDelta))} kWh versus the previous month.`,
    current.status === "Complete" ? "Selected month passed the report completeness check." : "Selected month is partial; review missing source readings before making operational decisions.",
    upsGroups.length === 0 ? "UPS group status is unavailable for the selected month." : `UPS status loaded from Dashboard-FAC group history for ${formatMonth(current.month)}.`
  ];
  return `<section class="page executive-dashboard-page" data-report-section="executive"><div class="dashboard-head"><div><p class="eyebrow">EXECUTIVE VIEW</p><h2>Executive View</h2><p>${escapeHtml(data.facility)} · ${escapeHtml(formatMonth(current.month))} · selected month only</p></div><div class="dashboard-tag">Management summary<br>${escapeHtml(formatMonth(current.month))}</div></div><div class="kpis-3col">${kpi("Building Energy · Selected Month", format2(current.buildingEnergyKwh), "kWh", "Selected reporting month only")}${kpi("4th Floor Energy · Selected Month", format2(current.floorEnergyKwh), "kWh", "UPS + AC + DC power panels")}${kpi("Building Cost · Selected Month", format2(current.buildingCostThb), "THB", "Stored/calculated building cost")}${kpi("4th Floor Cost · Selected Month", format2(current.floorCostThb), "THB", "Calculated at building average rate")}${kpi("4th Floor Energy Share", `${format2(current.floorSharePercent)}%`, "of building energy", "Selected reporting month")}${kpi("UPS Status", upsStatus, "Dashboard-FAC", "Persisted group status for selected month")}</div><article class="block"><h3>Management insights</h3><ul class="insight-list">${insights.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article></section>`;
}

function currentExecutiveTrendPages(data: ReportData): string {
  const rows = data.executiveTrendRows ?? data.monthlyRows;
  const charts: Array<[string, string, string, Array<number | null>, string]> = [
    ["4th Floor Estimated Cost Trend (THB)", "THB", REPORT_PALETTE.cost, rows.map(row => row.floorCostThb), "Estimated 4th Floor cost at the shared building electricity rate."],
    ["4th Floor Total Energy Trend (kWh)", "kWh", REPORT_PALETTE.energy, rows.map(row => row.floorEnergyKwh), "Monthly total 4th Floor energy consumption."],
    ["4th Floor Average Electricity Rate Trend (THB/kWh)", "THB/kWh", REPORT_PALETTE.rate, rows.map(row => row.averageRateThbPerKwh), "Building electricity cost divided by building energy."],
    ["4th Floor UPS Energy Trend (kWh)", "kWh", REPORT_PALETTE.ups, rows.map(row => row.upsEnergyKwh), "Monthly UPS system energy utilization."],
    ["4th Floor Air Conditioning Energy Trend (kWh)", "kWh", REPORT_PALETTE.air, rows.map(row => row.airEnergyKwh), "Monthly air-conditioning meter-difference energy."],
    ["4th Floor DC Power Energy Trend (kWh)", "kWh", REPORT_PALETTE.dc, rows.map(row => row.dcEnergyKwh), "Monthly DC power panel energy estimate."]
  ];
  return charts.map(([title, unit, color, values, explanation]) =>
    trendPage(title, unit, [{ name: title, color, values }], rows, explanation, "EXECUTIVE VIEW · LAST 12 MONTHS", "executive")
  ).join("");
}

function currentFacilitySelectedSections(selectedSections?: readonly ReportSectionId[]): readonly ReportSectionId[] | undefined {
  if (selectedSections === undefined) return undefined;
  const selected = new Set<ReportSectionId>(selectedSections);
  if (selected.has("ups") || selected.has("air-conditioning") || selected.has("dc")) selected.add("dashboard");
  return [...selected];
}

/** Current Facility PDF only: four deliberate major groups. Other formats
 *  continue to use buildReportBodyPages/buildReportHtml unchanged. */
export function buildCurrentFacilityPdfBody(data: ReportData, selectedSections?: readonly ReportSectionId[]): string {
  const engineering = data.engineeringDashboard
    ? engineeringDashboard(data, data.engineeringDashboard, true)
    : `<section class="page dashboard-page" data-report-section="dashboard"><h2>Engineering View</h2><p class="note">Engineering data is unavailable for the selected month.</p></section>`;
  const executive = currentExecutiveDashboardPage(data) + currentExecutiveTrendPages(data);
  const rack = rackCapacityPage(data) + capacityHealthPage(data);
  const rackUnit = renderRackUnitCapacityExecutivePage(data);
  const body = `${engineering}${executive}${rack}${rackUnit}`;
  const sections = currentFacilitySelectedSections(selectedSections);
  return sections !== undefined ? filterReportBodySections(body, sections) : body;
}

export function buildCurrentFacilityPdfHtml(data: ReportData, selectedSections?: readonly ReportSectionId[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)} · Current Facility PDF</title><style>${REPORT_CSS}</style></head><body>${reportCoverMain(data)}${buildCurrentFacilityPdfBody(data, selectedSections)}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}
export function buildReportBodyPages(data: ReportData, selectedSections?: readonly ReportSectionId[]): string {
  const executive = executiveDashboardPage(data);
  const dashboard = data.engineeringDashboard ? engineeringDashboard(data, data.engineeringDashboard) : "";
  const executiveTrend = trendPage(
    "Monthly Energy Consumption Trend",
    "kWh",
    [
      { name: "Whole Building", color: REPORT_PALETTE.energy, values: data.monthlyRows.map(row => row.buildingEnergyKwh) },
      { name: "4th Floor", color: REPORT_PALETTE.siteRangsit, values: data.monthlyRows.map(row => row.floorEnergyKwh) }
    ],
    data.monthlyRows,
    "Monthly whole-building and 4th-floor energy consumption for the selected reporting window.",
    "EXECUTIVE DASHBOARD · TREND ANALYTICS",
    "executive"
  );
  const trendPages = facilityTrendPages(data);
  const appendixRange = `${escapeHtml(formatMonth(data.historicalStart))} - ${escapeHtml(formatMonth(data.historicalEnd))}`;
  const appendix = `<section class="page appendix-page" data-report-section="appendix"><h2>Monthly Energy &amp; Cost Table</h2><div class="appendix-intro"><div><strong>Selected reporting window</strong><br><span>${appendixRange}</span></div><div><strong>${data.monthlyRows.length} month${data.monthlyRows.length === 1 ? "" : "s"}</strong><br><span>Facility: ${escapeHtml(data.facility)}</span></div></div>${monthlyTable(data.monthlyRows)}<p class="note">All values use the same shared report calculations as the Dashboard and exported workbook.</p></section>`;
  const body =
    `${executive}${executiveTrend}${dashboard}` +
    trendPages +
    appendix +
    `${comparisonPage(data)}${rackCapacityPage(data)}${renderRackUnitCapacityExecutivePage(data)}` +
    `${rackUnitComparisonPage(data)}${capacityHealthPage(data)}${rackComparisonPage(data)}`;
  return selectedSections !== undefined ? filterReportBodySections(body, selectedSections) : body;
}

export function reportCoverMain(data: ReportData): string {
  const range = `${formatMonth(data.historicalStart)} – ${formatMonth(data.historicalEnd)}`;
  return `<main class="cover"><h1>${escapeHtml(data.title)}</h1><h2>${escapeHtml(data.thaiSubtitle)}</h2><div class="meta">Facility: ${escapeHtml(data.facility)}<br>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}<br>Historical range: ${escapeHtml(range)}</div></main>`;
}

export function buildReportHtml(
  data: ReportData,
  opts?: readonly ReportSectionId[] | { sections?: readonly ReportSectionId[]; includeCover?: boolean },
): string {
  const norm: { sections?: readonly ReportSectionId[]; includeCover: boolean } = Array.isArray(opts)
    ? { sections: opts as readonly ReportSectionId[], includeCover: true }
    : { includeCover: true, ...((opts as { sections?: readonly ReportSectionId[]; includeCover?: boolean } | undefined) ?? {}) };
  const cover = norm.includeCover ? reportCoverMain(data) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>${REPORT_CSS}</style></head><body>${cover}${buildReportBodyPages(data, norm.sections)}<script>document.body.dataset.reportReady="true";</script></body></html>`;
}
