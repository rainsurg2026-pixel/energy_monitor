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
}

interface ApiSiteState {
  site: Omit<FacilitySite, "availableMonths" | "latestAvailableMonth">;
  availableMonths: string[];
  latestAvailableMonth: string | null;
}

/** Adapter for the server's authoritative `{ site, availability }` bootstrap DTO. */
export function normalizeBootstrap(payload: Omit<BootstrapState, "sites"> & { sites: ApiSiteState[] }): BootstrapState {
  return {
    ...payload,
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

export function facilityStorageKey(userId: string): string { return `energy-monitor:selected-facility:${userId}`; }
