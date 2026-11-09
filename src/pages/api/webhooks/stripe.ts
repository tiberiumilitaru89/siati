import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { buildSmartBillSpvPayload, TERMS_VERSION } from '../../../lib/checkout-domain';
import {
  formatBaniToRon,
  type DeliverySlot,
  type DeliveryZone,
  type SupportedCurrency,
} from '../../../lib/catalog';
import { looksLikePlaceholder, readEnv } from '../../../lib/env';
import { buildOrderConfirmationEmail } from '../../../lib/notifications';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import {
  markOrderInvoicedSpvServerSide,
  PersistenceError,
  recordPaidOrderServerSide,
} from '../../../lib/supabase';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DELIVERY_ZONES: readonly DeliveryZone[] = ['ploiesti', 'limitrophe', 'prahova_extins'];
const DELIVERY_SLOTS: readonly DeliverySlot[] = [
  'standard_2_3h',
  'morning_0830_1230',
  'afternoon_1230_1700',
  'evening_1700_2100',
  'next_day_0830_1230',
];

const SMARTBILL_TIMEOUT_MS = 8000;
const NOTIFICATION_TIMEOUT_MS = 6000;

function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

type InvoiceOutcome =
  | { readonly status: 'issued'; readonly series: string; readonly number: string }
  | { readonly status: 'skipped' }
  | { readonly status: 'failed' };

/**
 * Emite factura SmartBill (RO e-Factura / SPV). Nu aruncă niciodată: orice eșec este logat
 * și raportat ca `failed`, pentru ca restul fluxului (email, alertă) să nu fie blocat.
 */
async function issueSmartBillInvoice(
  params: {
    readonly customerName: string;
    readonly customerEmail: string;
    readonly customerPhone: string;
    readonly productName: string;
    readonly amountBani: bigint;
  },
  traceId: string
): Promise<InvoiceOutcome> {
  const smartbillEmail = readEnv('SMARTBILL_EMAIL');
  const smartbillToken = readEnv('SMARTBILL_API_TOKEN');
  const smartbillCif = readEnv('SMARTBILL_CIF');
  const smartbillSeries = readEnv('SMARTBILL_INVOICE_SERIES', 'SMARTBILL_SERIES') ?? 'SIATI';

  if (
    !smartbillEmail ||
    !smartbillToken ||
    !smartbillCif ||
    looksLikePlaceholder(smartbillToken) ||
    looksLikePlaceholder(smartbillCif)
  ) {
    writeStructuredLog({
      level: 'warn',
      event: 'smartbill.not_configured',
      trace_id: traceId,
    });
    return { status: 'skipped' };
  }

  try {
    const spvPayload = buildSmartBillSpvPayload({
      companyVatCode: smartbillCif,
      seriesName: smartbillSeries,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerPhone: params.customerPhone,
      productName: params.productName,
      amountBani: params.amountBani,
    });

    const basicAuth = Buffer.from(`${smartbillEmail}:${smartbillToken}`).toString('base64');
    const response = await fetch('https://ws.smartbill.ro/SBORO/api/invoice', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(spvPayload),
      signal: AbortSignal.timeout(SMARTBILL_TIMEOUT_MS),
    });

    const rawText = await response.text();
    let parsed: { number?: string; series?: string; errorText?: string } = {};
    try {
      parsed = JSON.parse(rawText) as typeof parsed;
    } catch {
      // Răspuns non-JSON: tratat ca eșec mai jos
    }

    if (!response.ok || (parsed.errorText ?? '').length > 0 || !parsed.number) {
      writeStructuredLog({
        level: 'error',
        event: 'smartbill.invoice_rejected',
        trace_id: traceId,
        http_status: response.status,
        error_text: (parsed.errorText ?? rawText).slice(0, 300),
      });
      return { status: 'failed' };
    }

    return { status: 'issued', series: parsed.series ?? smartbillSeries, number: parsed.number };
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'smartbill.spv_invoice_failed',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'SmartBillError',
    });
    return { status: 'failed' };
  }
}

async function sendConfirmationEmail(
  params: {
    readonly customerName: string;
    readonly customerEmail: string;
    readonly productName: string;
    readonly amountLabel: string;
    readonly requirePhoto: boolean;
    readonly invoice: { readonly series: string; readonly number: string } | null;
  },
  traceId: string
): Promise<void> {
  const resendApiKey = readEnv('RESEND_API_KEY');
  if (!resendApiKey || looksLikePlaceholder(resendApiKey)) {
    return;
  }

  const shopEmail = readEnv('REPORT_RECIPIENT_EMAIL') ?? 'contact@floraria-siati.ro';
  const { subject, html } = buildOrderConfirmationEmail(params);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: readEnv('RESEND_FROM_EMAIL') ?? 'Florăria Siati <contact@floraria-siati.ro>',
        reply_to: 'contact@floraria-siati.ro',
        to: params.customerEmail ? [params.customerEmail] : [shopEmail],
        bcc: params.customerEmail ? [shopEmail] : undefined,
        subject,
        html,
      }),
      signal: AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS),
    });

    if (!response.ok) {
      writeStructuredLog({
        level: 'error',
        event: 'resend.email_rejected',
        trace_id: traceId,
        http_status: response.status,
        error_text: (await response.text()).slice(0, 300),
      });
    }
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'resend.email_failed',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'ResendError',
    });
  }
}

async function postWhatsAppAlert(payload: Record<string, unknown>, traceId: string): Promise<void> {
  const whatsappWebhookUrl = readEnv('WHATSAPP_GROUP_WEBHOOK_URL', 'WHATSAPP_WEBHOOK_URL');
  if (!whatsappWebhookUrl || looksLikePlaceholder(whatsappWebhookUrl)) {
    return;
  }

  try {
    const response = await fetch(whatsappWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, traceId }),
      signal: AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS),
    });
    if (!response.ok) {
      writeStructuredLog({
        level: 'warn',
        event: 'whatsapp.webhook_rejected',
        trace_id: traceId,
        http_status: response.status,
      });
    }
  } catch (waErr) {
    writeStructuredLog({
      level: 'warn',
      event: 'whatsapp.webhook_failed',
      trace_id: traceId,
      error_name: waErr instanceof Error ? waErr.name : 'WhatsAppWebhookError',
    });
  }
}

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  const stripeSecretKey = readEnv('STRIPE_SECRET_KEY');
  const webhookSecret = readEnv('STRIPE_WEBHOOK_SECRET');
  const signature = request.headers.get('stripe-signature');

  if (!stripeSecretKey || !webhookSecret) {
    writeStructuredLog({ level: 'error', event: 'stripe.webhook.unconfigured', trace_id: traceId });
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/webhook-unconfigured',
      title: 'Webhook Neconfigurat',
      status: 503,
      detail: 'Serverul nu are configurate cheile Stripe necesare pentru verificarea webhook-ului.',
      instance,
      trace_id: traceId,
    });
  }

  if (!signature) {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/webhook-unauthorized',
      title: 'Semnătură Webhook Lipsă',
      status: 400,
      detail: 'Cererea nu conține antetul cu semnătura criptografică Stripe.',
      instance,
      trace_id: traceId,
    });
  }

  const rawBody = await request.text();
  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });

  let event: Stripe.Event;
  try {
    // Varianta ASINCRONĂ este obligatorie pe Workers: SubtleCrypto nu poate rula în context sincron.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch (err) {
    writeStructuredLog({
      level: 'warn',
      event: 'stripe.webhook.invalid_signature',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'SignatureVerificationError',
      error_message: err instanceof Error ? err.message.slice(0, 200) : undefined,
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/invalid-webhook-signature',
      title: 'Semnătură Criptografică Invalidă',
      status: 400,
      detail: 'Semnătura Stripe nu a putut fi verificată.',
      instance,
      trace_id: traceId,
    });
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata ?? {};

  if (session.payment_status !== 'paid') {
    writeStructuredLog({
      level: 'info',
      event: 'stripe.webhook.unpaid_ignored',
      trace_id: traceId,
      stripe_session_id: session.id,
      payment_status: session.payment_status,
    });
    return new Response(JSON.stringify({ received: true, ignored: 'unpaid' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Nicio valoare implicită pentru produs/sumă: o sesiune fără metadatele noastre nu provine din acest site.
  const productId = metadata.product_id;
  const amountBaniRaw = metadata.amount_bani;
  if (
    !productId ||
    !UUID_PATTERN.test(productId) ||
    !amountBaniRaw ||
    !/^\d{1,12}$/.test(amountBaniRaw)
  ) {
    writeStructuredLog({
      level: 'error',
      event: 'stripe.webhook.metadata_invalid',
      trace_id: traceId,
      stripe_session_id: session.id,
    });
    return new Response(JSON.stringify({ received: true, ignored: 'not_a_siati_checkout' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const productName = metadata.product_name?.trim() || 'Aranjament Floral Siati';
  const currency: SupportedCurrency =
    metadata.currency === 'eur' || session.currency === 'eur' ? 'eur' : 'ron';
  // Păstrăm amount_bani ca referință contabilă unificată în RON (bani) pentru SPV ANAF
  const amountBani = BigInt(amountBaniRaw);
  const surchargeBani = BigInt(/^\d{1,12}$/.test(metadata.surcharge_bani ?? '') ? (metadata.surcharge_bani as string) : '0');
  const deliveryZone = pickEnum(metadata.delivery_zone, DELIVERY_ZONES, 'ploiesti');
  const deliverySlot = pickEnum(metadata.delivery_slot, DELIVERY_SLOTS, 'standard_2_3h');
  const expressImmediate = metadata.express_immediate === 'true';
  const afterHoursVip = metadata.after_hours_vip === 'true';
  const requirePhoto = metadata.require_photo !== 'false';
  const perishableConsentAt = metadata.perishable_consent_at || new Date().toISOString();
  const termsVersion = metadata.terms_version || TERMS_VERSION;
  const greetingMessage = metadata.greeting_message ?? '';
  const isAnonymousGift = metadata.is_anonymous_gift === 'true';
  const recipientName = metadata.recipient_name ?? '';
  const recipientPhone = metadata.recipient_phone ?? '';

  const customerName = session.customer_details?.name?.trim() || 'Client Florăria Siati';
  const customerEmail = (session.customer_details?.email ?? metadata.customer_email ?? '').trim();
  const customerPhone = session.customer_details?.phone ?? '';

  // 1. Inserare Idempotentă în Registrul Imutabil orders (Supabase obligatoriu în producție)
  let duplicate: boolean;
  try {
    ({ duplicate } = await recordPaidOrderServerSide(
      {
        id: crypto.randomUUID(),
        idempotency_key: event.id,
        stripe_session_id: session.id,
        product_id: productId,
        product_name: productName,
        amount_bani: Number(amountBani),
        surcharge_bani: Number(surchargeBani),
        currency,
        delivery_zone: deliveryZone,
        delivery_slot: deliverySlot,
        express_immediate: expressImmediate,
        after_hours_vip: afterHoursVip,
        status: 'paid',
        require_whatsapp_photo: requirePhoto,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        smartbill_series: null,
        smartbill_number: null,
        created_at: perishableConsentAt,
        greeting_message: greetingMessage,
        is_anonymous_gift: isAnonymousGift,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        terms_version: termsVersion,
      },
      {
        ...(session.shipping_details?.address ?? {}),
        greeting_message: greetingMessage,
        is_anonymous_gift: isAnonymousGift,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        terms_version: termsVersion,
      }
    ));
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'stripe.webhook.persistence_failed',
      trace_id: traceId,
      stripe_event_id: event.id,
      stripe_session_id: session.id,
      error_name: err instanceof Error ? err.name : 'PersistenceError',
      error_code: err instanceof PersistenceError ? err.code : undefined,
      error_message: err instanceof Error ? err.message.slice(0, 300) : undefined,
    });

    // Plata a fost încasată, dar comanda nu s-a putut salva: personalul trebuie alertat acum.
    await postWhatsAppAlert(
      {
        event: 'ORDER_PERSISTENCE_FAILED',
        stripeSessionId: session.id,
        product: productName,
        amount: formatBaniToRon(amountBani),
        customerName,
        customerPhone,
      },
      traceId
    );

    // 500 => Stripe reîncearcă livrarea evenimentului (cu backoff) până la salvarea reușită.
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/order-persistence-failed',
      title: 'Comanda Nu a Putut Fi Salvată',
      status: 500,
      detail: 'Comanda achitată nu a putut fi înregistrată momentan. Stripe va reîncerca livrarea.',
      instance,
      trace_id: traceId,
    });
  }

  if (duplicate) {
    writeStructuredLog({
      level: 'info',
      event: 'stripe.webhook.duplicate_ignored',
      trace_id: traceId,
      stripe_event_id: event.id,
    });
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // 2. Facturare Automată SmartBill + Transmitere ANAF RO e-Factura (SPV) + PDF pe Email Clientului
  const invoice = await issueSmartBillInvoice(
    { customerName, customerEmail, customerPhone, productName, amountBani },
    traceId
  );

  if (invoice.status === 'issued') {
    try {
      await markOrderInvoicedSpvServerSide(event.id, invoice.series, invoice.number);
    } catch (markErr) {
      // Factura EXISTĂ în SmartBill dar registrul nu a fost actualizat: necesită intervenție manuală.
      writeStructuredLog({
        level: 'error',
        event: 'ledger.invoice_mark_failed',
        trace_id: traceId,
        stripe_event_id: event.id,
        smartbill_series: invoice.series,
        smartbill_number: invoice.number,
        error_name: markErr instanceof Error ? markErr.name : 'PersistenceError',
      });
    }
  }

  const invoiceRef = invoice.status === 'issued' ? { series: invoice.series, number: invoice.number } : null;

  // 3 + 4. Email client (+ copie atelier) și alertă WhatsApp, în paralel (limită de timp Stripe).
  await Promise.all([
    sendConfirmationEmail(
      {
        customerName,
        customerEmail,
        productName,
        amountLabel: formatBaniToRon(amountBani),
        requirePhoto,
        invoice: invoiceRef,
      },
      traceId
    ),
    postWhatsAppAlert(
      {
        event: 'NEW_PAID_ORDER',
        product: productName,
        amount: formatBaniToRon(amountBani),
        requirePhoto,
        customerName,
        customerPhone,
        invoice: invoiceRef ? `${invoiceRef.series} ${invoiceRef.number}` : 'pending_manual',
      },
      traceId
    ),
  ]);

  return new Response(
    JSON.stringify({
      received: true,
      trace_id: traceId,
      spv_dispatched: invoice.status === 'issued',
      invoice: invoice.status,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );
};
