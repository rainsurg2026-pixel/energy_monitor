import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkflowHeader.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const desktopHeader = readFileSync(new URL("../src/components/EntryWorkflowHeader.tsx", import.meta.url), "utf8");

assert.match(header, /import EntryWorkflowHeader/);
assert.match(header, /workbookLabel="Production API"/);
assert.match(header, /completion=\{computeCompletion\(draft\)\}/);
assert.match(header, /showHealth=\{false\}/);
assert.match(desktopHeader, /showHealth\?: boolean/);
assert.match(app, /<WebEntryWorkflowHeader facilityName=\{site\.name\}/);

console.log("web entry workflow: reuses Desktop month/completion controls without claiming workbook health");
