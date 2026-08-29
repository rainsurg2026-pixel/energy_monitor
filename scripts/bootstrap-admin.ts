import { randomUUID } from "node:crypto";
import { loadDotEnvFile, loadMigrationDatabaseConfig } from "../server/config/env";
import { createPool } from "../server/db/pool";
import { PostgresAuthRepository } from "../server/auth/repository";
import { Argon2idPasswordHasher, hashNewPassword } from "../server/auth/passwordHasher";
import { normalizeUsername } from "../server/auth/passwordPolicy";
import { verifyProductionEnvironment, verifyProductionTarget } from "./lib/productionTargetGuard";

loadDotEnvFile();

// Bootstrapping the first admin is exactly the kind of write a stale/
// misdirected DIRECT_DATABASE_URL could send to the wrong database - the
// same target guard seed-production-master-data.ts uses, checked before
// any pool/connection is created.
const environmentCheck = verifyProductionEnvironment(process.env.NODE_ENV, { vercelEnv: process.env.VERCEL_ENV, readOnlyMode: process.env.READ_ONLY_MODE === "true" });
if (!environmentCheck.ok) {
  throw new Error(`Refusing to run: ${environmentCheck.reason}`);
}

const config = loadMigrationDatabaseConfig(process.env);
const connectionString = config.directDatabaseUrl ?? config.databaseUrl;
const targetVerification = verifyProductionTarget(connectionString);
if (!targetVerification.ok) {
  throw new Error(`Refusing to run: ${targetVerification.reason}`);
}
console.log(`Target verification: PASS - ${targetVerification.reason}`);

const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || "Data Center Energy & Facility Monitor Administrator";

if (!username || !password) throw new Error("BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD are required.");
if (displayName.length === 0 || displayName.length > 256) throw new Error("BOOTSTRAP_ADMIN_DISPLAY_NAME must be between 1 and 256 characters.");

const pool = createPool(config, "migration");
try {
  const repository = new PostgresAuthRepository(pool);
  if (await repository.countUsers() !== 0) throw new Error("Bootstrap refused because an application user already exists.");
  const passwordHasher = new Argon2idPasswordHasher();
  const normalizedUsername = normalizeUsername(username);
  const passwordHash = await hashNewPassword(password, passwordHasher);
  await repository.createUser({ username, normalizedUsername, displayName, passwordHash, role: "admin", actorUserId: null }, `bootstrap:${randomUUID()}`);
  console.log("Initial administrator created.");
} finally {
  await pool.end();
}
