import crypto from 'node:crypto';
import { type AdminConfigResult, verifyAdminSessionToken } from './admin-domain';
import { looksLikePlaceholder } from './env';

export const MIN_CRON_SECRET_LENGTH = 24;

/**
 * Un `CRON_SECRET` este utilizabil doar dacă este suficient de lung și nu este valoarea de
 * completare din `.env.example` (publică în repository).
 */
export function isUsableCronSecret(secret: string | undefined): secret is string {
  return (
    typeof secret === 'string' &&
    secret.length >= MIN_CRON_SECRET_LENGTH &&
    !looksLikePlaceholder(secret)
  );
}

/**
 * Compară tokenul Bearer în timp constant (prin hash SHA-256, fără a scurge lungimea secretului).
 */
export function verifyBearerToken(header: string | null, expectedSecret: string): boolean {
  if (!header || !header.startsWith('Bearer ')) {
    return false;
  }
  const provided = header.slice('Bearer '.length).trim();
  const providedHash = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expectedSecret, 'utf8').digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

export interface CronAuthInput {
  readonly authorizationHeader: string | null;
  readonly cookieToken: string | null | undefined;
  readonly cronSecret: string | undefined;
  readonly adminConfig: AdminConfigResult;
}

export interface CronAuthResult {
  readonly authorized: boolean;
  readonly viaCronBearer: boolean;
}

/**
 * Autorizează rutele de raportare: fie un job cron cu `Authorization: Bearer <CRON_SECRET>`,
 * fie o sesiune validă de administrator.
 */
export function authorizeCronOrAdmin(input: CronAuthInput): CronAuthResult {
  if (
    isUsableCronSecret(input.cronSecret) &&
    verifyBearerToken(input.authorizationHeader, input.cronSecret)
  ) {
    return { authorized: true, viaCronBearer: true };
  }

  if (
    input.adminConfig.ok &&
    verifyAdminSessionToken(input.cookieToken, input.adminConfig.config.hmacSecret)
  ) {
    return { authorized: true, viaCronBearer: false };
  }

  return { authorized: false, viaCronBearer: false };
}
