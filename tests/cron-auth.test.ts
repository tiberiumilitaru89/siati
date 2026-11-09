import { describe, expect, it } from 'vitest';
import {
  createAdminSessionToken,
  resolveAdminSecurityConfig,
} from '../src/lib/admin-domain';
import {
  authorizeCronOrAdmin,
  isUsableCronSecret,
  verifyBearerToken,
} from '../src/lib/cron-auth';

const CRON_SECRET = 'cron-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c';
const adminConfig = resolveAdminSecurityConfig({
  password: 'Parola-Foarte-Lunga-2026',
  secret: 'kQ7vT2mZp9XcL4nR8sW1yB6dF3hJ5gA0u',
});

describe('isUsableCronSecret', () => {
  it('accepts a long random secret', () => {
    expect(isUsableCronSecret(CRON_SECRET)).toBe(true);
  });

  it('rejects missing, short and placeholder secrets', () => {
    expect(isUsableCronSecret(undefined)).toBe(false);
    expect(isUsableCronSecret('scurt')).toBe(false);
    expect(isUsableCronSecret('replace-with-strong-cron-bearer-secret')).toBe(false);
  });
});

describe('verifyBearerToken', () => {
  it('matches only the exact secret', () => {
    expect(verifyBearerToken(`Bearer ${CRON_SECRET}`, CRON_SECRET)).toBe(true);
    expect(verifyBearerToken(`Bearer ${CRON_SECRET}x`, CRON_SECRET)).toBe(false);
    expect(verifyBearerToken('Bearer ', CRON_SECRET)).toBe(false);
    expect(verifyBearerToken(CRON_SECRET, CRON_SECRET)).toBe(false);
    expect(verifyBearerToken(null, CRON_SECRET)).toBe(false);
  });
});

describe('authorizeCronOrAdmin', () => {
  it('authorizes a cron job presenting the bearer secret', () => {
    const result = authorizeCronOrAdmin({
      authorizationHeader: `Bearer ${CRON_SECRET}`,
      cookieToken: undefined,
      cronSecret: CRON_SECRET,
      adminConfig,
    });
    expect(result).toEqual({ authorized: true, viaCronBearer: true });
  });

  it('does NOT authorize with the public placeholder secret from .env.example', () => {
    const placeholder = 'replace-with-strong-cron-bearer-secret';
    const result = authorizeCronOrAdmin({
      authorizationHeader: `Bearer ${placeholder}`,
      cookieToken: undefined,
      cronSecret: placeholder,
      adminConfig,
    });
    expect(result.authorized).toBe(false);
  });

  it('authorizes a valid admin session cookie', () => {
    if (!adminConfig.ok) throw new Error('config de test invalidă');
    const result = authorizeCronOrAdmin({
      authorizationHeader: null,
      cookieToken: createAdminSessionToken(adminConfig.config.hmacSecret),
      cronSecret: undefined,
      adminConfig,
    });
    expect(result).toEqual({ authorized: true, viaCronBearer: false });
  });

  it('refuses admin cookies when the admin panel is not configured', () => {
    const unconfigured = resolveAdminSecurityConfig({});
    const forged = createAdminSessionToken('siati-hmac-secret-SiatiAdmin2026!');
    const result = authorizeCronOrAdmin({
      authorizationHeader: null,
      cookieToken: forged,
      cronSecret: undefined,
      adminConfig: unconfigured,
    });
    expect(result.authorized).toBe(false);
  });

  it('refuses a request with no credentials', () => {
    expect(
      authorizeCronOrAdmin({ authorizationHeader: null, cookieToken: null, cronSecret: CRON_SECRET, adminConfig })
    ).toEqual({ authorized: false, viaCronBearer: false });
  });
});
