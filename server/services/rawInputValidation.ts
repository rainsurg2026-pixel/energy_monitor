import type { AirRecord, EnergyCalculationProfile, MonthlyLog, SrinakarinInputSnapshot, UpsRecord } from "../../src/types";
import { RACK_CANONICAL_STATUSES } from "../../src/domain/rackCapacity";
import { HttpError } from "../errors";
import type { RackFieldChangeInput } from "../repositories/contracts";

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
function numberMap(value: unknown, field: string): Record<string, number | null> {
  const source = object(value ?? {}, field);
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [text(key, `${field} key`), nullableNumber(entry, `${field}.${key}`)]));
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

function optionalRackTextEdit(value: unknown, field: string): { expected: string | null; next: string | null } | undefined {
  if (value === null || value === undefined) return undefined;
  const source = object(value, field);
  const expected = source.expected;
  const next = source.next;
  if (expected !== null && expected !== undefined && (typeof expected !== "string" || expected.length > 200)) throw new HttpError(400, "INVALID_BODY", `${field}.expected must be a string or null.`);
  if (next !== null && (typeof next !== "string" || next.length > 200)) throw new HttpError(400, "INVALID_BODY", `${field}.next must be a string or null.`);
  return { expected: typeof expected === "string" ? expected : null, next: typeof next === "string" ? next : null };
}

/** Mirrors Desktop's Rack Capacity IPC trust boundary: every staged field
 * edit includes its previously read value so the repository can reject a
 * concurrent change without overwriting it. */
export function parseRackFieldChanges(value: unknown): RackFieldChangeInput[] {
  if (!Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "changes must be an array.");
  if (value.length > 500) throw new HttpError(400, "INVALID_BODY", "Too many Rack Capacity changes in one save (max 500).");
  return value.map((entry, index) => {
    const source = object(entry, `changes[${index}]`);
    const rowNumber = source.rowNumber;
    if (typeof rowNumber !== "number" || !Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > 100000) throw new HttpError(400, "INVALID_BODY", `changes[${index}].rowNumber must be a positive integer.`);
    const rackId = source.rackId;
    if (typeof rackId !== "string" || rackId.trim() === "" || rackId.length > 200) throw new HttpError(400, "INVALID_BODY", `changes[${index}].rackId must be a non-empty string.`);
    const status = optionalRackTextEdit(source.status, `changes[${index}].status`);
    if (status && (status.next === null || !RACK_CANONICAL_STATUSES.includes(status.next as (typeof RACK_CANONICAL_STATUSES)[number]))) throw new HttpError(400, "INVALID_BODY", `changes[${index}].status.next must be a canonical Rack Capacity status.`);
    const cabinetSize = optionalRackTextEdit(source.cabinetSize, `changes[${index}].cabinetSize`);
    const detail = optionalRackTextEdit(source.detail, `changes[${index}].detail`);
    const deviceType = optionalRackTextEdit(source.deviceType, `changes[${index}].deviceType`);
    const remarks = optionalRackTextEdit(source.remarks, `changes[${index}].remarks`);
    if (!status && !cabinetSize && !detail && !deviceType && !remarks) throw new HttpError(400, "INVALID_BODY", `changes[${index}] must contain at least one Rack Capacity edit.`);
    return { rowNumber, rackId, status: status ? { expected: status.expected, next: status.next } : undefined, cabinetSize, detail, deviceType, remarks };
  });
}

export function parseRackUnitCapacity(value: unknown, expectedMonth: string): { totalU: number; usedU: number; expectedRowVersion: number | null; forceSnapshot: boolean } {
  const source = object(value, "body");
  const totalU = source.total_u;
  const usedU = source.used_u;
  if (typeof totalU !== "number" || !Number.isFinite(totalU) || totalU < 0) throw new HttpError(400, "INVALID_BODY", "total_u must be a non-negative finite number.");
  if (typeof usedU !== "number" || !Number.isFinite(usedU) || usedU < 0) throw new HttpError(400, "INVALID_BODY", "used_u must be a non-negative finite number.");
  if (source.month !== undefined && source.month !== expectedMonth) throw new HttpError(400, "INVALID_BODY", "month must match the requested month.");
  return { totalU, usedU, expectedRowVersion: parseExpectedRowVersion(source.expected_row_version), forceSnapshot: source.force_snapshot === true };
}

export function parseProvenance(value: unknown): { sourceType: string; sourceFileHash?: string | null; sourceFileName?: string | null; sourceSheet?: string | null; sourceLocation?: string | null } | undefined {
  if (value === undefined || value === null) return undefined;
  const source = object(value, "provenance");
  return { sourceType: text(source.sourceType ?? source.source_type, "provenance.source_type"), sourceFileHash: nullableText(source.sourceFileHash ?? source.source_file_hash, "provenance.source_file_hash"), sourceFileName: nullableText(source.sourceFileName ?? source.source_file_name, "provenance.source_file_name"), sourceSheet: nullableText(source.sourceSheet ?? source.source_sheet, "provenance.source_sheet"), sourceLocation: nullableText(source.sourceLocation ?? source.source_location, "provenance.source_location") };
}
