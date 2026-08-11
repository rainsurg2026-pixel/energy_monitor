/** The Google service-account credential is env-var-only, always - never
 *  stored in the database, never sent to the browser, never editable via
 *  the Admin UI. The Admin-configurable piece is only the destination
 *  (which spreadsheet, enabled/disabled) - see backupService.ts's use of
 *  BackendRepository.getBackupConfig() for that. Deliberately separate
 *  from ServerConfig/loadServerConfig: it must never block server startup
 *  or a normal Data Entry save if absent or invalid. */
export interface ServiceAccountCredential {
  serviceAccountJson: string;
}

export function loadServiceAccountCredential(environment: NodeJS.ProcessEnv = process.env): ServiceAccountCredential | null {
  const serviceAccountJson = environment.GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson) return null;
  return { serviceAccountJson };
}

/** Vercel Cron sends this exact header/value convention (a shared secret,
 *  not a user session) to authenticate scheduled invocations - see
 *  https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs. */
export function isAuthorizedCronRequest(authorizationHeader: string | undefined, environment: NodeJS.ProcessEnv = process.env): boolean {
  const secret = environment.CRON_SECRET?.trim();
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
