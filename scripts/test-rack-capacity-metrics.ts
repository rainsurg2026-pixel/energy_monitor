import { calculateRackCapacityMetrics, formatRatioPercent, rackUtilizationLevel } from "../src/utils/rackCapacity";
import type { RackRecord } from "../src/reports/reportTypes";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function record(zone: string, status: string | null, rackId = `${zone}-${Math.random()}`): RackRecord {
  return { rowNumber: 0, rackZone: zone, rackId, status, cabinetSize: null, detail: null, deviceType: null, remarks: null };
}

// ---- Example from the spec: 237 total, 218 In Use, 3 Available, 13 Reserved, 3 Pending Dismantle ----
const records: RackRecord[] = [
  ...Array.from({ length: 218 }, () => record("A", "In Use")),
  ...Array.from({ length: 3 }, () => record("A", "Available")),
  ...Array.from({ length: 13 }, () => record("B", "Reserved")),
  ...Array.from({ length: 3 }, () => record("B", "Pending Dismantle"))
];
const metrics = calculateRackCapacityMetrics(records);
check("total is 237", metrics.total === 237);
check("In Use count is 218", metrics.inUse.count === 218);
check("In Use ratio is a 0-1 fraction (not 0-100)", Math.abs((metrics.inUse.ratio ?? 0) - 218 / 237) < 1e-9);
check("In Use ratio is NOT stored as 91.98", (metrics.inUse.ratio ?? 0) < 1);
check("formatRatioPercent renders 91.98%", formatRatioPercent(metrics.inUse.ratio) === "91.98%");
check("Available ratio matches 3/237", Math.abs((metrics.available.ratio ?? 0) - 3 / 237) < 1e-9);
check("Reserved ratio matches 13/237", Math.abs((metrics.reserved.ratio ?? 0) - 13 / 237) < 1e-9);
check("Pending Dismantle ratio matches 3/237", Math.abs((metrics.pendingDismantle.ratio ?? 0) - 3 / 237) < 1e-9);
check("Other count is 0 (all statuses canonical)", metrics.other.count === 0);

// ---- Zero denominator: null ratio, never NaN/Infinity, formats as "—" ----
const empty = calculateRackCapacityMetrics([]);
check("Empty total is 0", empty.total === 0);
check("Empty In Use ratio is null (not NaN)", empty.inUse.ratio === null);
check("formatRatioPercent(null) is an em dash", formatRatioPercent(empty.inUse.ratio) === "—");
check("formatRatioPercent never emits NaN%", !formatRatioPercent(empty.inUse.ratio).includes("NaN"));
check("formatRatioPercent never emits Infinity%", !formatRatioPercent(empty.inUse.ratio).includes("Infinity"));

// ---- Non-canonical status counted as "Other", never invented ----
const withUnknown = calculateRackCapacityMetrics([
  record("A", "In Use"),
  record("A", "Decommissioned"),
  record("A", null)
]);
check("Unknown + blank statuses both count as Other", withUnknown.other.count === 2);
check("Other ratio matches 2/3", Math.abs((withUnknown.other.ratio ?? 0) - 2 / 3) < 1e-9);

// ---- Zone denominator must be the ZONE total, not the facility total ----
const zoned = calculateRackCapacityMetrics([
  ...Array.from({ length: 9 }, () => record("A", "In Use")),
  ...Array.from({ length: 1 }, () => record("A", "Available")),
  ...Array.from({ length: 1 }, () => record("B", "Reserved"))
]);
const zoneA = zoned.zoneMetrics.find(z => z.zone === "A")!;
const zoneB = zoned.zoneMetrics.find(z => z.zone === "B")!;
check("Zone A total is 10 (not facility total 11)", zoneA.total === 10);
check("Zone A In Use ratio is 9/10 (zone denominator)", Math.abs((zoneA.inUse.ratio ?? 0) - 0.9) < 1e-9);
check("Zone A In Use ratio is NOT 9/11 (facility denominator)", Math.abs((zoneA.inUse.ratio ?? 0) - 9 / 11) > 1e-6);
check("Zone B Reserved ratio is 1/1 = 100%", zoneB.reserved.ratio === 1);
check("Facility-level In Use ratio still uses facility total (9/11)", Math.abs((zoned.inUse.ratio ?? 0) - 9 / 11) < 1e-9);
check("Zones sorted alphabetically", zoned.zoneMetrics.map(z => z.zone).join(",") === "A,B");

// Production-web status bands: exact boundary behavior is part of the UI
// contract and must not drift between the dashboard, tooltip, and tests.
check("79.99% is Normal", rackUtilizationLevel(79.99) === "Normal");
check("80.0% is Attention", rackUtilizationLevel(80.0) === "Attention");
check("84.9% is Attention", rackUtilizationLevel(84.9) === "Attention");
check("85.0% is High", rackUtilizationLevel(85.0) === "High");

console.log(failures === 0 ? "\nALL RACK CAPACITY METRICS TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
