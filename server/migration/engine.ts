import { createHash } from "node:crypto";
import { computeAllMetrics } from "../../src/domain/analytics";
import { calculateEnergyCostForMonth } from "../../src/domain/energyCost";
import { normalizedMonth } from "../../src/domain/dates";
import type { MonthlyLog } from "../../src/types";
import type { MigrationCalculation, MigrationIssue, MigrationPlan, MigrationPreview, MigrationSiteMapping, MigrationSource } from "./types";

function issue(code: string, message: string, sourceLocation?: string, field?: string): MigrationIssue {
  return { severity: "error", code, message, sourceLocation, field };
}

function walkNumbers(value: unknown, location: string, issues: MigrationIssue[], seen: Set<object> = new Set()): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(issue("NON_FINITE_NUMERIC", `${location} must be finite.`, undefined, location));
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkNumbers(entry, `${location}[${index}]`, issues, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) walkNumbers(entry, `${location}.${key}`, issues, seen);
}

function countRawRows(log: MonthlyLog): number {
  const srinakarin = log.srinakarinInputs;
  return 1
    + log.ups.length
    + Object.values(log.ups).reduce((count, row) => count + Object.keys(row.phases ?? {}).length, 0)
    + Object.keys(log.air.meters ?? {}).length
    + log.dc.length
    + Object.keys(srinakarin?.upsPhase ?? {}).length
    + Object.keys(srinakarin?.acPhase ?? {}).length
    + Object.keys(srinakarin?.ppc43Current ?? {}).length
    + Object.keys(srinakarin?.ppc43Panel ?? {}).length;
}

function calculateOutputs(logs: readonly MonthlyLog[]): MigrationCalculation[] {
  const metricsByMonth = new Map(computeAllMetrics([...logs]).map(metrics => [metrics.month, metrics]));
  return [...logs]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(log => {
      const energy = calculateEnergyCostForMonth(logs, log.month);
      const metrics = metricsByMonth.get(log.month);
      if (!metrics) throw new Error(`Domain calculation did not produce metrics for ${log.month}.`);
      return { month: log.month, energy, metrics };
    });
}

export function createMigrationPlan(source: MigrationSource, mapping: MigrationSiteMapping): MigrationPlan {
  const issues: MigrationIssue[] = [];
  if (!/^[a-f0-9]{64}$/i.test(source.sourceFileHash)) issues.push(issue("INVALID_SOURCE_HASH", "Source workbook hash must be a SHA-256 hex digest."));
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(mapping.siteCode)) issues.push(issue("INVALID_SITE_MAPPING", "siteCode must contain only letters, numbers, dot, underscore, or hyphen."));
  if (source.validation.errors.length > 0) source.validation.errors.forEach(message => issues.push(issue("WORKBOOK_VALIDATION", message)));
  source.validation.warnings.forEach(message => issues.push({ severity: "warning", code: "WORKBOOK_WARNING", message }));
  source.integrity.duplicateKeys.forEach(entry => issues.push(issue("DUPLICATE_SOURCE_ROW", `${entry.tab} has duplicate ${entry.month}${entry.deviceId ? `/${entry.deviceId}` : ""} rows: ${entry.rowNumbers.join(", ")}.`)));
  source.integrity.missingMonths.forEach(entry => issues.push(issue("MONTH_MAPPING_MISSING", `${entry.tab} has no source row for ${entry.month}.`)));
  source.integrity.missingDevices.forEach(entry => issues.push(issue("DEVICE_MAPPING_MISSING", `${entry.tab} is missing ${entry.deviceId} for ${entry.month}.`)));
  source.integrity.invalidIds.forEach(entry => issues.push(issue("DEVICE_MAPPING_INVALID", `${entry.tab} row ${entry.rowNumber} has an unknown device identifier.`)));
  source.integrity.unexpectedBlankRows.forEach(entry => issues.push(issue("UNEXPECTED_BLANK_ROW", `${entry.tab} row ${entry.rowNumber} contains values but no valid month.`)));
  source.cachedEvidence.filter(entry => entry.authoritativeInput).forEach(entry => issues.push(issue("CACHED_FORMULA_INPUT", "A formula result appears in an authoritative input field; migration refuses to trust the cached value.", entry.sourceLocation, entry.fieldName)));

  const months = new Set<string>();
  if (source.logs.length === 0) issues.push(issue("NO_SOURCE_LOGS", "The workbook produced no monthly logs."));
  source.logs.forEach((log, index) => {
    const month = normalizedMonth(log.month);
    if (!month) issues.push(issue("INVALID_MONTH", `Source log ${index + 1} has an invalid month.`));
    else if (months.has(month)) issues.push(issue("DUPLICATE_MONTH", `Source contains more than one monthly log for ${month}.`));
    else months.add(month);
    walkNumbers(log, `logs[${index}]`, issues);
  });

  let calculations: MigrationCalculation[] = [];
  if (issues.every(entry => entry.severity !== "error")) {
    try { calculations = calculateOutputs(source.logs); }
    catch (error) { issues.push(issue("DOMAIN_CALCULATION_FAILED", error instanceof Error ? error.message : "Domain calculation failed.")); }
  }

  const idempotencyKey = createHash("sha256")
    .update(`${source.sourceType}:${mapping.siteCode}:${source.sourceFileHash}`)
    .digest("hex");
  return {
    source,
    mapping,
    idempotencyKey,
    rowCount: source.logs.reduce((total, log) => total + countRawRows(log), 0),
    calculations,
    issues
  };
}

export function previewMigrationPlan(plan: MigrationPlan): MigrationPreview {
  return {
    sourceFileName: plan.source.sourceFileName,
    sourceFileHash: plan.source.sourceFileHash,
    siteCode: plan.mapping.siteCode,
    idempotencyKey: plan.idempotencyKey,
    months: plan.source.logs.map(log => log.month).sort(),
    rowCount: plan.rowCount,
    cachedEvidenceCount: plan.source.cachedEvidence.length,
    calculatedMonthCount: plan.calculations.length,
    errors: plan.issues.filter(entry => entry.severity === "error"),
    warnings: plan.issues.filter(entry => entry.severity === "warning"),
    canImport: plan.issues.every(entry => entry.severity !== "error")
  };
}

function numbersEqual(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  return Math.abs(expected - actual) <= 1e-9 * Math.max(1, Math.abs(expected), Math.abs(actual));
}

export function verifyCalculatedParity(expected: readonly MigrationCalculation[], actualLogs: readonly MonthlyLog[]): MigrationIssue[] {
  const actualByMonth = new Map(calculateOutputs(actualLogs).map(entry => [entry.month, entry]));
  const issues: MigrationIssue[] = [];
  for (const expectedEntry of expected) {
    const actualEntry = actualByMonth.get(expectedEntry.month);
    if (!actualEntry) { issues.push(issue("GOLDEN_PARITY_MISSING", `No calculated result was returned for ${expectedEntry.month}.`)); continue; }
    for (const key of Object.keys(expectedEntry.energy) as Array<keyof typeof expectedEntry.energy>) {
      const wanted = expectedEntry.energy[key];
      const received = actualEntry.energy[key];
      if (typeof wanted === "number" || wanted === null) {
        if (!numbersEqual(wanted as number | null, received as number | null)) issues.push(issue("GOLDEN_PARITY_MISMATCH", `Energy output ${String(key)} differs for ${expectedEntry.month}.`));
      }
    }
    for (const key of ["upsEnergyKwh", "airEnergyKwh", "dcEnergyKwh", "totalEnergyKwh", "itEquipmentEnergyKwh", "pue", "carbonEmissionKg", "actualCostThb", "estimatedCostThb", "avgElectricityRate", "buildingEnergyKwh", "buildingCostThb"] as const) {
      if (!numbersEqual(expectedEntry.metrics[key], actualEntry.metrics[key])) issues.push(issue("GOLDEN_PARITY_MISMATCH", `Dashboard output ${key} differs for ${expectedEntry.month}.`));
    }
    if (expectedEntry.metrics.dataQualityScore !== actualEntry.metrics.dataQualityScore || expectedEntry.metrics.facilityHealthScore !== actualEntry.metrics.facilityHealthScore || JSON.stringify(expectedEntry.metrics.alerts) !== JSON.stringify(actualEntry.metrics.alerts)) {
      issues.push(issue("GOLDEN_PARITY_MISMATCH", `Quality/alert outputs differ for ${expectedEntry.month}.`));
    }
  }
  return issues;
}

export function createSyntheticMigrationSource(logs: MonthlyLog[], sourceFileHash = "0".repeat(64)): MigrationSource {
  return {
    sourceType: "desktop_workbook",
    sourcePath: "synthetic://phase4",
    sourceFileName: "phase4-sanitized-fixture.xlsx",
    sourceFileHash,
    readAt: new Date(0).toISOString(),
    logs,
    validation: { ok: true, errors: [], warnings: [], sheetNames: {} },
    integrity: { duplicateKeys: [], missingMonths: [], missingDevices: [], unexpectedBlankRows: [], invalidIds: [] },
    cachedEvidence: [],
    sourceLocationsByMonth: Object.fromEntries(logs.map(log => [log.month, [`synthetic://${log.month}`]]))
  };
}
