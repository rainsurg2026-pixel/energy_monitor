/** Backup config is deliberately separate from ServerConfig/loadServerConfig:
 *  it must NEVER block server startup or block a normal Data Entry save if
 *  absent or invalid - per DATA_BACKUP_AND_RECOVERY.md, a failed/unconfigured
 *  backup is an observable, non-fatal condition, not a boot-time error. */
export interface BackupConfig {
  serviceAccountJson: string;
  spreadsheetId: string;
}

export function loadBackupConfig(environment: NodeJS.ProcessEnv = process.env): BackupConfig | null {
  const serviceAccountJson = environment.GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON?.trim();
  const spreadsheetId = environment.GOOGLE_BACKUP_SPREADSHEET_ID?.trim();
  if (!serviceAccountJson || !spreadsheetId) return null;
  return { serviceAccountJson, spreadsheetId };
}

/** Vercel Cron sends this exact header/value convention (a shared secret,
 *  not a user session) to authenticate scheduled invocations - see
 *  https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs. */
export function isAuthorizedCronRequest(authorizationHeader: string | undefined, environment: NodeJS.ProcessEnv = process.env): boolean {
  const secret = environment.CRON_SECRET?.trim();
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
