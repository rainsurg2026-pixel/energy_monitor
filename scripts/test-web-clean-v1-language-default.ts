import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLanguage } from "../src/web-clean-v1/theme";

let checks = 0;
const check = (name: string, cond: boolean) => { assert.ok(cond, name); checks++; };

// normalizeLanguage: English is the default for null / unknown; a saved "th" is honoured.
check("null -> en", normalizeLanguage(null) === "en");
check("unknown -> en", normalizeLanguage("xx") === "en");
check("empty -> en", normalizeLanguage("") === "en");
check("'en' -> en", normalizeLanguage("en") === "en");
check("'th' -> th (honoured)", normalizeLanguage("th") === "th");

// Web app initialises to English.
const app = readFileSync("src/web-clean-v1/CleanWebApp.tsx", "utf8");
check("CleanWebApp lang state defaults to en",
  /const \[lang, setLang\] = useState<AppLanguage>\("en"\)/.test(app));

// Desktop initialises to English and its DEFAULT_CONFIG is English.
const desktop = readFileSync("src/App.tsx", "utf8");
check("Desktop lang state defaults to en",
  /const \[lang, setLang\] = useState<"th" \| "en">\("en"\)/.test(desktop));
const cfg = readFileSync("src/electron/config.ts", "utf8");
check("DEFAULT_CONFIG.language is en", /language:\s*"en"/.test(cfg));

// A user who explicitly saved Thai still restores Thai (restore effect only
// calls setLang when the stored value is non-null, and normalizeLanguage("th")==="th").
check("restore effect still respects a stored value",
  /if \(savedLanguage !== null\) setLang\(normalizeLanguage\(savedLanguage\)\)/.test(app));

console.log(`language-default: ${checks} checks passed`);
