import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const files = glob("src/components/**/*.{ts,tsx}", { exclude: ["node_modules"] });
const allowed = new Set(["TrendLineChart.tsx"]);
// This intentionally scans presentation components only. Geometry files are
// excluded because their toFixed calls serialize SVG coordinates, not metrics.
// Parsing/calculation code is outside this rule and is covered by TypeScript
// and domain regression tests.
const forbidden = /(?:\.toFixed\(|\.toLocaleString\(|Intl\.NumberFormat\()/;
const failures = [];
for await (const file of files) {
  if (allowed.has(file.split(/[\\/]/).pop())) continue;
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => { if (forbidden.test(line)) failures.push(`${file}:${index + 1}: ${line.trim()}`); });
}
// Domain-module boundary: formatting APIs must not be imported from
// energyCost.ts. Domain calculation imports remain allowed.
const sourceFiles = glob("src/**/*.{ts,tsx}", { exclude: ["node_modules"] });
const forbiddenBusinessImport = /import\s*\{[^}]*\b(?:formatNumber|formatNumber2|formatDecimal|formatPercentage|formatEnergy)\b[^}]*\}\s*from\s*["'][^"']*energyCost["']/s;
for await (const file of sourceFiles) {
  const content = await readFile(file, "utf8");
  if (forbiddenBusinessImport.test(content)) failures.push(`${file}: formatting API imported from energyCost.ts`);
}
if (failures.length) {
  console.error("Direct UI number formatting detected outside NumberFormatter:");
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Number formatting architecture check passed.");
