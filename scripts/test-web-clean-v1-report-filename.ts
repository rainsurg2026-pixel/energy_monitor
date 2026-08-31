import assert from "node:assert/strict";
import { defaultAllFacilitiesReportFilename, defaultReportFilename, resolveFilename, sanitizeFilename, withExtension } from "../src/web-clean-v1/reportFilename";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// Desktop-standard default: confirmed from Desktop's own Recent Reports
// history (Energy_Report_Rangsit_2026-06.pdf / Energy_Report_Srinakarin_2026-06.pdf),
// not assumed.
check("default filename matches the Desktop convention", defaultReportFilename("Rangsit", "2026-06") === "Energy_Report_Rangsit_2026-06");
check("default filename strips spaces from a multi-word facility name", defaultReportFilename("Data Center One", "2026-06") === "Energy_Report_DataCenterOne_2026-06");
check("All Facilities filename uses YYYY-Mmm", defaultAllFacilitiesReportFilename("2026-07") === "All_Facilities_Energy_Report_2026-Jul");

// Extension safety: no duplicate extensions, case-insensitive detection.
check("Excel gets .xlsx", withExtension("Energy_Report_Rangsit_2026-06", "xlsx") === "Energy_Report_Rangsit_2026-06.xlsx");
check("CSV gets .csv", withExtension("Energy_Report_Rangsit_2026-06", "csv") === "Energy_Report_Rangsit_2026-06.csv");
check("PDF gets .pdf", withExtension("Energy_Report_Rangsit_2026-06", "pdf") === "Energy_Report_Rangsit_2026-06.pdf");
check("a name already ending in .xlsx does not become .xlsx.xlsx", withExtension("MyReport.xlsx", "xlsx") === "MyReport.xlsx");
check("a name typed with the wrong extension is corrected, not appended", withExtension("MyReport.csv", "pdf") === "MyReport.pdf");
check("extension matching is case-insensitive", withExtension("MyReport.XLSX", "xlsx") === "MyReport.xlsx");

// Invalid Windows filename characters are normalized, not left broken.
check("invalid Windows characters are replaced", sanitizeFilename('Report<>:"/\\|?*Name') === "Report---------Name");
check("a name with no invalid characters is returned unchanged", sanitizeFilename("Energy_Report_Rangsit_2026-06") === "Energy_Report_Rangsit_2026-06");

// Empty filename: must never produce a bare ".xlsx" - falls back to the
// Desktop-standard default instead.
check("an empty user filename falls back to the Desktop-standard default", resolveFilename("", "Rangsit", "2026-06") === "Energy_Report_Rangsit_2026-06");
check("a whitespace-only user filename falls back to the default", resolveFilename("   ", "Rangsit", "2026-06") === "Energy_Report_Rangsit_2026-06");
check("a user-customized filename is preserved as-is", resolveFilename("June_Summary", "Rangsit", "2026-06") === "June_Summary");
check("a user filename with invalid characters is sanitized, not rejected", resolveFilename("June/Summary", "Rangsit", "2026-06") === "June-Summary");

console.log(`web-clean-v1 report filename: ${checks} assertions passed`);
