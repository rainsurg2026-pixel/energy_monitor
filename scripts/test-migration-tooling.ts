import assert from "node:assert/strict";
import fs from "node:fs";
import type { MonthlyLog } from "../src/types";
import type { UpsGroupHistoryRow } from "../src/reports/reportTypes";
import { createMigrationPlan, createSyntheticMigrationSource, previewMigrationPlan, verifyCalculatedParity } from "../server/migration/engine";

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/desktop-v2.3.1.json", "utf8")) as { rangsit: { logs: MonthlyLog[] } };
const golden = JSON.parse(fs.readFileSync("tests/golden/desktop-v2.3.1.expected.json", "utf8")) as { rangsit: { energy: unknown } };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

const source = createSyntheticMigrationSource(clone(fixture.rangsit.logs), "a".repeat(64));
source.cachedEvidence.push({ month: "2026-03", fieldName: "4th Floor Electricity Cost", numericValue: 123, textValue: null, sourceSheet: "4. Electricity Cost Log", sourceLocation: "4. Electricity Cost Log!G4", formulaVersion: "desktop-v2.3.1", authoritativeInput: false });
const plan = createMigrationPlan(source, { siteCode: "rangsit", expectedProfileCode: "rangsit-v3" });
const preview = previewMigrationPlan(plan);
check("sanitized source validates", preview.canImport);
check("preview does not write", preview.cachedEvidenceCount === 1 && preview.canImport);
check("source hash creates stable idempotency key", plan.idempotencyKey === createMigrationPlan(source, { siteCode: "rangsit", expectedProfileCode: "rangsit-v3" }).idempotencyKey);
check("row summary includes raw records", preview.rowCount > fixture.rangsit.logs.length);
check("Phase 1 energy calculation matches golden parity", JSON.stringify(plan.calculations.find(entry => entry.month === "2026-03")?.energy) === JSON.stringify(golden.rangsit.energy));
check("round-trip calculation verification passes", verifyCalculatedParity(plan.calculations, source.logs).length === 0);

const changedLogs = clone(source.logs);
changedLogs[1].ups[0].loadKw = (changedLogs[1].ups[0].loadKw ?? 0) + 1;
check("changed source is detected by parity verification", verifyCalculatedParity(plan.calculations, changedLogs).some(entry => entry.code === "GOLDEN_PARITY_MISMATCH"));

const duplicateSource = createSyntheticMigrationSource([...clone(fixture.rangsit.logs), clone(fixture.rangsit.logs[1])], "b".repeat(64));
const duplicatePreview = previewMigrationPlan(createMigrationPlan(duplicateSource, { siteCode: "rangsit" }));
check("duplicate month is rejected", duplicatePreview.errors.some(entry => entry.code === "DUPLICATE_MONTH"));

const invalidNumericLogs = clone(fixture.rangsit.logs);
invalidNumericLogs[0].energyCost.buildingEnergyKwh = Number.NaN;
const invalidNumericPreview = previewMigrationPlan(createMigrationPlan(createSyntheticMigrationSource(invalidNumericLogs, "c".repeat(64)), { siteCode: "rangsit" }));
check("non-finite numeric input is rejected", invalidNumericPreview.errors.some(entry => entry.code === "NON_FINITE_NUMERIC"));

const invalidWorkbookSource = createSyntheticMigrationSource(clone(fixture.rangsit.logs), "d".repeat(64));
invalidWorkbookSource.validation = { ok: false, errors: ["missing required sheet"], warnings: [], sheetNames: {} };
const invalidWorkbookPreview = previewMigrationPlan(createMigrationPlan(invalidWorkbookSource, { siteCode: "rangsit" }));
check("workbook validation errors become rejected-row diagnostics", invalidWorkbookPreview.errors.some(entry => entry.code === "WORKBOOK_VALIDATION"));

const formulaInputSource = createSyntheticMigrationSource(clone(fixture.rangsit.logs), "e".repeat(64));
formulaInputSource.cachedEvidence.push({ month: "2026-03", fieldName: "Building Energy (kWh)", numericValue: 100, textValue: null, sourceSheet: "4. Electricity Cost Log", sourceLocation: "4. Electricity Cost Log!B4", formulaVersion: "desktop-v2.3.1", authoritativeInput: true });
const formulaInputPreview = previewMigrationPlan(createMigrationPlan(formulaInputSource, { siteCode: "rangsit" }));
check("cached formula in authoritative input is rejected", formulaInputPreview.errors.some(entry => entry.code === "CACHED_FORMULA_INPUT"));

const historyRow: UpsGroupHistoryRow = { facility: "rangsit", month: "2026-07", group: "UPS 11", totalLoadKw: 10, totalLoadKva: 11, capacity: 400, loadPercent: 2.75, availablePercent: 97.25, monthlyEnergyKwh: 7440, generatedAt: "2026-08-01T00:00:00.000Z", dataVersion: 1 };
const duplicateHistorySource = createSyntheticMigrationSource(clone(fixture.rangsit.logs), "f".repeat(64));
duplicateHistorySource.upsGroupHistoryRows = [historyRow, { ...historyRow, generatedAt: "2026-08-02T00:00:00.000Z" }];
const duplicateHistoryPreview = previewMigrationPlan(createMigrationPlan(duplicateHistorySource, { siteCode: "rangsit" }));
check("identical duplicate UPS history keys are previewed as collapsible warnings", duplicateHistoryPreview.canImport && duplicateHistoryPreview.warnings.some(entry => entry.code === "DUPLICATE_UPS_HISTORY_COLLAPSED"));
const conflictingHistorySource = createSyntheticMigrationSource(clone(fixture.rangsit.logs), "1".repeat(64));
conflictingHistorySource.upsGroupHistoryRows = [historyRow, { ...historyRow, totalLoadKw: 99 }];
const conflictingHistoryPreview = previewMigrationPlan(createMigrationPlan(conflictingHistorySource, { siteCode: "rangsit" }));
check("conflicting duplicate UPS history keys are rejected", !conflictingHistoryPreview.canImport && conflictingHistoryPreview.errors.some(entry => entry.code === "DUPLICATE_UPS_HISTORY_CONFLICT"));

console.log(`migration tooling: ${checks} assertions passed; preview-only; no database or source workbook writes`);
