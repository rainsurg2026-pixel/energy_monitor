import type { DashboardUpsMappingReport, DashboardUpsMappingRow, DashboardUpsSummaryRow } from "../../src/reports/reportTypes";

function numberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSummaryRow(value: unknown): value is DashboardUpsSummaryRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.no === "number" && Number.isFinite(row.no)
    && typeof row.name === "string"
    && numberOrNull(row.totalLoadKw)
    && numberOrNull(row.totalLoadKva)
    && numberOrNull(row.capacity)
    && numberOrNull(row.loadPercent);
}

function isMappingRow(value: unknown): value is DashboardUpsMappingRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.no === "number" && Number.isFinite(row.no)
    && typeof row.umdb === "string"
    && typeof row.upsId === "string"
    && typeof row.acPowerPanel === "string"
    && typeof row.sts === "string"
    && typeof row.oudb === "string"
    && numberOrNull(row.voltage)
    && numberOrNull(row.current)
    && numberOrNull(row.loadKw)
    && numberOrNull(row.loadKva)
    && numberOrNull(row.capacity)
    && numberOrNull(row.loadPercent);
}

/**
 * Reads only the Dashboard-FAC field from site_profiles.policy. Invalid or
 * legacy policy JSON is treated as absent, so malformed configuration cannot
 * break bootstrap or leak arbitrary policy fields into the API DTO.
 */
export function dashboardMappingFromPolicy(policy: unknown): DashboardUpsMappingReport | null {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  const candidate = (policy as Record<string, unknown>).dashboardMapping;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const report = candidate as Record<string, unknown>;
  if (typeof report.sourceSheet !== "string" || !Array.isArray(report.summary) || !Array.isArray(report.mapping)) return null;
  if (!report.summary.every(isSummaryRow) || !report.mapping.every(isMappingRow)) return null;
  return {
    sourceSheet: report.sourceSheet,
    summary: report.summary.map(row => ({ ...row })),
    mapping: report.mapping.map(row => ({ ...row }))
  };
}
