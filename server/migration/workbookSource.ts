import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { DESKTOP_FORMULA_VERSION } from "../../src/domain/formulaVersion";
import { readWorkbookFromBuffer } from "../../src/excel/WorkbookReader";
import { normalizeMonthCell } from "../../src/excel/ExcelSchema";
import type { DeviceLists } from "../../src/excel/SheetMapper";
import { DEFAULT_DEVICE_LISTS } from "../../src/excel/SheetMapper";
import type { CachedEvidenceRecord, MigrationSource } from "./types";

type PlainValue = string | number | Date | null;

interface CellInfo {
  value: PlainValue;
  formula: string | null;
}

function cellInfo(cell: ExcelJS.Cell): CellInfo {
  const value = cell.value;
  if (value === null || value === undefined) return { value: null, formula: null };
  if (value instanceof Date || typeof value === "number" || typeof value === "string") return { value, formula: null };
  if (typeof value === "boolean") return { value: value ? 1 : 0, formula: null };
  if (typeof value === "object") {
    const candidate = value as ExcelJS.CellFormulaValue & ExcelJS.CellRichTextValue & ExcelJS.CellHyperlinkValue;
    if (candidate.richText) return { value: candidate.richText.map(part => part.text).join(""), formula: null };
    if (typeof candidate.formula === "string") {
      const result = candidate.result;
      if (result instanceof Date || typeof result === "number" || typeof result === "string") return { value: result, formula: candidate.formula };
      return { value: null, formula: candidate.formula };
    }
    if ("hyperlink" in candidate && candidate.text) return { value: String(candidate.text), formula: null };
  }
  return { value: null, formula: null };
}

function headerText(cell: ExcelJS.Cell): string {
  const value = cellInfo(cell).value;
  return value === null ? "" : String(value).trim();
}

function findMonthHeader(worksheet: ExcelJS.Worksheet): { row: number; monthColumn: number; headers: Map<number, string> } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const headers = new Map<number, string>();
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const text = headerText(cell);
      if (text) headers.set(columnNumber, text);
    });
    const monthColumn = [...headers.entries()].find(([, text]) => text.toLowerCase() === "month")?.[0];
    if (monthColumn) return { row: rowNumber, monthColumn, headers };
  }
  return null;
}

function addLocation(map: Record<string, string[]>, month: string, location: string): void {
  const locations = map[month] ?? [];
  if (!locations.includes(location)) locations.push(location);
  map[month] = locations;
}

function readCachedEvidence(workbook: ExcelJS.Workbook): { evidence: CachedEvidenceRecord[]; locations: Record<string, string[]> } {
  const evidence: CachedEvidenceRecord[] = [];
  const locations: Record<string, string[]> = {};
  for (const worksheet of workbook.worksheets) {
    const header = findMonthHeader(worksheet);
    if (!header) continue;
    for (let rowNumber = header.row + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const month = normalizeMonthCell(cellInfo(row.getCell(header.monthColumn)).value);
      if (!month) continue;
      addLocation(locations, month, `${worksheet.name}!${rowNumber}`);
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const info = cellInfo(cell);
        const fieldName = header.headers.get(columnNumber) ?? `column_${columnNumber}`;
        const normalizedSheet = worksheet.name.toLowerCase();
        const normalizedField = fieldName.toLowerCase();
        const cachedDerivedField = ((normalizedField.includes("floor") || normalizedField.includes("4th")) && normalizedField.includes("cost"))
          || (normalizedField.includes("average") && normalizedField.includes("rate"));
        const derivedSheet = normalizedSheet.includes("average") || normalizedSheet.includes("aggregate") || normalizedSheet.includes("helper") || normalizedSheet.includes("summary");
        if ((!info.formula && !cachedDerivedField) || info.value === null || info.value === "") return;
        const numericValue = typeof info.value === "number" && Number.isFinite(info.value) ? info.value : null;
        const textValue = numericValue === null ? String(info.value instanceof Date ? info.value.toISOString() : info.value) : null;
        evidence.push({
          month,
          fieldName,
          numericValue,
          textValue,
          sourceSheet: worksheet.name,
          sourceLocation: `${worksheet.name}!${cell.address}`,
          formulaVersion: DESKTOP_FORMULA_VERSION,
          // A cached result is migration evidence only.  Even if its column is
          // labelled like an input, the workbook formula (rather than a raw
          // source reading) produced the value, so it must never be promoted
          // to an authoritative input for the v3 calculation layer.
          authoritativeInput: !info.formula && !cachedDerivedField && !derivedSheet
        });
      });
    }
  }
  return { evidence, locations };
}

export async function readWorkbookSource(filePath: string, devices: DeviceLists = DEFAULT_DEVICE_LISTS): Promise<MigrationSource> {
  const sourcePath = path.resolve(filePath);
  const buffer = await readFile(sourcePath);
  const workbookResult = await readWorkbookFromBuffer(buffer, devices);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const cached = readCachedEvidence(workbook);
  const sourceFileHash = createHash("sha256").update(buffer).digest("hex");
  return {
    sourceType: "desktop_workbook",
    sourcePath,
    sourceFileName: path.basename(sourcePath),
    sourceFileHash,
    readAt: new Date().toISOString(),
    logs: workbookResult.logs,
    validation: workbookResult.validation,
    integrity: workbookResult.integrity,
    cachedEvidence: cached.evidence,
    sourceLocationsByMonth: cached.locations
  };
}
