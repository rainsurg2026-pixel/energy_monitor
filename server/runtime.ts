import type { Express } from "express";
import type { Pool } from "pg";
import { Argon2idPasswordHasher } from "./auth/passwordHasher";
import { AuthService } from "./auth/authService";
import { PostgresAuthRepository } from "./auth/repository";
import { loadServerConfig, type ServerConfig } from "./config/env";
import { PostgresRepository } from "./db/postgresRepository";
import { assertRuntimeRole, createPool, RUNTIME_DATABASE_ROLE } from "./db/pool";
import { createApp } from "./http/app";
import { PostgresRateLimitStore } from "./http/security/rateLimit";

export interface ConfiguredRuntime {
  readonly app: Express;
  readonly config: ServerConfig;
  readonly pool: Pool;
}

function configuredUsernameMatchesRuntimeRole(databaseUrl: string | null): boolean {
  if (!databaseUrl) return false;
  try {
    const username = decodeURIComponent(new URL(databaseUrl).username);
    return username === RUNTIME_DATABASE_ROLE || username.startsWith(`${RUNTIME_DATABASE_ROLE}.`);
  } catch {
    return false;
  }
}

/**
 * Compose the existing API once per process. Vercel warm invocations reuse
 * this pool; local development owns the same pool until main.ts shuts down.
 */
export async function createConfiguredRuntime(environment: NodeJS.ProcessEnv = process.env): Promise<ConfiguredRuntime> {
  const config = loadServerConfig(environment, { requireDatabase: true, requireRuntimeDatabase: true });
  const pool = createPool(config, "runtime");

  try {
    await assertRuntimeRole(pool, configuredUsernameMatchesRuntimeRole(config.databaseUrl));
    const passwordHasher = new Argon2idPasswordHasher();
    const authRepository = new PostgresAuthRepository(pool);
    const authService = new AuthService(authRepository, {
      passwordHasher,
      dummyPasswordHash: await passwordHasher.hash("energy-monitor-dummy-login-sentinel"),
      sessionPolicy: { absoluteLifetimeMs: config.sessionLifetimeMs }
    });
    const app = createApp({
      config,
      repository: new PostgresRepository(pool),
      authService,
      rateLimitStore: new PostgresRateLimitStore(pool)
    });
    return { app, config, pool };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
