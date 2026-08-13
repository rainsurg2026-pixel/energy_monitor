import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");

assert.match(app, /import SrinakarinPowerPhaseTable from "\.\.\/components\/SrinakarinPowerPhaseTable"/);
assert.match(app, /site\?\.code === "srinakarin" \? <SrinakarinPowerPhaseTable/);
assert.match(app, /initialLog=\{draft\} lastSaved=\{draft\.lastSavedUps\} onSave=\{\(ups, srinakarinInputs\) => void save\(\{ ups, srinakarinInputs \}\)\}/);
assert.match(app, /: <UpsTable monthStr=\{month\} initialRecords=\{draft\.ups\}/);

console.log("web-clean-v1 Srinakarin entry: preserves Desktop phase-input workflow and generic UPS entry for other sites");
