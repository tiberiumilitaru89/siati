import crypto from 'node:crypto';
import { z } from 'zod';
import { looksLikePlaceholder, readEnv } from './env';

export const ADMIN_COOKIE_NAME = 'siati_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 ore

export const PRODUCT_CATEGORIES = [
  'buchete',
  'nunti',
  'cutii',
  'botez',
  'corporate',
  'funerare',
  'ghiveci',
] as const;

/**
 * Convertește un preț introdus în RON (ex: "190", "190.50", "190,5", 220) în bani întregi (number).
 * Folosește parsare deterministă fără erori de virgulă mobilă IEEE 754.
 */
export function parseRonInputToBani(input: string | number): number {
  const raw = typeof input === 'number' ? input.toFixed(2) : String(input).trim();
  const normalized = raw.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new RangeError('Prețul în RON trebuie să fie un număr pozitiv cu cel mult 2 zecimale.');
  }
  const [wholePart = '0', fracPart = ''] = normalized.split('.');
  const paddedFrac = fracPart.padEnd(2, '0');
  const baniBig = BigInt(wholePart) * 100n + BigInt(paddedFrac);
  if (baniBig <= 0n || baniBig > 100_000_000n) {
    throw new RangeError('Prețul în RON trebuie să fie între 0,01 RON și 1.000.000 RON.');
  }
  return Number(baniBig);
}

/**
 * Verifică parola panoului de admin în timp constant (anti-timing attack) folosind SHA-256 + timingSafeEqual.
 */
export function verifyAdminPassword(candidatePassword: string, expectedPassword: string): boolean {
  const candidateTrimmed = candidatePassword.trim();
  const expectedTrimmed = expectedPassword.trim();
  if (candidateTrimmed.length === 0 || expectedTrimmed.length === 0) {
    return false;
  }
  const candidateHash = crypto.createHash('sha256').update(candidateTrimmed, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expectedTrimmed, 'utf8').digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

/**
 * Generează un token de sesiune semnat criptografic cu HMAC-SHA256.
 */
export function createAdminSessionToken(
  secretKey: string,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const payload = {
    role: 'admin' as const,
    iat: nowUnixSeconds,
    exp: nowUnixSeconds + ADMIN_SESSION_TTL_SECONDS,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(payloadBase64)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
}

/**
 * Validează criptografic tokenul de sesiune admin și verifică expirarea.
 */
export function verifyAdminSessionToken(
  token: string | undefined | null,
  secretKey: string,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(payloadBase64)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (decoded.role !== 'admin' || typeof decoded.exp !== 'number') {
      return false;
    }
    return decoded.exp > nowUnixSeconds;
  } catch {
    return false;
  }
}

export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_ADMIN_SESSION_SECRET_LENGTH = 32;

/**
 * Valori publicate în istoricul repository-ului: respinse indiferent de lungime.
 */
const KNOWN_INSECURE_VALUES: readonly string[] = ['SiatiAdmin2026!'];

export interface AdminSecurityConfig {
  readonly expectedPassword: string;
  readonly hmacSecret: string;
}

export type AdminConfigFailureReason =
  | 'password_missing'
  | 'password_too_short'
  | 'password_insecure'
  | 'secret_missing'
  | 'secret_too_short'
  | 'secret_insecure'
  | 'secret_equals_password';

export type AdminConfigResult =
  | { readonly ok: true; readonly config: AdminSecurityConfig }
  | { readonly ok: false; readonly reason: AdminConfigFailureReason };

/**
 * Validează configurația panoului de administrare. NU există valori implicite: dacă parola sau
 * secretul de sesiune lipsesc ori sunt slabe, panoul rămâne blocat (fail-closed).
 */
export function resolveAdminSecurityConfig(input: {
  readonly password?: string | undefined;
  readonly secret?: string | undefined;
}): AdminConfigResult {
  const password = input.password?.trim() ?? '';
  const secret = input.secret?.trim() ?? '';

  if (password.length === 0) {
    return { ok: false, reason: 'password_missing' };
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'password_too_short' };
  }
  if (KNOWN_INSECURE_VALUES.includes(password) || looksLikePlaceholder(password)) {
    return { ok: false, reason: 'password_insecure' };
  }

  if (secret.length === 0) {
    return { ok: false, reason: 'secret_missing' };
  }
  if (secret.length < MIN_ADMIN_SESSION_SECRET_LENGTH) {
    return { ok: false, reason: 'secret_too_short' };
  }
  if (KNOWN_INSECURE_VALUES.includes(secret) || looksLikePlaceholder(secret)) {
    return { ok: false, reason: 'secret_insecure' };
  }
  if (secret === password) {
    return { ok: false, reason: 'secret_equals_password' };
  }

  return { ok: true, config: { expectedPassword: password, hmacSecret: secret } };
}

/**
 * Citește configurația `/admin` din variabilele de mediu runtime.
 */
export function getAdminSecurityConfig(): AdminConfigResult {
  return resolveAdminSecurityConfig({
    password: readEnv('ADMIN_PANEL_PASSWORD'),
    secret: readEnv('ADMIN_SESSION_SECRET'),
  });
}

/**
 * Extrage valoarea unui cookie din antetul HTTP Cookie.
 */
export function extractCookieValue(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...rest] = pair.trim().split('=');
    if (rawName === cookieName) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const ImagePathOrUrlSchema = z
  .string()
  .trim()
  .min(3, 'Adresa imaginii este obligatorie.')
  .refine(
    (val) => val.startsWith('https://') || val.startsWith('/images/') || val.startsWith('/uploads/'),
    'Imaginea trebuie să fie un URL securizat (https://...) sau o fotografie încărcată (/uploads/...).'
  );

export const AdminLoginSchema = z.object({
  password: z
    .string()
    .min(4, 'Parola trebuie să conțină cel puțin 4 caractere.')
    .max(128, 'Parola este prea lungă.'),
});

export const UpdateWeeklyOfferSchema = z.object({
  action: z.literal('update_weekly_offer'),
  title: z
    .string()
    .trim()
    .min(3, 'Titlul ofertei săptămânii trebuie să aibă între 3 și 120 de caractere.')
    .max(120),
  description: z
    .string()
    .trim()
    .min(5, 'Descrierea ofertei trebuie să aibă cel puțin 5 caractere.')
    .max(600),
  priceRon: z.union([z.string(), z.number()]),
  imageUrl: ImagePathOrUrlSchema,
  productId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const UpsertProductSchema = z.object({
  action: z.enum(['update_product', 'create_product']),
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, 'Numele produsului trebuie să aibă între 2 și 150 de caractere.')
    .max(150),
  description: z
    .string()
    .trim()
    .min(5, 'Descrierea produsului trebuie să aibă cel puțin 5 caractere.')
    .max(600),
  category: z.enum(PRODUCT_CATEGORIES),
  badge: z.string().trim().max(60).nullable().optional(),
  priceRon: z.union([z.string(), z.number()]),
  imageUrl: ImagePathOrUrlSchema,
  inStock: z.boolean().default(true),
});

export const DeleteProductSchema = z.object({
  action: z.literal('delete_product'),
  id: z.string().uuid('ID-ul produsului pentru ștergere este invalid.'),
});

export const AdminCatalogActionSchema = z.discriminatedUnion('action', [
  UpdateWeeklyOfferSchema,
  UpsertProductSchema,
  DeleteProductSchema,
]);

export function slugifyProductName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
