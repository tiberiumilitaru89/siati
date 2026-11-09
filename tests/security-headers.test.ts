import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applySecurityHeaders,
  CONTENT_SECURITY_POLICY,
  isNoIndexPath,
  SECURITY_HEADERS,
} from '../src/lib/security-headers';

// Normalizăm CRLF: pe Windows, o clonă proaspătă cu `core.autocrlf=true` scrie fișierele cu \r\n.
const headersFile = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n'
);

describe('public/_headers stays in sync with src/lib/security-headers.ts', () => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    it(`declares ${name} with the exact same value`, () => {
      expect(headersFile).toContain(`\n  ${name}: ${value}\n`);
    });
  }
});

describe('Content-Security-Policy', () => {
  it('has no eval, no wildcard script source and no unused third-party script hosts', () => {
    const scriptSrc = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).not.toContain('cdnjs.cloudflare.com');
    expect(CONTENT_SECURITY_POLICY).not.toContain('api.smartbill.ro');
  });

  it('loads fonts and styles only from this origin (GDPR: no request, hence no IP, goes to Google Fonts)', () => {
    const directives = CONTENT_SECURITY_POLICY.split('; ');
    expect(directives).toContain("font-src 'self'");
    expect(directives).toContain("style-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/google|gstatic/i);
  });

  it('forbids framing by other origins, plugins and foreign form targets', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
  });
});

describe('isNoIndexPath', () => {
  it.each(['/admin', '/admin/', '/admin/x', '/api/webhooks/stripe', '/api/admin/auth'])('flags %s', (path) => {
    expect(isNoIndexPath(path)).toBe(true);
  });

  it.each(['/', '/politica-livrare/', '/administrare-publica/', '/apis'])('does not flag %s', (path) => {
    expect(isNoIndexPath(path)).toBe(false);
  });
});

describe('applySecurityHeaders', () => {
  it('sets all security headers on a normal page without noindex', () => {
    const response = applySecurityHeaders(new Response('ok'), '/');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('adds noindex and no-store for /admin', () => {
    const response = applySecurityHeaders(new Response('ok'), '/admin');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps an explicit Cache-Control already set by an API route', () => {
    const response = applySecurityHeaders(new Response('{}', { headers: { 'Cache-Control': 'no-store' } }), '/api/x');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('works on responses with immutable headers (e.g. returned by fetch)', () => {
    const immutable = new Response('ok');
    Object.defineProperty(immutable, 'headers', {
      value: new Proxy(immutable.headers, {
        get(target, prop) {
          if (prop === 'set') {
            return () => {
              throw new TypeError('immutable headers');
            };
          }
          const member = Reflect.get(target, prop, target) as unknown;
          return typeof member === 'function' ? (member as (...args: unknown[]) => unknown).bind(target) : member;
        },
      }),
    });

    const response = applySecurityHeaders(immutable, '/');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
