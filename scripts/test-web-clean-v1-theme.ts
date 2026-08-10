import assert from "node:assert/strict";
import { normalizeTheme, themeStorageKey } from "../src/web-clean-v1/theme";

assert.equal(normalizeTheme("light"), "light");
assert.equal(normalizeTheme("dark"), "dark");
assert.equal(normalizeTheme("system"), "dark");
assert.equal(normalizeTheme(null), "dark");
assert.equal(themeStorageKey("8"), "energy-monitor:theme:8");
assert.notEqual(themeStorageKey("8"), themeStorageKey("9"));
console.log("web-clean-v1 theme: 6 assertions passed");
