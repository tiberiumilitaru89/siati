import { describe, expect, it } from 'vitest';
import {
  createAdminSessionToken,
  extractCookieValue,
  MIN_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_SESSION_SECRET_LENGTH,
  resolveAdminSecurityConfig,
  UpsertProductSchema,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from '../src/lib/admin-domain';
import { looksLikePlaceholder, pickEnv } from '../src/lib/env';

const STRONG_PASSWORD = 'Parola-Foarte-Lunga-2026';
const STRONG_SECRET = 'kQ7vT2mZp9XcL4nR8sW1yB6dF3hJ5gA0u';

describe('pickEnv', () => {
  it('returns the first non-empty trimmed value', () => {
    expect(pickEnv({ A: '  valoare  ' }, ['A'])).toBe('valoare');
  });

  it('ignores empty, whitespace-only and missing values', () => {
    expect(pickEnv({ A: '', B: '   ' }, ['A', 'B', 'C'])).toBeUndefined();
  });

  it('falls back to aliases in the given order', () => {
    expect(pickEnv({ SMARTBILL_SERIES: 'SIATI' }, ['SMARTBILL_INVOICE_SERIES', 'SMARTBILL_SERIES'])).toBe('SIATI');
    expect(pickEnv({ B: 'doi', C: 'trei' }, ['A', 'B', 'C'])).toBe('doi');
  });
});

describe('looksLikePlaceholder', () => {
  it.each([
    'replace-with-strong-cron-bearer-secret',
    'your_smartbill_api_token',
    're_your_resend_key',
    'https://your-whatsapp-webhook-endpoint',
    'changeme',
    'placeholder',
  ])('flags %s', (value) => {
    expect(looksLikePlaceholder(value)).toBe(true);
  });

  it('does not flag a realistic random secret', () => {
    expect(looksLikePlaceholder(STRONG_SECRET)).toBe(false);
  });
});

describe('resolveAdminSecurityConfig (fail-closed, fără valori implicite)', () => {
  it('refuses to start with no configuration at all', () => {
    expect(resolveAdminSecurityConfig({})).toEqual({ ok: false, reason: 'password_missing' });
  });

  it('refuses a password shorter than the minimum', () => {
    const result = resolveAdminSecurityConfig({
      password: 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1),
      secret: STRONG_SECRET,
    });
    expect(result).toEqual({ ok: false, reason: 'password_too_short' });
  });

  it('refuses the password that was previously hard-coded and published in the repository', () => {
    const result = resolveAdminSecurityConfig({ password: 'SiatiAdmin2026!', secret: STRONG_SECRET });
    expect(result).toEqual({ ok: false, reason: 'password_insecure' });
  });

  it('refuses placeholder passwords copied from .env.example', () => {
    const result = resolveAdminSecurityConfig({
      password: 'replace-with-a-long-unique-password',
      secret: STRONG_SECRET,
    });
    expect(result).toEqual({ ok: false, reason: 'password_insecure' });
  });

  it('requires an explicit session secret (no derivation from the password)', () => {
    expect(resolveAdminSecurityConfig({ password: STRONG_PASSWORD })).toEqual({
      ok: false,
      reason: 'secret_missing',
    });
  });

  it('refuses a short or placeholder session secret', () => {
    expect(
      resolveAdminSecurityConfig({
        password: STRONG_PASSWORD,
        secret: 's'.repeat(MIN_ADMIN_SESSION_SECRET_LENGTH - 1),
      })
    ).toEqual({ ok: false, reason: 'secret_too_short' });
    expect(
      resolveAdminSecurityConfig({
        password: STRONG_PASSWORD,
        secret: 'replace-with-strong-32-byte-hmac-secret',
      })
    ).toEqual({ ok: false, reason: 'secret_insecure' });
  });

  it('refuses a session secret identical to the password', () => {
    expect(resolveAdminSecurityConfig({ password: STRONG_SECRET, secret: STRONG_SECRET })).toEqual({
      ok: false,
      reason: 'secret_equals_password',
    });
  });

  it('accepts a strong, distinct password and secret (trimmed)', () => {
    const result = resolveAdminSecurityConfig({
      password: `  ${STRONG_PASSWORD}  `,
      secret: ` ${STRONG_SECRET} `,
    });
    expect(result).toEqual({
      ok: true,
      config: { expectedPassword: STRONG_PASSWORD, hmacSecret: STRONG_SECRET },
    });
  });
});

describe('admin session tokens', () => {
  const now = 1_800_000_000;

  it('verifies a freshly issued token', () => {
    const token = createAdminSessionToken(STRONG_SECRET, now);
    expect(verifyAdminSessionToken(token, STRONG_SECRET, now + 60)).toBe(true);
  });

  it('rejects a token signed with another secret', () => {
    const token = createAdminSessionToken('alt-secret-complet-diferit-0123456789', now);
    expect(verifyAdminSessionToken(token, STRONG_SECRET, now + 60)).toBe(false);
  });

  it('rejects an expired token', () => {
    const token = createAdminSessionToken(STRONG_SECRET, now);
    expect(verifyAdminSessionToken(token, STRONG_SECRET, now + 13 * 60 * 60)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const token = createAdminSessionToken(STRONG_SECRET, now);
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ role: 'admin', iat: now, exp: now + 10 * 365 * 24 * 3600 }),
      'utf8'
    ).toString('base64url');
    expect(verifyAdminSessionToken(`${forgedPayload}.${signature}`, STRONG_SECRET, now + 60)).toBe(false);
  });

  it.each([null, undefined, '', 'fara-punct', 'a.b.c'])('rejects malformed token %s', (token) => {
    expect(verifyAdminSessionToken(token, STRONG_SECRET, now)).toBe(false);
  });
});

describe('verifyAdminPassword', () => {
  it('compares passwords exactly (after trim) and rejects empty values', () => {
    expect(verifyAdminPassword(` ${STRONG_PASSWORD}`, STRONG_PASSWORD)).toBe(true);
    expect(verifyAdminPassword('alta-parola', STRONG_PASSWORD)).toBe(false);
    expect(verifyAdminPassword('', STRONG_PASSWORD)).toBe(false);
    expect(verifyAdminPassword(STRONG_PASSWORD, '')).toBe(false);
  });
});

describe('extractCookieValue', () => {
  it('extracts and decodes a named cookie', () => {
    expect(extractCookieValue('a=1; siati_admin_session=abc%2Fdef; b=2', 'siati_admin_session')).toBe('abc/def');
  });

  it('returns null for a missing cookie or header', () => {
    expect(extractCookieValue(null, 'x')).toBeNull();
    expect(extractCookieValue('a=1', 'x')).toBeNull();
  });

  it('does not throw on malformed percent-encoding', () => {
    expect(extractCookieValue('siati_admin_session=%E0%A4%A', 'siati_admin_session')).toBeNull();
  });
});

describe('product image URL validation', () => {
  const base = {
    action: 'create_product' as const,
    name: 'Buchet de test',
    description: 'Descriere de test pentru buchet.',
    category: 'buchete' as const,
    priceRon: '190',
  };

  it('accepts https URLs and local image paths', () => {
    expect(UpsertProductSchema.safeParse({ ...base, imageUrl: 'https://cdn.example.test/a.webp' }).success).toBe(true);
    expect(UpsertProductSchema.safeParse({ ...base, imageUrl: '/images/tulip_hero.webp' }).success).toBe(true);
  });

  it.each(['http://insecure.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.test/a.jpg'])(
    'rejects %s',
    (imageUrl) => {
      expect(UpsertProductSchema.safeParse({ ...base, imageUrl }).success).toBe(false);
    }
  );
});
