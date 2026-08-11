import type { DashboardUpsMappingReport, UpsGroupHistoryReport } from "../reports/reportTypes";

/**
 * DashboardSummary's UPS Groups section needs either a facility.profile.dashboard
 * topology (Desktop's file-based config/<id>/profile.json - no Web/Supabase
 * equivalent) or an upsMapping.summary report. CleanWebApp has no topology,
 * but it already fetches upsGroupHistory (server-computed, already
 * facility/Display-Period-scoped - see server/services/apiService.ts's
 * getHistory) for the History screen. Reusing the selected month's rows here
 * is real, already-verified data, not a guess - it keeps the Dashboard's UPS
 * group totals from silently rendering empty. The detailed per-UPS
 * UMDB/STS/OUDB hardware mapping table has no Web/DB equivalent at all and is
 * deliberately left empty (never fabricated) rather than reusing this data.
 */
export function buildDashboardUpsMapping(upsGroupHistory: UpsGroupHistoryReport | null, month: string): DashboardUpsMappingReport | null {
  const rows = upsGroupHistory?.rows.filter(row => row.month === month) ?? [];
  if (rows.length === 0) return null;
  return {
    sourceSheet: upsGroupHistory!.sourceSheet,
    summary: rows.map((row, index) => ({ no: index + 1, name: row.group, totalLoadKw: row.totalLoadKw, totalLoadKva: row.totalLoadKva, capacity: row.capacity, loadPercent: row.loadPercent })),
    mapping: []
  };
}
