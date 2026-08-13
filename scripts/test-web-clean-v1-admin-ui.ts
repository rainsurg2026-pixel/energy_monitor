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

// Edit Role for an existing user: the backend (PATCH /admin/users/:id/role,
// with last-admin protection, audit logging, and session revocation) already
// existed and was already tested server-side - this closes the frontend gap
// where the Role column was previously a plain, uneditable <td>{target.role}</td>.
assert.match(admin, /aria-label=\{`Role for \$\{target\.username\}`\}/);
assert.match(admin, /value=\{target\.role\}\s+onChange=\{event\s*=>\s*void changeRole/);
assert.match(admin, /if \(role === target\.role\) return;/);
assert.match(admin, /if \(!window\.confirm\(`Change/);
assert.match(admin, /\/admin\/users\/\$\{target\.id\}\/role.*method:\s*"PATCH"/);

console.log("web-clean-v1 admin UI: role, active-state, edit-role, and destructive-action guard assertions passed");
