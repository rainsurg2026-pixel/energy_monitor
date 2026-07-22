import type { ReportData, ReportMonthlyRow, RackCapacityReport } from "../reportTypes";
import { formatNumber } from "../../utils/numberFormatBridge";

const FONT_STACK = 'Prompt, "Noto Sans Thai", Tahoma, sans-serif';

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function format2(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatNumber(value)
    : "—";
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${format2(value)}%`;
}

function formatMonth(month: string | null): string {
  if (!month) return "—";
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function valueOrDash(value: number | null): string {
  return value === null ? "—" : format2(value);
}

interface ChartSeries {
  name: string;
  color: string;
  values: Array<number | null>;
  dash?: string;
}

function chartPath(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      open = false;
      return;
    }
    path += `${open ? " L" : "M"} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    open = true;
  });
  return path;
}

function lineChartSvg(title: string, unit: string, labels: string[], series: ChartSeries[], description: string): string {
  const width = 1080;
  const height = 460;
  const left = 72;
  const right = 22;
  const top = 38;
  const bottom = 100;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  if (values.length === 0) return `<div class="empty-chart">No valid ${escapeHtml(unit)} values are available.</div>`;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const x = (index: number) => left + (labels.length <= 1 ? plotWidth / 2 : ((index + 1) / (labels.length + 1)) * plotWidth);
  const y = (value: number) => top + ((max - value) / range) * plotHeight;
  const grid = [0, 1, 2, 3, 4].map(step => {
    const value = max - (range * step) / 4;
    const yy = y(value);
    return `<line x1="${left}" y1="${yy.toFixed(2)}" x2="${width - right}" y2="${yy.toFixed(2)}" class="grid"/><text x="${left - 10}" y="${(yy + 4).toFixed(2)}" text-anchor="end" class="axis">${escapeHtml(format2(value))}</text>`;
  }).join("");
  const xLabels = labels.map((label, index) => `<text transform="translate(${x(index).toFixed(2)},${height - 45}) rotate(-45)" text-anchor="end" class="axis">${escapeHtml(label)}</text>`).join("");
  const lines = series.map((item, seriesIndex) => {
    const path = chartPath(item.values, x, y);
    const points = item.values.map((value, index) => value === null || !Number.isFinite(value)
      ? ""
      : `<circle cx="${x(index).toFixed(2)}" cy="${y(value).toFixed(2)}" r="3.2" fill="${item.color}"/><text x="${x(index).toFixed(2)}" y="${(y(value) - 10 - (seriesIndex % 2) * 11).toFixed(2)}" text-anchor="middle" class="point-label">${escapeHtml(format2(value))}</text>`).join("");
    return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2.4" ${item.dash ? `stroke-dasharray="${item.dash}"` : ""}/>${points}`;
  }).join("");
  const legend = series.map(item => `<span class="legend"><i style="background:${item.color}"></i>${escapeHtml(item.name)}</span>`).join("");
  return `<div class="chart-block"><h3>${escapeHtml(title)}</h3><p class="chart-caption">${escapeHtml(description)}</p><div class="legend-row">${legend}<span class="unit">${escapeHtml(unit)}</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}${lines}${xLabels}</svg></div>`;
}

function barChartSvg(title: string, labels: string[], values: number[], color: string, description: string): string {
  if (values.length === 0) return `<div class="empty-chart">No valid values are available.</div>`;
  const width = 1080;
  const height = 300;
  const left = 54;
  const right = 18;
  const top = 28;
  const bottom = 70;
  const max = Math.max(...values, 1);
  const slot = (width - left - right) / values.length;
  const bars = values.map((value, index) => {
    const barWidth = Math.max(8, slot * 0.68);
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = ((height - top - bottom) * value) / max;
    const y = height - bottom - barHeight;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="3" fill="${color}"/><text x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 7).toFixed(2)}" text-anchor="middle" class="point-label">${escapeHtml(format2(value))}</text><text transform="translate(${(x + barWidth / 2).toFixed(2)},${height - 28}) rotate(-45)" text-anchor="end" class="axis">${escapeHtml(labels[index])}</text>`;
  }).join("");
  return `<div class="chart-block"><h3>${escapeHtml(title)}</h3><p class="chart-caption">${escapeHtml(description)}</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" class="axis-line"/>${bars}</svg></div>`;
}

function monthlyTable(rows: ReportMonthlyRow[]): string {
  const body = rows.map(row => `<tr><td>${escapeHtml(formatMonth(row.month))}</td><td>${valueOrDash(row.buildingEnergyKwh)}</td><td>${valueOrDash(row.buildingCostThb)}</td><td>${valueOrDash(row.floorEnergyKwh)}</td><td>${valueOrDash(row.floorCostThb)}</td><td>${valueOrDash(row.averageRateThbPerKwh)}</td><td>${formatPercent(row.floorSharePercent)}</td><td>${valueOrDash(row.upsEnergyKwh)}</td><td>${valueOrDash(row.airEnergyKwh)}</td><td>${valueOrDash(row.dcEnergyKwh)}</td><td>${escapeHtml(row.status)}</td></tr>`).join("");
  return `<p class="table-caption">Authoritative monthly values re-read from the workbook. Blank values remain blank and are shown as —; numeric zero remains a valid value.</p><div class="table-wrap"><table><thead><tr><th>Reporting Month</th><th>Building Energy (kWh)</th><th>Building Cost (THB)</th><th>4th Floor Energy (kWh)</th><th>4th Floor Cost (THB)</th><th>Average Rate (THB/kWh)</th><th>4th Floor Share</th><th>UPS Energy (kWh)</th><th>Air Energy (kWh)</th><th>DC Energy (kWh)</th><th>Data Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function kpi(label: string, value: string, unit = ""): string {
  return `<div class="kpi"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div>${unit ? `<div class="kpi-unit">${escapeHtml(unit)}</div>` : ""}</div>`;
}

function rackSection(rack: RackCapacityReport): string {
  const statusLabels = rack.byStatus.map(item => item.status);
  const statusValues = rack.byStatus.map(item => item.count);
  const zoneRows = rack.byZone.map(item => `<tr><td>${escapeHtml(item.zone)}</td><td>${item.count}</td><td>—</td><td>—</td></tr>`).join("");
  const statusRows = rack.byStatus.map(item => `<tr><td>${escapeHtml(item.status)}</td><td>${item.count}</td></tr>`).join("");
  const validationRows = [
    ...rack.validation.duplicateIds.map(id => `<li>Duplicate Rack ID: ${escapeHtml(id)}</li>`),
    ...rack.validation.missingRequiredFields.map(item => `<li>Missing ${escapeHtml(item.field)} at workbook row ${item.rowNumber}</li>`),
    ...rack.validation.invalidStatuses.map(item => `<li>Invalid status “${escapeHtml(item.status)}” at workbook row ${item.rowNumber}</li>`),
    ...rack.validation.invalidDataTypes.map(item => `<li>Unexpected ${escapeHtml(item.type)} value in ${escapeHtml(item.field)} at workbook row ${item.rowNumber}</li>`)
  ].join("");
  return `<section class="report-section"><h2>Rack Capacity Summary</h2><p class="section-intro">This section summarizes the read-only Rack Capacity / Table7 source. Counts are grouped by status, zone, cabinet size, and device type. Unsupported U-capacity fields are not inferred.</p><p class="muted">Source: ${escapeHtml(rack.sourceSheet)} / ${escapeHtml(rack.sourceTable)}. Total U, Used U, Available U, Reserved U, and utilization are unavailable in the workbook.</p><div class="kpi-grid">${kpi("Total Racks", format2(rack.records.length), "racks")}${kpi("Active / In Use", format2(rack.byStatus.find(item => item.status === "In Use")?.count ?? null), "racks")}${kpi("Available", format2(rack.byStatus.find(item => item.status === "Available")?.count ?? null), "racks")}${kpi("Reserved", format2(rack.byStatus.find(item => item.status === "Reserved")?.count ?? null), "racks")}${kpi("Total Capacity U", "—", "unavailable")}${kpi("Rack Utilization", "—", "unavailable")}</div>${barChartSvg("Rack status counts", statusLabels, statusValues, "#d9776a", "Number of Rack Capacity records grouped by the workbook Status field.")}<div class="two-col">${barChartSvg("Rack counts by zone", rack.byZone.map(item => item.zone), rack.byZone.map(item => item.count), "#7c9cc8", "Number of records grouped by Rack Zone.")}${barChartSvg("Rack counts by cabinet size", rack.byCabinetSize.map(item => item.cabinetSize), rack.byCabinetSize.map(item => item.count), "#7aa88a", "Number of records grouped by the source Cabinet Size value.")}</div><div class="two-col">${barChartSvg("Rack counts by device type", rack.byDeviceType.map(item => item.deviceType), rack.byDeviceType.map(item => item.count), "#b296c7", "Number of records grouped by the source Device Type value.")}<div><p class="table-caption">Zone summary. U-capacity columns are intentionally unavailable and remain —.</p><div class="table-wrap"><table><thead><tr><th>Rack Zone</th><th>Rack Count</th><th>Used U</th><th>Available U</th></tr></thead><tbody>${zoneRows}</tbody></table></div></div></div><div class="two-col"><div><p class="table-caption">Status summary used by the charts above.</p><div class="table-wrap"><table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${statusRows}</tbody></table></div></div><div><h3>Rack validation</h3>${validationRows ? `<ul>${validationRows}</ul>` : `<p class="ok">No duplicate IDs, missing required fields, or invalid statuses detected.</p>`}<p class="muted">Unsupported U metrics: ${escapeHtml(rack.validation.unsupportedUMetrics.join(", "))}.</p></div></div></section>`;
}

function forecastSection(data: ReportData): string {
  const blocks: string[] = [];
  for (const forecast of [data.energyForecast, data.costForecast]) {
    if (!forecast) continue;
    const labels = forecast.points.map(point => formatMonth(point.monthStr));
    blocks.push(lineChartSvg(`${forecast.metric} forecast`, forecast.unit, labels, [
      { name: "Actual", color: "#5d7fa8", values: forecast.points.map(point => point.actual) },
      { name: "Forecast", color: "#d9776a", values: forecast.points.map(point => point.forecast), dash: "8 5" }
    ], "Solid points show actual workbook history; the dashed line shows the application forecast after the last actual month."));
  }
  return blocks.join("");
}

function rackInventorySection(rack: RackCapacityReport): string {
  const rows = rack.records.map(record => `<tr><td>${escapeHtml(record.rackZone ?? "—")}</td><td>${escapeHtml(record.rackId ?? "—")}</td><td>${escapeHtml(record.status ?? "—")}</td><td>${escapeHtml(record.cabinetSize ?? "—")}</td><td>${escapeHtml(record.detail ?? "—")}</td><td>${escapeHtml(record.deviceType ?? "—")}</td><td>${escapeHtml(record.remarks ?? "—")}</td></tr>`).join("");
  return `<section class="report-section"><h2>Rack Inventory</h2><p class="section-intro">One row per Rack Capacity / Table7 record. This is a read-only inventory view; blank source cells remain —.</p><p class="table-caption">Fields are copied from the workbook without deriving U-capacity or utilization values.</p><div class="table-wrap"><table><thead><tr><th>Rack Zone</th><th>Rack ID</th><th>Status</th><th>Cabinet Size</th><th>Detail</th><th>Device Type</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function buildReportHtml(data: ReportData): string {
  const labels = data.monthlyRows.map(row => formatMonth(row.month));
  const current = data.currentRow;
  const benchmarks = data.benchmarks.map(item => `<tr><td>${escapeHtml(item.metric)}</td><td>${escapeHtml(item.unit)}</td><td>${escapeHtml(formatMonth(item.period))}</td><td>${format2(item.current)}</td><td>${format2(item.baseline)}</td><td>${escapeHtml(item.baselineLabel)}</td></tr>`).join("");
  const omitted = data.sections.filter(section => !section.included).map(section => `${section.title}: ${section.reason ?? "not available"}`).join("; ");
  const sectionNotes = omitted ? `<p class="muted">Omitted sections: ${escapeHtml(omitted)}</p>` : "";
  const warningList = data.validationWarnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("");
  const insightList = data.insights.map(insight => `<li>${escapeHtml(insight)}</li>`).join("");
  const energyChart = lineChartSvg("แนวโน้มการใช้พลังงานไฟฟ้า", "kWh", labels, [
    { name: "Building Energy", color: "#5d7fa8", values: data.monthlyRows.map(row => row.buildingEnergyKwh) },
    { name: "4th Floor Energy", color: "#d9776a", values: data.monthlyRows.map(row => row.floorEnergyKwh) }
  ], "Monthly building consumption compared with the authoritative 4th Floor energy value for each reporting month.");
  const costChart = lineChartSvg("แนวโน้มค่าไฟฟ้า", "THB", labels, [
    { name: "Building Cost", color: "#5d7fa8", values: data.monthlyRows.map(row => row.buildingCostThb) },
    { name: "4th Floor Cost", color: "#d9776a", values: data.monthlyRows.map(row => row.floorCostThb) }
  ], "Monthly electricity cost comparison. Blank workbook values remain gaps rather than being converted to zero.");
  const subsystemChart = lineChartSvg("UPS, Air, and DC Energy", "kWh", labels, [
    { name: "UPS", color: "#7c9cc8", values: data.monthlyRows.map(row => row.upsEnergyKwh) },
    { name: "Air", color: "#7aa88a", values: data.monthlyRows.map(row => row.airEnergyKwh) },
    { name: "DC", color: "#b296c7", values: data.monthlyRows.map(row => row.dcEnergyKwh) }
  ], "Subsystem energy series are shown for context; missing source values are left as gaps in the lines.");
  const kpis = current
    ? `<div class="kpi-grid">${kpi("Building Energy", valueOrDash(current.buildingEnergyKwh), "kWh")}${kpi("Building Cost", valueOrDash(current.buildingCostThb), "THB")}${kpi("4th Floor Energy", valueOrDash(current.floorEnergyKwh), "kWh")}${kpi("4th Floor Cost", valueOrDash(current.floorCostThb), "THB")}${kpi("Average Rate", valueOrDash(current.averageRateThbPerKwh), "THB/kWh")}${kpi("4th Floor Share", formatPercent(current.floorSharePercent))}${kpi("UPS Energy", valueOrDash(current.upsEnergyKwh), "kWh")}${kpi("Air Energy", valueOrDash(current.airEnergyKwh), "kWh")}${kpi("DC Energy", valueOrDash(current.dcEnergyKwh), "kWh")}</div>`
    : `<p class="muted">No selected reporting month is available.</p>`;
  const benchmarkSection = data.benchmarks.length > 0 ? `<section class="report-section"><h2>Benchmark Summary</h2><p class="section-intro">Current values are compared with the selected workbook/application baseline. This table is descriptive and does not alter source calculations.</p><div class="table-wrap"><table><thead><tr><th>Metric</th><th>Unit</th><th>Period</th><th>Current</th><th>Baseline</th><th>Reference</th></tr></thead><tbody>${benchmarks}</tbody></table></div></section>` : "";
  const forecast = data.energyForecast || data.costForecast ? `<section class="report-section"><h2>Forecast Summary</h2><p class="muted">Forecasts use the existing application linear-regression utility. Actual values end at ${escapeHtml(formatMonth(data.energyForecast?.lastActualMonth ?? data.costForecast?.lastActualMonth ?? null))}; forecast horizon is ${data.energyForecast?.horizonMonths ?? data.costForecast?.horizonMonths ?? 0} month(s).</p>${forecastSection(data)}</section>` : "";
  const rack = data.rack ? `${rackSection(data.rack)}${rackInventorySection(data.rack)}` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>
  @page{size:A4 landscape;margin:14mm 12mm 15mm 12mm}*{box-sizing:border-box}html,body{margin:0;background:#fffaf7;color:#243247;font-family:${FONT_STACK};font-size:10.5px;line-height:1.45}body{padding:0 0 18mm}.cover{height:180mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}.cover h1{font-size:30px;line-height:1.2;margin:0 0 12px;color:#29415d}.cover h2{font-size:17px;font-weight:400;color:#7c6a68;margin:0 0 26px}.cover .meta{border-top:1px solid #e6d9d2;padding-top:16px;line-height:1.9;color:#5f6f82}.report-section{page-break-before:always;padding-top:2mm}.report-section:first-of-type{page-break-before:always}.report-section h2{font-size:19px;margin:0 0 8px;color:#29415d;border-bottom:2px solid #e8d7d0;padding-bottom:6px}.report-section h3,.chart-block h3{font-size:13px;color:#3e5874;margin:10px 0 4px}.section-intro,.chart-caption,.table-caption{color:#5f7083;margin:0 0 8px;line-height:1.45}.chart-caption,.table-caption{font-size:9.5px}.muted{color:#6c7b8c}.ok{color:#3d8064}.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 14px}.kpi{min-height:66px;padding:11px;background:#f5eee9;border:1px solid #e7d9d2;border-radius:7px}.kpi-label{font-size:9px;color:#67788b;text-transform:uppercase;letter-spacing:.04em}.kpi-value{font-size:17px;font-weight:700;margin-top:7px;color:#29415d;word-break:break-word}.kpi-unit{font-size:9px;color:#7c6a68;margin-top:2px}.chart-block{margin:12px 0 16px;background:#fff;border:1px solid #e7dcd6;border-radius:8px;padding:11px;break-inside:avoid}.chart-block svg{width:100%;height:auto;display:block}.grid{stroke:#eadfda;stroke-width:1}.axis-line{stroke:#98a6b6;stroke-width:1}.axis{fill:#657488;font-size:9px}.point-label{fill:#344c67;font-size:8px;font-weight:400}.legend-row{display:flex;align-items:center;gap:16px;margin-bottom:3px;color:#5e6f82;font-size:9px}.legend{display:inline-flex;align-items:center;gap:5px}.legend i{display:inline-block;width:12px;height:4px;border-radius:3px}.unit{margin-left:auto;color:#8a6f69}.report-grid{display:grid;gap:10px}.grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}.table-wrap{overflow:visible;margin:8px 0;break-inside:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:8.8px;line-height:1.35;table-layout:auto}thead{display:table-header-group}th{background:#eee3dd;color:#40566e;text-align:right;font-weight:700;padding:7px 6px;border:1px solid #dfd1ca;white-space:normal}th:first-child,td:first-child{text-align:left}td{text-align:right;padding:6px;border:1px solid #eadfda;vertical-align:top;word-break:break-word}tr{break-inside:avoid}ul{margin:6px 0 0 18px;padding:0;line-height:1.6}.empty-chart{padding:20px;color:#7d8997;background:#fff;border:1px dashed #d9cbc4}.page-footer{position:fixed;bottom:-10mm;left:0;right:0;text-align:center;color:#7d8997;font-size:8px}.page-footer .page::after{content:counter(page) " of " counter(pages)}
  </style></head><body><div class="page-footer">${escapeHtml(data.sourceWorkbook)} · ${escapeHtml(data.generatedAt)} · Page <span class="page"></span></div>
  <main class="cover"><h1>${escapeHtml(data.title)}</h1><h2>${escapeHtml(data.thaiSubtitle)}</h2><div class="meta"><div>Facility: ${escapeHtml(data.facility)}</div><div>Reporting month: ${escapeHtml(formatMonth(data.reportingMonth))}</div><div>Historical range: ${escapeHtml(formatMonth(data.historicalStart))} – ${escapeHtml(formatMonth(data.historicalEnd))}</div><div>Source workbook: ${escapeHtml(data.sourceWorkbook)}</div><div>Generated: ${escapeHtml(data.generatedAt)}</div><div>Application version: ${escapeHtml(data.appVersion)}</div><div>Data status: ${escapeHtml(data.status)}</div></div></main>
  <section class="report-section"><h2>Table of Contents</h2><ol><li>Executive Summary</li><li>Energy &amp; Cost KPI Summary</li><li>Energy Consumption Trend</li><li>Electricity Cost Trend</li><li>UPS, Air, and DC Summary</li><li>Historical Operations Summary</li><li>Monthly Energy &amp; Cost Table</li><li>Benchmark Summary and Forecast Summary (when available)</li><li>Smart Insights and Data-quality Warnings</li><li>Rack Capacity Summary and Rack Inventory (when available)</li><li>Report Information and Data Source</li></ol></section>
  <section class="report-section"><h2>Executive Summary</h2><p class="muted">This combined report contains the validated workbook history, Energy &amp; Cost trends, subsystem context, forecasts, benchmarks, and the read-only Rack Capacity summary.</p>${sectionNotes}</section>
  <section class="report-section"><h2>Energy &amp; Cost KPI Summary</h2><p class="section-intro">Selected-month KPIs copied from the authoritative workbook row. Values are displayed with the workbook-compatible units and precision.</p>${kpis}</section>
  <section class="report-section"><h2>Energy Consumption Trend</h2>${energyChart}</section>
  <section class="report-section"><h2>Electricity Cost Trend</h2>${costChart}</section>
  <section class="report-section"><h2>UPS, Air, and DC Summary</h2>${subsystemChart}</section>
  <section class="report-section"><h2>Historical Operations Summary</h2><p class="section-intro">Historical Energy, Cost, and subsystem values are sourced from the re-read workbook and calculated through the shared application utilities. The complete month-by-month values are listed once in the Monthly Energy &amp; Cost Table.</p>${data.currentRow ? `<div class="report-grid grid-4"><div class="kpi"><span class="kpi-label">Reporting month</span><strong>${escapeHtml(formatMonth(data.currentRow.month))}</strong></div><div class="kpi"><span class="kpi-label">Building Energy</span><strong>${format2(data.currentRow.buildingEnergyKwh)}</strong></div><div class="kpi"><span class="kpi-label">Building Cost</span><strong>${format2(data.currentRow.buildingCostThb)}</strong></div><div class="kpi"><span class="kpi-label">Status</span><strong>${escapeHtml(data.currentRow.status)}</strong></div></div>` : `<p class="muted">No reporting month is available.</p>`}</section>
  <section class="report-section"><h2>Monthly Energy &amp; Cost Table</h2>${monthlyTable(data.monthlyRows)}</section>
  ${benchmarkSection}${forecast}<section class="report-section"><h2>Smart Insights and Data-quality Warnings</h2><p class="section-intro">These notes describe validation and operational observations; they do not replace workbook values.</p><ul>${insightList}</ul>${warningList ? `<h3>Validation warnings</h3><ul>${warningList}</ul>` : ""}</section>${rack}<section class="report-section"><h2>Report Information and Data Source</h2><p class="table-caption">Export metadata and coverage information for this generated report.</p><div class="table-wrap"><table><tbody><tr><th>Source workbook</th><td>${escapeHtml(data.sourceWorkbook)}</td></tr><tr><th>Reporting month</th><td>${escapeHtml(formatMonth(data.reportingMonth))}</td></tr><tr><th>Historical range</th><td>${escapeHtml(formatMonth(data.historicalStart))} – ${escapeHtml(formatMonth(data.historicalEnd))}</td></tr><tr><th>Energy monthly rows</th><td>${data.monthlyRows.length}</td></tr><tr><th>Rack rows</th><td>${data.rack?.records.length ?? 0}</td></tr><tr><th>Data status</th><td>${escapeHtml(data.status)}</td></tr><tr><th>Omitted sections</th><td>${escapeHtml(omitted || "None")}</td></tr></tbody></table></div></section>
  <script>document.body.dataset.reportReady="true";</script></body></html>`;
}
