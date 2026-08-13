import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkspace.tsx", import.meta.url), "utf8");

assert.match(app, /import WebEntryWorkspace from "\.\/WebEntryWorkspace"/);
assert.match(app, /<WebEntryWorkspace siteName=\{site\.name\} siteCode=\{site\.code\}/);
assert.match(workspace, /import SrinakarinPowerPhaseTable from "\.\.\/components\/SrinakarinPowerPhaseTable"/);
assert.match(workspace, /siteCode === "srinakarin" \? <SrinakarinPowerPhaseTable/);
assert.match(workspace, /initialLog=\{draft\} lastSaved=\{draft\.lastSavedUps\} onSave=\{\(ups, srinakarinInputs\) => void onSave\(\{ ups, srinakarinInputs \}\)\}/);
assert.match(workspace, /: <UpsTable monthStr=\{month\} initialRecords=\{draft\.ups\}/);

console.log("web-clean-v1 Srinakarin entry: preserves Desktop phase-input workflow and generic UPS entry for other sites");
