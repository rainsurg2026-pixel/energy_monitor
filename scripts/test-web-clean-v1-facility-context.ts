import assert from "node:assert/strict";
import { facilityStorageKey, normalizeBootstrap, selectedFacility } from "../src/web-clean-v1/facilityContext";

const payload = {
  displayPeriod: { startMonth: "2026-01", endMonth: "2026-12", rowVersion: 7 },
  sites: [
    { site: { id: 1, code: "rangsit", name: "Rangsit", active: true }, availableMonths: ["2026-01"], latestAvailableMonth: "2026-01" },
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
assert.equal(facilityStorageKey("42"), "energy-monitor:selected-facility:42");
console.log("web-clean-v1 facility context: 8 assertions passed");
