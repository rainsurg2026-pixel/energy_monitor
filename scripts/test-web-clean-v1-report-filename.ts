import assert from "node:assert/strict";
import { defaultAllFacilitiesReportFilename, defaultReportFilename, resolveFilename, sanitizeFilename, withExtension } from "../src/web-clean-v1/reportFilename";

let checks = 0;
function check(name: string, condition: unknown): void { assert.equal(Boolean(condition), true, name); checks++; }

// Current Facility filename is keyed to the report month and approved site code.
check("Rangsit current filename uses RST and Mmm-YYYY", defaultReportFilename("Rangsit", "2026-06") === "DC_Status_MonthlyReport of RST_Jun-2026");
check("Srinakarin current filename uses SNK and Mmm-YYYY", defaultReportFilename("Srinakarin", "2026-08") === "DC_Status_MonthlyReport of SNK_Aug-2026");
check("unknown facility falls back to a stable three-character code", defaultReportFilename("Data Center One", "2026-06") === "DC_Status_MonthlyReport of DAT_Jun-2026");
check("All Facilities filename uses YYYY-Mmm", defaultAllFacilitiesReportFilename("2026-07") === "All_Facilities_Energy_Report_2026-Jul");
check("All Facilities filename appends both site names", defaultAllFacilitiesReportFilename("2026-07", ["Rangsit", "Srinakarin"]) === "All_Facilities_Energy_Report_2026-Jul_Rangsit_Srinakarin");
check("All Facilities filename sanitizes and de-duplicates site names", defaultAllFacilitiesReportFilename("2026-07", ["Data Center One", "Data Center One"]) === "All_Facilities_Energy_Report_2026-Jul_DataCenterOne");

// Extension safety: no duplicate extensions, case-insensitive detection.
check("Excel gets .xlsx", withExtension("DC_Status_MonthlyReport of RST_Jun-2026", "xlsx") === "DC_Status_MonthlyReport of RST_Jun-2026.xlsx");
check("CSV gets .csv", withExtension("DC_Status_MonthlyReport of RST_Jun-2026", "csv") === "DC_Status_MonthlyReport of RST_Jun-2026.csv");
check("PDF gets .pdf", withExtension("DC_Status_MonthlyReport of RST_Jun-2026", "pdf") === "DC_Status_MonthlyReport of RST_Jun-2026.pdf");
check("a name already ending in .xlsx does not become .xlsx.xlsx", withExtension("MyReport.xlsx", "xlsx") === "MyReport.xlsx");
check("a name typed with the wrong extension is corrected, not appended", withExtension("MyReport.csv", "pdf") === "MyReport.pdf");
check("extension matching is case-insensitive", withExtension("MyReport.XLSX", "xlsx") === "MyReport.xlsx");

// Invalid Windows filename characters are normalized, not left broken.
check("invalid Windows characters are replaced", sanitizeFilename('Report<>:"/\\|?*Name') === "Report---------Name");
check("a name with no invalid characters is returned unchanged", sanitizeFilename("Energy_Report_Rangsit_2026-06") === "Energy_Report_Rangsit_2026-06");

// Empty filename: must never produce a bare ".xlsx" - falls back to the
// approved Current Facility default instead.
check("an empty user filename falls back to the Desktop-standard default", resolveFilename("", "Rangsit", "2026-06") === "DC_Status_MonthlyReport of RST_Jun-2026");
check("a whitespace-only user filename falls back to the default", resolveFilename("   ", "Rangsit", "2026-06") === "DC_Status_MonthlyReport of RST_Jun-2026");
check("a user-customized filename is preserved as-is", resolveFilename("June_Summary", "Rangsit", "2026-06") === "June_Summary");
check("a user filename with invalid characters is sanitized, not rejected", resolveFilename("June/Summary", "Rangsit", "2026-06") === "June-Summary");

console.log(`web-clean-v1 report filename: ${checks} assertions passed`);
