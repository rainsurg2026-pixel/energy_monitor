import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeTheme, themeStorageKey } from "../src/web-clean-v1/theme";

assert.equal(normalizeTheme("light"), "light");
assert.equal(normalizeTheme("dark"), "dark");
assert.equal(normalizeTheme("system"), "dark");
assert.equal(normalizeTheme(null), "dark");
assert.equal(themeStorageKey("8"), "energy-monitor:theme:8");
assert.notEqual(themeStorageKey("8"), themeStorageKey("9"));
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
for (const token of ["--color-bg", "--color-surface", "--color-surface-elevated", "--color-text", "--color-text-secondary", "--color-text-muted", "--color-text-disabled", "--color-border", "--color-input-bg", "--color-input-text", "--color-input-placeholder", "--color-primary", "--color-secondary", "--color-danger", "--color-success", "--color-warning"]) assert.match(css, new RegExp(`${token}:`));
assert.match(css, /body\s*\{[^}]*background: var\(--color-bg\);[^}]*color: var\(--color-text\);/s);
assert.match(css, /input::placeholder,[\s\S]*?color: var\(--color-input-placeholder\);/);
assert.match(css, /html\.theme-light\s*\{[\s\S]*?--color-bg: #f6f1e8;[\s\S]*?--color-text: #333333;[\s\S]*?--color-border: #e3ded5;/);
assert.match(css, /--color-input-bg: #071a30;[\s\S]*?--color-input-text: #f4f7fb;[\s\S]*?--color-input-placeholder: #b9c9da;/);
assert.match(app, /function Login[\s\S]*?bg-slate-950 px-4 text-slate-100/);
assert.match(app, /เข้าระบบเพื่อดำเนินการต่อ/);
assert.doesNotMatch(app, /เข้าสู่พื้นที่ปฏิบัติการ v2\.3\.1 เพื่อดำเนินการต่อ/);
assert.match(app, /function Login[\s\S]*?text-center/);
assert.match(app, /PASSWORD_MIN_LENGTH = 6/);
assert.match(app, /passwordHelp/);

// Dashboard accent colors (amber/emerald/purple/rose/sky/teal) are tuned for
// dark-theme legibility and were measured at 1.1-2.8:1 against the light
// theme's #f6f1e8 background before this fix - effectively invisible. Verify
// every light-theme override for these families actually meets WCAG AA
// (>=4.5:1) against both #f6f1e8 (page) and #ffffff (card surface), so a
// future edit can't silently reintroduce unreadable text.
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hex1: string, hex2: string): number {
  const parse = (h: string): [number, number, number] => { const c = h.replace("#", ""); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
  const l1 = relLuminance(parse(hex1)), l2 = relLuminance(parse(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
const lightThemeBlock = css.match(/html\.theme-light\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const dashboardAccentTokens = ["--color-amber-400", "--color-amber-500", "--color-orange-200", "--color-orange-300", "--color-orange-400", "--color-emerald-300", "--color-emerald-400", "--color-emerald-500", "--color-purple-400", "--color-rose-400", "--color-rose-500", "--color-sky-300", "--color-sky-400", "--color-teal-400", "--color-teal-500", "--color-indigo-300"];
for (const token of dashboardAccentTokens) {
  const match = lightThemeBlock.match(new RegExp(`${token}: (#[0-9a-fA-F]{6});`));
  assert.ok(match, `${token} must be defined in html.theme-light`);
  const hex = match![1];
  const vsPage = contrastRatio(hex, "#f6f1e8");
  const vsSurface = contrastRatio(hex, "#ffffff");
  assert.ok(vsPage >= 4.5, `${token} (${hex}) contrast vs #f6f1e8 page background must be >=4.5:1 for WCAG AA text, got ${vsPage.toFixed(2)}:1`);
  assert.ok(vsSurface >= 4.5, `${token} (${hex}) contrast vs #ffffff card surface must be >=4.5:1 for WCAG AA text, got ${vsSurface.toFixed(2)}:1`);
}

assert.match(css, /\.dashboard-table/);
assert.match(css, /--chart-axis:/);
assert.match(css, /--chart-tooltip-bg:/);
assert.match(css, /recharts-cartesian-axis-line/);
const dashboard = readFileSync(new URL("../src/components/DashboardSummary.tsx", import.meta.url), "utf8");
assert.match(dashboard, /text-orange-200/);
assert.doesNotMatch(dashboard, /text-slate-650/);
console.log("web-clean-v1 theme: semantic token and readability assertions passed");
