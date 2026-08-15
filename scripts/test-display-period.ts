import { filterLogsForDisplay, isMonthInDisplayPeriod } from "../src/utils/displayPeriod";

function assert(name: string, condition: boolean): void {
  if (!condition) throw new Error(name);
  console.log(`PASS  ${name}`);
}

const logs = [
  { month: "2025-12", value: 1 },
  { month: "2026-01", value: 2 },
  { month: "2026-07", value: 3 }
];
const original = JSON.stringify(logs);

assert("2026 display period keeps only 2026 records", JSON.stringify(filterLogsForDisplay(logs, "2026")) === JSON.stringify(logs.slice(1)));
assert("all available display period keeps retained history", filterLogsForDisplay(logs, "all").length === logs.length);
assert("month matching is year-scoped", isMonthInDisplayPeriod("2026-07", "2026") && !isMonthInDisplayPeriod("2025-07", "2026"));
assert("month-range display period keeps both configured years", JSON.stringify(filterLogsForDisplay(logs, "2025-01..2026-12")) === JSON.stringify(logs));
assert("month-range display period excludes months outside its bounds", !isMonthInDisplayPeriod("2024-12", "2025-01..2026-12") && !isMonthInDisplayPeriod("2027-01", "2025-01..2026-12"));
assert("display filtering does not mutate source records", JSON.stringify(logs) === original);
