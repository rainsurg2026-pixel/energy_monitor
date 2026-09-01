import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("../src/web-clean-v1/WebRackCapacityEditors.tsx", import.meta.url), "utf8");

assert.match(editor, /buildRackCapacitySavePayload/,
  "Rack Capacity editor must use the payload builder so null carry-forward metadata is omitted");
assert.doesNotMatch(editor, /carry_forward_source_month:\s*carryForwardSourceMonth/,
  "Rack Capacity editor must not serialize the optional carry-forward month directly");

console.log("web-clean-v1 Rack Capacity editor uses the safe save payload builder");
