import type { AirRecord, EnergyCalculationProfile, MonthlyLog, SrinakarinInputSnapshot, UpsRecord } from "../../src/types";
import { HttpError } from "../errors";
import type { MonthlySectionKey, RackSnapshotRecord, RackUnitSnapshotRecord } from "../repositories/contracts";

type JsonObject = Record<string, unknown>;
function object(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", `${field} must be a JSON object.`);
  return value as JsonObject;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new HttpError(400, "INVALID_BODY", `${field} must be a non-empty string.`);
  return value;
}
function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, "INVALID_BODY", `${field} must be a finite number or null.`);
  return value;
}
function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "INVALID_BODY", `${field} must be a string or null.`);
  return value;
}
function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new HttpError(400, "INVALID_BODY", `${field} must be a finite non-negative number.`);
  return value;
}
function numberMap(value: unknown, field: string): Record<string, number | null> {
  const source = object(value ?? {}, field);
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [text(key, `${field} key`), nullableNumber(entry, `${field}.${key}`)]));
}

const MONTHLY_SECTION_KEYS: readonly MonthlySectionKey[] = ["ups", "air", "dc", "energyCost"];

export function parseSavedSections(value: unknown): MonthlySectionKey[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "changed_sections must be an array.");
  const sections = value.map((entry, index) => {
    if (typeof entry !== "string" || !MONTHLY_SECTION_KEYS.includes(entry as MonthlySectionKey)) {
      throw new HttpError(400, "INVALID_BODY", `changed_sections[${index}] is not a supported monthly section.`);
    }
    return entry as MonthlySectionKey;
  });
  return [...new Set(sections)];
}
function phase(value: unknown, field: string): { voltage: number | null; current: number | null; loadKw: number | null; loadKva: number | null } {
  const source = object(value, field);
  return { voltage: nullableNumber(source.voltage, `${field}.voltage`), current: nullableNumber(source.current, `${field}.current`), loadKw: nullableNumber(source.loadKw, `${field}.loadKw`), loadKva: nullableNumber(source.loadKva, `${field}.loadKva`) };
}
function parseUps(value: unknown, index: number): UpsRecord {
  const source = object(value, `ups[${index}]`);
  const record: UpsRecord = { upsId: text(source.upsId, `ups[${index}].upsId`), voltage: nullableNumber(source.voltage, `ups[${index}].voltage`), current: nullableNumber(source.current, `ups[${index}].current`), loadKw: nullableNumber(source.loadKw, `ups[${index}].loadKw`), loadKva: nullableNumber(source.loadKva, `ups[${index}].loadKva`) };
  if (source.phases !== undefined) {
    const phases = object(source.phases, `ups[${index}].phases`);
    record.phases = Object.fromEntries(Object.entries(phases).map(([key, entry]) => [text(key, "phase key"), phase(entry, `ups[${index}].phases.${key}`)]));
  }
  return record;
}
function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new HttpError(400, "DUPLICATE_INPUT", `${field} contains duplicate identifiers.`);
}
function parseSrinakarin(value: unknown): SrinakarinInputSnapshot | undefined {
  if (value === undefined || value === null) return undefined;
  const source = object(value, "srinakarinInputs");
  const upsPhaseSource = object(source.upsPhase ?? {}, "srinakarinInputs.upsPhase");
  const acPhaseSource = object(source.acPhase ?? {}, "srinakarinInputs.acPhase");
  const panelSource = object(source.ppc43Panel ?? {}, "srinakarinInputs.ppc43Panel");
  return {
    upsPhase: Object.fromEntries(Object.entries(upsPhaseSource).map(([key, entry]) => [text(key, "upsPhase key"), phase(entry, `srinakarinInputs.upsPhase.${key}`)])),
    acPhase: Object.fromEntries(Object.entries(acPhaseSource).map(([key, entry]) => { const parsed = object(entry, `srinakarinInputs.acPhase.${key}`); return [text(key, "acPhase key"), { voltage: nullableNumber(parsed.voltage, `acPhase.${key}.voltage`), current: nullableNumber(parsed.current, `acPhase.${key}.current`) }]; })),
    ppc43Current: numberMap(source.ppc43Current, "srinakarinInputs.ppc43Current"),
    ppc43Panel: Object.fromEntries(Object.entries(panelSource).map(([key, entry]) => { const parsed = object(entry, `srinakarinInputs.ppc43Panel.${key}`); return [text(key, "ppc43Panel key"), { loadKw: nullableNumber(parsed.loadKw, `ppc43Panel.${key}.loadKw`), loadKva: nullableNumber(parsed.loadKva, `ppc43Panel.${key}.loadKva`) }]; }))
  };
}

export function parseMonthlyLog(value: unknown, expectedMonth: string): MonthlyLog {
  const source = object(value, "log");
  if (source.month !== expectedMonth) throw new HttpError(400, "INVALID_BODY", "log.month must match the requested month.");
  const airSource = object(source.air, "log.air");
  const air: AirRecord = { eb41a: nullableNumber(airSource.eb41a, "log.air.eb41a"), eb41b: nullableNumber(airSource.eb41b, "log.air.eb41b"), eb42a: nullableNumber(airSource.eb42a, "log.air.eb42a"), eb42b: nullableNumber(airSource.eb42b, "log.air.eb42b"), meters: numberMap(airSource.meters, "log.air.meters") };
  const upsValue = source.ups;
  if (!Array.isArray(upsValue)) throw new HttpError(400, "INVALID_BODY", "log.ups must be an array.");
  const dcValue = source.dc;
  if (!Array.isArray(dcValue)) throw new HttpError(400, "INVALID_BODY", "log.dc must be an array.");
  const energy = object(source.energyCost, "log.energyCost");
  let energyCalculation: EnergyCalculationProfile | undefined;
  if (source.energyCalculation !== undefined) {
    const profile = object(source.energyCalculation, "log.energyCalculation");
    const groups = profile.upsGroups;
    if (!Array.isArray(groups) || !groups.every(group => Array.isArray(group) && group.every(item => typeof item === "string"))) throw new HttpError(400, "INVALID_BODY", "log.energyCalculation.upsGroups must be a string matrix.");
    const dcIds = profile.dcIds;
    const airFields = profile.airFields;
    if (!Array.isArray(dcIds) || !dcIds.every(item => typeof item === "string") || !Array.isArray(airFields) || !airFields.every(item => typeof item === "string")) throw new HttpError(400, "INVALID_BODY", "log.energyCalculation lists must contain strings.");
    energyCalculation = { upsGroups: groups as string[][], dcIds: dcIds as string[], airFields: airFields as string[] };
  }
  const ups = upsValue.map(parseUps);
  const dc = dcValue.map((entry, index) => { const item = object(entry, `log.dc[${index}]`); return { panelId: text(item.panelId, `log.dc[${index}].panelId`), voltage: nullableNumber(item.voltage, `log.dc[${index}].voltage`), current: nullableNumber(item.current, `log.dc[${index}].current`) }; });
  assertUnique(ups.map(item => item.upsId), "log.ups");
  assertUnique(dc.map(item => item.panelId), "log.dc");
  return { month: expectedMonth, ups, air, dc, energyCost: { buildingEnergyKwh: nullableNumber(energy.buildingEnergyKwh, "log.energyCost.buildingEnergyKwh"), buildingElectricityCostThb: nullableNumber(energy.buildingElectricityCostThb, "log.energyCost.buildingElectricityCostThb") }, lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null, energyCalculation, srinakarinInputs: parseSrinakarin(source.srinakarinInputs) };
}

export function parseExpectedRowVersion(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new HttpError(400, "INVALID_ROW_VERSION", "expected_row_version must be a PostgreSQL-safe non-negative integer or null.");
  return value;
}

export function parseRackSnapshotRecords(value: unknown): RackSnapshotRecord["records"] {
  if (!Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "records must be an array.");
  return value.map((entry, index) => {
    const source = object(entry, `records[${index}]`);
    const rowNumber = source.rowNumber ?? source.row_number;
    if (rowNumber !== null && rowNumber !== undefined && (!Number.isSafeInteger(rowNumber) || Number(rowNumber) < 1)) {
      throw new HttpError(400, "INVALID_BODY", `records[${index}].rowNumber must be a positive integer or null.`);
    }
    return {
      rowNumber: rowNumber === null || rowNumber === undefined ? null : Number(rowNumber),
      rackZone: nullableText(source.rackZone ?? source.rack_zone, `records[${index}].rackZone`),
      rackId: nullableText(source.rackId ?? source.rack_id, `records[${index}].rackId`),
      status: nullableText(source.status, `records[${index}].status`),
      cabinetSize: nullableText(source.cabinetSize ?? source.cabinet_size, `records[${index}].cabinetSize`),
      detail: nullableText(source.detail, `records[${index}].detail`),
      deviceType: nullableText(source.deviceType ?? source.device_type, `records[${index}].deviceType`),
      remarks: nullableText(source.remarks, `records[${index}].remarks`)
    };
  });
}

export function parseRackUnitSnapshot(value: unknown): Pick<RackUnitSnapshotRecord, "totalU" | "usedU"> {
  const source = object(value, "rack_unit");
  return { totalU: nonNegativeNumber(source.totalU ?? source.total_u, "rack_unit.totalU"), usedU: nonNegativeNumber(source.usedU ?? source.used_u, "rack_unit.usedU") };
}

export function parseProvenance(value: unknown): { sourceType: string; sourceFileHash?: string | null; sourceFileName?: string | null; sourceSheet?: string | null; sourceLocation?: string | null } | undefined {
  if (value === undefined || value === null) return undefined;
  const source = object(value, "provenance");
  return { sourceType: text(source.sourceType ?? source.source_type, "provenance.source_type"), sourceFileHash: nullableText(source.sourceFileHash ?? source.source_file_hash, "provenance.source_file_hash"), sourceFileName: nullableText(source.sourceFileName ?? source.source_file_name, "provenance.source_file_name"), sourceSheet: nullableText(source.sourceSheet ?? source.source_sheet, "provenance.source_sheet"), sourceLocation: nullableText(source.sourceLocation ?? source.source_location, "provenance.source_location") };
}
