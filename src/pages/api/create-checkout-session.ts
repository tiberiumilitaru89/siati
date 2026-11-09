import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { getLiveBnrEurRate } from '../../lib/bnr';
import {
  CheckoutRequestSchema,
  DELIVERY_SLOT_LABELS,
  DELIVERY_ZONE_LABELS,
  resolveServerSideCheckout,
} from '../../lib/checkout-domain';
import { looksLikePlaceholder, readEnv } from '../../lib/env';
import { createProblemResponse, writeStructuredLog } from '../../lib/problem';
import { checkoutAttempts } from '../../lib/rate-limit';
import {
  crossSiteBlockedResponse,
  getClientIp,
  invalidBodyResponse,
  isSameOriginRequest,
  rateLimitedResponse,
  readJsonBodyLimited,
} from '../../lib/request-guards';
import { resolveStripeImageUrl } from '../../lib/stripe-helpers';
import { findProductByIdServerSide, recordNewsletterSubscriberServerSide } from '../../lib/supabase';

export const prerender = false;

const MAX_CHECKOUT_BODY_BYTES = 16 * 1024;

function getCurrentBucharestTime(): { readonly hour: number; readonly minute: number } {
  try {
    const formatter = new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return { hour: Number.isFinite(hour) ? hour : 12, minute: Number.isFinite(minute) ? minute : 0 };
  } catch {
    return { hour: 12, minute: 0 };
  }
}

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  if (!isSameOriginRequest(request)) {
    writeStructuredLog({ level: 'warn', event: 'checkout.cross_site_blocked', trace_id: traceId });
    return crossSiteBlockedResponse(instance, traceId);
  }

  const rate = checkoutAttempts.consume(getClientIp(request));
  if (!rate.allowed) {
    writeStructuredLog({ level: 'warn', event: 'checkout.rate_limited', trace_id: traceId });
    return rateLimitedResponse({
      instance,
      traceId,
      retryAfterSeconds: rate.retryAfterSeconds,
      detail:
        'Ai inițiat prea multe plăți într-un interval scurt. Te rugăm să reîncerci peste câteva minute sau comandă pe WhatsApp la 0723 852 820.',
    });
  }

  const body = await readJsonBodyLimited(request, MAX_CHECKOUT_BODY_BYTES);
  if (!body.ok) {
    return invalidBodyResponse(body.reason, instance, traceId);
  }
  const rawBody = body.value;

  // Pre-validare preliminară pentru a extrage productId înainte de interogarea Supabase
  const preliminaryParse = CheckoutRequestSchema.safeParse(rawBody);
  const candidateProduct = preliminaryParse.success
    ? await findProductByIdServerSide(preliminaryParse.data.productId)
    : null;

  const bnrInfo = await getLiveBnrEurRate();

  const checkoutOutcome = resolveServerSideCheckout(
    rawBody,
    () => candidateProduct,
    new Date().toISOString(),
    {
      enforceCutoffWindow: true,
      bucharestTime: getCurrentBucharestTime(),
      bnrRateScaled: bnrInfo.rateBaniScaled,
    }
  );

  if (!checkoutOutcome.ok) {
    writeStructuredLog({
      level: 'warn',
      event: 'checkout.validation_failed',
      trace_id: traceId,
      status: checkoutOutcome.status,
      detail: checkoutOutcome.detail,
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/checkout-validation',
      title: checkoutOutcome.title,
      status: checkoutOutcome.status,
      detail: checkoutOutcome.detail,
      instance,
      trace_id: traceId,
      invalid_params: checkoutOutcome.invalidParams,
    });
  }

  const stripeSecretKey = readEnv('STRIPE_SECRET_KEY');
  if (!stripeSecretKey || looksLikePlaceholder(stripeSecretKey)) {
    writeStructuredLog({
      level: 'error',
      event: 'checkout.stripe_unconfigured',
      trace_id: traceId,
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/payment-gateway-unavailable',
      title: 'Serviciu de Plăți Indisponibil Temporar',
      status: 503,
      detail:
        'Procesatorul de plăți cu cardul este în curs de configurare. Poți finaliza comanda imediat pe WhatsApp la 0723 852 820.',
      instance,
      trace_id: traceId,
    });
  }

  try {
    const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });
    const {
      product,
      currency,
      surchargeBani,
      totalAmountBani,
      stripeBaseUnitAmount,
      stripeSurchargeUnitAmount,
      stripeUnitAmount,
      deliveryZone,
      deliverySlot,
      expressImmediate,
      afterHoursVip,
      requirePhoto,
      includeGreetingCard,
      greetingMessage,
      isAnonymousGift,
      recipientName,
      recipientPhone,
      customerEmail,
      newsletterOptin,
      perishableConsentAt,
      termsVersion,
    } = checkoutOutcome.value;

    const origin = new URL(request.url).origin;

    const productDescriptionParts = [
      `${DELIVERY_ZONE_LABELS[deliveryZone]} • ${DELIVERY_SLOT_LABELS[deliverySlot]}`,
    ];
    if (requirePhoto) {
      productDescriptionParts.push('Poză reală WhatsApp');
    }
    if (includeGreetingCard && greetingMessage) {
      productDescriptionParts.push('Include Felicitare Cadou');
    }
    if (isAnonymousGift) {
      productDescriptionParts.push('Livrare Anonimă / Surpriză');
    }

    const stripeImageUrl = resolveStripeImageUrl(product.image_url, origin);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency,
          product_data: {
            name: product.name,
            description: productDescriptionParts.join(' • '),
            ...(stripeImageUrl ? { images: [stripeImageUrl] } : {}),
          },
          unit_amount: Number(stripeBaseUnitAmount),
        },
        quantity: 1,
      },
    ];

    if (stripeSurchargeUnitAmount > 0n) {
      const surchargeParts: string[] = [];
      if (deliveryZone === 'prahova_extins') {
        surchargeParts.push('Livrare Județul Prahova Extins');
      }
      if (expressImmediate) {
        surchargeParts.push('Plecare Imediată din Stoc Fizic');
      }
      if (afterHoursVip) {
        surchargeParts.push('Livrare VIP în Afara Programului (După 18:30)');
      }

      lineItems.push({
        price_data: {
          currency,
          product_data: {
            name: `Servicii Prioritare & Livrare (${surchargeParts.join(' + ')})`,
            description: 'Cost suplimentar pentru transport regional Prahova sau regim prioritar.',
          },
          unit_amount: Number(stripeSurchargeUnitAmount),
        },
        quantity: 1,
      });
    }

    if (customerEmail && newsletterOptin) {
      try {
        await recordNewsletterSubscriberServerSide({
          email: customerEmail,
          source: 'checkout',
          lastOrderProduct: product.name,
        });
      } catch (subErr) {
        // Eșecul abonării nu trebuie să blocheze plata
        writeStructuredLog({
          level: 'warn',
          event: 'newsletter.subscriber_record_failed',
          trace_id: traceId,
          error_name: subErr instanceof Error ? subErr.name : 'UnknownError',
        });
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: customerEmail || undefined,
      shipping_address_collection: {
        allowed_countries: ['RO'],
      },
      phone_number_collection: {
        enabled: true,
      },
      metadata: {
        product_id: product.id,
        product_name: product.name,
        currency,
        amount_bani: totalAmountBani.toString(),
        surcharge_bani: surchargeBani.toString(),
        stripe_unit_amount: stripeUnitAmount.toString(),
        delivery_zone: deliveryZone,
        delivery_slot: deliverySlot,
        express_immediate: expressImmediate ? 'true' : 'false',
        after_hours_vip: afterHoursVip ? 'true' : 'false',
        require_photo: requirePhoto ? 'true' : 'false',
        include_greeting_card: includeGreetingCard ? 'true' : 'false',
        greeting_message: greetingMessage,
        is_anonymous_gift: isAnonymousGift ? 'true' : 'false',
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        customer_email: customerEmail || '',
        newsletter_optin: newsletterOptin ? 'true' : 'false',
        bnr_eur_rate: bnrInfo.rateFormatted,
        perishable_consent_accepted: 'true',
        perishable_consent_at: perishableConsentAt,
        terms_version: termsVersion,
        trace_id: traceId,
      },
      success_url: `${origin}/?comanda=succes&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?comanda=anulata`,
    });

    writeStructuredLog({
      level: 'info',
      event: 'checkout.session_created',
      trace_id: traceId,
      session_id: session.id,
      product_id: product.id,
      currency,
      amount_bani: totalAmountBani.toString(),
      delivery_zone: deliveryZone,
      delivery_slot: deliverySlot,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Correlation-ID': traceId,
      },
    });
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'checkout.stripe_exception',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_message: err instanceof Error ? err.message.slice(0, 200) : undefined,
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/internal-checkout-error',
      title: 'Eroare la Inițierea Plății',
      status: 500,
      detail: 'Nu am putut deschide sesiunea Stripe. Te rugăm să reîncerci în câteva momente.',
      instance,
      trace_id: traceId,
    });
  }
};
