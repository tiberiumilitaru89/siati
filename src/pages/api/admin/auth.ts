import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  AdminLoginSchema,
  createAdminSessionToken,
  getAdminSecurityConfig,
  verifyAdminPassword,
} from '../../../lib/admin-domain';
import { adminNotConfiguredResponse } from '../../../lib/admin-guard';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import { adminLoginFailures } from '../../../lib/rate-limit';
import {
  crossSiteBlockedResponse,
  getClientIp,
  invalidBodyResponse,
  isSameOriginRequest,
  rateLimitedResponse,
  readJsonBodyLimited,
} from '../../../lib/request-guards';

export const prerender = false;

const MAX_LOGIN_BODY_BYTES = 2 * 1024;

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  if (!isSameOriginRequest(request)) {
    writeStructuredLog({ level: 'warn', event: 'admin.cross_site_blocked', trace_id: traceId });
    return crossSiteBlockedResponse(instance, traceId);
  }

  const clientIp = getClientIp(request);
  const limiterState = adminLoginFailures.status(clientIp);
  if (!limiterState.allowed) {
    writeStructuredLog({ level: 'warn', event: 'admin.auth_rate_limited', trace_id: traceId });
    return rateLimitedResponse({
      instance,
      traceId,
      retryAfterSeconds: limiterState.retryAfterSeconds,
      detail: 'Prea multe încercări de autentificare eșuate. Reîncearcă peste câteva minute.',
    });
  }

  const body = await readJsonBodyLimited(request, MAX_LOGIN_BODY_BYTES);
  if (!body.ok) {
    return invalidBodyResponse(body.reason, instance, traceId);
  }

  const parsed = AdminLoginSchema.safeParse(body.value);
  if (!parsed.success) {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/invalid-admin-login',
      title: 'Date de Autentificare Invalide',
      status: 400,
      detail: parsed.error.issues[0]?.message ?? 'Parola introdusă este invalidă.',
      instance,
      trace_id: traceId,
    });
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

  const { expectedPassword, hmacSecret } = adminConfig.config;
  const isValid = verifyAdminPassword(parsed.data.password, expectedPassword);

  if (!isValid) {
    adminLoginFailures.record(clientIp);
    writeStructuredLog({
      level: 'warn',
      event: 'admin.auth_failed',
      trace_id: traceId,
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/admin-unauthorized',
      title: 'Parolă Incorectă',
      status: 401,
      detail: 'Parola introdusă pentru Panoul de Administrare Florăria Siati este incorectă.',
      instance,
      trace_id: traceId,
    });
  }

  adminLoginFailures.reset(clientIp);

  const token = createAdminSessionToken(hmacSecret);
  const isHttps = new URL(request.url).protocol === 'https:';
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) {
    cookieParts.push('Secure');
  }

  writeStructuredLog({
    level: 'info',
    event: 'admin.auth_succeeded',
    trace_id: traceId,
  });

  return new Response(JSON.stringify({ ok: true, trace_id: traceId }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookieParts.join('; '),
      'X-Correlation-ID': traceId,
    },
  });
};

export const DELETE: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  if (!isSameOriginRequest(request)) {
    return crossSiteBlockedResponse(instance, traceId);
  }

  const isHttps = new URL(request.url).protocol === 'https:';
  const cookieValue =
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` + (isHttps ? '; Secure' : '');

  writeStructuredLog({
    level: 'info',
    event: 'admin.logout',
    trace_id: traceId,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookieValue,
      'X-Correlation-ID': traceId,
    },
  });
};
