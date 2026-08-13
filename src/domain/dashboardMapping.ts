import type { DashboardUpsMappingReport, DashboardUpsMappingRow } from "../reports/reportTypes";

/**
 * Desktop Dashboard-FAC's hardware mapping is configuration, not a monthly
 * reading. Imported sites retain the source-derived report in
 * site_profiles.policy; this small built-in map remains only as a read-only
 * compatibility fallback for legacy sites that predate mapping retention.
 * Monthly voltage/current/load values are still taken from the selected
 * month's saved readings; the mapping provides the fixed wiring labels and
 * rated capacity.
 */
const DESKTOP_DASHBOARD_MAPPING: Record<string, DashboardUpsMappingRow[]> = {
  rangsit: [
    { no: 1, umdb: "UMDB11A (EMDB_12A2)", upsId: "UPS 11A", acPowerPanel: "—", sts: "STS11A", oudb: "OUDB41A", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null },
    { no: 2, umdb: "UMDB11B (EMDB_12B2)", upsId: "UPS 11B", acPowerPanel: "—", sts: "STS11B", oudb: "OUDB41B", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null },
    { no: 3, umdb: "UMDB13A (EMDB_12A1)", upsId: "UPS 13A", acPowerPanel: "—", sts: "STS13A", oudb: "OUDB42A", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null },
    { no: 4, umdb: "UMDB13B (EMDB_12B1)", upsId: "UPS 13B", acPowerPanel: "—", sts: "STS13B", oudb: "OUDB42B", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null },
    { no: 5, umdb: "MTS.UPS14C (EMDB_12A-B1)", upsId: "UPS 14C", acPowerPanel: "—", sts: "—", oudb: "OUDB43", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 120, loadPercent: null },
    { no: 6, umdb: "UMDB15A (EMDB_12A2)", upsId: "UPS 15A (PPC44A)", acPowerPanel: "—", sts: "STS15A", oudb: "OUDB31A", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null },
    { no: 7, umdb: "UMDB15B (EMDB_12B2)", upsId: "UPS 15B (PPC44B)", acPowerPanel: "—", sts: "STS15B", oudb: "OUDB31B", voltage: null, current: null, loadKw: null, loadKva: null, capacity: 400, loadPercent: null }
  ],
  srinakarin: [
    { no: 1, umdb: "—", upsId: "UPS 41A", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 2, umdb: "—", upsId: "UPS 41B", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 3, umdb: "—", upsId: "PPC 41A", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 4, umdb: "—", upsId: "PPC 41B", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 5, umdb: "—", upsId: "PPC 42A", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 6, umdb: "—", upsId: "PPC 42B", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 7, umdb: "—", upsId: "PPC 43A", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 8, umdb: "—", upsId: "PPC 43B", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 9, umdb: "—", upsId: "PPC 44A", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null },
    { no: 10, umdb: "—", upsId: "PPC 44B", acPowerPanel: "—", sts: "—", oudb: "—", voltage: null, current: null, loadKw: null, loadKva: null, capacity: null, loadPercent: null }
  ]
};

// Runtime source-derived mappings are populated from the authenticated Web
// bootstrap after a migration. They take precedence over the built-in parity
// fallback while keeping legacy sites usable when no mapping was retained.
const RUNTIME_DASHBOARD_MAPPING = new Map<string, DashboardUpsMappingReport>();

export function registerDesktopDashboardMapping(siteCode: string, report?: DashboardUpsMappingReport | null): void {
  const key = siteCode.trim().toLowerCase();
  if (!key || !report?.mapping?.length) return;
  RUNTIME_DASHBOARD_MAPPING.set(key, {
    sourceSheet: report.sourceSheet,
    summary: report.summary.map(row => ({ ...row })),
    mapping: report.mapping.map(row => ({ ...row }))
  });
}

export function getDesktopDashboardMapping(siteCode: string): DashboardUpsMappingRow[] {
  const key = siteCode.trim().toLowerCase();
  const source = RUNTIME_DASHBOARD_MAPPING.get(key);
  return (source?.mapping ?? DESKTOP_DASHBOARD_MAPPING[key] ?? []).map(row => ({ ...row }));
}
