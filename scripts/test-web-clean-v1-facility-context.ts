import assert from "node:assert/strict";
import { facilityStorageKey, latestEnergyMonth, normalizeBootstrap, selectedFacility } from "../src/web-clean-v1/facilityContext";
import { getDesktopDashboardMapping } from "../src/domain/dashboardMapping";

const sourceMapping = { sourceSheet: "Dashboard-FAC", summary: [], mapping: [{ ...getDesktopDashboardMapping("rangsit")[0], upsId: "SOURCE UPS 99" }] };

const payload = {
  displayPeriod: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 7 },
  sites: [
    { site: { id: 1, code: "rangsit", name: "Rangsit", active: true, dashboardMapping: sourceMapping }, availableMonths: ["2026-01"], latestAvailableMonth: "2026-01" },
    { site: { id: 2, code: "srinakarin", name: "Srinakarin", active: true }, availableMonths: ["2026-02"], latestAvailableMonth: "2026-02" }
  ]
};

const bootstrap = normalizeBootstrap(payload);
assert.deepEqual(bootstrap.sites.map(site => site.id), [1, 2]);
assert.equal(bootstrap.sites[0]?.name, "Rangsit");
assert.equal(bootstrap.sites[1]?.latestAvailableMonth, "2026-02");
assert.equal(selectedFacility(bootstrap.sites, null)?.id, 1);
assert.equal(selectedFacility(bootstrap.sites, "2")?.id, 2);
assert.equal(selectedFacility(bootstrap.sites, "999")?.id, 1);
assert.equal(selectedFacility([], "1"), null);
assert.equal(latestEnergyMonth([{ month: "2026-06" }, { month: "2026-07" }], "2026-08"), "2026-07");
assert.equal(facilityStorageKey("42"), "energy-monitor:selected-facility:42");
assert.equal(getDesktopDashboardMapping("rangsit")[0]?.upsId, "SOURCE UPS 99");
console.log("web-clean-v1 facility context: 9 assertions passed");
