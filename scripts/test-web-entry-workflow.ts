import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkflowHeader.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/web-clean-v1/WebEntryWorkspace.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const desktopHeader = readFileSync(new URL("../src/components/EntryWorkflowHeader.tsx", import.meta.url), "utf8");

assert.match(header, /import EntryWorkflowHeader/);
assert.match(header, /workbookLabel="Production API"/);
assert.match(header, /completion=\{computeCompletion\(draft\)\}/);
assert.match(header, /showHealth=\{false\}/);
assert.match(header, /Historical Data Edit Mode/);
assert.match(header, /Return to latest/);
assert.match(desktopHeader, /showHealth\?: boolean/);
assert.match(app, /<WebEntryWorkspace siteName=\{site\.name\}/);
assert.match(workspace, /<StickyEntryToolbar/);
assert.match(workspace, /Save All sends one concurrency-protected Production API update/);
assert.match(workspace, /listMissingFields\(liveDraft\)/);
assert.match(workspace, /onSave\(\{ ups: liveDraft\.ups/);
assert.match(workspace, /onDraftChange=\{\(ups, srinakarinInputs\)/);
assert.match(workspace, /aboveMobileNav/);
assert.match(workspace, /pb-40 md:pb-24/);
assert.match(desktopHeader, /showHealth\?: boolean/);

console.log("web entry workflow: reuses Desktop month/completion controls without claiming workbook health");
