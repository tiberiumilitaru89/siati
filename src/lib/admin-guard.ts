import {
  ADMIN_COOKIE_NAME,
  extractCookieValue,
  getAdminSecurityConfig,
  verifyAdminSessionToken,
} from './admin-domain';
import { createProblemResponse, writeStructuredLog } from './problem';
import { crossSiteBlockedResponse, isSameOriginRequest } from './request-guards';

/**
 * Răspunsul standard când panoul de administrare nu este configurat în siguranță pe server.
 */
export function adminNotConfiguredResponse(instance: string, traceId: string): Response {
  return createProblemResponse({
    type: 'https://floraria-siati.ro/errors/admin-not-configured',
    title: 'Panou Administrare Indisponibil',
    status: 503,
    detail:
      'Panoul de administrare nu este configurat în siguranță pe server (ADMIN_PANEL_PASSWORD de minimum 12 caractere și ADMIN_SESSION_SECRET de minimum 32 de caractere).',
    instance,
    trace_id: traceId,
  });
}

/**
 * Gardă comună pentru rutele de administrare cu efect de scriere:
 * origine identică → configurație validă → sesiune HMAC validă.
 * Returnează `null` dacă accesul este permis, altfel răspunsul de refuz.
 */
export function requireAdminSession(
  request: Request,
  instance: string,
  traceId: string
): Response | null {
  if (!isSameOriginRequest(request)) {
    writeStructuredLog({ level: 'warn', event: 'admin.cross_site_blocked', trace_id: traceId });
    return crossSiteBlockedResponse(instance, traceId);
  }

  const adminConfig = getAdminSecurityConfig();
  if (!adminConfig.ok) {
    writeStructuredLog({
      level: 'error',
      event: 'admin.config_invalid',
      trace_id: traceId,
      reason: adminConfig.reason,
    });
    return adminNotConfiguredResponse(instance, traceId);
  }

  const sessionToken = extractCookieValue(request.headers.get('cookie'), ADMIN_COOKIE_NAME);
  if (!verifyAdminSessionToken(sessionToken, adminConfig.config.hmacSecret)) {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/admin-session-expired',
      title: 'Acces Neautorizat',
      status: 401,
      detail: 'Sesiunea de administrare a expirat. Te rugăm să te autentifici din nou cu parola.',
      instance,
      trace_id: traceId,
    });
  }

  return null;
}
