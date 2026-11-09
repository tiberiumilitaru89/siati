import Stripe from 'stripe';
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
    recordPaidOrderServerSide: vi.fn(),
    markOrderInvoicedSpvServerSide: vi.fn(),
  };
});

import { POST } from '../src/pages/api/webhooks/stripe';
import {
  markOrderInvoicedSpvServerSide,
  PersistenceError,
  recordPaidOrderServerSide,
} from '../src/lib/supabase';

type Ctx = Parameters<typeof POST>[0];
const callWebhook = (request: Request): Promise<Response> =>
  Promise.resolve(POST({ request } as unknown as Ctx));

const WEBHOOK_SECRET = 'whsec_unit_test_secret';
const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_unit_0123456789',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  SMARTBILL_EMAIL: 'atelier@floraria.test',
  SMARTBILL_API_TOKEN: 'tok_0123456789abcdef',
  SMARTBILL_CIF: 'RO15942693',
  RESEND_API_KEY: 're_0123456789abcdef',
  WHATSAPP_GROUP_WEBHOOK_URL: 'https://hooks.relay.test/group-1',
} as const;

const record = vi.mocked(recordPaidOrderServerSide);
const markInvoiced = vi.mocked(markOrderInvoicedSpvServerSide);

interface FetchCall {
  readonly url: string;
  readonly body: Record<string, unknown> | null;
}
let fetchCalls: FetchCall[] = [];

function stubFetch(handlers: { smartbill?: () => Response } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      fetchCalls.push({ url, body });

      if (url.includes('ws.smartbill.ro')) {
        return (
          handlers.smartbill?.() ??
          new Response(JSON.stringify({ number: '0042', series: 'SIATI', errorText: '', message: '' }), {
            status: 200,
          })
        );
      }
      if (url.includes('api.resend.com')) {
        return new Response('{"id":"em_1"}', { status: 200 });
      }
      if (url.includes('hooks.relay.test')) {
        return new Response('ok', { status: 200 });
      }
      throw new Error(`Cerere de rețea neașteptată în test: ${url}`);
    })
  );
}

function checkoutEvent(options: {
  metadata?: Record<string, string> | null;
  paymentStatus?: string;
  customerName?: string;
} = {}) {
  const defaultMetadata = {
    product_id: '11111111-1111-4111-8111-111111111101',
    product_name: 'Buchet Lalele Albe',
    currency: 'ron',
    amount_bani: '19000',
    surcharge_bani: '0',
    delivery_zone: 'ploiesti',
    delivery_slot: 'standard_2_3h',
    require_photo: 'true',
    terms_version: 'v2026.11',
    perishable_consent_at: '2026-11-04T10:00:00.000Z',
  };
  return {
    id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_unit',
        object: 'checkout.session',
        payment_status: options.paymentStatus ?? 'paid',
        currency: 'ron',
        amount_total: 19000,
        metadata: options.metadata === undefined ? defaultMetadata : (options.metadata ?? {}),
        customer_details: {
          name: options.customerName ?? 'Ana Popescu',
          email: 'ana@client.test',
          phone: '+40700000001',
        },
      },
    },
  };
}

function signedRequest(event: unknown, secret: string = WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request('https://floraria-siati.ro/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
    body: payload,
  });
}

beforeEach(() => {
  fetchCalls = [];
  for (const [key, value] of Object.entries(ENV)) {
    vi.stubEnv(key, value);
  }
  record.mockReset().mockResolvedValue({ duplicate: false });
  markInvoiced.mockReset().mockResolvedValue(undefined);
  stubFetch();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Stripe webhook — verificare semnătură (asincron, compatibil Workers)', () => {
  it('accepts a correctly signed event', async () => {
    const response = await callWebhook(signedRequest(checkoutEvent()));
    expect(response.status).toBe(200);
  });

  it('rejects an event signed with another secret', async () => {
    const response = await callWebhook(signedRequest(checkoutEvent(), 'whsec_altul'));
    expect(response.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a request without a signature header', async () => {
    const request = new Request('https://floraria-siati.ro/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify(checkoutEvent()),
    });
    expect((await callWebhook(request)).status).toBe(400);
  });

  it('answers 503 (not 400) when the server has no Stripe configuration', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const response = await callWebhook(signedRequest(checkoutEvent()));
    expect(response.status).toBe(503);
  });

  it('ignores unrelated event types without touching the ledger', async () => {
    const response = await callWebhook(signedRequest({ ...checkoutEvent(), type: 'charge.refunded' }));
    expect(response.status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('Stripe webhook — date comandă', () => {
  it('ignores sessions that are not paid', async () => {
    const response = await callWebhook(signedRequest(checkoutEvent({ paymentStatus: 'unpaid' })));
    expect(response.status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it('ignores sessions without our metadata instead of inventing a product or amount', async () => {
    const response = await callWebhook(signedRequest(checkoutEvent({ metadata: null })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: 'not_a_siati_checkout' });
    expect(record).not.toHaveBeenCalled();
  });

  it('records the order with the exact amounts and the terms version actually accepted', async () => {
    await callWebhook(signedRequest(checkoutEvent()));
    expect(record).toHaveBeenCalledTimes(1);
    const order = record.mock.calls[0]?.[0];
    expect(order).toMatchObject({
      product_id: '11111111-1111-4111-8111-111111111101',
      amount_bani: 19000,
      currency: 'ron',
      status: 'paid',
      terms_version: 'v2026.11',
      customer_email: 'ana@client.test',
    });
  });

  it('does not process the same event twice', async () => {
    record.mockResolvedValue({ duplicate: true });
    const response = await callWebhook(signedRequest(checkoutEvent()));
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('Stripe webhook — persistență', () => {
  it('answers 500 so Stripe retries, alerts the staff, and does NOT invoice when the order cannot be saved', async () => {
    record.mockRejectedValue(new PersistenceError('baza de date indisponibilă', '57P01'));
    const response = await callWebhook(signedRequest(checkoutEvent()));

    expect(response.status).toBe(500);
    expect(fetchCalls.some((call) => call.url.includes('smartbill'))).toBe(false);
    expect(fetchCalls.some((call) => call.url.includes('api.resend.com'))).toBe(false);
    const alert = fetchCalls.find((call) => call.url.includes('hooks.relay.test'));
    expect(alert?.body).toMatchObject({ event: 'ORDER_PERSISTENCE_FAILED', stripeSessionId: 'cs_test_unit' });
  });
});

describe('Stripe webhook — facturare SmartBill', () => {
  it('issues the invoice, marks the order and tells the client the real invoice number', async () => {
    const event = checkoutEvent();
    const response = await callWebhook(signedRequest(event));
    const result = (await response.json()) as Record<string, unknown>;

    expect(result).toMatchObject({ received: true, invoice: 'issued', spv_dispatched: true });
    expect(markInvoiced).toHaveBeenCalledWith(event.id, 'SIATI', '0042');

    const email = fetchCalls.find((call) => call.url.includes('api.resend.com'));
    expect(email?.body).toMatchObject({
      to: ['ana@client.test'],
      subject: 'Confirmare Comandă & Factură SPV (SIATI 0042) — Florăria Siati',
    });
    const alert = fetchCalls.find((call) => call.url.includes('hooks.relay.test'));
    expect(alert?.body).toMatchObject({ event: 'NEW_PAID_ORDER', invoice: 'SIATI 0042' });
  });

  it('keeps the order, is honest in the email and flags manual invoicing when SmartBill rejects', async () => {
    stubFetch({
      smartbill: () =>
        new Response(JSON.stringify({ errorText: 'Seria nu există', number: '' }), { status: 400 }),
    });
    const response = await callWebhook(signedRequest(checkoutEvent()));
    const result = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ invoice: 'failed', spv_dispatched: false });
    expect(markInvoiced).not.toHaveBeenCalled();

    const email = fetchCalls.find((call) => call.url.includes('api.resend.com'));
    expect(String(email?.body?.html)).toContain('Factura fiscală va fi emisă');
    expect(String(email?.body?.html)).not.toContain('a fost emisă automat');
    const alert = fetchCalls.find((call) => call.url.includes('hooks.relay.test'));
    expect(alert?.body).toMatchObject({ invoice: 'pending_manual' });
  });

  it('skips invoicing (and says so) when SmartBill is not configured', async () => {
    vi.stubEnv('SMARTBILL_API_TOKEN', 'your_smartbill_api_token');
    const response = await callWebhook(signedRequest(checkoutEvent()));
    expect(await response.json()).toMatchObject({ invoice: 'skipped' });
    expect(fetchCalls.some((call) => call.url.includes('smartbill'))).toBe(false);
  });
});

describe('Stripe webhook — email', () => {
  it('escapes HTML coming from Stripe customer data', async () => {
    await callWebhook(signedRequest(checkoutEvent({ customerName: '<img src=x onerror=alert(1)>' })));
    const email = fetchCalls.find((call) => call.url.includes('api.resend.com'));
    const html = String(email?.body?.html);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
