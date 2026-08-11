/** Vercel Cron sends this exact header/value convention (a shared secret,
 *  not a user session) to authenticate scheduled invocations - see
 *  https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 *  Google Backup authentication itself is now the Admin's own connected
 *  Google account (server/backup/googleOAuthClient.ts +
 *  server/backup/googleOAuthCrypto.ts) - service-account credentials are
 *  no longer used for backups at all. */
export function isAuthorizedCronRequest(authorizationHeader: string | undefined, environment: NodeJS.ProcessEnv = process.env): boolean {
  const secret = environment.CRON_SECRET?.trim();
  if (!secret) return false;
  return authorizationHeader === `Bearer ${secret}`;
}
