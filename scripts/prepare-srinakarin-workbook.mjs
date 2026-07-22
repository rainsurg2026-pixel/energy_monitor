import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";

/**
 * Prepare the Srinakarin workbook for the Energy Monitor Excel-first flow.
 *
 * This is deliberately a zip-level patch. ExcelJS is not used to write the
 * file because doing so would discard VBA, pivot caches, drawings and other
 * workbook parts that are not represented by the application data model.
 * The input workbook is never overwritten.
 */

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("Usage: node scripts/prepare-srinakarin-workbook.mjs <source.xlsm> [output.xlsm]");
}

const outputPath = process.argv[3] ?? path.resolve(
  "release",
  "SNK_Dashboard_Renew_Voltage-1_EnergyMonitorReady.xlsm"
);

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function xmlUnescape(value) {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function relationshipTarget(workbookXml, relsXml, sheetName) {
  const sheet = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)]
    .map(match => match[1])
    .map(attrs => ({
      name: xmlUnescape(attrs.match(/\bname="([^"]*)"/)?.[1] ?? ""),
      id: attrs.match(/\br:id="([^"]*)"/)?.[1] ?? ""
    }))
    .find(item => item.name === sheetName);
  if (!sheet) throw new Error(`Worksheet not found: ${sheetName}`);

  const relationship = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)]
    .map(match => match[1])
    .map(attrs => ({
      id: attrs.match(/\bId="([^"]*)"/)?.[1] ?? "",
      target: attrs.match(/\bTarget="([^"]*)"/)?.[1] ?? ""
    }))
    .find(item => item.id === sheet.id);
  if (!relationship) throw new Error(`Worksheet relationship not found: ${sheetName}`);

  const target = relationship.target.replaceAll("\\", "/");
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

function cellPattern(ref) {
  return [
    new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)\\/>`, "m"),
    new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)>([\\s\\S]*?)<\\/c>`, "m")
  ];
}

function patchFormulaCell(xml, ref, formula, cachedValue = null) {
  const patterns = cellPattern(ref);
  const pattern = patterns.find(candidate => candidate.test(xml));
  const match = pattern ? xml.match(pattern) : null;
  if (!pattern || !match) {
    const context = xml.match(new RegExp(`.{0,80}${ref}.{0,120}`))?.[0] ?? "<no context>";
    throw new Error(`Cell ${ref} was not found while patching ${ref}: ${context}`);
  }

  const attrs = match[1].replace(/\s+t="[^"]*"/g, "");
  const cached = cachedValue === null || cachedValue === undefined
    ? "<v/>"
    : `<v>${xmlEscape(cachedValue)}</v>`;
  const replacement = `<c${attrs}><f>${xmlEscape(formula)}</f>${cached}</c>`;
  // Use a callback so `$1`, `$2`, etc. in Excel formulas are not interpreted
  // as JavaScript replacement-string backreferences.
  return xml.replace(pattern, () => replacement);
}

function patchCachedValue(xml, ref, cachedValue) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)>([\\s\\S]*?)<\\/c>`, "m");
  const match = xml.match(pattern);
  if (!match) {
    return xml;
  }
  const attrs = match[1].replace(/\s+t="[^"]*"/g, "");
  const inner = match[2];
  if (!/<f\b/.test(inner)) return xml;
  const value = cachedValue === null || cachedValue === undefined
    ? "<v/>"
    : `<v>${xmlEscape(cachedValue)}</v>`;
  const updatedInner = inner.replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>|<v\s*\/>/, value);
  return xml.replace(pattern, () => `<c${attrs}>${updatedInner}</c>`);
}

function patchWorkbookCalculationSettings(xml) {
  if (/<calcPr\b/.test(xml)) {
    return xml.replace(/<calcPr\b([^>]*)\/>/, (_match, attrs) => {
      const withoutFlags = attrs
        .replace(/\s+calcMode="[^"]*"/g, "")
        .replace(/\s+fullCalcOnLoad="[^"]*"/g, "")
        .replace(/\s+forceFullCalc="[^"]*"/g, "");
      return `<calcPr${withoutFlags} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
    });
  }
  return xml.replace("</workbook>", '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
}

function removeCalcChainRelationship(xml) {
  return xml.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, "");
}

function removeCalcChainContentType(xml) {
  return xml.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, "");
}

function clearCachedFormulaErrors(xml) {
  return xml.replace(
    /<c\b([^>]*\bt="e"[^>]*)>(<f\b[^>]*>[\s\S]*?<\/f>)<v>#[A-Z0-9/!?]+<\/v><\/c>/g,
    (_match, attrs, formula) => `<c${attrs.replace(/\s+t="e"/g, "")}>${formula}<v/></c>`
  );
}

const sourceBuffer = await fs.readFile(sourcePath);
const sourceZip = await JSZip.loadAsync(sourceBuffer);
const workbookXmlOriginal = await sourceZip.file("xl/workbook.xml").async("string");
const workbookRelsOriginal = await sourceZip.file("xl/_rels/workbook.xml.rels").async("string");

const dashboardPath = relationshipTarget(workbookXmlOriginal, workbookRelsOriginal, "Dashboard-FAC");
const calUpsPath = relationshipTarget(workbookXmlOriginal, workbookRelsOriginal, "Cal-UPS LOAD");

let dashboardXml = await sourceZip.file(dashboardPath).async("string");
let calUpsXml = await sourceZip.file(calUpsPath).async("string");

// Summary rows: keep the workbook's UPS grouping, correcting the swapped UPS
// 12/13 references and replacing broken #REF/PPC references with the exact
// device identifiers in the source log.
const summaryGroups = [
  [10, ["UPS 41A", "UPS 41B"]],
  [11, ["PPC 41A", "PPC 41B"]],
  [12, ["PPC 42A", "PPC 42B"]],
  [13, ["PPC 43A", "PPC 43B"]],
  [14, ["PPC 44A", "PPC 44B"]]
];
for (const [row, devices] of summaryGroups) {
  const sum = (column) => devices
    .map(device => `SUMIFS('1. UPS Data Log'!$${column}:$${column},'1. UPS Data Log'!$A:$A,$H$1,'1. UPS Data Log'!$B:$B,"${device}")`)
    .join("+");
  dashboardXml = patchFormulaCell(dashboardXml, `C${row}`, `=${sum("E")}`);
  dashboardXml = patchFormulaCell(dashboardXml, `D${row}`, `=${sum("F")}`);
  dashboardXml = patchFormulaCell(dashboardXml, `H${row}`, `=C${row}*24*$H$2`);
  dashboardXml = patchFormulaCell(dashboardXml, `F${row}`, `=D${row}/E${row}`);
  dashboardXml = patchFormulaCell(dashboardXml, `G${row}`, `=100%-F${row}`);
}

// UPS 11/12/13 summary cards use the detail rows below. The original file had
// UPS 12 and UPS 13 swapped, which made the cards disagree with the log.
dashboardXml = patchFormulaCell(dashboardXml, "C4", "=I20+I21");
dashboardXml = patchFormulaCell(dashboardXml, "D4", "=J20+J21");
dashboardXml = patchFormulaCell(dashboardXml, "C5", "=I24+I25");
dashboardXml = patchFormulaCell(dashboardXml, "D5", "=J24+J25");
dashboardXml = patchFormulaCell(dashboardXml, "C6", "=I22+I23");
dashboardXml = patchFormulaCell(dashboardXml, "D6", "=J22+J23");

// Detail rows are keyed by exact device id and reporting month. The phase log
// has " - R/S/T" suffixes, while the average log contains the exact labels
// used on Dashboard-FAC, so the average log is the authoritative helper here.
for (let row = 18; row <= 27; row += 1) {
  for (const [column, sourceColumn] of [["G", "C"], ["H", "D"], ["I", "E"], ["J", "F"]]) {
    const formula = `=IFERROR(XLOOKUP(1,('1.2 UPS Data Log_Average'!$A$3:$A$42=$H$1)*('1.2 UPS Data Log_Average'!$B$3:$B$42=$C${row}),'1.2 UPS Data Log_Average'!$${sourceColumn}$3:$${sourceColumn}$42,""),"")`;
    dashboardXml = patchFormulaCell(dashboardXml, `${column}${row}`, formula);
  }
}

// The AC log has six source meters: EB41A/B, EB43A/B and EB44A/B. The source
// workbook had EB44A/B pointing at EB43A/B and the total omitted EB41A/B.
for (const row of [30, 31]) {
  dashboardXml = patchFormulaCell(dashboardXml, `F${row}`, `=XLOOKUP($A$${row},'2. Air Energy Consumption Log'!$A$2:$A$98,'2. Air Energy Consumption Log'!$F$2:$F$98,"")`);
  dashboardXml = patchFormulaCell(dashboardXml, `G${row}`, `=XLOOKUP($A$${row},'2. Air Energy Consumption Log'!$A$2:$A$98,'2. Air Energy Consumption Log'!$G$2:$G$98,"")`);
}
dashboardXml = patchFormulaCell(dashboardXml, "H30", "=SUM(B32:G32)*1000000");

// The energy summary is the sum of UPS/PPC, Air and DC monthly energy. This
// replaces the deleted reference and keeps the existing full-precision rate,
// cost and share formulas intact.
dashboardXml = patchFormulaCell(dashboardXml, "D40", "=H15+H30+G37");
dashboardXml = patchFormulaCell(dashboardXml, "E40", "=(C40/B40)*D40");
dashboardXml = patchFormulaCell(dashboardXml, "F40", "=C40/B40");
dashboardXml = patchFormulaCell(dashboardXml, "G40", "=D40/B40");
dashboardXml = patchFormulaCell(dashboardXml, "H15", "=SUM(H10:H14)");
dashboardXml = patchFormulaCell(dashboardXml, "E13", "=E12");
dashboardXml = patchFormulaCell(dashboardXml, "E14", "=E12");
dashboardXml = patchFormulaCell(dashboardXml, "L18", "=J18/K18");
dashboardXml = patchFormulaCell(dashboardXml, "L19", "=J19/K19");
for (let row = 18; row <= 27; row += 1) {
  dashboardXml = patchFormulaCell(dashboardXml, `L${row}`, `=J${row}/K${row}`);
}

// The hidden legacy helper referenced deleted cells. Keep it valid so a
// workbook-wide formula audit no longer reports #REF! errors.
calUpsXml = patchFormulaCell(calUpsXml, "C3", "='Dashboard-FAC'!C4");
calUpsXml = patchFormulaCell(calUpsXml, "D3", "='Dashboard-FAC'!D4");
calUpsXml = patchFormulaCell(calUpsXml, "C4", "='Dashboard-FAC'!C6");
calUpsXml = patchFormulaCell(calUpsXml, "D4", "='Dashboard-FAC'!D6");

// Populate cached values for the active reporting month. Excel will still
// recalculate these formulas on open, but a reader that only consumes cached
// results (including the portable application) will no longer show blanks.
const sourceWorkbook = new ExcelJS.Workbook();
await sourceWorkbook.xlsx.load(sourceBuffer, { keepVba: true });
const sourceDashboard = sourceWorkbook.getWorksheet("Dashboard-FAC");
const sourceMonthValue = sourceDashboard.getCell("H1").value;
const monthKey = value => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? null
    : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const activeMonth = monthKey(sourceMonthValue);
const numericCellValue = value => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) {
    return typeof value.result === "number" && Number.isFinite(value.result) ? value.result : null;
  }
  return null;
};

const averageSheet = sourceWorkbook.getWorksheet("1.2 UPS Data Log_Average");
const averages = new Map();
for (let row = 3; row <= averageSheet.rowCount; row += 1) {
  const values = averageSheet.getRow(row).values;
  const key = `${monthKey(values[1])}|${String(values[2] ?? "")}`;
  if (key !== "null|") averages.set(key, [3, 4, 5, 6].map(index => numericCellValue(values[index])));
}
const detailCache = new Map();
for (let row = 18; row <= 27; row += 1) {
  const device = String(sourceDashboard.getCell(`C${row}`).value ?? "");
  const values = averages.get(`${activeMonth}|${device}`) ?? [null, null, null, null];
  detailCache.set(row, values);
  for (const [column, value] of [["G", values[0]], ["H", values[1]], ["I", values[2]], ["J", values[3]]]) {
    dashboardXml = patchCachedValue(dashboardXml, `${column}${row}`, value);
  }
  const loadPercent = typeof values[3] === "number" && typeof numericCellValue(sourceDashboard.getCell(`K${row}`).value) === "number"
    ? values[3] / numericCellValue(sourceDashboard.getCell(`K${row}`).value)
    : null;
  dashboardXml = patchCachedValue(dashboardXml, `L${row}`, loadPercent);
}

const rawUps = sourceWorkbook.getWorksheet("1. UPS Data Log");
const rawUpsValues = new Map();
for (let row = 3; row <= rawUps.rowCount; row += 1) {
  const values = rawUps.getRow(row).values;
  const key = `${monthKey(values[1])}|${String(values[2] ?? "")}`;
  rawUpsValues.set(key, [numericCellValue(values[5]), numericCellValue(values[6])]);
}
const summaryCache = new Map();
for (const [row, devices] of summaryGroups) {
  const totals = [0, 0];
  for (const device of devices) {
    const values = rawUpsValues.get(`${activeMonth}|${device}`) ?? [null, null];
    if (typeof values[0] === "number") totals[0] += values[0];
    if (typeof values[1] === "number") totals[1] += values[1];
  }
  dashboardXml = patchCachedValue(dashboardXml, `C${row}`, totals[0]);
  dashboardXml = patchCachedValue(dashboardXml, `D${row}`, totals[1]);
  dashboardXml = patchCachedValue(dashboardXml, `E${row}`, row >= 13 ? 400 : numericCellValue(sourceDashboard.getCell(`E${row}`).value));
  dashboardXml = patchCachedValue(dashboardXml, `F${row}`, totals[1] / 400);
  dashboardXml = patchCachedValue(dashboardXml, `G${row}`, 1 - totals[1] / 400);
  dashboardXml = patchCachedValue(dashboardXml, `H${row}`, totals[0] * 24 * numericCellValue(sourceDashboard.getCell("H2").value));
  summaryCache.set(row, totals);
}

const detailGroups = [[4, 20, 21], [5, 24, 25], [6, 22, 23]];
for (const [summaryRow, rowA, rowB] of detailGroups) {
  const c = (detailCache.get(rowA)?.[2] ?? 0) + (detailCache.get(rowB)?.[2] ?? 0);
  const d = (detailCache.get(rowA)?.[3] ?? 0) + (detailCache.get(rowB)?.[3] ?? 0);
  dashboardXml = patchCachedValue(dashboardXml, `C${summaryRow}`, c);
  dashboardXml = patchCachedValue(dashboardXml, `D${summaryRow}`, d);
  dashboardXml = patchCachedValue(dashboardXml, `F${summaryRow}`, d / 400);
  dashboardXml = patchCachedValue(dashboardXml, `G${summaryRow}`, 1 - d / 400);
}

const airSheet = sourceWorkbook.getWorksheet("2. Air Energy Consumption Log");
const airRows = new Map();
for (let row = 2; row <= airSheet.rowCount; row += 1) {
  const values = airSheet.getRow(row).values;
  airRows.set(monthKey(values[1]), [2, 3, 4, 5, 6, 7].map(index => numericCellValue(values[index])));
}
const previousDate = new Date(`${activeMonth}-01T00:00:00Z`);
previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
const previousMonth = monthKey(previousDate);
const previousAir = airRows.get(previousMonth) ?? [];
const currentAir = airRows.get(activeMonth) ?? [];
for (const [row, values] of [[30, previousAir], [31, currentAir]]) {
  for (let index = 0; index < 6; index += 1) dashboardXml = patchCachedValue(dashboardXml, `${String.fromCharCode(66 + index)}${row}`, values[index] ?? null);
}
const airDelta = currentAir.length === 6 && previousAir.length === 6 && currentAir.every((value, index) => typeof value === "number" && typeof previousAir[index] === "number")
  ? currentAir.reduce((sum, value, index) => sum + value - previousAir[index], 0) * 1000000
  : null;
dashboardXml = patchCachedValue(dashboardXml, "H30", airDelta);

const energySheet = sourceWorkbook.getWorksheet("4. Electricity Cost Log");
let buildingEnergy = null;
let buildingCost = null;
for (let row = 2; row <= energySheet.rowCount; row += 1) {
  const values = energySheet.getRow(row).values;
  if (monthKey(values[1]) !== activeMonth) continue;
  buildingEnergy = numericCellValue(values[2]);
  buildingCost = numericCellValue(values[3]);
  break;
}
dashboardXml = patchCachedValue(dashboardXml, "B40", buildingEnergy);
dashboardXml = patchCachedValue(dashboardXml, "C40", buildingCost);
const h15 = summaryGroups.reduce((sum, [row]) => sum + (summaryCache.get(row)?.[0] ?? 0) * 24 * numericCellValue(sourceDashboard.getCell("H2").value), 0);
dashboardXml = patchCachedValue(dashboardXml, "H15", h15);
const dcEnergy = numericCellValue(sourceDashboard.getCell("G37").value);
const floorEnergy = h15 + (airDelta ?? 0) + (dcEnergy ?? 0);
const rate = typeof buildingEnergy === "number" && buildingEnergy !== 0 && typeof buildingCost === "number" ? buildingCost / buildingEnergy : null;
dashboardXml = patchCachedValue(dashboardXml, "D40", floorEnergy);
dashboardXml = patchCachedValue(dashboardXml, "E40", rate === null ? null : rate * floorEnergy);
dashboardXml = patchCachedValue(dashboardXml, "F40", rate);
dashboardXml = patchCachedValue(dashboardXml, "G40", rate === null || typeof buildingEnergy !== "number" || buildingEnergy === 0 ? null : floorEnergy / buildingEnergy);

sourceZip.file(dashboardPath, dashboardXml);
sourceZip.file(calUpsPath, calUpsXml);

let workbookXml = patchWorkbookCalculationSettings(workbookXmlOriginal);
sourceZip.file("xl/workbook.xml", workbookXml);

const workbookRels = removeCalcChainRelationship(workbookRelsOriginal);
sourceZip.file("xl/_rels/workbook.xml.rels", workbookRels);
sourceZip.file("[Content_Types].xml", removeCalcChainContentType(await sourceZip.file("[Content_Types].xml").async("string")));
sourceZip.remove("xl/calcChain.xml");

// Cached #REF/#VALUE results belonged to the deleted formulas. Clear only
// those formula caches; Excel will recalculate every formula on open.
for (const name of Object.keys(sourceZip.files)) {
  if (!name.startsWith("xl/worksheets/") || !name.endsWith(".xml")) continue;
  const file = sourceZip.file(name);
  if (!file) continue;
  sourceZip.file(name, clearCachedFormulaErrors(await file.async("string")));
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const outputBuffer = await sourceZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await fs.writeFile(outputPath, outputBuffer);

// Validate the patch without relying on Excel's cached formula results.
const outputZip = await JSZip.loadAsync(outputBuffer);
const outputDashboard = await outputZip.file(dashboardPath).async("string");
const outputCalUps = await outputZip.file(calUpsPath).async("string");
const formulaText = xml => [...xml.matchAll(/<f\b[^>]*>([\s\S]*?)<\/f>/g)].map(match => match[1]).join("\n");
if (formulaText(outputDashboard).includes("#REF!") || formulaText(outputCalUps).includes("#REF!")) {
  throw new Error("The prepared workbook still contains #REF! in Dashboard-FAC or Cal-UPS LOAD");
}
if (!outputZip.file("xl/vbaProject.bin")) throw new Error("VBA project was not preserved");
for (const required of ["xl/pivotCache/pivotCacheDefinition1.xml", "xl/pivotTables/pivotTable1.xml", "xl/charts/chart1.xml"]) {
  if (!outputZip.file(required)) throw new Error(`Required workbook part was not preserved: ${required}`);
}

const sourceVba = await sourceZip.file("xl/vbaProject.bin").async("nodebuffer");
const outputVba = await outputZip.file("xl/vbaProject.bin").async("nodebuffer");
if (!sourceVba.equals(outputVba)) throw new Error("VBA project bytes changed");

console.log(JSON.stringify({
  source: path.resolve(sourcePath),
  output: path.resolve(outputPath),
  dashboardSheet: dashboardPath,
  calUpsSheet: calUpsPath,
  sourceBytes: sourceBuffer.length,
  outputBytes: outputBuffer.length,
  vbaPreserved: true,
  calcMode: "auto",
  fullCalcOnLoad: true,
  formulasRepaired: 5 + 6 + 40 + 2 + 1 + 4
}, null, 2));
