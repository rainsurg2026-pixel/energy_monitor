import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../src/web-clean-v1/WebReportPreview.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Explicit export selection + per-action feedback
// ---------------------------------------------------------------------------
assert.match(app, /type ExportScope = "current" \| "all";/);
assert.match(app, /type ExportFormat = "csv" \| "excel" \| "html" \| "pdf";/);
assert.match(app, /const \[exportScope, setExportScope\] = useState<ExportScope>\("current"\)/);
assert.match(app, /const \[exportFormat, setExportFormat\] = useState<ExportFormat \| null>\(null\)/);
assert.match(app, /const \[exportAction, setExportAction\] = useState<\{ key: string; stage: ExportStage \} \| null>\(null\)/);
assert.match(app, /const \[exportOutcome, setExportOutcome\] = useState<\{ key: string; ok: boolean \} \| null>\(null\)/);

// (1) A click enters the busy state, and (rAF) the busy paint happens BEFORE
// heavy generation.
assert.match(app, /const key = `\$\{scope\}:\$\{format\}`;/);
assert.match(app, /setExportAction\(\{ key, stage: "preparing" \}\);\s*await nextFrame\(\);\s*setExportAction\(\{ key, stage: "working" \}\);\s*try \{\s*await Promise\.resolve\(action\(\)\)/);
assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => resolve\(\)\)\)/);

// (3) A second click on the same active action is a no-op.
assert.match(app, /if \(exportAction\?\.key === key\) return;/);

// (2) Only the active action's button is busy / disabled; keyed per action.
assert.match(app, /const busy = exportAction\?\.key === key;/);
assert.match(app, /<button key=\{id\} type="button" disabled=\{busy\} aria-busy=\{busy \|\| undefined\}/);

// (4) success and (5) failure states are shown, and (busy-clear) the button
// never stays disabled - it clears in `finally` and the outcome auto-expires.
assert.match(app, /setExportOutcome\(\{ key, ok: true \}\);/);
assert.match(app, /setExportOutcome\(\{ key, ok: false \}\);\s*setMessage\(readError\(error\)\);/);
assert.match(app, /\} finally \{\s*setExportAction\(null\);\s*outcomeTimerRef\.current = window\.setTimeout\(/);
assert.match(app, /border-rose-500\/60 text-rose-300/); // failure treatment
assert.match(app, /border-emerald-500\/60 text-emerald-300/); // success treatment

// Selected scope card + selected format button get a subtle active treatment
// (design-system tokens, no loud fill).
assert.match(app, /const scopeActive = exportScope === scope;/);
assert.match(app, /data-export-scope=\{scope\} data-active=\{scopeActive \|\| undefined\} className=\{`rounded-xl border bg-slate-900 p-5 transition-colors \$\{scopeActive \? "border-teal-500\/60 ring-1 ring-teal-500\/30" : "border-slate-800"\}`\}/);
assert.match(app, /const selected = scopeActive && exportFormat === id;/);

// Stage feedback is coarse + honest (no fabricated %).
assert.match(app, /function exportStageLabel\(stage: ExportStage, scope: ExportScope, format: ExportFormat, th: boolean\)/);
assert.match(app, /return th \? "กำลังเรนเดอร์หน้า…" : "Rendering pages…";/); // All Facilities
assert.doesNotMatch(app, /\$\{[^}]*\}%.*Preparing|progress.*percent/i);

// ---------------------------------------------------------------------------
// Live Preview follows SCOPE (content), not FORMAT (download type)
// ---------------------------------------------------------------------------
// (6) current -> single-facility path; (7) all -> all-facilities model with
// the cross-site data carried by the same N-site model as the export.
assert.match(app, /const facilities = await loadAll\(\{ includeRack: true, includeImage: true \}\);\s*const model = buildSiteComparisonReportModel\(await loadComparison\(\), contextMonth\);\s*html = buildAllFacilitiesReportHtml\(facilities, model, contextMonth, selectedReportSections\);/);
assert.doesNotMatch(app, /cards\("comparison"/);
assert.doesNotMatch(app, /reportCopy\.comparison/);
assert.match(app, /overrideHtml=\{exportScope === "current" \? null : scopedPreview\?\.html \?\? null\}/);
assert.match(preview, /const html = overrideHtml \?\? currentFacilityHtml;/);

// (9) Format change never changes the preview content: the preview identity
// and effect key on exportScope + data identity, NOT exportFormat.
assert.ok(app.includes('const previewIdentity = [exportScope, exportScope === "current" ? String(siteId) : sites.map(item => item.id).join(","), contextMonth, periodIdentity, selectedReportSections.join(",")].join(" | ");'), "preview identity is scope + site set + month + period + sections");
assert.ok(!/previewIdentity = \[[^\]]*exportFormat/.test(app), "preview identity does not depend on the download format");
assert.ok(app.includes("}, [contextMonth, exportScope, loadAll, loadComparison, previewIdentity, selectedReportSections]);"), "the scoped-preview effect keys on scope + data identity, not format");

// (10) site / month / period changes invalidate the scoped preview cache.
assert.match(app, /useEffect\(\(\) => \{ previewCacheRef\.current\.clear\(\); \}, \[sites, periodIdentity\]\);/);

// (11) A stale async preview response cannot overwrite a newer selection.
assert.match(app, /const generation = \+\+previewGenRef\.current;/);
assert.match(app, /if \(previewGenRef\.current !== generation\) return;\s*previewCacheRef\.current\.set\(id, html\);/);
assert.match(app, /if \(previewGenRef\.current !== generation\) return;\s*setScopedPreview\(null\);\s*setMessage\(readError\(error\)\);/);

// Preview header shows the scope context + secondary format hint + page count.
assert.match(app, /contextLabel=\{previewContextLabel\}/);
assert.match(app, /selectedFormatLabel=\{exportFormat \? EXPORT_FORMAT_LABELS\[exportFormat\] : null\}/);
assert.match(preview, /data-testid="web-report-preview-context"/);
assert.match(preview, /Selected export: \$\{selectedFormatLabel\}/);
assert.match(preview, /\$\{pageCount\} pages/);

// ---------------------------------------------------------------------------
// Same model -> preview AND export; CSV / Excel data logic untouched
// ---------------------------------------------------------------------------
const exportsSource = readFileSync(new URL("../src/web-clean-v1/exports.ts", import.meta.url), "utf8");
assert.match(exportsSource, /export function buildAllFacilitiesReportHtml\(/);
assert.match(exportsSource, /await exportReportPdfFromHtml\(buildAllFacilitiesReportHtml\(facilities, comparison, selectedMonth, sections\)/);
// CSV builders are still the plain data path.
assert.match(exportsSource, /export function buildAllFacilitiesCsv\(/);
assert.match(exportsSource, /export function buildSiteComparisonCsv\(/);

// buildAllFacilitiesReportHtml is now DOM-free (no DOMParser): one shared
// REPORT_CSS block, one shared cover, a facility-band + body-page sequence, and one N-site cross-site block.
const allFacilitiesFn = exportsSource.slice(
  exportsSource.indexOf("export function buildAllFacilitiesReportHtml("),
  exportsSource.indexOf("export async function exportAllFacilitiesPdf("),
);
assert.match(allFacilitiesFn, /facilityBandPage\(facility\.siteName\) \+ buildReportBodyPages\(data, sections\)/);
assert.match(allFacilitiesFn, /buildCrossSiteComparisonPages\(comparison, sections\)/);
assert.match(allFacilitiesFn, /<style>\$\{REPORT_CSS\}<\/style>/);
assert.doesNotMatch(allFacilitiesFn, /new DOMParser\(\)/);

console.log("web-clean-v1 export feedback: per-action busy/success/error, scope-driven Live Preview, and shared report model verified");
