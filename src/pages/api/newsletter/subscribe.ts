import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import { newsletterAttempts } from '../../../lib/rate-limit';
import {
  crossSiteBlockedResponse,
  getClientIp,
  invalidBodyResponse,
  isSameOriginRequest,
  rateLimitedResponse,
  readJsonBodyLimited,
} from '../../../lib/request-guards';
import { recordNewsletterSubscriberServerSide } from '../../../lib/supabase';

export const prerender = false;

const MAX_SUBSCRIBE_BODY_BYTES = 2 * 1024;

const SubscribeSchema = z.object({
  email: z.string().trim().email('Te rugăm să introduci o adresă de email validă.').max(254),
  name: z.string().trim().max(100).optional(),
  source: z.enum(['checkout', 'footer', 'popup']).default('footer'),
});

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  if (!isSameOriginRequest(request)) {
    writeStructuredLog({ level: 'warn', event: 'newsletter.cross_site_blocked', trace_id: traceId });
    return crossSiteBlockedResponse(instance, traceId);
  }

  const rate = newsletterAttempts.consume(getClientIp(request));
  if (!rate.allowed) {
    writeStructuredLog({ level: 'warn', event: 'newsletter.rate_limited', trace_id: traceId });
    return rateLimitedResponse({
      instance,
      traceId,
      retryAfterSeconds: rate.retryAfterSeconds,
      detail: 'Ai încercat de prea multe ori. Te rugăm să reîncerci peste câteva minute.',
    });
  }

  const body = await readJsonBodyLimited(request, MAX_SUBSCRIBE_BODY_BYTES);
  if (!body.ok) {
    return invalidBodyResponse(body.reason, instance, traceId);
  }

  const parseResult = SubscribeSchema.safeParse(body.value);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0]?.message ?? 'Datele introduse sunt invalide.';
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/validation',
      title: 'Date Invalide',
      status: 400,
      detail: firstError,
      message: firstError,
      instance,
      trace_id: traceId,
      invalid_params: parseResult.error.errors.map((e) => ({
        name: e.path.join('.'),
        reason: e.message,
      })),
    });
  }

  const { email, name, source } = parseResult.data;

  try {
    const outcome = await recordNewsletterSubscriberServerSide({
      email,
      name,
      source,
    });

    writeStructuredLog({
      level: 'info',
      event: 'newsletter.subscribed',
      trace_id: traceId,
      email_masked: email.replace(/(?<=^.).(?=.*@)/g, '*'),
      source,
      already_subscribed: outcome.alreadySubscribed,
    });

    return new Response(
      JSON.stringify({
        success: true,
        alreadySubscribed: outcome.alreadySubscribed,
        message: outcome.alreadySubscribed
          ? 'Ești deja abonat! Vei primi în continuare Oferta Săptămânii și recomandările florale.'
          : 'Te-ai abonat cu succes! Vei primi pe email noutățile florale, Oferta Săptămânii și recomandări de sezon.',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Correlation-ID': traceId,
        },
      }
    );
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'newsletter.subscribe_exception',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_message: err instanceof Error ? err.message.slice(0, 200) : undefined,
    });

    const detail = 'A apărut o problemă temporară. Te rugăm să reîncerci în câteva momente.';
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/server-error',
      title: 'Eroare la Abonare',
      status: 500,
      detail,
      message: detail,
      instance,
      trace_id: traceId,
    });
  }
};
