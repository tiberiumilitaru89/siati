/**
 * Sursa UNICĂ pentru antetele de securitate.
 *
 * Sunt servite pe două căi complementare (nu duplicate):
 *  - `src/middleware.ts` → răspunsurile dinamice (SSR și API),
 *  - `public/_headers`   → fișierele statice și paginile prerenderate (Cloudflare nu rulează middleware pentru ele).
 * Testul `tests/security-headers.test.ts` verifică sincronizarea cu `public/_headers`.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https://*.supabase.co https://api.stripe.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
};

/**
 * Rutele care nu trebuie indexate niciodată de motoarele de căutare și nu trebuie păstrate în cache.
 */
export function isNoIndexPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/');
}

function setHeaders(response: Response, entries: ReadonlyArray<readonly [string, string]>): void {
  for (const [name, value] of entries) {
    response.headers.set(name, value);
  }
}

/**
 * Aplică antetele de securitate (și `noindex` pentru /admin și /api) pe un răspuns.
 * Dacă antetele răspunsului sunt imutabile (ex.: răspuns de la `fetch`), răspunsul este clonat.
 */
export function applySecurityHeaders(response: Response, pathname: string): Response {
  const entries: Array<readonly [string, string]> = Object.entries(SECURITY_HEADERS).map(
    ([name, value]) => [name, value] as const
  );

  if (isNoIndexPath(pathname)) {
    entries.push(['X-Robots-Tag', 'noindex, nofollow']);
    if (!response.headers.has('Cache-Control')) {
      entries.push(['Cache-Control', 'private, no-store']);
    }
  }

  try {
    setHeaders(response, entries);
    return response;
  } catch {
    const cloned = new Response(response.body, response);
    setHeaders(cloned, entries);
    return cloned;
  }
}
