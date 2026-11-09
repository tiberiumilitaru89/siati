import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FALLBACK_PRODUCTS,
  FALLBACK_WEEKLY_OFFER,
  type Product,
  type WeeklyOffer,
} from './catalog';
import { TERMS_VERSION } from './checkout-domain';
import { readEnv } from './env';
import { writeStructuredLog } from './problem';
import type { OrderLedgerRecord } from './reporting-domain';

export interface CatalogStoreState {
  readonly products: readonly Product[];
  readonly weeklyOffer: WeeklyOffer;
  readonly updatedAt: string;
}

/**
 * Eroare de persistență: baza de date nu este configurată sau o scriere a eșuat.
 * Rutele critice (webhook Stripe, newsletter, admin) o transformă în răspuns de eroare explicit
 * în loc să raporteze succes pentru date care nu au fost salvate.
 */
export class PersistenceError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), 'data', 'catalog-state.json');
const LOCAL_ORDERS_LEDGER_PATH = path.resolve(process.cwd(), 'data', 'orders-ledger.json');

export function createPublicSupabaseClient(): SupabaseClient | null {
  const url = readEnv('PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey || url.includes('your-project-id')) {
    return null;
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

export function createAdminSupabaseClient(): SupabaseClient | null {
  const url = readEnv('PUBLIC_SUPABASE_URL');
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey || url.includes('your-project-id')) {
    return null;
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Citește starea locală persistentă din data/catalog-state.json (sau returnează fallback-ul inițial).
 */
export async function readLocalCatalogStore(): Promise<CatalogStoreState> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CatalogStoreState>;
    if (Array.isArray(parsed.products) && parsed.weeklyOffer) {
      return {
        products: parsed.products,
        weeklyOffer: parsed.weeklyOffer,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    // Dacă fișierul nu există încă, folosim valorile canonice implicite
  }
  return {
    products: [...FALLBACK_PRODUCTS],
    weeklyOffer: { ...FALLBACK_WEEKLY_OFFER },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Salvează atomic starea catalogului în data/catalog-state.json (sau ignoră pe serverless edge).
 */
export async function writeLocalCatalogStore(state: CatalogStoreState): Promise<void> {
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Pe Cloudflare Workers discul e read-only; persistența este garantată de Supabase
  }
}

export async function fetchActiveProducts(): Promise<readonly Product[]> {
  const client = createPublicSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('products')
      .select('id, name, slug, description, price_bani, category, badge, image_url, in_stock')
      .eq('in_stock', true)
      .order('created_at', { ascending: true });

    if (!error && data && data.length > 0) {
      return data as Product[];
    }
  }
  const localStore = await readLocalCatalogStore();
  return localStore.products.filter((p) => p.in_stock);
}

export async function fetchAllProductsForAdmin(): Promise<readonly Product[]> {
  const adminClient = createAdminSupabaseClient();
  if (adminClient) {
    const { data, error } = await adminClient
      .from('products')
      .select('id, name, slug, description, price_bani, category, badge, image_url, in_stock')
      .order('created_at', { ascending: true });

    if (!error && data && data.length > 0) {
      return data as Product[];
    }
  }
  const localStore = await readLocalCatalogStore();
  return localStore.products;
}

export async function fetchActiveWeeklyOffer(): Promise<WeeklyOffer | null> {
  const client = createPublicSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('weekly_offer')
      .select('id, title, description, price_bani, image_url, product_id, is_active')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data as WeeklyOffer;
    }
  }
  const localStore = await readLocalCatalogStore();
  return localStore.weeklyOffer.is_active ? localStore.weeklyOffer : null;
}

export async function fetchWeeklyOfferForAdmin(): Promise<WeeklyOffer> {
  const adminClient = createAdminSupabaseClient();
  if (adminClient) {
    const { data, error } = await adminClient
      .from('weekly_offer')
      .select('id, title, description, price_bani, image_url, product_id, is_active')
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data as WeeklyOffer;
    }
  }
  const localStore = await readLocalCatalogStore();
  return localStore.weeklyOffer;
}

export async function findProductByIdServerSide(productId: string): Promise<Product | null> {
  const adminClient = createAdminSupabaseClient();
  if (adminClient) {
    const { data, error } = await adminClient
      .from('products')
      .select('id, name, slug, description, price_bani, category, badge, image_url, in_stock')
      .eq('id', productId)
      .single();

    if (!error && data) {
      return data as Product;
    }
  }
  const localStore = await readLocalCatalogStore();
  return localStore.products.find((p) => p.id === productId) ?? null;
}

/**
 * Citește registrul local de comenzi și facturi SPV din data/orders-ledger.json.
 */
export async function readLocalOrdersLedger(): Promise<readonly OrderLedgerRecord[]> {
  try {
    const raw = await fs.readFile(LOCAL_ORDERS_LEDGER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as OrderLedgerRecord[];
    }
  } catch {
    // Dacă fișierul nu există încă, returnăm registru gol
  }
  return [];
}

/**
 * Salvează registrul local de comenzi în data/orders-ledger.json (sau ignoră pe serverless edge).
 */
export async function writeLocalOrdersLedger(orders: readonly OrderLedgerRecord[]): Promise<void> {
  try {
    const dir = path.dirname(LOCAL_ORDERS_LEDGER_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(LOCAL_ORDERS_LEDGER_PATH, JSON.stringify(orders, null, 2), 'utf8');
  } catch {
    // Pe Cloudflare Workers discul e read-only; persistența este garantată de Supabase
  }
}

/**
 * Înregistrează idempotent o comandă achitată în Supabase (obligatoriu în producție)
 * și în registrul local data/orders-ledger.json (doar util în dezvoltare).
 *
 * Aruncă `PersistenceError` dacă baza de date lipsește (producție) sau scrierea eșuează, astfel încât
 * webhook-ul să răspundă cu eroare și Stripe să reîncerce livrarea evenimentului.
 */
export async function recordPaidOrderServerSide(
  order: OrderLedgerRecord,
  shippingAddressJson: Record<string, unknown> = {}
): Promise<{ duplicate: boolean }> {
  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase && import.meta.env.PROD) {
    throw new PersistenceError(
      'Supabase nu este configurat: comanda achitată nu poate fi salvată persistent.',
      'supabase_not_configured'
    );
  }

  const existingLocal = await readLocalOrdersLedger();
  if (existingLocal.some((item) => item.idempotency_key === order.idempotency_key)) {
    return { duplicate: true };
  }

  if (adminSupabase) {
    const { error: insertError } = await adminSupabase.from('orders').insert({
      idempotency_key: order.idempotency_key,
      stripe_session_id: order.stripe_session_id,
      product_id: order.product_id,
      amount_bani: order.amount_bani,
      surcharge_bani: order.surcharge_bani,
      currency: order.currency,
      delivery_zone: order.delivery_zone,
      delivery_slot: order.delivery_slot,
      express_immediate: order.express_immediate,
      after_hours_vip: order.after_hours_vip,
      require_whatsapp_photo: order.require_whatsapp_photo,
      perishable_consent_accepted: true,
      perishable_consent_at: order.created_at,
      terms_version: order.terms_version ?? TERMS_VERSION,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      shipping_address_json: shippingAddressJson,
      status: order.status,
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return { duplicate: true };
      }
      throw new PersistenceError(
        `Inserarea comenzii în Supabase a eșuat (${insertError.code ?? 'fără cod'}): ${insertError.message}`,
        insertError.code
      );
    }
  }

  await writeLocalOrdersLedger([order, ...existingLocal]);
  return { duplicate: false };
}

/**
 * Marchează comanda ca facturată în ANAF RO e-Factura (SPV) cu seria și numărul SmartBill.
 * Aruncă `PersistenceError` dacă actualizarea din Supabase eșuează (factura există deja în SmartBill).
 */
export async function markOrderInvoicedSpvServerSide(
  idempotencyKey: string,
  smartbillSeries: string,
  smartbillNumber: string
): Promise<void> {
  const adminSupabase = createAdminSupabaseClient();
  if (adminSupabase) {
    const { error } = await adminSupabase
      .from('orders')
      .update({
        status: 'invoiced_spv',
        smartbill_series: smartbillSeries,
        smartbill_number: smartbillNumber,
      })
      .eq('idempotency_key', idempotencyKey);

    if (error) {
      throw new PersistenceError(
        `Actualizarea facturii în Supabase a eșuat: ${error.message}`,
        error.code
      );
    }
  }

  const existingLocal = await readLocalOrdersLedger();
  const updatedLocal = existingLocal.map((item) =>
    item.idempotency_key === idempotencyKey
      ? {
          ...item,
          status: 'invoiced_spv' as const,
          smartbill_series: smartbillSeries,
          smartbill_number: smartbillNumber,
        }
      : item
  );
  await writeLocalOrdersLedger(updatedLocal);
}

const ORDER_REPORT_COLUMNS =
  'id, idempotency_key, stripe_session_id, product_id, amount_bani, surcharge_bani, currency, delivery_zone, delivery_slot, express_immediate, after_hours_vip, status, require_whatsapp_photo, customer_email, customer_phone, smartbill_series, smartbill_number, created_at';

function mapSupabaseOrderRow(row: Record<string, unknown>): OrderLedgerRecord {
  return {
    id: String(row.id),
    idempotency_key: String(row.idempotency_key),
    stripe_session_id: String(row.stripe_session_id ?? ''),
    product_id: String(row.product_id ?? ''),
    product_name: 'Aranjament Floral Siati',
    amount_bani: Number(row.amount_bani ?? 0),
    surcharge_bani: Number(row.surcharge_bani ?? 0),
    currency: row.currency === 'eur' ? 'eur' : 'ron',
    delivery_zone:
      row.delivery_zone === 'limitrophe' || row.delivery_zone === 'prahova_extins'
        ? row.delivery_zone
        : 'ploiesti',
    delivery_slot:
      row.delivery_slot === 'morning_0830_1230' ||
      row.delivery_slot === 'afternoon_1230_1700' ||
      row.delivery_slot === 'evening_1700_2100' ||
      row.delivery_slot === 'next_day_0830_1230'
        ? row.delivery_slot
        : 'standard_2_3h',
    express_immediate: Boolean(row.express_immediate),
    after_hours_vip: Boolean(row.after_hours_vip),
    status: row.status === 'invoiced_spv' || row.status === 'fulfilled' ? row.status : 'paid',
    require_whatsapp_photo: Boolean(row.require_whatsapp_photo),
    customer_name: 'Client Florăria Siati',
    customer_email: String(row.customer_email ?? 'contact@floraria-siati.ro'),
    customer_phone: String(row.customer_phone ?? ''),
    smartbill_series: row.smartbill_series ? String(row.smartbill_series) : null,
    smartbill_number: row.smartbill_number ? String(row.smartbill_number) : null,
    created_at: String(row.created_at),
  };
}

/**
 * Returnează comenzile achitate / facturate SPV dintr-un interval calendaristic [startIso, endIso],
 * îmbinând registrul local (dezvoltare) cu tabela `orders` din Supabase (producție).
 *
 * Cu `strict: true` (rapoartele contabile) o eroare Supabase se propagă ca `PersistenceError`
 * în loc să producă tăcut un raport gol.
 */
export async function fetchOrdersBetweenDates(
  startIso: string,
  endIso: string,
  options: { readonly strict?: boolean } = {}
): Promise<readonly OrderLedgerRecord[]> {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  const localOrders = (await readLocalOrdersLedger()).filter((order) => {
    const createdMs = new Date(order.created_at).getTime();
    return (
      createdMs >= startMs &&
      createdMs <= endMs &&
      (order.status === 'paid' || order.status === 'invoiced_spv' || order.status === 'fulfilled')
    );
  });

  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase) {
    return localOrders;
  }

  const { data, error } = await adminSupabase
    .from('orders')
    .select(ORDER_REPORT_COLUMNS)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .in('status', ['paid', 'invoiced_spv', 'fulfilled'])
    .order('created_at', { ascending: false });

  if (error) {
    writeStructuredLog({
      level: 'error',
      event: 'orders.report_query_failed',
      trace_id: crypto.randomUUID(),
      error_message: error.message,
    });
    if (options.strict) {
      throw new PersistenceError(`Citirea comenzilor din Supabase a eșuat: ${error.message}`, error.code);
    }
    return localOrders;
  }

  const seenKeys = new Set(localOrders.map((order) => order.idempotency_key));
  const merged: OrderLedgerRecord[] = [...localOrders];

  for (const row of data ?? []) {
    const mapped = mapSupabaseOrderRow(row as Record<string, unknown>);
    if (!seenKeys.has(mapped.idempotency_key)) {
      seenKeys.add(mapped.idempotency_key);
      merged.push(mapped);
    }
  }

  return merged;
}

export interface NewsletterSubscriber {
  readonly email: string;
  readonly name?: string;
  readonly opted_in_at: string;
  readonly source: 'checkout' | 'footer' | 'popup';
  readonly status: 'active' | 'unsubscribed';
  readonly preferences: readonly string[];
  readonly last_order_product?: string;
}

const LOCAL_SUBSCRIBERS_PATH = path.resolve(process.cwd(), 'data', 'subscribers.json');

export async function readLocalSubscribers(): Promise<readonly NewsletterSubscriber[]> {
  try {
    const raw = await fs.readFile(LOCAL_SUBSCRIBERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as NewsletterSubscriber[];
    }
  } catch {}
  return [];
}

export async function writeLocalSubscribers(list: readonly NewsletterSubscriber[]): Promise<void> {
  try {
    const dir = path.dirname(LOCAL_SUBSCRIBERS_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(LOCAL_SUBSCRIBERS_PATH, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

/**
 * Înregistrează un abonat la newsletter pentru oferte săptămânale și recomandări personalizate.
 *
 * În producție scrierea în tabela `subscribers` (migrația 0002) este obligatorie: dacă eșuează,
 * se aruncă `PersistenceError`, pentru ca utilizatorul să nu primească o confirmare falsă
 * și pentru ca înregistrarea consimțământului GDPR să nu se piardă tăcut.
 */
export async function recordNewsletterSubscriberServerSide(params: {
  email: string;
  name?: string;
  source?: 'checkout' | 'footer' | 'popup';
  lastOrderProduct?: string;
}): Promise<{ ok: boolean; alreadySubscribed: boolean }> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { ok: false, alreadySubscribed: false };
  }

  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase && import.meta.env.PROD) {
    throw new PersistenceError(
      'Supabase nu este configurat: abonatul nu poate fi salvat persistent.',
      'supabase_not_configured'
    );
  }

  const subscriber: NewsletterSubscriber = {
    email: cleanEmail,
    name: params.name?.trim() || undefined,
    opted_in_at: new Date().toISOString(),
    source: params.source || 'checkout',
    status: 'active',
    preferences: ['weekly_offer', 'history_recommendations'],
    last_order_product: params.lastOrderProduct,
  };

  if (adminSupabase) {
    const { data: existingRow, error: lookupError } = await adminSupabase
      .from('subscribers')
      .select('email')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (lookupError) {
      throw new PersistenceError(
        `Verificarea abonatului în Supabase a eșuat: ${lookupError.message}`,
        lookupError.code
      );
    }

    const alreadySubscribed = existingRow !== null;
    const { error: upsertError } = await adminSupabase.from('subscribers').upsert(
      {
        email: subscriber.email,
        name: subscriber.name,
        source: subscriber.source,
        status: subscriber.status,
        preferences: subscriber.preferences,
        last_order_product: subscriber.last_order_product,
        updated_at: new Date().toISOString(),
        // Păstrăm data primului consimțământ pentru abonații existenți.
        ...(alreadySubscribed ? {} : { opted_in_at: subscriber.opted_in_at }),
      },
      { onConflict: 'email' }
    );

    if (upsertError) {
      throw new PersistenceError(
        `Salvarea abonatului în Supabase a eșuat: ${upsertError.message}`,
        upsertError.code
      );
    }

    return { ok: true, alreadySubscribed };
  }

  // Dezvoltare locală (fără Supabase): registru JSON în data/
  const existing = await readLocalSubscribers();
  const alreadySubscribed = existing.some((s) => s.email.toLowerCase() === cleanEmail);

  if (!alreadySubscribed) {
    await writeLocalSubscribers([subscriber, ...existing]);
  } else {
    const updated = existing.map((s) =>
      s.email.toLowerCase() === cleanEmail
        ? { ...s, last_order_product: params.lastOrderProduct || s.last_order_product }
        : s
    );
    await writeLocalSubscribers(updated);
  }

  return { ok: true, alreadySubscribed };
}
