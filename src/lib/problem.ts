export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly trace_id: string;
  readonly invalid_params?: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
  /** Secunde până la o nouă încercare (HTTP 429/503); este trimis și ca antet `Retry-After`. */
  readonly retry_after_seconds?: number;
  /** Text afișabil direct în interfață (ex.: formularul de newsletter citește `message`). */
  readonly message?: string;
}

/**
 * Construiește un răspuns HTTP standardizat conform RFC 7807 (Modulul 7.3).
 */
export function createProblemResponse(params: ProblemDetails): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Correlation-ID': params.trace_id,
  };

  if (params.retry_after_seconds !== undefined) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(params.retry_after_seconds)));
  }

  return new Response(JSON.stringify(params), {
    status: params.status,
    headers,
  });
}

/**
 * Jurnalizare server-side JSON structurată cu trace_id (Modulul 3 - zero console.log).
 */
export function writeStructuredLog(entry: {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly trace_id: string;
  readonly [key: string]: unknown;
}): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (entry.level === 'error') {
    process.stderr.write(`${payload}\n`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}
