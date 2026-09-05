import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/web-clean-v1/CleanWebApp.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/web-clean-v1/AdminUserManagement.tsx", import.meta.url), "utf8");

assert.match(app, /AdminUserManagement/);
assert.match(admin, /Total Users/);
assert.match(admin, /Active Users/);
assert.match(admin, /Admins/);
assert.match(admin, /Add New User/);
assert.match(admin, /Reset Password/);
assert.match(admin, /User List/);
assert.match(admin, /Search by name or username/);
assert.match(admin, /All Roles/);
assert.match(admin, /All Status/);
assert.match(admin, /Export/);
assert.match(admin, /Refresh/);
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
assert.match(admin, /aria-label=\{`Role for \$\{target\.username\}`\}/);
assert.match(admin, /value=\{target\.role\}\s+onChange=\{event\s*=>\s*void changeRole/);
assert.match(admin, /if \(role === target\.role\) return;/);
assert.match(admin, /if \(!window\.confirm/);
assert.match(admin, /\/admin\/users\/\$\{target\.id\}\/role/);

console.log("web-clean-v1 admin UI: redesigned management workspace and protected account actions passed");
