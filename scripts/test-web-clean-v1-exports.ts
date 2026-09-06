import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildAllFacilitiesCsv, buildAllFacilitiesReportHtml, buildFacilityCsv, buildSiteComparisonCsv, buildSiteComparisonReportModel, facilityExportSections, facilityReportData, fitPdfImageToPage, siteComparisonExportSections, workbookForFacilities, writeInteractiveExcelWorkbook, rackReportFromSnapshot, type SiteComparisonExport, type RackSnapshotApiResponse } from "../src/web-clean-v1/exports";
import type { ReportData } from "../src/reports/reportTypes";
import { buildCombinedCsv } from "../src/utils/exportData";
import { buildReportHtml, buildReportBodyPages } from "../src/reports/pdf/reportHtml";
import { trendChartXPosition } from "../src/reports/pdf/reportHtml";
import { calculateRackCapacityMetrics } from "../src/domain/rackCapacity";
import { defaultReportingPeriod, effectiveMonth, filterLogsByPeriod, type ReportingPeriodSelection } from "../src/web-clean-v1/reportPeriod";
import { defaultAllFacilitiesReportFilename, defaultReportFilename, withExtension } from "../src/web-clean-v1/reportFilename";
import type { MonthlyLog } from "../src/types";
import { readWorkbookSource } from "../server/migration/workbookSource";
import { readUpsGroupHistoryFromBuffer } from "../src/reports/upsGroupHistoryReader";
import { readUpsMappingFromBuffer } from "../src/reports/upsMappingReader";
import { readRackCapacityFromBuffer } from "../src/reports/rackCapacityReader";
import { readRackCapacityHistoryFromBuffer } from "../src/excel/RackCapacityHistoryWriter";
import { buildEngineeringDashboardSnapshot } from "../src/domain/engineeringDashboard";
import { buildDashboardUpsMapping } from "../src/web-clean-v1/dashboardUpsMapping";
import { addCurrentFacilityDashboard, addDashboardDataSheet } from "../src/web-clean-v1/excelDashboard";


const log = (month: string): MonthlyLog => ({
  month,
  ups: [],
  air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
  dc: [],
  energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 500 },
  lastSavedUps: null,
  lastSavedAir: null,
  lastSavedDc: null,
  lastSavedEnergyCost: null
});

const comparison: SiteComparisonExport = {
  displayPeriod: { startMonth: "2025-12", endMonth: "2026-01" },
  months: ["2025-12", "2026-01"],
  sites: [
    { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 50, floorCost: 250, avgRate: 5, floorShare: 50 } }] },
    { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [{ month: "2025-12", metrics: null }, { month: "2026-01", metrics: { buildingEnergy: 200, buildingCost: 900, floorEnergy: 80, floorCost: 360, avgRate: 4.5, floorShare: 40 } }] }
  ]
};

const allFacilities = buildAllFacilitiesCsv([{ siteName: "Rangsit", logs: [log("2026-01")] }, { siteName: "Srinakarin", logs: [log("2026-01")] }], null);
assert.match(allFacilities, /# Facility: Rangsit/);
assert.match(allFacilities, /# Facility: Srinakarin/);
assert.match(allFacilities, /# Energy_Cost/);

const comparisonModel = buildSiteComparisonReportModel(comparison, "2026-01");
const csv = buildSiteComparisonCsv(comparisonModel);
assert.match(csv, /Rangsit,rangsit,2026-01,100.00,500.00/);
assert.match(csv, /Srinakarin,srinakarin,2026-01,200.00,900.00/);
assert.doesNotMatch(csv, /undefined|NaN/);

// ============================================================
// Critical stale-data test: Excel, CSV, and PDF must all reflect the
// currently-selected Reporting Period/Month, never a previously-selected
// one. Verifies ACTUAL generated content (real XLSX bytes via ExcelJS,
// the real CSV string, the real PDF HTML string) - not just "a file was
// produced". Distinct, easily-distinguished energy values per month
// (611111 / 722222 / 833333) rule out accidental substring collisions.
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// Excel completeness gate: every facility export must keep the entered facts,
// save/audit state, calculated values, Dashboard-FAC tables, and persisted
// history tables in separate, inspectable worksheets. Existence alone is not
// enough - read the generated XLSX back and verify representative values too.
const completeExportWorkbook = await workbookForFacilities([{
  siteName: "Rangsit",
  logs: [{
    ...log("2026-06"),
    ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 }],
    dc: [{ panelId: "DC PDB41A", voltage: 220, current: 5 }],
    energyCost: { buildingEnergyKwh: 100, buildingElectricityCostThb: 500 },
    lastSavedUps: "2026-06-30T01:00:00.000Z",
    lastSavedAir: "2026-06-30T01:01:00.000Z",
    lastSavedDc: "2026-06-30T01:02:00.000Z",
    lastSavedEnergyCost: "2026-06-30T01:03:00.000Z"
  }],
  rackUnitCapacity: [{ month: "2026-06", totalU: 100, usedU: 40, availableU: 60, availabilityPct: 0.6, imageAttached: true, imageContentType: "image/png", imageSavedAt: "2026-06-30T01:04:00.000Z" }],
  rackHistory: [{ snapshotMonth: "2026-06", facility: "Rangsit", rackZone: "(Total)", totalRacks: 10, inUse: 4, available: 6, reserved: 0, pendingDismantle: 0, other: 0, usagePct: 0.4, availabilityPct: 0.6, reservedPct: 0, pendingDismantlePct: 0, otherPct: 0, generatedAt: "2026-06-30T01:00:00.000Z", dataVersion: 1 }],
  upsGroupHistory: { sourceSheet: "2. UPS Group History", rows: [{ facility: "Rangsit", month: "2026-06", group: "UPS 11", totalLoadKw: 2, totalLoadKva: 2.5, capacity: 400, loadPercent: 0.625, availablePercent: 99.375, monthlyEnergyKwh: 1440, generatedAt: "2026-06-30T01:00:00.000Z", dataVersion: 1 }] },
  dashboardMapping: { sourceSheet: "Dashboard-FAC", summary: [], mapping: [{ no: 1, umdb: "UMDB11A", upsId: "UPS 11A", acPowerPanel: "—", sts: "STS11A", oudb: "OUDB41A", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null }] },
  rackUnitCapacityImageDataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  rackUnitCapacityImageMeta: { savedAt: "2026-06-30T01:04:00.000Z", savedBy: "fixture", width: 1, height: 1 }
}]);
const completeSheetNames = completeExportWorkbook.worksheets.map(sheet => sheet.name);
check("Current Facility workbook starts with 01_Dashboard", completeSheetNames[0] === "01_Dashboard");
check("Current Facility workbook activates 01_Dashboard", (completeExportWorkbook as any).views?.[0]?.activeTab === 0);
const groupedNames = ["02_Saved_Energy", "03_Saved_Rack", "04_Saved_RackUnit", "05_Input_UPS", "06_Input_AirConditioning", "07_Input_DCPower", "08_Input_EnergyCost", "09_Input_Rack", "10_Calculation_Energy", "11_Calculation_UPS", "12_Calculation_UPS_Detail", "13_Calculation_4thFloor", "14_History_Energy", "15_History_Rack", "16_History_RackUnit", "17_History_UPS"];
check("Current Facility workbook uses Saved -> Input -> Calculation -> History sheet order", groupedNames.every((name, index) => completeSheetNames.indexOf(name) > completeSheetNames.indexOf("01_Dashboard") && (index === 0 || completeSheetNames.indexOf(name) > completeSheetNames.indexOf(groupedNames[index - 1]))));
check("Current Facility source sheets are native Excel Tables", groupedNames.every(name => Object.keys((completeExportWorkbook.getWorksheet(name) as any)?.tables ?? {}).length === 1));
check("Excel V2 tab colors distinguish report, saved, input, calculation, and history", completeExportWorkbook.getWorksheet("01_Dashboard")?.properties.tabColor?.argb === "FF007A75" && completeExportWorkbook.getWorksheet("02_Saved_Energy")?.properties.tabColor?.argb === "FF2563EB" && completeExportWorkbook.getWorksheet("05_Input_UPS")?.properties.tabColor?.argb === "FFF59E0B" && completeExportWorkbook.getWorksheet("10_Calculation_Energy")?.properties.tabColor?.argb === "FF7C3AED" && completeExportWorkbook.getWorksheet("11_Calculation_UPS")?.properties.tabColor?.argb === "FF7C3AED" && completeExportWorkbook.getWorksheet("13_Calculation_4thFloor")?.properties.tabColor?.argb === "FF7C3AED" && completeExportWorkbook.getWorksheet("14_History_Energy")?.properties.tabColor?.argb === "FF16A34A");
check("Excel V2 includes a visible Energy Cost input sheet", (completeExportWorkbook.getWorksheet("08_Input_EnergyCost")?.getSheetValues().flat().map(String).join("|") ?? "").includes("Building Energy (kWh)"));
check("Excel V2 includes a visible calculation sheet using dashboard values", (completeExportWorkbook.getWorksheet("10_Calculation_Energy")?.getSheetValues().flat().map(String).join("|") ?? "").includes("100"));
check("Excel V2 includes visible UPS summary and detailed calculation sheets", (completeExportWorkbook.getWorksheet("11_Calculation_UPS")?.getSheetValues().flat().map(String).join("|") ?? "").includes("Monthly Energy (kWh)") && (completeExportWorkbook.getWorksheet("12_Calculation_UPS_Detail")?.getSheetValues().flat().map(String).join("|") ?? "").includes("UMDB"));
const upsStatusHelper = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("UPS_Status"));
check("Excel V2 precomputes UPS Status by month in a hidden helper", Boolean(upsStatusHelper) && upsStatusHelper?.state === "hidden" && (upsStatusHelper?.getSheetValues().flat().map(String).join("|") ?? "").includes("group(s) - max"));
const dashboardFormulaText = completeExportWorkbook.getWorksheet("01_Dashboard")?.getSheetValues().flat().map(value => typeof value === "object" && value !== null && "formula" in value ? String((value as { formula?: unknown }).formula ?? "") : "").join("|") ?? "";
check("Excel V2 UPS Status avoids MAXIFS for older Excel compatibility", !dashboardFormulaText.includes("MAXIFS") && dashboardFormulaText.includes("UPS_Status") && dashboardFormulaText.includes("INDEX("));
check("Excel V2 includes a dedicated visible 4th Floor electricity sheet", (completeExportWorkbook.getWorksheet("13_Calculation_4thFloor")?.getSheetValues().flat().map(String).join("|") ?? "").includes("4th Floor Estimated Cost (THB)"));
check("Excel V2 includes Rack Unit and UPS history sheets", Boolean(completeExportWorkbook.getWorksheet("16_History_RackUnit")) && Boolean(completeExportWorkbook.getWorksheet("17_History_UPS")));
const visibleCurrentNames = completeExportWorkbook.worksheets.filter((sheet: any) => sheet.state !== "hidden").map((sheet: any) => sheet.name);
check("Excel V2 hides legacy compatibility sheets from the normal workbook view", !visibleCurrentNames.some((name: string) => /^(20 |21 |22 |23 |24 |25 |26 |27 |28 |29 |30 |31 |32 |33 |34 |35 |36 )/.test(name)));
check("Excel V2 Dashboard O5 navigation starts with the first visible data sheet", completeExportWorkbook.getWorksheet("01_Dashboard")?.getCell("O5").value === "02_Saved_Energy");
check("Excel V2 every visible non-dashboard sheet has an A1 Home label ready for native link injection", completeExportWorkbook.worksheets.filter((sheet: any) => sheet.state !== "hidden" && sheet.name !== "01_Dashboard").every((sheet: any) => sheet.getCell("A1").value === "⌂ Home"));
check("Excel V2 sheet navigation is widened across O:Q and does not wrap long sheet names", completeExportWorkbook.getWorksheet("01_Dashboard")?.getCell("Q5").master.address === "O5" && [15,16,17].every(column => (completeExportWorkbook.getWorksheet("01_Dashboard")?.getColumn(column).width ?? 0) >= 16) && completeExportWorkbook.getWorksheet("01_Dashboard")?.getCell("O5").alignment?.shrinkToFit === true);
check("Excel V2 current table timestamps use dd-Mmm-YYYY_HH:MM:SS(GMT+7)", completeExportWorkbook.getWorksheet("05_Input_UPS")?.getCell("I3").value === "30-Jun-2026_08:00:00(GMT+7)" && completeExportWorkbook.getWorksheet("17_History_UPS")?.getCell("J3").value === "30-Jun-2026_08:00:00(GMT+7)");
for (const fragment of ["UPS_Loads", "Air_Inputs", "DC_Inputs", "Energy_Cost", "Saved_Records", "Saved_Values", "Raw_Inputs", "Calculated_Energy", "Dashboard-FAC", "Dashboard-FAC UPS", "Dashboard-FAC Air", "Dashboard-FAC DC", "Rack Unit Capacity", "Rack Capacity History", "UPS Group History", "Rack Capacity Raw"]) {
  check(`complete Excel export has ${fragment} table`, completeSheetNames.some(name => name.includes(fragment)));
}
const dashboardSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Dashboard-FAC") && !sheet.name.includes("UPS") && !sheet.name.includes("Air") && !sheet.name.includes("DC"));
const dashboardText = dashboardSheet?.getSheetValues().flat().map(String).join("|") ?? "";
check("Dashboard-FAC export contains the selected facility's calculated value", dashboardText.includes("100"));
const dashboardDetailSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Dashboard-FAC Detail"));
check("Dashboard-FAC Details export contains the Desktop mapping row", (dashboardDetailSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("UPS 11A"));
const rackUnitSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Rack Unit Capacity"));
check("Rack Unit Capacity export contains persisted Total (U)", (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("100"));
check("Rack Unit Capacity export exposes image attachment status without exposing storage keys", (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Image Attached") && (rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Yes") && !(rackUnitSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("objectKey"));
const savedRackUnitSourceSheet = completeExportWorkbook.getWorksheet("04_Saved_RackUnit");
const savedRackUnitSourceText = savedRackUnitSourceSheet?.getSheetValues().flat().map(String).join("|") ?? "";
check("Saved RackUnit source sheet contains persisted numeric values", savedRackUnitSourceText.includes("2026-06") && savedRackUnitSourceText.includes("100") && savedRackUnitSourceText.includes("40") && savedRackUnitSourceText.includes("60"));
check("Saved RackUnit source sheet embeds the selected image", ((savedRackUnitSourceSheet as any)?._media?.length ?? 0) === 1);
const savedValuesSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("Saved_Values"));
check("Saved Values export contains Rack Unit image metadata column", (savedValuesSheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("Rack Unit Image JSON"));
const interactiveXlsx = await writeInteractiveExcelWorkbook(completeExportWorkbook);
const serializedV2Workbook = new ExcelJS.Workbook();
await serializedV2Workbook.xlsx.load(interactiveXlsx);
check("Serialized Excel V2 retains category tab colors", serializedV2Workbook.getWorksheet("01_Dashboard")?.properties.tabColor?.argb === "FF007A75" && serializedV2Workbook.getWorksheet("02_Saved_Energy")?.properties.tabColor?.argb === "FF2563EB" && serializedV2Workbook.getWorksheet("05_Input_UPS")?.properties.tabColor?.argb === "FFF59E0B" && serializedV2Workbook.getWorksheet("10_Calculation_Energy")?.properties.tabColor?.argb === "FF7C3AED" && serializedV2Workbook.getWorksheet("11_Calculation_UPS")?.properties.tabColor?.argb === "FF7C3AED" && serializedV2Workbook.getWorksheet("13_Calculation_4thFloor")?.properties.tabColor?.argb === "FF7C3AED" && serializedV2Workbook.getWorksheet("14_History_Energy")?.properties.tabColor?.argb === "FF16A34A");
check("Serialized Excel V2 retains Dashboard navigation and Home labels", serializedV2Workbook.getWorksheet("01_Dashboard")?.getCell("O5").value === "02_Saved_Energy" && serializedV2Workbook.getWorksheet("02_Saved_Energy")?.getCell("A1").value === "⌂ Home");
const legacyUpsSheet = completeExportWorkbook.worksheets.find(sheet => sheet.name.includes("UPS_Loads"));
check("Hidden legacy compatibility timestamp remains raw ISO", legacyUpsSheet?.getCell("H2").value === "2026-06-30T01:00:00.000Z");
const interactiveZip = await JSZip.loadAsync(interactiveXlsx);
const interactiveParts = Object.keys(interactiveZip.files);
const chartParts = interactiveParts.filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name));
check("Interactive Excel export contains eight native editable Executive V2 charts", chartParts.length === 8);
const dashboardXmlParts: string[] = [];
for (const name of interactiveParts.filter(item => /^xl\/worksheets\/sheet\d+\.xml$/.test(item))) {
  const file = interactiveZip.file(name);
  if (file) dashboardXmlParts.push(await file.async("string"));
}
const dashboardSheetXml = dashboardXmlParts.find(xml => xml.includes("MATCH($B$3")) ?? "";
check("Interactive Dashboard has a reporting-month dropdown", dashboardSheetXml.includes("dataValidations") && dashboardSheetXml.includes("AvailableReportingMonths"));
check("Interactive Dashboard cards use the selected month", dashboardSheetXml.includes("MATCH($B$3"));
check("Serialized Excel V2 contains a native OOXML internal link from O5 to the first visible sheet", dashboardSheetXml.includes(`<hyperlink ref="O5" location="&apos;02_Saved_Energy&apos;!A1" display="02_Saved_Energy"/>`));
check("Serialized Excel V2 contains native OOXML Home links back to 01_Dashboard", dashboardXmlParts.some(xml => xml.includes(`<hyperlink ref="A1" location="&apos;01_Dashboard&apos;!A1" display="Home"/>`)));
check("Serialized Excel V2 navigation uses native location links instead of fragile HYPERLINK formulas", !dashboardSheetXml.includes("HYPERLINK("));
const chartFile = chartParts.length > 0 ? interactiveZip.file(chartParts[0]) : null;
const chartXml = chartFile ? await chartFile.async("string") : "";
check("Interactive Dashboard chart references the exported native Trend_Data range", chartXml.includes("98_Trend_Data") && chartXml.includes("4th Floor Estimated Cost Trend (THB)"));
check("Interactive line charts show value labels without noisy series/category names", chartXml.includes("showCatName val=\"0\"") && chartXml.includes("showSerName val=\"0\"") && chartXml.includes("showVal val=\"1\"") && chartXml.includes("dLblPos val=\"t\""));
check("Interactive charts provide a bottom legend", chartXml.includes("legendPos val=\"b\"") && chartXml.includes("overlay val=\"0\""));
check("Interactive Excel export contains a worksheet drawing relationship", interactiveParts.some(name => /xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) && interactiveParts.some(name => /xl\/drawings\/drawing\d+\.xml$/.test(name)));
const dashboardDrawingParts: string[] = [];
for (const name of interactiveParts.filter(item => /^xl\/drawings\/drawing\d+\.xml$/.test(item))) { const file = interactiveZip.file(name); if (file) dashboardDrawingParts.push(await file.async("string")); }
const dashboardChartDrawing = dashboardDrawingParts.find(xml => xml.includes("<xdr:graphicFrame")) ?? "";
const dashboardChartAnchors = [...dashboardChartDrawing.matchAll(/<xdr:twoCellAnchor[\s\S]*?<c:chart r:id="[^"]+"\/>[\s\S]*?<\/xdr:twoCellAnchor>/g)].map(match => match[0]);
check("Interactive Excel V2 uses one full-width chart per row", dashboardChartAnchors.length === 8 && dashboardChartAnchors.every(anchor => /<xdr:from><xdr:col>0<\/xdr:col>/.test(anchor) && /<xdr:to><xdr:col>14<\/xdr:col>/.test(anchor)));
  const chartTitles: string[] = [];
  const chartXmlParts: string[] = [];
  for (const name of chartParts) {
    const file = interactiveZip.file(name);
    if (file) {
      const xml = await file.async("string");
      chartXmlParts.push(xml);
      chartTitles.push(xml.match(/<a:t>([^<]+)<\/a:t>/)?.[1] ?? "");
    }
  }
  const allChartXml = chartXmlParts.join("\n");
  check("Interactive Excel line-series labels alternate above/below to reduce collisions", allChartXml.includes('dLblPos val="t"') && allChartXml.includes('dLblPos val="b"'));
  check("Interactive Excel line charts leave category-edge breathing room", allChartXml.includes('crossBetween val="between"'));
  check("Interactive Excel trend colors align with the approved Web palette", ["10B981","2563EB","F59E0B","4F46E5","06B6D4","8B5CF6"].every(color => allChartXml.includes(`srgbClr val="${color}"`)));
  check("Interactive Excel charts use compact K/M label formats when the plotted scale is long", allChartXml.includes('&quot;K&quot;') || allChartXml.includes('&quot;M&quot;') || allChartXml.includes('&quot;B&quot;'));
  check("Interactive Excel export charts mirror the PDF trend set in order", JSON.stringify(chartTitles) === JSON.stringify(["4th Floor Estimated Cost Trend (THB)", "4th Floor Total Energy Trend (kWh)", "4th Floor Average Electricity Rate Trend (THB/kWh)", "4th Floor UPS Energy Trend (kWh)", "4th Floor Air Conditioning Energy Trend (kWh)", "4th Floor DC Power Energy Trend (kWh)", "Rack Capacity Trend", "Rack Unit Capacity Trend"]));
  check("Interactive Excel export embeds rack image media", interactiveParts.some(name => /^xl\/media\/image\d+\.(png|jpe?g)$/.test(name)));
  check("Interactive Excel export contains no macro project", !interactiveParts.includes("xl/vbaProject.bin"));
const auditUser = "Patamin Thevase";
const auditTimestamp = "2026-09-05T11:03:07.000Z";
const auditTimestampDisplay = "05-Sep-2026_18:03:07(GMT+7)";
const selectionWorkbook = await workbookForFacilities([{ siteName: "Rangsit", selectedMonth: "2026-05", generatedBy: auditUser, generatedAt: auditTimestamp, reportingMonths: ["2026-05", "2026-06"], logs: [{ ...log("2026-05"), lastSavedEnergyCost: auditTimestamp, energyCost: { buildingEnergyKwh: 200, buildingElectricityCostThb: 1000 } }, { ...log("2026-06"), energyCost: { buildingEnergyKwh: 300, buildingElectricityCostThb: 1500 } }] }] as any);
const selectionDashboard = selectionWorkbook.getWorksheet("01_Dashboard")!;
check("Current Facility export keeps the UI-selected month", selectionDashboard.getCell("B3").value === "2026-05");
check("Current Facility Excel first sheet shows the authenticated display name", selectionDashboard.getCell("H3").value === auditUser);
check("Current Facility Excel first sheet shows the export timestamp", selectionDashboard.getCell("K3").value === auditTimestampDisplay);
check("Current Facility retains the shared Dashboard-FAC Air source used by report calculations", Boolean(selectionWorkbook.getWorksheet("31 Dashboard-FAC Air")));
const selectionDashboardText = selectionDashboard.getSheetValues().flat().map(String);
const selectionSurface = selectionDashboardText.join("|");
check("Current Facility 01_Dashboard starts with Building Energy Dashboard before Executive View", selectionDashboard.getCell("A5").value === "Engineering View · Building Energy Dashboard" && selectionDashboard.getCell("A15").value === "Executive View");
check("Current Facility 01_Dashboard keeps V3 Capacity/Rack after Energy trends", selectionDashboard.getCell("A22").value === "Energy & Cost Trends" && selectionDashboard.getCell("A145").value === "Capacity Overview · Rack Capacity + Rack Unit" && selectionDashboard.getCell("A153").value === "Rack Capacity & Utilization V3" && selectionDashboard.getCell("A180").value === "Rack Unit Capacity & Utilization V3");
check("Current Facility Excel Engineering cards include UPS/PPC, Air and DC totals", ["2.1 Total UPS/PPC Load - DCM 4th Floor (kW)", "2.2 Total Air (kWh)", "2.3 Total DC Power Panels (kWh)"].every(label => selectionSurface.includes(label)));
const engineeringCardLabels = [selectionDashboard.getCell("A7").value, selectionDashboard.getCell("E7").value, selectionDashboard.getCell("J7").value, selectionDashboard.getCell("A11").value, selectionDashboard.getCell("F11").value, selectionDashboard.getCell("K11").value].map(String);
check("Current Facility Excel Engineering removes the four Executive-duplicate cards", !engineeringCardLabels.some(label => ["Building Energy (kWh)", "Building Electricity Cost (THB)", "4th Floor Energy (kWh)", "Estimated 4th Floor Cost (THB)"].includes(label)));
check("Current Facility Excel applies Rack Capacity and Rack Unit V3 sections", selectionSurface.includes("Rack Capacity & Utilization V3") && selectionSurface.includes("Rack Unit Capacity & Utilization V3") && selectionSurface.includes("Reserved (racks)") && selectionSurface.includes("Available U (U)"));
check("Current Facility Excel Executive contains exactly the four approved KPI cards", [selectionDashboard.getCell("A17").value, selectionDashboard.getCell("D17").value, selectionDashboard.getCell("H17").value, selectionDashboard.getCell("K17").value].join("|") === "Building Energy (kWh)|Building Cost (THB)|4th Floor Energy (kWh)|Estimated 4th Floor Cost (THB)");
check("Current Facility Excel includes Facility Trend Analytics building and 4th Floor summary cards", selectionSurface.includes("Facility Trend Analytics Summary") && selectionSurface.includes("Building Energy Total (kWh)") && selectionSurface.includes("4th Floor Energy Total (kWh)") && selectionSurface.includes("Building Energy Monthly Average (kWh)") && selectionSurface.includes("4th Floor Energy Monthly Average (kWh)") && selectionSurface.includes("Building Cost Total (THB)") && selectionSurface.includes("4th Floor Cost Total (THB)") && selectionSurface.includes("Building Cost Monthly Average (THB)") && selectionSurface.includes("4th Floor Cost Monthly Average (THB)"));

check("Current Facility Excel Engineering omits Executive duplicate KPI cards", ["Building Energy (kWh)", "Building Cost (THB)", "4th Floor Energy (kWh)", "Estimated 4th Floor Cost (THB)"].every(label => !selectionDashboard.getSheetValues().slice(5, 15).flat().map(String).includes(label)));
check("Current Facility Excel Rack V3 KPI blocks include explicit units", ["Total Racks (racks)", "In Use (racks)", "Available (racks)", "Reserved (racks)", "Pending Dismantle (racks)", "Total U (U)", "Used U (U)", "Available U (U)", "Usage (%)", "Availability (%)"].every(label => selectionSurface.includes(label)));
const visibleCurrentSheets = selectionWorkbook.worksheets.filter(sheet => sheet.state !== "hidden" && sheet.name !== "01_Dashboard");
check("Current Facility Dashboard provides vertical sheet navigation labels from O5", visibleCurrentSheets.every((target, index) => selectionDashboard.getCell(5 + index, 15).value === target.name));
check("Every visible Current Facility data sheet has an A1 Home label", visibleCurrentSheets.every(target => target.getCell("A1").value === "⌂ Home"));
const currentUpsSheet = selectionWorkbook.getWorksheet("05_Input_UPS")!;
check("Current Facility tables start below Home and retain headers", currentUpsSheet.getCell("A1").value && currentUpsSheet.getCell("A2").value === "Month");
check("Current Facility table timestamps use dd-Mmm-YYYY_HH:MM:SS(GMT+7)", selectionWorkbook.getWorksheet("08_Input_EnergyCost")?.getCell(3, 7).value === auditTimestampDisplay);

// Excel dashboard usability regression: latest month is the final source row, and large KPI values must never render as ####.
{
  const layoutWorkbook = new ExcelJS.Workbook();
  const layoutMetrics = [
    { month: "2026-06", buildingEnergyKwh: 3000000, buildingCostThb: 12000000, floorEnergyKwh: 850000, floorCostThb: 3200000, averageRateThbPerKwh: 4, floorSharePercent: 28.33, upsEnergyKwh: 500000, airEnergyKwh: 300000, dcEnergyKwh: 50000, upsLoadKw: 1100, upsLoadPercent: 79 },
    { month: "2026-07", buildingEnergyKwh: 3200000, buildingCostThb: 12500000, floorEnergyKwh: 880000, floorCostThb: 3300000, averageRateThbPerKwh: 3.9, floorSharePercent: 27.5, upsEnergyKwh: 520000, airEnergyKwh: 310000, dcEnergyKwh: 50000, upsLoadKw: 1150, upsLoadPercent: 78 },
    { month: "2026-08", buildingEnergyKwh: 3447297.8, buildingCostThb: 13000000, floorEnergyKwh: 912905.81, floorCostThb: 3447297.8, averageRateThbPerKwh: 3.78, floorSharePercent: 23.97, upsEnergyKwh: 575000, airEnergyKwh: 331823.4, dcEnergyKwh: 6230.63, upsLoadKw: 1234.56, upsLoadPercent: 79 }
  ].map(metric => ({ ...metric, rackTotalU: null, rackUsedU: null, rackAvailableU: null, rackUsagePercent: null, rackTotalPositions: null, rackInUsePositions: null, rackAvailablePositions: null, rackPositionUsagePercent: null, rackPositionAvailabilityPercent: null, rackReservedPositions: null, rackPendingPositions: null })) as any;
  addDashboardDataSheet(layoutWorkbook, "99_Dashboard_Data", layoutMetrics);
  addDashboardDataSheet(layoutWorkbook, "98_Trend_Data", layoutMetrics);
  addCurrentFacilityDashboard(layoutWorkbook, "Rangsit", layoutMetrics, { dashboardSheetName: "01_Dashboard", dataSheetName: "99_Dashboard_Data", selectedMonth: "2026-08", exportedAt: auditTimestamp, airSheetName: "06_Input_AirConditioning", airDashboardSheetName: "31 Dashboard-FAC Air", rackSheetName: "03_Saved_Rack", rackUnitSheetName: "04_Saved_RackUnit", upsSheetName: "29 Dashboard-FAC UPS", upsOverallSheetName: "37 Dashboard-FAC UPS Overall", detailSheetName: "30 Dashboard-FAC Details", dcSheetName: "32 Dashboard-FAC DC", totalsSheetName: "38 Dashboard-FAC Totals", airFields: [], airRows: [], airDashboardRows: [], upsRows: [["2026-08", "UPS 1", 0, 0, 1000, 79, 21, 0], ["2026-08", "UPS 2", 0, 0, 1000, 70, 30, 0], ["2026-08", "UPS 3", 0, 0, 1000, 60, 40, 0], ["2026-08", "UPS 4", 0, 0, 1000, 50, 50, 0]], upsOverallRows: [], detailRows: [], dcRows: [], totalsRows: [], rackRows: [], rackUnitRows: [], trendMetrics: layoutMetrics, trendDataSheetName: "98_Trend_Data" } as any);
  const layoutDashboard = layoutWorkbook.getWorksheet("01_Dashboard")!;
  const expected = new Map([["E8","23.97"],["J8","3.78"],["A12","1,234.56"],["F12","331,823.40"],["K12","6,230.63"],["A18","3,447,297.80"],["D18","13,000,000.00"],["H18","912,905.81"],["K18","3,447,297.80"]]);
  check("Excel 01_Dashboard latest-month KPI cards retain complete cached values", [...expected].every(([address, value]) => (layoutDashboard.getCell(address).value as any)?.result === value));
  check("Excel 01_Dashboard numeric KPI cards use TEXT formulas plus shrink-to-fit so Excel cannot render ####", [...expected.keys()].every(address => { const cell = layoutDashboard.getCell(address); const value = cell.value as any; return cell.numFmt === "@" && String(value?.formula ?? "").includes("TEXT(") && cell.alignment?.shrinkToFit === true; }));
  check("Excel 01_Dashboard selected latest month lookup range includes the final source row", String((layoutDashboard.getCell("F12").value as any)?.formula ?? "").includes("$J$2:$J$4") && String((layoutDashboard.getCell("F12").value as any)?.formula ?? "").includes("$A$2:$A$4"));
}

// Quick Period contract: Dashboard/report data follows the selected report scope.
// Saved/Input/Calculation/History sheets retain the full visible history payload; when
// that scope contains one month, charts still receive trailing calculation history.
const trailingTwelveMonths = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
const trailingTwelveLogs = trailingTwelveMonths.map((month, index) => ({ ...log(month), energyCost: { buildingEnergyKwh: 1000 + index, buildingElectricityCostThb: 5000 + index } }));
const oneMonthWorkbook = await workbookForFacilities([{
  siteName: "Rangsit",
  selectedMonth: "2026-05",
  reportingMonths: ["2026-05"],
  logs: [trailingTwelveLogs.at(-1)!],
  calculationLogs: trailingTwelveLogs
}] as any);
const oneMonthReportData = oneMonthWorkbook.getWorksheet("99_Dashboard_Data")!;
const oneMonthTrendData = oneMonthWorkbook.getWorksheet("98_Trend_Data")!;
const oneMonthEnergyInput = oneMonthWorkbook.worksheets.find(sheet => sheet.name.includes("Energy_Cost_Inputs"))!;
check("One-month Excel Dashboard data contains only the selected Quick Period month while source sheets retain full calculation history", oneMonthReportData.rowCount === 2 && oneMonthEnergyInput.rowCount === trailingTwelveMonths.length + 1 && oneMonthEnergyInput.getCell(2, 1).value === "2025-06" && oneMonthEnergyInput.getCell(trailingTwelveMonths.length + 1, 1).value === "2026-05");
check("One-month Excel charts receive trailing 12 months", oneMonthTrendData.rowCount === 13 && oneMonthTrendData.getCell(2, 1).value === "2025-06" && oneMonthTrendData.getCell(13, 1).value === "2026-05");
check("One-month Current Facility Rack Unit chart uses the same trailing 12 trend data sheet", oneMonthTrendData.getCell(2, 2).value === "Jun-25" && oneMonthTrendData.getCell(13, 2).value === "May-26");

const twoMonthWorkbook = await workbookForFacilities([{
  siteName: "Rangsit",
  selectedMonth: "2026-05",
  reportingMonths: ["2026-04", "2026-05"],
  logs: trailingTwelveLogs.slice(-2),
  calculationLogs: trailingTwelveLogs
}] as any);
const twoMonthTrendData = twoMonthWorkbook.getWorksheet("98_Trend_Data")!;
check("Multi-month Excel charts follow Quick Period instead of expanding to 12 months", twoMonthTrendData.rowCount === 3 && twoMonthTrendData.getCell(2, 1).value === "2026-04" && twoMonthTrendData.getCell(3, 1).value === "2026-05");
const extendedTrendMonths = ["2025-04", "2025-05", ...trailingTwelveMonths];
const extendedTrendLogs = extendedTrendMonths.map((month, index) => ({ ...log(month), energyCost: { buildingEnergyKwh: 900 + index, buildingElectricityCostThb: 4500 + index } }));
for (const [label, count] of [["3 Months", 3], ["6 Months", 6], ["12 Months", 12]] as const) {
  const selectedMonths = extendedTrendMonths.slice(-count);
  const scopedWorkbook = await workbookForFacilities([{
    siteName: "Rangsit",
    selectedMonth: extendedTrendMonths.at(-1),
    reportingMonths: selectedMonths,
    logs: extendedTrendLogs.slice(-count),
    calculationLogs: extendedTrendLogs
  }] as any);
  const trendData = scopedWorkbook.getWorksheet("98_Trend_Data")!;
  check(`Excel ${label} trend contains exactly ${count} reporting months`, trendData.rowCount === count + 1 && trendData.getCell(2, 1).value === selectedMonths[0] && trendData.getCell(count + 1, 1).value === selectedMonths.at(-1));
}
const fullTrendWorkbook = await workbookForFacilities([{
  siteName: "Rangsit",
  selectedMonth: extendedTrendMonths.at(-1),
  reportingMonths: extendedTrendMonths,
  logs: extendedTrendLogs,
  calculationLogs: extendedTrendLogs
}] as any);
const fullTrendData = fullTrendWorkbook.getWorksheet("98_Trend_Data")!;
check("Excel Full History trend keeps all reporting months instead of truncating to 12", fullTrendData.rowCount === extendedTrendMonths.length + 1 && fullTrendData.getCell(2, 1).value === extendedTrendMonths[0] && fullTrendData.getCell(extendedTrendMonths.length + 1, 1).value === extendedTrendMonths.at(-1));

const multiAuditWorkbook = await workbookForFacilities([
  { siteName: "Rangsit", siteCode: "RST", generatedBy: auditUser, generatedAt: auditTimestamp, logs: [log("2026-05")] },
  { siteName: "Srinakarin", siteCode: "SNK", generatedBy: auditUser, generatedAt: auditTimestamp, logs: [log("2026-05")] }
]);
const multiAuditFirstSheet = multiAuditWorkbook.worksheets[0]!;
check("All Facilities Excel first sheet shows the authenticated display name", multiAuditFirstSheet.getCell("H3").value === auditUser);
check("All Facilities Excel first sheet shows the export timestamp", multiAuditFirstSheet.getCell("K3").value === auditTimestampDisplay);
const rackOnlyExport = await workbookForFacilities([{
  siteName: "Rangsit",
  logs: [],
  reportingMonths: ["2026-08"],
  rackUnitCapacity: [{ month: "2026-08", totalU: 200, usedU: 50, availableU: 150, availabilityPct: 0.75 }]
}]);
const rackOnlySheet = rackOnlyExport.worksheets.find(sheet => sheet.name.includes("Rack Unit Capacity"));
check("Rack Unit-only historical month is exported even when no MonthlyLog exists", (rackOnlySheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("2026-08") && (rackOnlySheet?.getSheetValues().flat().map(String).join("|") ?? "").includes("200"));

const june = { ...log("2026-06"), energyCost: { buildingEnergyKwh: 611111, buildingElectricityCostThb: 3055555 } };
const july = { ...log("2026-07"), energyCost: { buildingEnergyKwh: 722222, buildingElectricityCostThb: 3611110 } };
const august = { ...log("2026-08"), energyCost: { buildingEnergyKwh: 833333, buildingElectricityCostThb: 4166665 } };
const threeMonthLogs = [june, july, august];

/** Mirrors reportHtml.ts's internal (unexported) formatMonth: the PDF
 *  renders a human-readable "Mon YYYY" label, not the raw ISO month
 *  string - matching Desktop's report convention, not a defect. */
function humanMonthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

async function assertExportsShowOnlyMonth(monthLabel: string, selection: ReportingPeriodSelection, appMonth: string): Promise<void> {
  const scoped = filterLogsByPeriod(threeMonthLogs, selection, appMonth);
  check(`${monthLabel}: scoped log set contains exactly one month`, scoped.length === 1 && scoped[0].month === monthLabel);

  // CSV
  const csvContent = buildCombinedCsv(scoped);
  check(`${monthLabel}: CSV contains the selected month`, csvContent.includes(monthLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: CSV does not contain ${other}`, !csvContent.includes(other));
  }

  // Excel - real workbook bytes, read back with ExcelJS.
  const workbook = await workbookForFacilities([{ siteName: "Rangsit", logs: scoped }]);
  const buffer = await workbook.xlsx.writeBuffer();
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(buffer as unknown as ArrayBuffer);
  const energySheet = reread.worksheets.find(sheet => sheet.name.includes("Energy_Cost"));
  check(`${monthLabel}: Excel has an Energy_Cost sheet`, Boolean(energySheet));
  const sheetText = energySheet!.getSheetValues().flat().map(String).join("|");
  check(`${monthLabel}: Excel sheet contains the selected month`, sheetText.includes(monthLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: Excel sheet does not contain ${other}`, !sheetText.includes(other));
  }

  // PDF - real generated HTML string. Reports render a human-readable
  // "Mon YYYY" month label (e.g. "Jun 2026"), not the raw ISO string.
  const reportData = facilityReportData(scoped, "Rangsit", monthLabel);
  const html = buildReportHtml(reportData);
  const humanLabel = humanMonthLabel(monthLabel);
  check(`${monthLabel}: PDF HTML contains the selected reporting month (as "${humanLabel}")`, html.includes(humanLabel));
  for (const other of threeMonthLogs.map(l => l.month).filter(m => m !== monthLabel)) {
    check(`${monthLabel}: PDF HTML does not contain ${humanMonthLabel(other)}`, !html.includes(humanMonthLabel(other)));
  }
}

// Simulates: app starts on 2026-08 (today), user selects Single Month =
// 2026-06 in the Reports view, generates all three formats, then switches
// to 2026-07 and regenerates - each pass must show only its own month.
await assertExportsShowOnlyMonth("2026-06", { mode: "single", singleMonth: "2026-06", rangeStart: "2026-06", rangeEnd: "2026-06" }, "2026-08");
await assertExportsShowOnlyMonth("2026-07", { mode: "single", singleMonth: "2026-07", rangeStart: "2026-07", rangeEnd: "2026-07" }, "2026-08");

// "Current Month" mode follows the app's live reporting month directly,
// with no separate stored selection to go stale.
const currentModeJune: ReportingPeriodSelection = { mode: "current", singleMonth: "2026-06", rangeStart: "2026-06", rangeEnd: "2026-06" };
check("Current Month mode resolves to the app's live month", effectiveMonth(currentModeJune, "2026-06") === "2026-06");
check("Current Month mode filters to exactly that month", filterLogsByPeriod(threeMonthLogs, currentModeJune, "2026-06").length === 1);

const defaultPeriodJune = defaultReportingPeriod("2026-06");
check("Default Reporting Period is Last 3 Months", defaultPeriodJune.mode === "range" && defaultPeriodJune.rangeStart === "2026-04" && defaultPeriodJune.rangeEnd === "2026-06");
check("Default Last 3 Months includes the latest available log rows", filterLogsByPeriod(threeMonthLogs, defaultPeriodJune, "2026-06").length === 1);
const fullHistory: ReportingPeriodSelection = { mode: "full", singleMonth: "2026-08", rangeStart: "2026-06", rangeEnd: "2026-08" };
check("Full History mode includes every fetched month", filterLogsByPeriod(threeMonthLogs, fullHistory, "2026-08").length === 3);

// Month Range mode: inclusive boundaries, excludes months outside the range.
const juneToJuly: ReportingPeriodSelection = { mode: "range", singleMonth: "2026-06", rangeStart: "2026-06", rangeEnd: "2026-07" };
const rangeScoped = filterLogsByPeriod(threeMonthLogs, juneToJuly, "2026-08");
check("Month Range includes both boundary months", rangeScoped.some(l => l.month === "2026-06") && rangeScoped.some(l => l.month === "2026-07"));
check("Month Range excludes a month outside the range", !rangeScoped.some(l => l.month === "2026-08"));
const rangeReport = facilityReportData(rangeScoped, "Rangsit", "2026-07", null, [], [], threeMonthLogs);
const rangeReportHtml = buildReportHtml(rangeReport);
const executiveOnlyHtml = buildReportHtml(rangeReport, ["executive"]);
const executiveKpiHtml = executiveOnlyHtml.match(/data-report-section="executive"[\s\S]*?<\/section>/)?.[0] ?? "";
check("HTML Executive export keeps only the four approved KPI cards", ["Building Energy", "Building Cost", "4th Floor Energy", "Estimated 4th Floor Cost"].every(label => executiveKpiHtml.includes(label)) && !executiveKpiHtml.includes("4th Floor Energy Share") && !executiveKpiHtml.includes("Average Electricity Rate"));
check("Month Range changes the actual PDF report scope, not only the UI label", rangeReport.monthlyRows.map(row => row.month).join(",") === "2026-06,2026-07" && !rangeReportHtml.includes(humanMonthLabel("2026-08")));
check("PDF cover omits the internal source workbook label", !rangeReportHtml.includes("Source workbook:"));
check("PDF cover omits the application version label", !rangeReportHtml.includes("Application version:"));
const auditReport = facilityReportData(rangeScoped, "Rangsit", "2026-07", null, [], [], threeMonthLogs, { generatedBy: auditUser, generatedAt: auditTimestamp });
const auditReportHtml = buildReportHtml(auditReport);
check("Current Facility PDF cover shows the authenticated display name", auditReportHtml.includes(auditUser) && auditReportHtml.includes("cover-audit"));
check("Current Facility PDF cover shows the export timestamp", auditReportHtml.includes(auditTimestampDisplay));
const allAuditHtml = buildAllFacilitiesReportHtml([{ siteName: "Rangsit", logs: rangeScoped, calculationLogs: threeMonthLogs, generatedBy: auditUser, generatedAt: auditTimestamp }], null, "2026-07");
check("All Facilities PDF cover shows the authenticated display name", allAuditHtml.includes(auditUser) && allAuditHtml.includes("cover-audit"));
check("All Facilities PDF cover shows the export timestamp", allAuditHtml.includes(auditTimestampDisplay));

const upsReportLog: MonthlyLog = {
  ...log("2026-07"),
  ups: [{ upsId: "UPS 11A", voltage: 220, current: 10, loadKw: 2, loadKva: 2.5 }]
};
const reportWithDashboardData = facilityReportData(
  [upsReportLog],
  "Rangsit",
  "2026-07",
  null,
  [],
  [],
  [upsReportLog],
  {
    upsGroupHistory: {
      sourceSheet: "2. UPS Group History",
      rows: [{ facility: "Rangsit", month: "2026-07", group: "UPS 11", totalLoadKw: 2, totalLoadKva: 2.5, capacity: 400, loadPercent: 0.625, availablePercent: 99.375, monthlyEnergyKwh: 1488, generatedAt: null, dataVersion: 1 }]
    }
  }
);
const reportWithDashboardHtml = buildReportHtml(reportWithDashboardData);
check("PDF engineering analysis receives the persisted UPS status", reportWithDashboardData.engineeringDashboard?.upsGroups.some(group => group.name === "UPS 11") === true && reportWithDashboardHtml.includes("UPS Load Status"));
check("PDF includes the executive dashboard card page", reportWithDashboardHtml.includes("Executive Dashboard") && reportWithDashboardHtml.includes("Building Energy"));
check("Executive report selection includes the dashboard trend charts", buildReportHtml(reportWithDashboardData, ["executive"]).includes("Monthly Energy Consumption Trend"));

const reportWithRackUnitImage = facilityReportData(
  [log("2026-07")],
  "Srinakarin",
  "2026-07",
  null,
  [],
  [{ month: "2026-07", totalU: 9963, usedU: 7445, availableU: 2518, availabilityPct: 25.27 }],
  [log("2026-07")],
  {
    rackUnitCapacityImageDataUri: "data:image/png;base64,TEST_RACK_UNIT_IMAGE",
    rackUnitCapacityImageMeta: { savedAt: "2026-08-14T16:57:50.000Z", savedBy: "admin", width: 2048, height: 1536 }
  }
);
const reportWithRackUnitImageHtml = buildReportHtml(reportWithRackUnitImage);
check("Rack Unit Capacity PDF embeds the loaded image data URI", reportWithRackUnitImageHtml.includes("data:image/png;base64,TEST_RACK_UNIT_IMAGE"));
check("Rack Unit Capacity PDF includes image metadata when an image is available", reportWithRackUnitImageHtml.includes("2048×1536px") && reportWithRackUnitImageHtml.includes("Captured By: admin"));

const landscapePlacement = fitPdfImageToPage(1123, 794);
check("PDF page fit leaves a 10mm minimum outer margin", landscapePlacement.xMm >= 10 && landscapePlacement.yMm >= 10);
check("PDF page fit preserves the rendered page aspect ratio", Math.abs(landscapePlacement.widthMm / landscapePlacement.heightMm - 1123 / 794) < 0.000001);
const tallPlacement = fitPdfImageToPage(800, 1200);
check("Tall PDF content is contained without cropping or distortion", tallPlacement.widthMm <= 277 && tallPlacement.heightMm <= 190 && Math.abs(tallPlacement.widthMm / tallPlacement.heightMm - 800 / 1200) < 0.000001);
const firstTrendX = trendChartXPosition(0, 7);
const secondTrendX = trendChartXPosition(1, 7);
const lastTrendX = trendChartXPosition(6, 7);
const categorySlot = (1600 - 140 - 80) / 8;
check("Trend charts reserve one category slot before the first point", firstTrendX > 140 && Math.abs(firstTrendX - 140 - categorySlot) < 0.000001);
check("Trend charts reserve one category slot after the final point", Math.abs(1600 - 80 - lastTrendX - categorySlot) < 0.000001);
check("Trend chart category spacing remains uniform after the edge offsets", Math.abs((secondTrendX - firstTrendX) - categorySlot) < 0.000001);

// Filename actually reaches every format, with the correct extension and
// no duplicate/missing extension, and the displayed preview matches what
// would actually be downloaded/printed.
const filename = defaultReportFilename("Rangsit", "2026-06");
check("Current Facility filename follows approved RST Mmm-YYYY convention", filename === "DC_Status_MonthlyReport of RST_Jun-2026");
check("Excel filename has exactly one .xlsx extension", withExtension(filename, "xlsx") === "DC_Status_MonthlyReport of RST_Jun-2026.xlsx" && !withExtension(filename, "xlsx").includes(".xlsx.xlsx"));
check("CSV filename has exactly one .csv extension", withExtension(filename, "csv") === "DC_Status_MonthlyReport of RST_Jun-2026.csv");
check("PDF filename has exactly one .pdf extension", withExtension(filename, "pdf") === "DC_Status_MonthlyReport of RST_Jun-2026.pdf");

// ============================================================
// Rack Report: was previously always `rack: null` in every generated
// report regardless of real data (facilityReportData never fetched or
// received rack data at all). rackReportFromSnapshot() bridges the
// existing GET /racks API response into the same RackCapacityReport shape
// Desktop's Excel-based reader produces, reusing deriveRackCapacityReport
// (extracted from rackCapacityReader.ts) - the same grouping/validation
// rules, never a second calculation engine.
// ============================================================

check("rackReportFromSnapshot(null) returns null, not a crash", rackReportFromSnapshot(null) === null);
check("a genuinely empty snapshot returns null", rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: null }) === null);
check("a snapshot with zero records returns null", rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [] } }) === null);

const rackSnapshot: RackSnapshotApiResponse = {
  siteId: 1,
  month: "2026-06",
  snapshot: {
    month: "2026-06",
    rowVersion: 3,
    records: [
      { rowNumber: 1, rackZone: "Zone A", rackId: "A-01", status: "In Use", cabinetSize: "42U", detail: "Web servers", deviceType: "Server", remarks: null },
      { rowNumber: 2, rackZone: "Zone A", rackId: "A-02", status: "Available", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
      { rowNumber: null, rackZone: "Zone B", rackId: "B-01", status: "Reserved", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
      { rowNumber: 4, rackZone: "Zone B", rackId: "A-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null } // duplicate rack ID (A-01) on purpose
    ]
  }
};
const rackReport = rackReportFromSnapshot(rackSnapshot);
check("a real snapshot maps to a non-null RackCapacityReport", rackReport !== null);
check("records carry through unchanged (count)", rackReport!.records.length === 4);
check("a null source rowNumber falls back to its 1-based position, not fabricated data mistaken for a real row number", rackReport!.records[2].rowNumber === 3);
check("an already-present rowNumber is preserved exactly, not overwritten by the fallback", rackReport!.records[0].rowNumber === 1 && rackReport!.records[3].rowNumber === 4);
check("byZone grouping reuses Desktop's exact rule (2 zones, 2 records each)", rackReport!.byZone.length === 2 && rackReport!.byZone.every((z: { count: number }) => z.count === 2));
check("duplicate rack IDs are detected using the same rule the Excel reader uses", rackReport!.validation.duplicateIds.includes("A-01"));
check("sourceSheet/sourceTable match Desktop's Rack Capacity sheet/table naming", rackReport!.sourceSheet === "Rack Capacity" && rackReport!.sourceTable === "Table7");

// PDF content: the "Rack Capacity and Utilization" page must show real,
// non-fabricated numbers computed by the exact same calculateRackCapacityMetrics
// the live Rack Capacity view uses - not a second, Web-only calculation.
const noRackData = facilityReportData([log("2026-06")], "Rangsit", "2026-06", null);
const noRackHtml = buildReportHtml(noRackData);
check("with no rack data, the PDF honestly says so rather than showing a fabricated empty table", noRackHtml.includes("Rack capacity data is unavailable in this workbook."));

const withRackData = facilityReportData([log("2026-06")], "Rangsit", "2026-06", rackReport);
const withRackHtml = buildReportHtml(withRackData);
const expectedMetrics = calculateRackCapacityMetrics(rackReport!.records);
check("with real rack data, the PDF renders the Rack Capacity and Utilization page", withRackHtml.includes("Rack Capacity &amp; Utilization") && !withRackHtml.includes("Rack capacity data is unavailable in this workbook."));
check("the PDF's Total Racks KPI matches calculateRackCapacityMetrics exactly (reused, not recomputed)", withRackHtml.includes(`<div class="rack-v3-label">Total Racks</div><div class="rack-v3-value">${expectedMetrics.total}</div>`));
check("the PDF shows the real zone name from the snapshot", withRackHtml.includes("Zone A") && withRackHtml.includes("Zone B"));

// Facility isolation: printAllFacilitiesPdf builds one facilityReportData
// per facility (see src/web-clean-v1/exports.ts) - verify a second
// facility's distinctly-named rack zone never leaks into the first
// facility's report, mirroring every other facility-isolation test in
// this codebase.
const rangsitOnlyRack = rackReportFromSnapshot({ siteId: 1, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [{ rowNumber: 1, rackZone: "Rangsit-Only-Zone", rackId: "R-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null }] } });
const srinakarinOnlyRack = rackReportFromSnapshot({ siteId: 2, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [{ rowNumber: 1, rackZone: "Srinakarin-Only-Zone", rackId: "S-01", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null }] } });
const rangsitReportHtml = buildReportHtml(facilityReportData([log("2026-06")], "Rangsit", "2026-06", rangsitOnlyRack));
const srinakarinReportHtml = buildReportHtml(facilityReportData([log("2026-06")], "Srinakarin", "2026-06", srinakarinOnlyRack));
check("Rangsit's report shows its own rack zone", rangsitReportHtml.includes("Rangsit-Only-Zone"));
check("Rangsit's report never shows Srinakarin's rack zone (no cross-facility leak)", !rangsitReportHtml.includes("Srinakarin-Only-Zone"));
check("Srinakarin's report shows its own rack zone", srinakarinReportHtml.includes("Srinakarin-Only-Zone"));
check("Srinakarin's report never shows Rangsit's rack zone (no cross-facility leak)", !srinakarinReportHtml.includes("Rangsit-Only-Zone"));

// Site Comparison's "Rack Capacity Site Comparison" page (printSiteComparisonPdf
// builds this same rackComparison shape from two loadRack() results - not
// directly callable here since it uses window.open, so this exercises the
// shared renderer with the exact object shape that function assembles).
const comparisonBase = facilityReportData([log("2026-06")], "Site Comparison Base", "2026-06");
const withRackComparison: ReportData = { ...comparisonBase, rackComparison: { self: { label: "Rangsit", records: rangsitOnlyRack!.records }, other: { label: "Srinakarin", records: srinakarinOnlyRack!.records } } };
const rackComparisonHtml = buildReportHtml(withRackComparison);
check("Rack Capacity Site Comparison page renders when rackComparison is populated", rackComparisonHtml.includes("Rack Capacity Site Comparison"));
check("the comparison page shows both facility labels", rackComparisonHtml.includes("Rangsit") && rackComparisonHtml.includes("Srinakarin"));
const withoutRackComparison: ReportData = { ...comparisonBase, rackComparison: null };
check("Rack Capacity Site Comparison page is absent (not an empty section) when rackComparison is null", !buildReportHtml(withoutRackComparison).includes("Rack Capacity Site Comparison"));


// Complete-format regression fixture. This deliberately keeps Rack Positions
// independent of any UI expansion state: collapsed and expanded panels use the
// same persisted snapshot rows and therefore must produce identical exports.
const rackUnitExportRows = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((month, index) => month === "2026-06"
  ? { month, totalU: 9963, usedU: 7407, availableU: 2556, availabilityPct: 2556 / 9963, imageAttached: true, imageContentType: "image/png" as const, imageSavedAt: "2026-06-30T01:00:00.000Z" }
  : { month, totalU: 9000 + index, usedU: 6000 + index, availableU: 3000, availabilityPct: 3000 / (9000 + index) });
const completeFacility = { siteName: "Srinakarin", logs: [log("2026-06")], rack: rackReport, rackUnitCapacity: rackUnitExportRows, rackUnitCapacityImages: [{ reportingMonth: "2026-06", contentType: "image/png" as const, byteSize: 1024, width: 2048, height: 1536, savedAt: "2026-06-30T01:00:00.000Z" }] };
const completeFacilityCsv = buildFacilityCsv(completeFacility);
const completeFacilitySections = facilityExportSections(completeFacility);
check("facility CSV includes Rack Capacity, Rack Positions, Rack Unit trend, and image sections", ["RACK_CAPACITY_SUMMARY", "RACK_CAPACITY_DETAILS", "RACK_POSITIONS", "RACK_UNIT_CAPACITY", "RACK_UNIT_TREND", "RACK_UNIT_CAPACITY_IMAGES"].every(section => completeFacilityCsv.includes("# Section: " + section)));
check("facility CSV reconciles selected Rack Unit values", completeFacilityCsv.includes("2026-06,9963,7407,2556") && completeFacilityCsv.includes("74.3%") && completeFacilityCsv.includes("25.7%"));
const completeRackPositions = completeFacilitySections.find(section => section.name === "RACK_POSITIONS");
const deployablePositionStatuses = new Set(["Available", "Reserved", "Pending Dismantle", "Pending Decommission"]);
check("facility Rack Positions export lists only deployable/exception positions (Available/Reserved/Pending Decommission), independent of panel state", completeRackPositions !== undefined
  && completeRackPositions.rows.length === rackReport!.records.filter(record => deployablePositionStatuses.has(record.status ?? "")).length
  && completeRackPositions.rows.every(row => ["Available", "Reserved", "Pending Decommission"].includes(String(row[2])))
  && completeFacilityCsv.includes(",Available,A-02,") && completeFacilityCsv.includes(",Reserved,B-01,"));
check("facility Rack Positions export never emits an In Use detailed rack row", completeRackPositions?.rows.every(row => String(row[2]) !== "In Use" && row[3] !== "A-01"));
check("facility Rack Capacity Summary still carries the In Use count", completeFacilitySections.find(section => section.name === "RACK_CAPACITY_SUMMARY")?.rows[0]?.[3] === 2);
const positionStatusMappingReport = rackReportFromSnapshot({ siteId: 9, month: "2026-06", snapshot: { month: "2026-06", rowVersion: 1, records: [
  { rowNumber: 1, rackZone: "Z", rackId: "P-INUSE", status: "In Use", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
  { rowNumber: 2, rackZone: "Z", rackId: "P-AVAIL", status: "Available", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
  { rowNumber: 3, rackZone: "Z", rackId: "P-RESV", status: "Reserved", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
  { rowNumber: 4, rackZone: "Z", rackId: "P-PEND", status: "Pending Dismantle", cabinetSize: "42U", detail: null, deviceType: null, remarks: null },
  { rowNumber: 5, rackZone: "Z", rackId: "P-OTHER", status: "Decommissioned", cabinetSize: "42U", detail: null, deviceType: null, remarks: null }
] } });
const positionStatusMappingRows = facilityExportSections({ siteName: "MapCheck", logs: [log("2026-06")], rack: positionStatusMappingReport }).find(section => section.name === "RACK_POSITIONS")?.rows ?? [];
check("Rack Positions status display mapping: Pending Dismantle renders as Pending Decommission; In Use and unknown statuses are excluded", positionStatusMappingRows.map(row => String(row[2])).join("|") === "Available|Reserved|Pending Decommission"
  && positionStatusMappingRows.map(row => String(row[3])).join("|") === "P-AVAIL|P-RESV|P-PEND");
check("facility CSV has no object serialization defect", !completeFacilityCsv.includes("[object Object]") && !completeFacilityCsv.includes("undefined"));
const completeRackWorkbook = await workbookForFacilities([completeFacility]);
const semanticUnitSheet = completeRackWorkbook.getWorksheet("18_History_RackImage");
const semanticUnitValues = semanticUnitSheet?.getSheetValues() ?? [];
const selectedUnitRow = semanticUnitValues.find(row => Array.isArray(row) && row[2] === "2026-06") as unknown[] | undefined;
check("XLSX Rack Unit semantic sheet contains the selected row", Boolean(selectedUnitRow));
check("XLSX keeps Rack Unit KPI cells numeric", typeof selectedUnitRow?.[3] === "number" && selectedUnitRow?.[3] === 9963 && selectedUnitRow?.[4] === 7407 && selectedUnitRow?.[5] === 2556);
check("XLSX percentage cells remain numeric with native formatting", typeof selectedUnitRow?.[6] === "number" && typeof selectedUnitRow?.[7] === "number" && semanticUnitSheet?.getColumn(6).numFmt === "0.0%" && semanticUnitSheet?.getColumn(7).numFmt === "0.0%");
const completeReportHtml = buildReportHtml(facilityReportData([log("2026-06")], "Srinakarin", "2026-06", rackReport, [], rackUnitExportRows, [log("2026-06")], { rackUnitCapacityImageDataUri: "data:image/png;base64,TEST", rackUnitCapacityImageMeta: { savedAt: "2026-06-30T01:00:00.000Z", savedBy: "uat", width: 2048, height: 1536 } }));
check("HTML/PDF source contains Rack Positions even when the UI panel is collapsed", completeReportHtml.includes("Rack Positions") && completeReportHtml.includes("Cabinet Size (cm)") && completeReportHtml.includes("A-02") && completeReportHtml.includes("B-01"));
check("HTML/PDF source contains selected Rack Unit KPI, percentages, trend, and image details", completeReportHtml.includes("9,963") && completeReportHtml.includes("7,407") && completeReportHtml.includes("2,556") && completeReportHtml.includes("74.3%") && completeReportHtml.includes("25.7%") && completeReportHtml.includes("Rack Unit Capacity Trend") && completeReportHtml.includes("TEST") && completeReportHtml.includes("2048"));
const completeComparison: SiteComparisonExport = {
  displayPeriod: { startMonth: "2026-01", endMonth: "2026-06" },
  months: ["2026-06"],
  sites: [
    { ...comparison.sites[0], months: [{ month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 50, floorCost: 250, avgRate: 5, floorShare: 50 } }], rack: rackReport, rackUnitCapacity: rackUnitExportRows.map(row => ({ ...row, usagePercent: row.totalU > 0 ? row.usedU / row.totalU * 100 : null })) },
    { ...comparison.sites[1], months: [{ month: "2026-06", metrics: { buildingEnergy: 200, buildingCost: 900, floorEnergy: 80, floorCost: 360, avgRate: 4.5, floorShare: 40 } }], rack: rackReport, rackUnitCapacity: rackUnitExportRows.map(row => ({ ...row, usagePercent: row.totalU > 0 ? row.usedU / row.totalU * 100 : null })) }
  ]
};
const completeComparisonModel = buildSiteComparisonReportModel(completeComparison, "2026-06");
const comparisonSections = siteComparisonExportSections(completeComparisonModel);
const comparisonCompleteCsv = buildSiteComparisonCsv(completeComparisonModel);
check("Site Comparison CSV includes Rack Capacity, Rack Positions, and Rack Unit sections", ["RACK_CAPACITY_SUMMARY", "RACK_CAPACITY_DETAILS", "RACK_POSITIONS", "RACK_UNIT_CAPACITY_COMPARISON", "RACK_UNIT_TREND_COMPARISON"].every(section => comparisonCompleteCsv.includes("# Section: " + section)));
check("Site Comparison CSV reconciles both sites to the same Rack Unit source values", comparisonCompleteCsv.includes("Rangsit,2026-06,9963,7407,2556") && comparisonCompleteCsv.includes("Srinakarin,2026-06,9963,7407,2556") && comparisonCompleteCsv.includes(",Available,A-02,") && comparisonCompleteCsv.includes(",Reserved,B-01,"));
check("Site Comparison Rack Positions section excludes In Use detailed racks", (() => { const section = comparisonSections.find(entry => entry.name === "RACK_POSITIONS"); return section !== undefined && section.rows.length > 0 && section.rows.every(row => String(row[2]) !== "In Use" && row[3] !== "A-01"); })());
// ── Regression: Site Energy & Cost Comparison per-site month filter ─────────
// sites[].months holds { month, metrics } objects. loadComparison must filter
// them on entry.month; comparing the objects against the Set<string> of
// selected months (has(row)) is always false and silently blanks every
// energy/cost value in CSV / Excel / HTML / PDF.
const comparisonSelectedMonths = new Set(["2026-06"]);
const comparisonTwoMonths: SiteComparisonExport = {
  displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
  months: ["2026-05", "2026-06"],
  sites: completeComparison.sites.map(site => ({
    ...site,
    months: [
      { month: "2026-05", metrics: { buildingEnergy: 11, buildingCost: 22, floorEnergy: 33, floorCost: 44, avgRate: 5, floorShare: 6 } },
      { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 50, floorCost: 250, avgRate: 5, floorShare: 50 } }
    ]
  }))
};
const filterComparisonSites = (predicate: (entry: { month: string; metrics: unknown }) => boolean): SiteComparisonExport => ({
  ...comparisonTwoMonths,
  months: comparisonTwoMonths.months.filter(month => comparisonSelectedMonths.has(month)),
  sites: comparisonTwoMonths.sites.map(site => ({ ...site, months: site.months.filter(predicate) }))
});
const monthFieldFiltered = filterComparisonSites(entry => comparisonSelectedMonths.has(entry.month));
const objectFiltered = filterComparisonSites(entry => (comparisonSelectedMonths as Set<unknown>).has(entry));
const monthFieldModel = buildSiteComparisonReportModel(monthFieldFiltered, "2026-06");
const monthFieldRow = siteComparisonExportSections(monthFieldModel).find(section => section.name === "SITE_COMPARISON")!.rows[0];
const objectFilteredRow = siteComparisonExportSections(buildSiteComparisonReportModel(objectFiltered, "2026-06")).find(section => section.name === "SITE_COMPARISON")!.rows[0];
check("Site Comparison keeps the selected month's energy/cost metrics when filtering on entry.month", monthFieldRow[3] === "100.00" && monthFieldRow[4] === "500.00" && monthFieldRow[5] === "50.00" && monthFieldRow[6] === "250.00" && monthFieldRow[7] === "5.00" && monthFieldRow[8] === "50.00");
check("Site Comparison excludes non-selected months (2026-05 metrics never surface for a 2026-06 reference)", siteComparisonExportSections(buildSiteComparisonReportModel(monthFieldFiltered, "2026-05")).find(section => section.name === "SITE_COMPARISON")!.rows.every(row => row[3] === "" && row[4] === ""));
check("filtering the { month, metrics } rows against the raw month-string set blanks every metric (documents the defect)", objectFilteredRow.slice(3).every(cell => cell === ""));
const comparisonFixedCsv = buildSiteComparisonCsv(monthFieldModel);
check("Site Comparison CSV builder receives the selected month building-energy value", comparisonFixedCsv.includes("100.00") && comparisonFixedCsv.includes("500.00"));
// ============================================================
// Desktop-source acceptance gate: build the actual Web Excel export from the
// two Desktop workbooks and their external Rack Unit image stores. This is a
// stronger check than fixture-only sheet-name assertions: every required
// table must contain the source's real rows, including Dashboard-FAC detail
// mapping, UPS Group History, Rack Unit history, and image attachment status.
for (const sourceCase of [
  { site: "Rangsit", workbookPath: "DC_Rangsit.xlsm", imagesRoot: "release\\Energy Monitor-v2.3.0\\data\\rack-unit-images" },
  { site: "Srinakarin", workbookPath: "DC_Srinakarin.xlsm", imagesRoot: "release\\Energy Monitor-v2.2.6\\data\\rack-unit-images" }
].filter(sourceCase => existsSync(sourceCase.workbookPath) && existsSync(sourceCase.imagesRoot))) {
  const buffer = await readFile(sourceCase.workbookPath);
  const source = await readWorkbookSource(sourceCase.workbookPath, undefined, { imagesRootDir: sourceCase.imagesRoot, siteCode: sourceCase.site });
  const upsGroupHistory = await readUpsGroupHistoryFromBuffer(buffer);
  const dashboardMapping = source.dashboardMapping ?? await readUpsMappingFromBuffer(buffer);
  const rack = await readRackCapacityFromBuffer(buffer);
  const rackHistory = await readRackCapacityHistoryFromBuffer(buffer);
  const imageByMonth = new Map((source.rackUnitCapacityImages ?? []).map(image => [image.reportingMonth, image]));
  const rackUnitCapacity = source.rackUnitCapacityRows.map(row => {
    const image = imageByMonth.get(row.month);
    return { ...row, imageAttached: Boolean(image), imageContentType: image?.contentType ?? null, imageSavedAt: null };
  });
  const reportingMonths = [...new Set([
    ...source.logs.map(row => row.month),
    ...rackUnitCapacity.map(row => row.month),
    ...(upsGroupHistory?.rows ?? []).map(row => row.month),
    ...(rackHistory ?? []).map(row => row.snapshotMonth)
  ])].sort();
  const workbook = await workbookForFacilities([{ siteName: sourceCase.site, logs: source.logs, rack, rackHistory: rackHistory ?? [], rackUnitCapacity, rackUnitCapacityImages: (source.rackUnitCapacityImages ?? []).map(image => ({ reportingMonth: image.reportingMonth, contentType: image.contentType, byteSize: image.byteSize, width: image.width, height: image.height })), upsGroupHistory, dashboardMapping, reportingMonths }]);
  const sheet = (fragment: string) => workbook.worksheets.find(item => item.name.includes(fragment) && (fragment !== "Rack Unit Capacity" || item.name.includes("33 Rack Unit Capacity")));
  const arraySheetValues = (worksheet: ExcelJS.Worksheet | undefined): unknown[][] =>
    (worksheet?.getSheetValues() ?? []).map(row => Array.isArray(row) ? row : []);
  const requiredTables: Array<[string, number]> = [
    ["UPS_Loads", source.logs.reduce((count, log) => count + log.ups.length, 0) + 1],
    ["Air_Inputs", source.logs.length + 1],
    ["DC_Inputs", source.logs.reduce((count, log) => count + log.dc.length, 0) + 1],
    ["Energy_Cost_Inputs", source.logs.length + 1],
    ["Saved_Records", reportingMonths.length + 1],
    ["Saved_Values", reportingMonths.length + 1],
    ["Raw_Inputs", source.logs.filter(log => Boolean(log.srinakarinInputs)).length + 1],
    ["Calculated_Energy", source.logs.length + 1],
    ["Dashboard-FAC", source.logs.length + 1],
    ["Dashboard-FAC UPS", (upsGroupHistory?.rows.length ?? 0) + 1],
    ["Dashboard-FAC Details", source.logs.length * (dashboardMapping?.mapping.length ?? 0) + 1],
    ["Dashboard-FAC Air", 2],
    ["Dashboard-FAC DC", 2],
    ["Dashboard-FAC UPS Overall", 2],
    ["Dashboard-FAC Totals", source.logs.length + 1],
    ["Rack Unit Capacity", source.rackUnitCapacityRows.length + 1],
    ["Rack Capacity History", (rackHistory?.length ?? 0) + 1],
    ["UPS Group History", (upsGroupHistory?.rows.length ?? 0) + 1],
    ["Rack Capacity Raw", (rack?.records.length ?? 0) + 1]
  ];
  for (const [tableName, minimumRows] of requiredTables) {
    check(`${sourceCase.site}: export contains ${tableName} with its expected row count`, (sheet(tableName)?.rowCount ?? 0) >= minimumRows);
  }
  const serializedExport = await workbook.xlsx.writeBuffer();
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(serializedExport as unknown as ArrayBuffer);
  check(`${sourceCase.site}: serialized XLSX reopens with all required worksheets`, requiredTables.every(([tableName]) => roundTrip.worksheets.some(item => item.name.includes(tableName))));
  check(`${sourceCase.site}: Desktop workbook has no validation errors`, source.validation.errors.length === 0);
  check(`${sourceCase.site}: migration source retains Dashboard-FAC mapping from the workbook`, Boolean(source.dashboardMapping) && source.dashboardMapping?.mapping.length === dashboardMapping?.mapping.length);
  check(`${sourceCase.site}: migration source retains every persisted UPS Group History row`, source.upsGroupHistoryRows.length === (upsGroupHistory?.rows.length ?? 0));
  check(`${sourceCase.site}: migration source retains every Desktop Rack Capacity History row`, source.rackCapacityHistoryRows.length === (rackHistory?.length ?? 0));
  check(`${sourceCase.site}: Desktop Rack Unit image sources are discovered when present`, (source.rackUnitCapacityImages ?? []).length === 0 || (source.rackUnitCapacityImages ?? []).length === 2);
  check(`${sourceCase.site}: UPS input rows are exported from Desktop logs`, (sheet("UPS_Loads")?.rowCount ?? 1) > 1);
  check(`${sourceCase.site}: visible 05_Input_UPS retains all fetched UPS history`, (workbook.getWorksheet("05_Input_UPS")?.rowCount ?? 0) === Math.max(3, source.logs.reduce((count, log) => count + log.ups.length, 0) + 2));
  check(`${sourceCase.site}: visible 08_Input_EnergyCost retains every fetched monthly billing record`, (workbook.getWorksheet("08_Input_EnergyCost")?.rowCount ?? 0) === Math.max(3, source.logs.length + 2));
  check(`${sourceCase.site}: visible UPS calculation sheets expose full Dashboard-FAC history`, (workbook.getWorksheet("11_Calculation_UPS")?.rowCount ?? 0) > 1 && (workbook.getWorksheet("12_Calculation_UPS_Detail")?.rowCount ?? 0) > 1);
  check(`${sourceCase.site}: dedicated 13_Calculation_4thFloor retains every fetched month`, (workbook.getWorksheet("13_Calculation_4thFloor")?.rowCount ?? 0) === Math.max(3, source.logs.length + 2));
  check(`${sourceCase.site}: visible 14_History_Energy retains every fetched month`, (workbook.getWorksheet("14_History_Energy")?.rowCount ?? 0) === Math.max(3, source.logs.length + 2));
  check(`${sourceCase.site}: saved values table contains all source months`, (sheet("Saved_Values")?.rowCount ?? 0) >= source.logs.length + 1);
  const calculatedEnergyMonths = new Set(arraySheetValues(sheet("Calculated_Energy")).slice(1).map(row => String(row[1] ?? "")));
  check(`${sourceCase.site}: calculated energy table contains all source log months`, source.logs.every(log => calculatedEnergyMonths.has(log.month)));
  const dashboardFacMonths = new Set(arraySheetValues(sheet("Dashboard-FAC")).slice(1).map(row => String(row[1] ?? "")));
  check(`${sourceCase.site}: Dashboard-FAC contains all source log months`, source.logs.every(log => dashboardFacMonths.has(log.month)));
  check(`${sourceCase.site}: Dashboard-FAC Details contains Desktop mapping rows`, (sheet("Dashboard-FAC Details")?.rowCount ?? 1) > 1 && (sheet("Dashboard-FAC Details")?.getSheetValues().flat().map(String).join("|") ?? "").includes(dashboardMapping?.mapping[0]?.upsId ?? "__missing__"));
  check(`${sourceCase.site}: every Desktop Dashboard-FAC mapping ID is retained in the export`, (dashboardMapping?.mapping ?? []).every(row => (sheet("Dashboard-FAC Details")?.getSheetValues().flat().map(String).join("|") ?? "").includes(row.upsId)));
  if (sourceCase.site === "Rangsit") {
    const firstMonth = source.logs[0]?.month;
    const historicalDetails = arraySheetValues(sheet("Dashboard-FAC Details")).filter(row => row[1] === firstMonth);
    check("Rangsit historical Dashboard-FAC missing UPS readings remain blank, not fabricated zeros", historicalDetails.length > 0 && historicalDetails.every(row => row.slice(8, 12).every(value => value === null || value === undefined)));
  }
  check(`${sourceCase.site}: Dashboard-FAC UPS contains persisted group history`, (sheet("Dashboard-FAC UPS")?.rowCount ?? 1) >= (upsGroupHistory?.rows.length ?? 0) + 1);
  check(`${sourceCase.site}: UPS Group History export contains every persisted source row`, (sheet("UPS Group History")?.rowCount ?? 1) === Math.max(2, (upsGroupHistory?.rows.length ?? 0) + 1));
  check(`${sourceCase.site}: Dashboard-FAC Air table contains source rows`, (sheet("Dashboard-FAC Air")?.rowCount ?? 1) > 1);
  check(`${sourceCase.site}: Dashboard-FAC DC table contains source rows`, (sheet("Dashboard-FAC DC")?.rowCount ?? 1) > 1);
  const latestSourceLog = source.logs.at(-1);
  const canonicalMapping = latestSourceLog ? buildDashboardUpsMapping(upsGroupHistory, latestSourceLog.month, dashboardMapping?.mapping ?? []) : null;
  const canonicalSnapshot = latestSourceLog ? buildEngineeringDashboardSnapshot(source.logs, latestSourceLog.month, canonicalMapping) : null;
  const totalsRows = arraySheetValues(sheet("Dashboard-FAC Totals"));
  const canonicalTotalsRow = latestSourceLog ? totalsRows.find(row => Array.isArray(row) && row[1] === latestSourceLog.month) : undefined;
  check(`${sourceCase.site}: Dashboard-FAC Totals contains every source log month`, source.logs.every(log => totalsRows.some(row => Array.isArray(row) && row[1] === log.month)));
  check(`${sourceCase.site}: Excel totals use the same canonical Web Engineering snapshot`, Boolean(canonicalSnapshot && canonicalTotalsRow)
    && canonicalTotalsRow?.[2] === canonicalSnapshot?.daysInMonth
    && canonicalTotalsRow?.[3] === canonicalSnapshot?.previousMonth
    && canonicalTotalsRow?.[4] === canonicalSnapshot?.totalUpsKw
    && canonicalTotalsRow?.[5] === canonicalSnapshot?.totalUpsKva
    && canonicalTotalsRow?.[6] === canonicalSnapshot?.totalUpsEnergyKwh
    && canonicalTotalsRow?.[7] === canonicalSnapshot?.detailedVoltageAvg
    && canonicalTotalsRow?.[8] === canonicalSnapshot?.detailedCurrentSum
    && canonicalTotalsRow?.[9] === canonicalSnapshot?.airEnergyKwh
    && canonicalTotalsRow?.[10] === canonicalSnapshot?.totalDcPowerW
    && canonicalTotalsRow?.[11] === canonicalSnapshot?.totalDcAcCurrentA
    && canonicalTotalsRow?.[12] === canonicalSnapshot?.totalDcAcPowerW
    && canonicalTotalsRow?.[13] === canonicalSnapshot?.totalDcEnergyKwh
    && canonicalTotalsRow?.[14] === canonicalSnapshot?.buildingEnergyKwh
    && canonicalTotalsRow?.[15] === canonicalSnapshot?.buildingCostThb
    && canonicalTotalsRow?.[16] === canonicalSnapshot?.floorEnergyKwh
    && canonicalTotalsRow?.[17] === canonicalSnapshot?.floorCostThb
    && canonicalTotalsRow?.[18] === canonicalSnapshot?.averageRateThbPerKwh
    && canonicalTotalsRow?.[19] === canonicalSnapshot?.floorSharePercent);
  const visibleCalculation = workbook.getWorksheet("10_Calculation_Energy");
  const visibleCalculationRow = latestSourceLog ? arraySheetValues(visibleCalculation).find(row => Array.isArray(row) && row[1] === latestSourceLog.month) : undefined;
  check(`${sourceCase.site}: visible Calculation sheet exposes Web UPS/Air/DC totals`, Boolean(visibleCalculationRow && canonicalSnapshot)
    && visibleCalculationRow?.[4] === canonicalSnapshot?.totalUpsKw
    && visibleCalculationRow?.[6] === canonicalSnapshot?.totalUpsEnergyKwh
    && visibleCalculationRow?.[9] === canonicalSnapshot?.airEnergyKwh
    && visibleCalculationRow?.[10] === canonicalSnapshot?.totalDcPowerW
    && visibleCalculationRow?.[13] === canonicalSnapshot?.totalDcEnergyKwh);
  const dashboardSurface = workbook.getWorksheet("01_Dashboard");
  const dashboardSurfaceText = dashboardSurface?.getSheetValues().flat().map(String).join("|") ?? "";
  check(`${sourceCase.site}: Excel report surface exposes Engineering before Executive and Capacity sections`, dashboardSurface?.getCell("A5").value === "Engineering View · Building Energy Dashboard" && dashboardSurface?.getCell("A15").value === "Executive View" && dashboardSurfaceText.includes("Capacity Overview") && dashboardSurfaceText.includes("Energy & Cost Trends") && dashboardSurfaceText.includes("Rack Capacity & Utilization V3") && dashboardSurfaceText.includes("Rack Unit Capacity & Utilization V3"));
  if ((canonicalSnapshot?.upsOverallGroups.length ?? 0) > 0) {
    check(`${sourceCase.site}: Excel retains UPS Overall and UPS/PPC source groups outside the Executive dashboard`, (sheet("Dashboard-FAC UPS Overall")?.rowCount ?? 1) > 1 && (sheet("Dashboard-FAC UPS")?.rowCount ?? 1) > 1);
  }
  check(`${sourceCase.site}: Rack Unit Capacity contains every Desktop row`, (sheet("Rack Unit Capacity")?.rowCount ?? 0) === Math.max(2, source.rackUnitCapacityRows.length + 1));
  const sourceImageSheet = workbook.getWorksheet("18_History_RackImage");
  check(`${sourceCase.site}: Rack Unit export preserves image metadata even when no numeric row matches`, (source.rackUnitCapacityImages ?? []).length === 0 ? !Boolean(sourceImageSheet) : (sourceImageSheet?.rowCount ?? 0) >= (source.rackUnitCapacityImages?.length ?? 0) + 1);
  check(`${sourceCase.site}: Rack Capacity Raw contains the Desktop snapshot rows`, (sheet("Rack Capacity Raw")?.rowCount ?? 1) === Math.max(2, (rack?.records.length ?? 0) + 1));
  check(`${sourceCase.site}: Rack Capacity History preserves source rows when present`, (sheet("Rack Capacity History")?.rowCount ?? 1) === Math.max(2, (rackHistory?.length ?? 0) + 1));
}

// --- SiteComparisonReportModel (N-site shared input) ---
{
  const raw = {
    displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" },
    months: ["2026-05", "2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" },
        months: [
          { month: "2026-05", metrics: null },
          { month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } },
        ],
        rackUnitCapacity: [{ month: "2026-06", totalU: 200, usedU: 150, availableU: 50, usagePercent: 75 }] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" },
        months: [
          { month: "2026-05", metrics: { buildingEnergy: 80, buildingCost: 360, floorEnergy: 30, floorCost: 135, avgRate: 4.5, floorShare: 37.5 } },
          { month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } },
        ],
        rackUnitCapacity: [] },
    ],
  } as any;
  const model = buildSiteComparisonReportModel(raw, "2026-06");
  check("model reference month", model.referenceMonth === "2026-06");
  check("model months ascending & <= ref", JSON.stringify(model.months) === JSON.stringify(["2026-05", "2026-06"]));
  check("model has all sites", model.sites.length === 2);
  check("siteCode carried from server DTO", model.sites[0].siteCode === "rangsit" && model.sites[1].siteCode === "srinakarin");
  check("reference-month metrics resolved", model.sites[0].metrics?.buildingEnergy === 100);
  check("missing month metrics stay null (no fabrication)", model.sites[0].metricsByMonth["2026-05"] === null);
  check("metricsByMonth covers every month", Object.keys(model.sites[1].metricsByMonth).sort().join(",") === "2026-05,2026-06");
  check("rackUnit availabilityPct backfilled as ratio", Math.abs((model.sites[0].rackUnit[0].availabilityPct ?? -1) - 50 / 200) < 1e-9);
  check("site with no rackUnit -> empty array", model.sites[1].rackUnit.length === 0);
}

// ── Source code assertions ─────────────────────────────────────────────────────
{
  const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
  check("loadAll passes siteCode to ExportFacility", /siteName:\s*site\.name,\s*siteCode:\s*site\.code/.test(app.replace(/\s+/g, " ")));
}

// ── Task 2.2: cover-less body pages + includeCover option + DOM-free All Facilities ──
{
  const data = facilityReportData([log("2026-06")], "Rangsit", "2026-06");
  const withCover = buildReportHtml(data);
  const noCover = buildReportHtml(data, { includeCover: false });
  check("default build has a cover", withCover.includes('<main class="cover">'));
  check("includeCover:false drops the cover", !noCover.includes('<main class="cover">'));
  check("includeCover:false keeps the body pages", noCover.includes('<section class="page'));
  check("bare array second arg still works (back-compat)",
    buildReportHtml(data, ["executive"]).includes('<main class="cover">'));
  const body = buildReportBodyPages(data);
  check("buildReportBodyPages returns only page sections (no doctype/head)",
    !body.includes("<!doctype") && !body.includes("<head>") && body.trim().startsWith('<section class="page'));

  const two = [
    { siteName: "Rangsit", logs: [log("2026-06")] },
    { siteName: "Srinakarin", logs: [log("2026-06")] },
  ] as any;
  const allHtml = buildAllFacilitiesReportHtml(two, null, "2026-06");
  check("buildAllFacilitiesReportHtml runs DOM-free in node", allHtml.includes("<!doctype"));
  check("one style block", (allHtml.match(/<style>/g) ?? []).length === 1);
  check("All Facilities has one shared cover", (allHtml.match(/<main class="cover">/g) ?? []).length === 1);
  check("All Facilities has one facility band per site", (allHtml.match(/data-report-section="facility-header"/g) ?? []).length === 2);
  check("no DOMParser leftovers in output", !allHtml.includes("[object"));
}

{
  // New All-Facilities signatures accept a comparison model; null keeps prior output.
  const facilities = [{ siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] }] as any;
  const htmlNoCmp = buildAllFacilitiesReportHtml(facilities, null, "2026-06");
  check("all-facilities html builds with null comparison", /<!doctype/i.test(htmlNoCmp));
  const csvNoCmp = buildAllFacilitiesCsv(facilities, null);
  check("all-facilities csv builds with null comparison", csvNoCmp.includes("# Facility: Rangsit"));

  const two = [
    { siteName: "Rangsit", siteCode: "rangsit", logs: [log("2026-06")] },
    { siteName: "Srinakarin", siteCode: "srinakarin", logs: [log("2026-06")] },
  ] as any;
  const model = buildSiteComparisonReportModel({
    displayPeriod: { startMonth: "2026-06", endMonth: "2026-06" },
    months: ["2026-06"],
    sites: [
      { site: { id: 1, code: "rangsit", name: "Rangsit" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 100, buildingCost: 500, floorEnergy: 40, floorCost: 200, avgRate: 5, floorShare: 40 } }], rackUnitCapacity: [] },
      { site: { id: 2, code: "srinakarin", name: "Srinakarin" }, months: [{ month: "2026-06", metrics: { buildingEnergy: 90, buildingCost: 405, floorEnergy: 33, floorCost: 148.5, avgRate: 4.5, floorShare: 36.7 } }], rackUnitCapacity: [] },
    ],
  } as any, "2026-06");
  const htmlCmp = buildAllFacilitiesReportHtml(two, model, "2026-06");
  check("all-facilities html tags a cross-site energy section", htmlCmp.includes('data-report-section="site-energy-comparison"'));
  const csvCmp = buildAllFacilitiesCsv(two, model);
  check("all-facilities csv appends SITE_COMPARISON section", csvCmp.includes("# Section: SITE_COMPARISON"));
  check("all-facilities csv keeps per-facility blocks", csvCmp.includes("# Facility: Rangsit") && csvCmp.includes("# Facility: Srinakarin"));
  const singleWorkbook = await workbookForFacilities([{ siteName: "Rangsit", siteCode: "RST", logs: [log("2026-06")] }] as any);
  const visibleNames = singleWorkbook.worksheets.filter((sheet: any) => sheet.state !== "hidden").map((sheet: any) => sheet.name);
  check("single-facility starts with the native Current Facility dashboard", visibleNames[0] === "01_Dashboard");
  const currentGroups = ["02_Saved_Energy", "03_Saved_Rack", "04_Saved_RackUnit", "05_Input_UPS", "06_Input_AirConditioning", "07_Input_DCPower", "08_Input_EnergyCost", "09_Input_Rack", "10_Calculation_Energy", "11_Calculation_UPS", "12_Calculation_UPS_Detail", "13_Calculation_4thFloor", "14_History_Energy", "15_History_Rack", "16_History_RackUnit", "17_History_UPS"];
  check("single-facility grouped source sheets follow dashboard", currentGroups.every((name, index) => visibleNames.indexOf(name) > visibleNames.indexOf("01_Dashboard") && (index === 0 || visibleNames.indexOf(name) > visibleNames.indexOf(currentGroups[index - 1]))));
  check("raw sheets follow presentation sheets", singleWorkbook.worksheets.findIndex((sheet: any) => sheet.name.includes("20 UPS_Loads")) >= 7);
  const singleLast = singleWorkbook.worksheets.at(-1);
  check("Dashboard_Data is hidden and last", Boolean(singleLast?.name.includes("Dashboard_Data")) && singleLast?.state === "hidden");
  const multiWorkbook = await workbookForFacilities(two, model);
  const allFacilitiesWithImages = two.map((facility: any) => ({ ...facility, rackUnitCapacity: [{ month: "2026-06", totalU: 9963, usedU: 7407, availableU: 2556, availabilityPct: 2556 / 9963, imageAttached: true, imageContentType: "image/png", imageSavedAt: "2026-06-30T01:00:00.000Z" }], rackUnitCapacityImageDataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", rackUnitCapacityImageMeta: { savedAt: "2026-06-30T01:00:00.000Z", savedBy: facility.siteName, width: 1, height: 1 } }));
  const allWorkbookWithImages = await workbookForFacilities(allFacilitiesWithImages, model);
  const multiRackUnitSheets = allWorkbookWithImages.worksheets.filter((sheet: any) => sheet.name.includes("05 Rack Unit Capacity"));
  check("All Facilities Excel has one Rack Unit sheet per facility", multiRackUnitSheets.length === 2);
  check("All Facilities Excel Rack Unit sheets retain numeric capacity values", multiRackUnitSheets.every((sheet: any) => sheet.getSheetValues().flat().includes(9963) && sheet.getSheetValues().flat().includes(7407) && sheet.getSheetValues().flat().includes(2556)));
  const allWorkbookBytes = await writeInteractiveExcelWorkbook(allWorkbookWithImages);
  const allWorkbookZip = await JSZip.loadAsync(allWorkbookBytes);
  const allWorkbookMedia = Object.keys(allWorkbookZip.files).filter(name => name.startsWith("xl/media/image") && /\.(png|jpe?g)$/.test(name));
  check("All Facilities Excel embeds Rack Unit image binaries", allWorkbookMedia.length >= 2);
  const allFacilitiesHtmlWithImages = buildAllFacilitiesReportHtml(allFacilitiesWithImages, null, "2026-06");
  check("All Facilities PDF/HTML includes the selected-month image for every facility", (allFacilitiesHtmlWithImages.split("data:image/png;base64,").length - 1) === 2);
  check("All Facilities default filename uses YYYY-Mmm", defaultAllFacilitiesReportFilename("2026-07") === "All_Facilities_Energy_Report_2026-Jul");
  check("All Facilities default filename appends included sites", defaultAllFacilitiesReportFilename("2026-07", ["Rangsit", "Srinakarin"]) === "All_Facilities_Energy_Report_2026-Jul_Rangsit_Srinakarin");
  const excelDashboardSource = readFileSync("src/web-clean-v1/excelDashboard.ts", "utf8");
  check("interactive Excel OOXML is DEFLATE-compressed", excelDashboardSource.includes('compression: "DEFLATE"') && excelDashboardSource.includes("level: 6"));
  const multiNames = multiWorkbook.worksheets.map((sheet: any) => sheet.name);
  check("All Facilities Excel has 90 Site Energy Comparison", multiNames.some((name: string) => name.startsWith("90 ")));
  check("All Facilities Excel has 91 Site Rack Comparison", multiNames.some((name: string) => name.startsWith("91 ")));
  check("comparison sheets follow facility raw sheets", multiNames.findIndex((name: string) => name.startsWith("90 ")) > multiNames.findIndex((name: string) => name.includes("36 Rack Capacity Raw")));
}

// Task 1.6: the web-only popup/print and download wrappers are orphaned now
// that Reports uses direct file exports; the shared comparison builders remain
// covered above for the protected data regression.
{
  const exportSource = readFileSync("src/web-clean-v1/exports.ts", "utf8");
  for (const name of ["openReportPopup", "renderReportPopup", "renderReportErrorPopup", "printDesktopPdf", "printSiteComparisonPdf", "printAllFacilitiesPdf", "exportSiteComparisonCsv", "exportSiteComparisonExcel", "exportSiteComparisonHtml", "exportSiteComparisonPdf"]) {
    check(name + " orphaned export removed", !exportSource.includes("function " + name + "("));
  }
  check("parseCsvLine dead helper removed", !exportSource.includes("function parseCsvLine("));
  check("monthSet dead helper removed", !exportSource.includes("function monthSet("));
}
{
  const raw = { displayPeriod: { startMonth: "2026-05", endMonth: "2026-06" }, months: ["2026-05", "2026-06"], sites: [{ site: { id: 1, code: "RST", name: "Rangsit" }, months: [
    { month: "2026-05", metrics: { buildingEnergy: 111, buildingCost: 555, floorEnergy: 44, floorCost: 222, avgRate: 5, floorShare: 39.6 } },
    { month: "2026-06", metrics: { buildingEnergy: 222, buildingCost: 999, floorEnergy: 88, floorCost: 444, avgRate: 4.5, floorShare: 39.6 } },
  ], rackUnitCapacity: [] }] } as any;
  const model = buildSiteComparisonReportModel(raw, "2026-06");
  const section = siteComparisonExportSections(model).find(s => s.name === "SITE_COMPARISON")!;
  const row = section.rows[0].map(String).join("|");
  check("selected month energy/cost survive comparison model", row.includes("222") && row.includes("999") && row.includes("88") && row.includes("444"));
  check("non-selected month metrics are absent from comparison summary", !row.includes("111") && !row.includes("555"));
  const csvPositive = buildSiteComparisonCsv(model);
  check("comparison CSV keeps selected-month metrics", csvPositive.includes("222") && csvPositive.includes("999"));
}

console.log(`web-clean-v1 exports: 7 + ${checks} assertions passed`);
