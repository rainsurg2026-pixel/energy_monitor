import type { DashboardUpsMappingReport, DashboardUpsMappingRow, UpsGroupHistoryReport } from "../reports/reportTypes";

/**
 * DashboardSummary's UPS Groups section needs either a facility.profile.dashboard
 * topology (Desktop's file-based config/<id>/profile.json - no Web/Supabase
 * equivalent) or an upsMapping.summary report. CleanWebApp has no topology,
 * but it already fetches upsGroupHistory (server-computed, already
 * facility/Display-Period-scoped - see server/services/apiService.ts's
 * getHistory) for the History screen. Reusing the selected month's rows here
 * is real, already-verified data, not a guess - it keeps the Dashboard's UPS
 * group totals from silently rendering empty. The fixed detail mapping is
 * supplied separately from the shared Desktop parity map; its monthly
 * readings still come from the selected month's saved log.
 */
export function buildDashboardUpsMapping(upsGroupHistory: UpsGroupHistoryReport | null, month: string, detailMapping: DashboardUpsMappingRow[] = []): DashboardUpsMappingReport | null {
  const rows = upsGroupHistory?.rows.filter(row => row.month === month) ?? [];
  if (rows.length === 0 && detailMapping.length === 0) return null;
  return {
    sourceSheet: upsGroupHistory?.sourceSheet ?? "Dashboard-FAC",
    summary: rows.map((row, index) => ({ no: index + 1, name: row.group, totalLoadKw: row.totalLoadKw, totalLoadKva: row.totalLoadKva, capacity: row.capacity, loadPercent: row.loadPercent })),
    // The source workbook's mapping reader also returns cached readings from
    // the workbook's active month. Those numbers are not topology. Clear
    // them here so a historical month with a missing device row cannot fall
    // back to a different month's cached value; buildEngineeringDashboardSnapshot
    // will fill these fields only from the selected MonthlyLog.
    mapping: detailMapping.map(row => ({ ...row, voltage: null, current: null, loadKw: null, loadKva: null, loadPercent: null }))
  };
}
