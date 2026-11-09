import type { MiddlewareHandler } from 'astro';
import { applySecurityHeaders } from './lib/security-headers';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();

  // Security Headers Defense-in-Depth (OWASP / Cloudflare Edge) — sursa unică: lib/security-headers.ts
  return applySecurityHeaders(response, new URL(context.request.url).pathname);
};
