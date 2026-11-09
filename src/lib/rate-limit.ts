/**
 * Limitator de rată cu fereastră glisantă, ținut în memoria instanței (izolatului Workers).
 *
 * LIMITARE ASUMATĂ: pe Cloudflare fiecare izolat are propria memorie, deci limita efectivă este
 * `limit × numărul de izolate active`. Este un strat de apărare în adâncime, nu o garanție strictă.
 * Garanția strictă vine din regula Cloudflare WAF → Rate limiting configurată în dashboard.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Numărul maxim de evenimente permise în fereastră. */
  readonly limit: number;
  /** Lungimea ferestrei glisante, în milisecunde. */
  readonly windowMs: number;
  /** Numărul maxim de chei urmărite simultan (protecție de memorie). */
  readonly maxKeys?: number;
  /** Sursă de timp injectabilă pentru teste. */
  readonly now?: () => number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new RangeError('Limita trebuie să fie un număr întreg ≥ 1.');
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new RangeError('Fereastra trebuie să fie un număr pozitiv de milisecunde.');
    }
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 5000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Citește starea curentă fără a înregistra un eveniment nou.
   */
  status(key: string): RateLimitDecision {
    const timestamps = this.live(key);
    if (timestamps.length < this.limit) {
      return { allowed: true, remaining: this.limit - timestamps.length, retryAfterSeconds: 0 };
    }
    const oldest = timestamps[0] ?? this.now();
    const waitMs = oldest + this.windowMs - this.now();
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  /**
   * Înregistrează un eveniment doar dacă mai există loc în fereastră.
   * Încercările refuzate nu prelungesc fereastra.
   */
  consume(key: string): RateLimitDecision {
    const decision = this.status(key);
    if (!decision.allowed) {
      return decision;
    }
    this.record(key);
    return { ...decision, remaining: decision.remaining - 1 };
  }

  /**
   * Înregistrează necondiționat un eveniment (ex.: o autentificare eșuată).
   */
  record(key: string): void {
    const timestamps = this.live(key);
    timestamps.push(this.now());
    this.hits.set(key, timestamps);
    this.evictIfNeeded();
  }

  /**
   * Șterge istoricul unei chei (ex.: după o autentificare reușită).
   */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private live(key: string): number[] {
    const current = this.hits.get(key);
    if (!current) {
      return [];
    }
    const cutoff = this.now() - this.windowMs;
    const fresh = current.filter((timestamp) => timestamp > cutoff);
    if (fresh.length === 0) {
      this.hits.delete(key);
      return [];
    }
    if (fresh.length !== current.length) {
      this.hits.set(key, fresh);
    }
    return fresh;
  }

  private evictIfNeeded(): void {
    if (this.hits.size <= this.maxKeys) {
      return;
    }
    const cutoff = this.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const last = timestamps[timestamps.length - 1] ?? 0;
      if (last <= cutoff) {
        this.hits.delete(key);
      }
    }
    while (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next();
      if (first.done) {
        break;
      }
      this.hits.delete(first.value);
    }
  }
}

/** Autentificări eșuate în `/admin`: 5 eșecuri / 15 minute / IP. */
export const adminLoginFailures = new SlidingWindowRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

/** Inițieri de plată: 15 / 10 minute / IP. */
export const checkoutAttempts = new SlidingWindowRateLimiter({ limit: 15, windowMs: 10 * 60_000 });

/** Abonări la newsletter: 8 / 10 minute / IP. */
export const newsletterAttempts = new SlidingWindowRateLimiter({ limit: 8, windowMs: 10 * 60_000 });
