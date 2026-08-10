import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const admin = app.slice(app.indexOf("function Admin()"));

assert.match(admin, /role:\s*"user"\s+as Role/);
assert.match(admin, /active:\s*true/);
assert.match(admin, /aria-label="Role"/);
assert.match(admin, /<option value="user">User<\/option>/);
assert.match(admin, /<option value="admin">Admin<\/option>/);
assert.match(admin, /type="checkbox"\s+checked=\{form\.active\}/);
assert.match(admin, /body:\s*JSON\.stringify\(form\)/);
assert.match(admin, /target\.active\s+&&\s+!window\.confirm/);
assert.match(admin, /Delete user .*This cannot be undone/s);
assert.match(admin, /body:\s*JSON\.stringify\(\{ active:\s*!target\.active \}\)/);
assert.match(admin, /\/admin\/users\/\$\{target\.id\}/);

console.log("web-clean-v1 admin UI: role, active-state, and destructive-action guard assertions passed");
