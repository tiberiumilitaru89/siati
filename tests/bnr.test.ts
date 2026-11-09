import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const xml = (rate: string, date = '2026-11-04') =>
  `<?xml version="1.0" encoding="utf-8"?><DataSet xmlns="http://www.bnr.ro/xsd"><Body><Cube date="${date}"><Rate currency="EUR">${rate}</Rate></Cube></Body></DataSet>`;

/** Modulul ține cache în memorie: îl reîncărcăm pentru fiecare test. */
async function loadBnr() {
  vi.resetModules();
  return import('../src/lib/bnr');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getLiveBnrEurRate', () => {
  it('reads the official rate and serves it from memory afterwards', async () => {
    const fetchMock = vi.fn(async () => new Response(xml('5.3443'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLiveBnrEurRate } = await loadBnr();

    const first = await getLiveBnrEurRate();
    const second = await getLiveBnrEurRate();

    expect(first).toMatchObject({ rateNumber: 5.3443, rateBaniScaled: 53443n, isFallback: false, date: '2026-11-04' });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks Cloudflare to cache the feed at the edge and never waits more than a few seconds', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(xml('5.3443'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getLiveBnrEurRate } = await loadBnr();

    await getLiveBnrEurRate();

    const init = fetchMock.mock.calls[0]?.[1] as (RequestInit & { cf?: unknown }) | undefined;
    expect(init?.cf).toEqual({ cacheTtl: 3600, cacheEverything: true });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the safety constant when BNR is down and nothing is known, without retrying on every request', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('BNR offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getLiveBnrEurRate, FALLBACK_EUR_RATE_SCALED } = await loadBnr();

    const first = await getLiveBnrEurRate();
    expect(first).toMatchObject({ isFallback: true, rateBaniScaled: FALLBACK_EUR_RATE_SCALED });

    vi.setSystemTime(new Date('2026-11-04T10:00:59Z'));
    await getLiveBnrEurRate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-04T10:01:01Z'));
    await getLiveBnrEurRate();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prefers the last real BNR rate over the constant when a refresh fails (stale-if-error)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(xml('5.3443'), { status: 200 }))
      .mockRejectedValue(new Error('BNR offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { getLiveBnrEurRate } = await loadBnr();

    await getLiveBnrEurRate();
    vi.setSystemTime(new Date('2026-11-04T17:00:00Z')); // după cele 6 ore de cache

    const stale = await getLiveBnrEurRate();
    expect(stale).toMatchObject({ rateNumber: 5.3443, isFallback: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an invalid response as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nu e XML BNR</html>', { status: 200 })));
    const { getLiveBnrEurRate } = await loadBnr();
    expect((await getLiveBnrEurRate()).isFallback).toBe(true);
  });
});
