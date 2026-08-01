/**
 * Unit tests for the single shared Rack Capacity status presentation config
 * (src/utils/rackStatusConfig.ts) and the ratio-clamping helper it and
 * RackStatusBar.tsx both rely on (src/utils/rackCapacity.ts's clampRatio).
 * Every Rack Capacity view (summary cards, donut, legend, zone table,
 * Historical Explorer, PDF) is required to read status order/labels/colors
 * from this one module rather than maintaining separate hardcoded arrays -
 * these tests pin that single source down so a future edit can't silently
 * reintroduce a second, differently-ordered status list.
 */
import { RACK_CANONICAL_STATUSES } from "../src/utils/rackCapacity";
import { RACK_STATUS_DISPLAY_ORDER, rackStatusHex, rackStatusLabel, rackStatusPresentation } from "../src/utils/rackStatusConfig";
import { clampRatio } from "../src/utils/rackCapacity";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

// ---- Canonical order: the single sequence every view must follow ----
check(
  "RACK_STATUS_DISPLAY_ORDER is In Use, Available, Reserved, Pending Dismantle, Other",
  RACK_STATUS_DISPLAY_ORDER.join(",") === "In Use,Available,Reserved,Pending Dismantle,Other",
  RACK_STATUS_DISPLAY_ORDER.join(",")
);
check(
  "the display order's first 4 entries are exactly RACK_CANONICAL_STATUSES (single source, not a duplicate)",
  RACK_STATUS_DISPLAY_ORDER.slice(0, 4).join(",") === RACK_CANONICAL_STATUSES.join(",")
);
check("Other is appended last, never reordered ahead of a real status", RACK_STATUS_DISPLAY_ORDER.at(-1) === "Other");

// ---- Labels: every status has both a TH and EN label, none blank ----
for (const status of RACK_STATUS_DISPLAY_ORDER) {
  check(`"${status}" has a non-empty English label`, rackStatusLabel(status, "en").length > 0);
  check(`"${status}" has a non-empty Thai label`, rackStatusLabel(status, "th").length > 0);
}
check("English and Thai labels differ for every real status (never left untranslated)", RACK_CANONICAL_STATUSES.every(status => rackStatusLabel(status, "en") !== rackStatusLabel(status, "th")));

// ---- Colors: one semantic hex per status, all distinct, valid hex format ----
const hexes = RACK_STATUS_DISPLAY_ORDER.map(rackStatusHex);
check("every status has a valid #rrggbb hex color", hexes.every(hex => /^#[0-9a-f]{6}$/i.test(hex)), hexes.join(","));
check("all 5 status colors are distinct (no two statuses share a color)", new Set(hexes).size === hexes.length, hexes.join(","));

// ---- Unknown/aggregate statuses fall back to "Other", never invented ----
check("an unrecognized status string falls back to the Other presentation", rackStatusPresentation("Decommissioned").status === "Other");
check("an unrecognized status string's hex matches Other's hex exactly", rackStatusHex("Decommissioned") === rackStatusHex("Other"));
check("a blank/null-ish status string falls back to Other", rackStatusPresentation("(blank)").status === "Other");

// ---- clampRatio: what every progress/data bar's width is derived from ----
check("a valid mid-range ratio passes through unchanged", clampRatio(0.42) === 0.42);
check("exactly 0 stays 0", clampRatio(0) === 0);
check("exactly 1 stays 1", clampRatio(1) === 1);
check("null becomes 0 (empty bar, never a crash)", clampRatio(null) === 0);
check("NaN becomes 0", clampRatio(Number.NaN) === 0);
check("a negative ratio clamps to 0 (never a negative-width bar)", clampRatio(-0.3) === 0);
check("a ratio above 1 clamps to 1 (never an overflowing bar)", clampRatio(1.75) === 1);
check("Infinity is treated as invalid data and becomes 0, never left as Infinity", clampRatio(Number.POSITIVE_INFINITY) === 0);

console.log(failures === 0 ? "\nALL RACK STATUS CONFIG TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
