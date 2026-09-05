import type { Express } from "express";
import type { Pool } from "pg";
import { Argon2idPasswordHasher } from "./auth/passwordHasher";
import { AuthService } from "./auth/authService";
import { PostgresAuthRepository } from "./auth/repository";
import { loadServerConfig, type ServerConfig } from "./config/env";
import { PostgresRepository } from "./db/postgresRepository";
import { createPool } from "./db/pool";
import { createApp } from "./http/app";
import { PostgresRateLimitStore } from "./http/security/rateLimit";
import { SupabaseRackUnitImageStorage } from "./storage/rackUnitImageStorage";
import { PostgresLogicalBackupExporter } from "./backup/logicalBackupExporter";

export interface ConfiguredRuntime {
  readonly app: Express;
  readonly config: ServerConfig;
  readonly pool: Pool;
}

/**
 * Compose the existing API once per process. Vercel warm invocations reuse
 * this pool; local development owns the same pool until main.ts shuts down.
 */
export async function createConfiguredRuntime(environment: NodeJS.ProcessEnv = process.env): Promise<ConfiguredRuntime> {
  const config = loadServerConfig(environment, { requireDatabase: true, requireRuntimeDatabase: true });
  const pool = createPool(config, "runtime");

  try {
    const passwordHasher = new Argon2idPasswordHasher();
    const authRepository = new PostgresAuthRepository(pool);
    const authService = new AuthService(authRepository, {
      passwordHasher,
      dummyPasswordHash: await passwordHasher.hash("energy-monitor-dummy-login-sentinel"),
      sessionSecret: config.sessionSecret,
      sessionPolicy: { absoluteLifetimeMs: config.sessionLifetimeMs }
    });
    const imageStorage = config.supabaseUrl && config.supabaseServiceRoleKey
      ? new SupabaseRackUnitImageStorage(config.supabaseUrl, config.supabaseServiceRoleKey, config.rackUnitImageBucket ?? "rack-unit-capacity")
      : undefined;
    const app = createApp({
      config,
      repository: new PostgresRepository(pool),
      authService,
      rateLimitStore: new PostgresRateLimitStore(pool),
      imageStorage,
      backupExporter: new PostgresLogicalBackupExporter(pool)
    });
    return { app, config, pool };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
