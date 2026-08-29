import type { DashboardUpsMappingReport } from "../reports/reportTypes";
import { registerDesktopDashboardMapping } from "../domain/dashboardMapping";

export interface FacilitySite {
  id: number;
  code: string;
  name: string;
  active: boolean;
  availableMonths: string[];
  latestAvailableMonth: string | null;
  /** Source-derived Desktop Dashboard-FAC topology, when migration retained it. */
  dashboardMapping?: DashboardUpsMappingReport | null;
}

export interface DisplayPeriodState { startMonth: string; endMonth: string; rowVersion: number; }

export interface BootstrapState {
  displayPeriod: DisplayPeriodState;
  sites: FacilitySite[];
  /** Server-side READ_ONLY_MODE gate: when true every mutation returns 423. */
  readOnlyMode: boolean;
}

interface ApiSiteState {
  site: Omit<FacilitySite, "availableMonths" | "latestAvailableMonth">;
  availableMonths: string[];
  latestAvailableMonth: string | null;
}

/** Adapter for the server's authoritative `{ site, availability }` bootstrap DTO. */
export function normalizeBootstrap(payload: Omit<BootstrapState, "sites" | "readOnlyMode"> & { sites: ApiSiteState[]; readOnlyMode?: boolean }): BootstrapState {
  return {
    ...payload,
    readOnlyMode: payload.readOnlyMode ?? false,
    sites: payload.sites.map(item => {
      registerDesktopDashboardMapping(item.site.code, item.site.dashboardMapping);
      return { ...item.site, availableMonths: item.availableMonths, latestAvailableMonth: item.latestAvailableMonth };
    })
  };
}

export function selectedFacility(sites: readonly FacilitySite[], storedSiteId: string | null): FacilitySite | null {
  const parsed = storedSiteId !== null && /^\d+$/.test(storedSiteId) ? Number(storedSiteId) : null;
  return sites.find(site => site.id === parsed) ?? sites[0] ?? null;
}

/** Select the newest month with an actual monthly energy log. Bootstrap
 * availability also includes Rack Capacity and Rack Unit-only rows, which
 * must not make the dashboard open on an empty energy month. */
export function latestEnergyMonth(logs: readonly { month: string }[], fallback: string): string {
  return logs.map(log => log.month).filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort().at(-1) ?? fallback;
}

/** Keep a user-selected reporting month inside the Global Display Period.
 * A month already in range is returned unchanged (the user's position is
 * preserved); an out-of-range month snaps to the NEAREST valid boundary -
 * never to "the latest available month". When `available` months are given,
 * the boundary resolves to the closest month the site actually has. */
export function clampMonthToDisplayPeriod(month: string, startMonth: string, endMonth: string, available: readonly string[] = []): string {
  if (month >= startMonth && month <= endMonth) return month;
  const inRange = [...available].filter(value => value >= startMonth && value <= endMonth).sort();
  if (month < startMonth) return inRange[0] ?? startMonth;
  return inRange.at(-1) ?? endMonth;
}

export function facilityStorageKey(userId: string): string { return `energy-monitor:selected-facility:${userId}`; }
