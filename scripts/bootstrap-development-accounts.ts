import { randomUUID } from "node:crypto";
import { loadDotEnvFile, loadServerConfig } from "../server/config/env";
import { PostgresAuthRepository } from "../server/auth/repository";
import { Argon2idPasswordHasher, hashNewPassword } from "../server/auth/passwordHasher";
import { normalizeUsername } from "../server/auth/passwordPolicy";
import { createPool } from "../server/db/pool";

loadDotEnvFile();

if (process.env.NODE_ENV === "production") throw new Error("Development account bootstrap is disabled in production.");
if (process.env.DEV_ACCOUNT_BOOTSTRAP !== "true") throw new Error("Set DEV_ACCOUNT_BOOTSTRAP=true for this one-time development operation.");

const adminPassword = process.env.DEV_ADMIN_PASSWORD;
const userPassword = process.env.DEV_USER_PASSWORD;
if (!adminPassword || !userPassword) throw new Error("DEV_ADMIN_PASSWORD and DEV_USER_PASSWORD are required for this one-time operation.");

const config = loadServerConfig(process.env, { requireDatabase: true, requireRuntimeDatabase: false, requireMigrationDatabase: true });
const pool = createPool(config, "migration");
const repository = new PostgresAuthRepository(pool);
const hasher = new Argon2idPasswordHasher();
const developmentPasswordPolicy = { minLength: 8, maxLength: 1024 };

const accounts = [
  { username: "admin", displayName: "Energy Monitor Administrator", role: "admin" as const, password: adminPassword },
  { username: "usertest", displayName: "Energy Monitor User", role: "user" as const, password: userPassword }
];

try {
  const existing = new Map((await repository.listUsers()).map(user => [normalizeUsername(user.username), user]));
  let created = 0;
  for (const account of accounts) {
    const existingAccount = existing.get(normalizeUsername(account.username));
    if (existingAccount) {
      if (!existingAccount.active || existingAccount.role !== account.role) throw new Error(`Development account ${account.username} exists with an unexpected role or inactive status.`);
      continue;
    }
    const passwordHash = await hashNewPassword(account.password, hasher, developmentPasswordPolicy);
    await repository.createUser({
      username: account.username,
      normalizedUsername: normalizeUsername(account.username),
      displayName: account.displayName,
      passwordHash,
      role: account.role,
      active: true,
      actorUserId: null
    }, `dev-bootstrap:${randomUUID()}`);
    created++;
  }
  console.log(`Development account bootstrap complete (${created} account(s) created; existing accounts were not modified).`);
} finally {
  await pool.end();
}
