import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import {
  AdminCatalogActionSchema,
  parseRonInputToBani,
  slugifyProductName,
} from '../../../lib/admin-domain';
import { requireAdminSession } from '../../../lib/admin-guard';
import type { Product, WeeklyOffer } from '../../../lib/catalog';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import { invalidBodyResponse, readJsonBodyLimited } from '../../../lib/request-guards';
import {
  createAdminSupabaseClient,
  PersistenceError,
  readLocalCatalogStore,
  writeLocalCatalogStore,
} from '../../../lib/supabase';

export const prerender = false;

const MAX_CATALOG_BODY_BYTES = 32 * 1024;

function jsonOk(traceId: string, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Correlation-ID': traceId,
    },
  });
}

/**
 * Supabase nu aruncă excepții la erori de scriere: le returnează în `error`.
 * Fără această verificare, panoul ar raporta „salvat” chiar dacă nimic nu s-a scris.
 */
function assertWritten(
  result: { readonly error: { readonly message: string; readonly code?: string } | null },
  entity: string
): void {
  if (result.error) {
    throw new PersistenceError(`Scrierea în ${entity} a eșuat: ${result.error.message}`, result.error.code);
  }
}

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  const denied = requireAdminSession(request, instance, traceId);
  if (denied) {
    return denied;
  }

  const body = await readJsonBodyLimited(request, MAX_CATALOG_BODY_BYTES);
  if (!body.ok) {
    return invalidBodyResponse(body.reason, instance, traceId);
  }

  const parsed = AdminCatalogActionSchema.safeParse(body.value);
  if (!parsed.success) {
    const invalidParams = parsed.error.issues.map((issue) => ({
      name: issue.path.join('.') || 'body',
      reason: issue.message,
    }));
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/admin-validation-failed',
      title: 'Date Invalide în Formular',
      status: 400,
      detail: invalidParams[0]?.reason ?? 'Verifică datele introduse.',
      instance,
      trace_id: traceId,
      invalid_params: invalidParams,
    });
  }

  const adminSupabase = createAdminSupabaseClient();
  if (!adminSupabase && import.meta.env.PROD) {
    writeStructuredLog({ level: 'error', event: 'admin.catalog_storage_unconfigured', trace_id: traceId });
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/storage-unconfigured',
      title: 'Baza de Date Neconfigurată',
      status: 503,
      detail:
        'Supabase nu este configurat pe server (PUBLIC_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY), deci modificările nu pot fi salvate.',
      instance,
      trace_id: traceId,
    });
  }

  const actionPayload = parsed.data;
  const localStore = await readLocalCatalogStore();

  try {
    if (actionPayload.action === 'update_weekly_offer') {
      const priceBani = parseRonInputToBani(actionPayload.priceRon);
      const updatedOffer: WeeklyOffer = {
        id: localStore.weeklyOffer.id,
        title: actionPayload.title,
        description: actionPayload.description,
        price_bani: priceBani,
        image_url: actionPayload.imageUrl,
        product_id: actionPayload.productId ?? localStore.weeklyOffer.product_id,
        is_active: actionPayload.isActive,
      };

      if (adminSupabase) {
        assertWritten(
          await adminSupabase.from('weekly_offer').upsert({
            id: updatedOffer.id,
            title: updatedOffer.title,
            description: updatedOffer.description,
            price_bani: updatedOffer.price_bani,
            image_url: updatedOffer.image_url,
            product_id: updatedOffer.product_id,
            is_active: updatedOffer.is_active,
            updated_at: new Date().toISOString(),
          }),
          'weekly_offer'
        );

        await writeAuditLog(adminSupabase, traceId, {
          action: 'UPDATE',
          entityType: 'weekly_offer',
          entityId: updatedOffer.id,
          afterState: updatedOffer,
        });
      }

      await writeLocalCatalogStore({
        products: localStore.products,
        weeklyOffer: updatedOffer,
        updatedAt: new Date().toISOString(),
      });

      writeStructuredLog({
        level: 'info',
        event: 'admin.weekly_offer_updated',
        trace_id: traceId,
        price_bani: priceBani,
        is_active: updatedOffer.is_active,
      });

      return jsonOk(traceId, {
        ok: true,
        message: 'Oferta Săptămânii a fost actualizată pe site!',
        weeklyOffer: updatedOffer,
      });
    }

    if (actionPayload.action === 'update_product' || actionPayload.action === 'create_product') {
      const priceBani = parseRonInputToBani(actionPayload.priceRon);
      const isCreate = actionPayload.action === 'create_product' || !actionPayload.id;
      const productId = actionPayload.id ?? crypto.randomUUID();
      const baseSlug = slugifyProductName(actionPayload.name) || `produs-${productId.slice(0, 8)}`;

      const updatedProduct: Product = {
        id: productId,
        name: actionPayload.name,
        slug: isCreate ? `${baseSlug}-${productId.slice(0, 4)}` : baseSlug,
        description: actionPayload.description,
        price_bani: priceBani,
        category: actionPayload.category,
        badge:
          actionPayload.badge && actionPayload.badge.trim().length > 0
            ? actionPayload.badge.trim()
            : null,
        image_url: actionPayload.imageUrl,
        in_stock: actionPayload.inStock,
      };

      if (adminSupabase) {
        assertWritten(
          await adminSupabase.from('products').upsert({
            id: updatedProduct.id,
            name: updatedProduct.name,
            slug: updatedProduct.slug,
            description: updatedProduct.description,
            price_bani: updatedProduct.price_bani,
            category: updatedProduct.category,
            badge: updatedProduct.badge,
            image_url: updatedProduct.image_url,
            in_stock: updatedProduct.in_stock,
            updated_at: new Date().toISOString(),
          }),
          'products'
        );

        await writeAuditLog(adminSupabase, traceId, {
          action: isCreate ? 'CREATE' : 'UPDATE',
          entityType: 'products',
          entityId: updatedProduct.id,
          afterState: updatedProduct,
        });
      }

      const existingIdx = localStore.products.findIndex((p) => p.id === productId);
      const nextProducts =
        existingIdx >= 0
          ? localStore.products.map((p, idx) => (idx === existingIdx ? updatedProduct : p))
          : [...localStore.products, updatedProduct];

      await writeLocalCatalogStore({
        products: nextProducts,
        weeklyOffer: localStore.weeklyOffer,
        updatedAt: new Date().toISOString(),
      });

      writeStructuredLog({
        level: 'info',
        event: isCreate ? 'admin.product_created' : 'admin.product_updated',
        trace_id: traceId,
        product_id: updatedProduct.id,
        category: updatedProduct.category,
        price_bani: updatedProduct.price_bani,
      });

      return jsonOk(traceId, {
        ok: true,
        message: isCreate
          ? `Aranjamentul „${updatedProduct.name}” a fost adăugat în rubrica ${updatedProduct.category.toUpperCase()}!`
          : `Aranjamentul „${updatedProduct.name}” a fost actualizat cu succes!`,
        product: updatedProduct,
      });
    }

    if (actionPayload.action === 'delete_product') {
      const targetId = actionPayload.id;

      if (adminSupabase) {
        assertWritten(await adminSupabase.from('products').delete().eq('id', targetId), 'products');

        await writeAuditLog(adminSupabase, traceId, {
          action: 'DELETE',
          entityType: 'products',
          entityId: targetId,
        });
      }

      await writeLocalCatalogStore({
        products: localStore.products.filter((p) => p.id !== targetId),
        weeklyOffer: localStore.weeklyOffer,
        updatedAt: new Date().toISOString(),
      });

      writeStructuredLog({
        level: 'info',
        event: 'admin.product_deleted',
        trace_id: traceId,
        product_id: targetId,
      });

      return jsonOk(traceId, {
        ok: true,
        message: 'Produsul a fost eliminat din catalog.',
      });
    }

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/unsupported-action',
      title: 'Acțiune Necunoscută',
      status: 400,
      detail: 'Acțiunea solicitată nu este suportată.',
      instance,
      trace_id: traceId,
    });
  } catch (err) {
    if (err instanceof PersistenceError && err.code === '23503') {
      return createProblemResponse({
        type: 'https://floraria-siati.ro/errors/product-has-orders',
        title: 'Produsul Are Comenzi Asociate',
        status: 409,
        detail:
          'Produsul nu poate fi șters pentru că există comenzi înregistrate pentru el. Marchează-l ca indisponibil în loc să îl ștergi.',
        instance,
        trace_id: traceId,
      });
    }

    writeStructuredLog({
      level: 'error',
      event: 'admin.catalog_save_failed',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_code: err instanceof PersistenceError ? err.code : undefined,
    });

    const detail =
      err instanceof RangeError
        ? err.message
        : 'Nu am putut salva modificarea. Verifică datele introduse.';
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/admin-save-error',
      title: 'Eroare la Salvare',
      status: err instanceof RangeError ? 400 : 500,
      detail,
      instance,
      trace_id: traceId,
    });
  }
};

/**
 * Jurnalul de audit nu blochează operațiunea principală, dar eșecul lui este mereu logat.
 */
async function writeAuditLog(
  client: NonNullable<ReturnType<typeof createAdminSupabaseClient>>,
  traceId: string,
  entry: {
    readonly action: 'CREATE' | 'UPDATE' | 'DELETE';
    readonly entityType: string;
    readonly entityId: string;
    readonly afterState?: unknown;
  }
): Promise<void> {
  const { error } = await client.from('audit_logs').insert({
    actor_id: 'admin_panel',
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    after_state: entry.afterState ?? null,
    trace_id: traceId,
  });

  if (error) {
    writeStructuredLog({
      level: 'warn',
      event: 'admin.audit_log_failed',
      trace_id: traceId,
      error_message: error.message,
    });
  }
}
