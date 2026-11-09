import { createProblemResponse } from './problem';

/**
 * IP-ul clientului așa cum îl raportează Cloudflare. Antetul `cf-connecting-ip` este rescris de
 * edge și nu poate fi falsificat de client. Fără el (dezvoltare locală) folosim o cheie comună.
 */
export function getClientIp(request: Request): string {
  const value = request.headers.get('cf-connecting-ip')?.trim();
  return value && value.length <= 64 ? value : 'unknown';
}

/**
 * Respinge cererile inițiate cross-site de un browser (Sec-Fetch-Site / Origin).
 * Cererile fără aceste antete (curl, cron, webhook) nu sunt evaluate aici: pentru ele
 * protecția rămâne autentificarea (cookie SameSite=Strict, Bearer, semnătură Stripe).
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false;
  }

  const origin = request.headers.get('origin');
  if (origin !== null) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }

  return true;
}

export type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'too_large' | 'invalid_json' };

/**
 * Citește un corp JSON cu limită strictă de dimensiune, fără a încărca în memorie fluxuri uriașe.
 */
export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number
): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, reason: 'invalid_json' };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(merged)) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

export function crossSiteBlockedResponse(instance: string, traceId: string): Response {
  return createProblemResponse({
    type: 'https://floraria-siati.ro/errors/cross-site-blocked',
    title: 'Cerere Blocată',
    status: 403,
    detail: 'Cererea provine de pe o altă origine și a fost respinsă din motive de securitate.',
    instance,
    trace_id: traceId,
  });
}

export function rateLimitedResponse(params: {
  readonly instance: string;
  readonly traceId: string;
  readonly retryAfterSeconds: number;
  readonly detail?: string;
}): Response {
  const detail =
    params.detail ?? 'Prea multe încercări într-un interval scurt. Te rugăm să reîncerci peste câteva minute.';
  return createProblemResponse({
    type: 'https://floraria-siati.ro/errors/rate-limited',
    title: 'Prea Multe Cereri',
    status: 429,
    detail,
    message: detail,
    instance: params.instance,
    trace_id: params.traceId,
    retry_after_seconds: params.retryAfterSeconds,
  });
}

export function invalidBodyResponse(
  reason: 'too_large' | 'invalid_json',
  instance: string,
  traceId: string
): Response {
  if (reason === 'too_large') {
    return createProblemResponse({
      type: 'https://floraria-siati.ro/errors/payload-too-large',
      title: 'Cerere Prea Mare',
      status: 413,
      detail: 'Corpul cererii depășește dimensiunea maximă permisă.',
      instance,
      trace_id: traceId,
    });
  }
  return createProblemResponse({
    type: 'https://floraria-siati.ro/errors/invalid-json',
    title: 'JSON Malformat',
    status: 400,
    detail: 'Corpul cererii nu este un JSON valid.',
    instance,
    trace_id: traceId,
  });
}
