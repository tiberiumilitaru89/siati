import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { requireAdminSession } from '../../../lib/admin-guard';
import { createProblemResponse, writeStructuredLog } from '../../../lib/problem';
import { createAdminSupabaseClient } from '../../../lib/supabase';
import {
  declaredMimeMatches,
  detectImageType,
  IMAGE_TYPE_INFO,
} from '../../../lib/upload-validation';

export const prerender = false;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_MULTIPART_OVERHEAD_BYTES = 512 * 1024;

function okResponse(traceId: string, imageUrl: string, message: string): Response {
  return new Response(JSON.stringify({ ok: true, imageUrl, message }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Correlation-ID': traceId,
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const traceId = crypto.randomUUID();
  const instance = new URL(request.url).pathname;

  const denied = requireAdminSession(request, instance, traceId);
  if (denied) {
    return denied;
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/file-too-large',
      title: 'Fotografie Prea Mare',
      status: 413,
      detail: 'Dimensiunea maximă permisă pentru o fotografie este de 8 MB.',
      instance,
      trace_id: traceId,
    });
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return createProblemResponse({
        type: 'https://floraria-siati.ro/errors/invalid-multipart',
        title: 'Cerere Invalidă',
        status: 400,
        detail: 'Cererea de încărcare nu a putut fi citită. Reîncearcă selectarea fotografiei.',
        instance,
        trace_id: traceId,
      });
    }

    const fileEntry = formData.get('photo');

    if (!(fileEntry instanceof File)) {
      return createProblemResponse({
        type: 'https://floraria-siati.ro/errors/missing-photo',
        title: 'Fișier Lipsă',
        status: 400,
        detail: 'Selectează o fotografie (JPG, PNG sau WebP) de pe telefon sau calculator.',
        instance,
        trace_id: traceId,
      });
    }

    if (fileEntry.size <= 0 || fileEntry.size > MAX_UPLOAD_BYTES) {
      return createProblemResponse({
        type: 'https://floraria-siati.ro/errors/file-too-large',
        title: 'Fotografie Prea Mare',
        status: 413,
        detail: 'Dimensiunea maximă permisă pentru o fotografie este de 8 MB.',
        instance,
        trace_id: traceId,
      });
    }

    const fileBytes = new Uint8Array(await fileEntry.arrayBuffer());
    const detectedType = detectImageType(fileBytes);

    if (!detectedType || !declaredMimeMatches(fileEntry.type, detectedType)) {
      writeStructuredLog({
        level: 'warn',
        event: 'admin.upload_rejected_content',
        trace_id: traceId,
        declared_mime: fileEntry.type,
      });
      return createProblemResponse({
        type: 'https://floraria-siati.ro/errors/invalid-mime',
        title: 'Format Imagine Nepermis',
        status: 415,
        detail: 'Sunt acceptate doar fotografii reale în format JPG, PNG, WebP sau AVIF.',
        instance,
        trace_id: traceId,
      });
    }

    const typeInfo = IMAGE_TYPE_INFO[detectedType];
    const fileName = `siati-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${typeInfo.extension}`;

    // 1. Supabase Storage (singura stocare persistentă pe Cloudflare Pages)
    const adminSupabase = createAdminSupabaseClient();
    if (adminSupabase) {
      const { error: uploadError } = await adminSupabase.storage
        .from('catalog-photos')
        .upload(fileName, fileBytes, { contentType: typeInfo.mime, upsert: false });

      if (uploadError) {
        writeStructuredLog({
          level: 'error',
          event: 'admin.photo_upload_storage_failed',
          trace_id: traceId,
          error_message: uploadError.message,
        });
        return createProblemResponse({
          type: 'https://floraria-siati.ro/errors/storage-failed',
          title: 'Stocarea Fotografiei a Eșuat',
          status: 502,
          detail:
            'Fotografia nu a putut fi salvată în Supabase Storage. Verifică existența bucket-ului public „catalog-photos”.',
          instance,
          trace_id: traceId,
        });
      }

      const { data: publicData } = adminSupabase.storage.from('catalog-photos').getPublicUrl(fileName);

      writeStructuredLog({
        level: 'info',
        event: 'admin.photo_uploaded_supabase',
        trace_id: traceId,
        image_url: publicData.publicUrl,
        bytes: fileBytes.byteLength,
      });

      return okResponse(traceId, publicData.publicUrl, 'Fotografia a fost încărcată în Supabase Storage!');
    }

    // 2. Doar în dezvoltare locală (astro dev): salvare pe disc. Ramura dispare din build-ul de producție.
    if (import.meta.env.DEV) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
      await fs.mkdir(uploadsDir, { recursive: true });
      await fs.writeFile(path.join(uploadsDir, fileName), fileBytes);

      writeStructuredLog({
        level: 'info',
        event: 'admin.photo_uploaded_local',
        trace_id: traceId,
        bytes: fileBytes.byteLength,
      });
      return okResponse(traceId, `/uploads/${fileName}`, 'Fotografia a fost salvată pe disc (mod dezvoltare).');
    }

    writeStructuredLog({
      level: 'error',
      event: 'admin.photo_upload_storage_unconfigured',
      trace_id: traceId,
    });
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/storage-unconfigured',
      title: 'Stocare Imagini Neconfigurată',
      status: 503,
      detail:
        'Supabase Storage nu este configurat pe server (PUBLIC_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY), deci fotografiile nu pot fi încărcate.',
      instance,
      trace_id: traceId,
    });
  } catch (err) {
    writeStructuredLog({
      level: 'error',
      event: 'admin.photo_upload_failed',
      trace_id: traceId,
      error_name: err instanceof Error ? err.name : 'UploadError',
    });

    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/upload-failed',
      title: 'Eroare la Procesarea Fotografiei',
      status: 500,
      detail: 'Fotografia nu a putut fi procesată. Te rugăm să încerci o altă imagine.',
      instance,
      trace_id: traceId,
    });
  }
};
