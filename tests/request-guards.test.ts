import { describe, expect, it } from 'vitest';
import { getClientIp, isSameOriginRequest, readJsonBodyLimited } from '../src/lib/request-guards';

function post(headers: Record<string, string>, body = '{}'): Request {
  return new Request('https://floraria-siati.ro/api/x', { method: 'POST', headers, body });
}

describe('isSameOriginRequest', () => {
  it('accepts a same-origin browser request', () => {
    expect(isSameOriginRequest(post({ origin: 'https://floraria-siati.ro', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('accepts requests without Origin/Sec-Fetch-Site (curl, cron, webhooks)', () => {
    expect(isSameOriginRequest(post({}))).toBe(true);
  });

  it('rejects a foreign Origin', () => {
    expect(isSameOriginRequest(post({ origin: 'https://evil.example' }))).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isSameOriginRequest(post({ origin: 'https://floraria-siati.ro.evil.example' }))).toBe(false);
  });

  it('rejects cross-site and same-site fetch metadata', () => {
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOriginRequest(post({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  it('rejects the opaque "null" origin', () => {
    expect(isSameOriginRequest(post({ origin: 'null' }))).toBe(false);
  });
});

describe('getClientIp', () => {
  it('uses the Cloudflare connecting IP', () => {
    expect(getClientIp(post({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For (client-controlled) and falls back to a shared key', () => {
    expect(getClientIp(post({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
  });
});

describe('readJsonBodyLimited', () => {
  it('parses a small JSON body', async () => {
    const result = await readJsonBodyLimited(post({}, '{"a":1}'), 1024);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects a body declared larger than the limit before reading it', async () => {
    const result = await readJsonBodyLimited(post({ 'content-length': '999999' }, '{}'), 1024);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects an oversized body even without a Content-Length header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode('x'.repeat(600));
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    // `duplex: 'half'` este necesar pentru corpuri de tip stream în Node/undici
    const init = { method: 'POST', body: stream, duplex: 'half' } as RequestInit;
    const request = new Request('https://floraria-siati.ro/api/x', init);
    expect(await readJsonBodyLimited(request, 1000)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects invalid JSON', async () => {
    expect(await readJsonBodyLimited(post({}, '{nu-este-json'), 1024)).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });
});
