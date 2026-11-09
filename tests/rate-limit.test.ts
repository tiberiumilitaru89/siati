import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limit';

function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit and then refuses with a retry delay', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now });

    expect(limiter.consume('ip').remaining).toBe(2);
    expect(limiter.consume('ip').remaining).toBe(1);
    expect(limiter.consume('ip').remaining).toBe(0);

    const refused = limiter.consume('ip');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it('does not extend the window with refused attempts', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(limiter.consume('ip').allowed).toBe(true);
    clock.advance(30_000);
    expect(limiter.consume('ip').allowed).toBe(false);
    clock.advance(30_001);
    expect(limiter.consume('ip').allowed).toBe(true);
  });

  it('reports the remaining wait time as the window slides', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    limiter.consume('ip');
    clock.advance(45_000);
    expect(limiter.status('ip')).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 15 });
  });

  it('tracks keys independently', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
  });

  it('status() never consumes, record() always counts (failed-login pattern)', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now });

    expect(limiter.status('ip').allowed).toBe(true);
    expect(limiter.status('ip').remaining).toBe(2);

    limiter.record('ip');
    limiter.record('ip');
    expect(limiter.status('ip').allowed).toBe(false);

    limiter.reset('ip');
    expect(limiter.status('ip').allowed).toBe(true);
  });

  it('bounds memory by evicting old keys', () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now: clock.now });

    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      limiter.record(key);
    }
    // cele mai vechi chei au fost eliminate, deci pot consuma din nou
    expect(limiter.status('a').allowed).toBe(true);
    expect(limiter.status('e').allowed).toBe(false);
  });

  it('rejects invalid configuration', () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => new SlidingWindowRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
  });
});
