import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => {
  class PersistenceError extends Error {
    readonly code: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'PersistenceError';
      this.code = code;
    }
  }
  return {
    PersistenceError,
    recordNewsletterSubscriberServerSide: vi.fn(),
    findProductByIdServerSide: vi.fn(async () => null),
  };
});

import { POST as adminAuth } from '../src/pages/api/admin/auth';
import { POST as checkout } from '../src/pages/api/create-checkout-session';
import { POST as subscribe } from '../src/pages/api/newsletter/subscribe';
import { PersistenceError, recordNewsletterSubscriberServerSide } from '../src/lib/supabase';

type Handler = (ctx: never) => Response | Promise<Response>;
const run = (handler: Handler, request: Request): Promise<Response> =>
  Promise.resolve(handler({ request } as never));

const ORIGIN = 'https://floraria-siati.ro';
const PASSWORD = 'Parola-Foarte-Lunga-2026';
const SECRET = 'kQ7vT2mZp9XcL4nR8sW1yB6dF3hJ5gA0u';

let ipCounter = 0;
/** Fiecare test primește un IP propriu, ca limitatoarele (în memorie) să nu se influențeze. */
const freshIp = (): string => `203.0.113.${(ipCounter += 1)}`;

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PANEL_PASSWORD', PASSWORD);
  vi.stubEnv('ADMIN_SESSION_SECRET', SECRET);
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/admin/auth', () => {
  const login = (password: string, ip: string, headers: Record<string, string> = {}) =>
    run(adminAuth, jsonPost('/api/admin/auth', { password }, { 'cf-connecting-ip': ip, ...headers }));

  it('logs in with the configured password and issues a hardened session cookie', async () => {
    const response = await login(PASSWORD, freshIp());
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('siati_admin_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
  });

  it('REFUSES the password that used to be hard-coded in the repository', async () => {
    const response = await login('SiatiAdmin2026!', freshIp());
    expect(response.status).toBe(401);
  });

  it('blocks the sixth failed attempt (even with the right password) and tells when to retry', async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login('gresita-total', ip)).status).toBe(401);
    }
    const blocked = await login(PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    // alt IP nu este afectat
    expect((await login(PASSWORD, freshIp())).status).toBe(200);
  });

  it('forgets earlier failures after a successful login', async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await login('gresita-total', ip);
    }
    expect((await login(PASSWORD, ip)).status).toBe(200);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await login('gresita-total', ip)).status).toBe(401);
    }
  });

  it('stays locked (503) when the server has no valid admin configuration', async () => {
    vi.stubEnv('ADMIN_PANEL_PASSWORD', '');
    const response = await login('SiatiAdmin2026!', freshIp());
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('stays locked when only a weak password is configured', async () => {
    vi.stubEnv('ADMIN_PANEL_PASSWORD', 'scurta');
    expect((await login('scurta', freshIp())).status).toBe(503);
  });

  it('blocks cross-site requests', async () => {
    expect((await login(PASSWORD, freshIp(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await login(PASSWORD, freshIp(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('rejects oversized bodies', async () => {
    const response = await run(
      adminAuth,
      jsonPost('/api/admin/auth', { password: 'x'.repeat(5000) }, { 'cf-connecting-ip': freshIp() })
    );
    expect(response.status).toBe(413);
  });
});

describe('POST /api/create-checkout-session — protecții anti-abuz', () => {
  const post = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    run(checkout, jsonPost('/api/create-checkout-session', body, { 'cf-connecting-ip': ip, ...headers }));

  it('blocks cross-site requests before doing any work', async () => {
    expect((await post({}, freshIp(), { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('rate-limits payment initiations per IP', async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      expect((await post({}, ip)).status).toBe(400); // payload invalid, dar cererea a fost acceptată
    }
    const limited = await post({}, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });

  it('rejects oversized bodies and malformed JSON', async () => {
    expect((await post({ x: 'y'.repeat(20_000) }, freshIp())).status).toBe(413);
    expect((await post('{nu-este-json', freshIp())).status).toBe(400);
  });
});

describe('POST /api/newsletter/subscribe', () => {
  const post = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    run(subscribe, jsonPost('/api/newsletter/subscribe', body, { 'cf-connecting-ip': ip, ...headers }));
  const recordMock = vi.mocked(recordNewsletterSubscriberServerSide);

  beforeEach(() => {
    recordMock.mockReset().mockResolvedValue({ ok: true, alreadySubscribed: false });
  });

  it('subscribes a valid email', async () => {
    const response = await post({ email: 'Client@Example.com', source: 'footer' }, freshIp());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, alreadySubscribed: false });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'Client@Example.com' }));
  });

  it('does NOT confirm the subscription when it could not be saved', async () => {
    recordMock.mockRejectedValue(new PersistenceError('tabela subscribers lipsește', '42P01'));
    const response = await post({ email: 'client@example.com' }, freshIp());
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(500);
    expect(payload.success).toBeUndefined();
    expect(typeof payload.message).toBe('string'); // formularul din footer afișează `message`
  });

  it('rate-limits per IP and returns a user-facing message', async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await post({ email: 'client@example.com' }, ip)).status).toBe(200);
    }
    const limited = await post({ email: 'client@example.com' }, ip);
    expect(limited.status).toBe(429);
    expect(typeof ((await limited.json()) as Record<string, unknown>).message).toBe('string');
  });

  it('blocks cross-site requests and invalid emails', async () => {
    expect((await post({ email: 'client@example.com' }, freshIp(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ email: 'nu-este-email' }, freshIp())).status).toBe(400);
  });
});
